/**
 * τ-bench runner — v0.0.1 scaffold.
 *
 * Full implementation lands in v0.1. This file documents the surface the
 * benchmark will have so the reporting format is stable from day one.
 *
 *   npx tsx benchmarks/tau-bench/runner.ts --n 20 --model deepseek-chat
 */

import { writeFileSync } from "node:fs";
import {
  CacheFirstLoop,
  DeepSeekClient,
  ImmutablePrefix,
  type SessionSummary,
  loadDotenv,
} from "../../src/index.js";

loadDotenv();

interface TauTask {
  id: string;
  instruction: string;
  /** Accept string-match / LLM-judge in v0.1; v0.0.1 records only. */
  check?: (finalAnswer: string) => boolean;
}

/** Placeholder tasks — replace with the real τ-bench dataset in v0.1. */
const SAMPLE_TASKS: TauTask[] = [
  { id: "t1", instruction: "What is 17 + 25? Answer with just the number." },
  { id: "t2", instruction: "Spell 'caching' backwards." },
  { id: "t3", instruction: "Return the JSON {\"ok\": true} exactly." },
];

interface RunResult {
  taskId: string;
  final: string;
  stats: SessionSummary;
  ok: boolean | null;
}

export async function runBench(n: number, model: string): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const tasks = SAMPLE_TASKS.slice(0, n);

  for (const task of tasks) {
    const client = new DeepSeekClient();
    const prefix = new ImmutablePrefix({
      system: "You solve benchmark tasks. Answer concisely.",
    });
    const loop = new CacheFirstLoop({ client, prefix, model });
    const final = await loop.run(task.instruction);
    const ok = task.check ? task.check(final) : null;
    results.push({ taskId: task.id, final, stats: loop.stats.summary(), ok });
    process.stdout.write(
      `[${task.id}] ok=${ok} cache=${(loop.stats.aggregateCacheHitRatio * 100).toFixed(1)}% ` +
        `cost=$${loop.stats.totalCost.toFixed(6)}\n`,
    );
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let n = 3;
  let model = "deepseek-chat";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--n") n = Number.parseInt(args[++i] ?? "3", 10);
    else if (args[i] === "--model") model = args[++i] ?? model;
  }
  const results = await runBench(n, model);
  const out = `benchmarks/tau-bench/results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(results, null, 2), "utf8");
  console.log(`wrote ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
