import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

const MAX_FILE_SIZE = 500 * 1024; // 500KB

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".pyc",
  ".o",
  ".obj",
]);

export async function handleFileRead(
  method: string,
  rest: string[],
  _body: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  if (method !== "GET") return { status: 405, body: { error: "GET only" } };

  const filePath = decodeURIComponent(rest.join("/"));
  if (!filePath) return { status: 400, body: { error: "file path required" } };

  const cwd = ctx.getCurrentCwd?.();
  if (!cwd || !existsSync(cwd)) {
    return { status: 503, body: { error: "no project directory available" } };
  }

  const fullPath = join(cwd, filePath);

  if (!existsSync(fullPath)) {
    return { status: 404, body: { error: `file not found: ${filePath}` } };
  }

  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(fullPath);
  } catch {
    return { status: 500, body: { error: "cannot stat file" } };
  }

  if (!st.isFile()) {
    return { status: 400, body: { error: "not a file" } };
  }

  if (st.size > MAX_FILE_SIZE) {
    return {
      status: 413,
      body: { error: `file too large (${st.size} bytes, max ${MAX_FILE_SIZE})` },
    };
  }

  const ext = extname(filePath).toLowerCase();
  if (BINARY_EXTS.has(ext)) {
    return { status: 400, body: { error: "binary file not supported" } };
  }

  try {
    const content = readFileSync(fullPath, "utf-8");
    return { status: 200, body: { content, path: filePath, size: st.size } };
  } catch (err) {
    return { status: 500, body: { error: `read failed: ${(err as Error).message}` } };
  }
}
