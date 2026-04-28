/**
 * `/api/semantic` — control the on-disk semantic index from the
 * dashboard.
 *
 *   GET  /api/semantic            → { ollama, index, job } snapshot
 *   POST /api/semantic/start      → kick off buildIndex({ rebuild })
 *   POST /api/semantic/stop       → abort the in-flight job
 *
 * The job state lives in a module-scoped Map keyed by project root so
 * two dashboards (same process, different roots) don't collide. Each
 * entry is a small in-memory record: phase, counters, last result or
 * error. Endpoints just read/write that record; the actual indexing
 * runs as a fire-and-forget Promise that updates the record via
 * `onProgress` as it goes.
 *
 * `reasonix index` from the CLI is independent of this — it spawns
 * its own buildIndex, doesn't touch this Map. Users mixing both will
 * see the dashboard report whatever the dashboard last started, even
 * if the CLI is also running. Acceptable: real concurrent runs of
 * buildIndex on the same root would race anyway, and we surface the
 * "running" state so the user can choose not to start another.
 */

import { buildIndex, indexExists } from "../../index/semantic/builder.js";
import type { BuildProgress, BuildResult } from "../../index/semantic/builder.js";
import { probeOllama } from "../../index/semantic/embedding.js";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

interface JobRecord {
  startedAt: number;
  phase: BuildProgress["phase"] | "error";
  filesScanned?: number;
  filesChanged?: number;
  filesSkipped?: number;
  chunksTotal?: number;
  chunksDone?: number;
  result?: BuildResult;
  error?: string;
  rebuild: boolean;
  // AbortController so /api/semantic/stop can interrupt — buildIndex
  // doesn't accept a signal yet, but the CLI's tool registers one and
  // we can extend builder later. For now stop is a no-op signal that
  // the SPA can show feedback for; the next phase boundary picks it
  // up by checking `aborted` if/when builder gains a signal arg.
  aborted: boolean;
}

const JOBS = new Map<string, JobRecord>();

function getRoot(ctx: DashboardContext): string | null {
  const cwd = ctx.getCurrentCwd?.();
  return cwd ?? null;
}

export async function handleSemantic(
  method: string,
  rest: string[],
  body: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  const sub = rest[0] ?? "";

  if (sub === "" && method === "GET") {
    return await getStatus(ctx);
  }
  if (sub === "start" && method === "POST") {
    return await startJob(body, ctx);
  }
  if (sub === "stop" && method === "POST") {
    return await stopJob(ctx);
  }
  return { status: 404, body: { error: "no such semantic endpoint" } };
}

async function getStatus(ctx: DashboardContext): Promise<ApiResult> {
  const root = getRoot(ctx);
  if (!root) {
    return {
      status: 200,
      body: {
        attached: false,
        reason:
          "Semantic indexing requires a code-mode session — run `/dashboard` from inside `reasonix code` instead of standalone `reasonix dashboard`.",
      },
    };
  }
  const [hasIndex, ollama] = await Promise.all([
    indexExists(root),
    probeOllama({}).catch(() => ({ ok: false, error: "probe failed" })),
  ]);
  const job = JOBS.get(root) ?? null;
  return {
    status: 200,
    body: {
      attached: true,
      root,
      index: { exists: hasIndex },
      ollama,
      job: job ? snapshotJob(job) : null,
    },
  };
}

function snapshotJob(j: JobRecord): unknown {
  return {
    startedAt: j.startedAt,
    phase: j.phase,
    rebuild: j.rebuild,
    filesScanned: j.filesScanned ?? null,
    filesChanged: j.filesChanged ?? null,
    filesSkipped: j.filesSkipped ?? null,
    chunksTotal: j.chunksTotal ?? null,
    chunksDone: j.chunksDone ?? null,
    aborted: j.aborted,
    result: j.result ?? null,
    error: j.error ?? null,
  };
}

interface StartBody {
  rebuild?: unknown;
}

async function startJob(body: string, ctx: DashboardContext): Promise<ApiResult> {
  const root = getRoot(ctx);
  if (!root) {
    return {
      status: 400,
      body: { error: "no project root — only available in attached (code-mode) dashboards" },
    };
  }
  const existing = JOBS.get(root);
  if (
    existing &&
    (existing.phase === "scan" || existing.phase === "embed" || existing.phase === "write")
  ) {
    return {
      status: 409,
      body: { error: "an indexing job is already running", job: snapshotJob(existing) },
    };
  }

  let parsed: StartBody = {};
  if (body) {
    try {
      parsed = JSON.parse(body) as StartBody;
    } catch {
      return { status: 400, body: { error: "invalid JSON body" } };
    }
  }
  const rebuild = parsed.rebuild === true;

  const job: JobRecord = {
    startedAt: Date.now(),
    phase: "scan",
    rebuild,
    aborted: false,
  };
  JOBS.set(root, job);

  // Fire-and-forget — endpoint returns immediately so the SPA can
  // poll /api/semantic for progress instead of blocking on a long
  // request that might exceed the browser's idle timeout.
  void runIndex(root, job).catch((err) => {
    job.phase = "error";
    job.error = err instanceof Error ? err.message : String(err);
  });

  return { status: 202, body: { started: true, job: snapshotJob(job) } };
}

async function runIndex(root: string, job: JobRecord): Promise<void> {
  try {
    const result = await buildIndex(root, {
      rebuild: job.rebuild,
      onProgress: (p) => {
        job.phase = p.phase;
        if (p.filesScanned !== undefined) job.filesScanned = p.filesScanned;
        if (p.filesChanged !== undefined) job.filesChanged = p.filesChanged;
        if (p.filesSkipped !== undefined) job.filesSkipped = p.filesSkipped;
        if (p.chunksTotal !== undefined) job.chunksTotal = p.chunksTotal;
        if (p.chunksDone !== undefined) job.chunksDone = p.chunksDone;
      },
    });
    job.phase = "done";
    job.result = result;
  } catch (err) {
    job.phase = "error";
    job.error = err instanceof Error ? err.message : String(err);
  }
}

async function stopJob(ctx: DashboardContext): Promise<ApiResult> {
  const root = getRoot(ctx);
  if (!root) {
    return { status: 400, body: { error: "no project root" } };
  }
  const job = JOBS.get(root);
  if (!job || job.phase === "done" || job.phase === "error") {
    return { status: 404, body: { error: "no running job" } };
  }
  job.aborted = true;
  // builder.ts doesn't honor an AbortSignal yet — flagging the job is
  // best-effort. The SPA still surfaces "stopping…" so the user knows
  // the request was received; the next done/error update lands when
  // the build naturally terminates.
  return { status: 202, body: { stopping: true, job: snapshotJob(job) } };
}
