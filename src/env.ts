import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal `.env` loader; no dependency on dotenv.
 *
 * Reads KEY=VALUE lines and populates `process.env` for keys not already set.
 * Silently no-ops if the file is missing. Safe to call from library entry
 * points, CLI commands, examples, and benchmark runners.
 */
export function loadDotenv(path = ".env"): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
