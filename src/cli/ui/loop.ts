/**
 * `/loop <interval> <prompt>` parsing + status formatting.
 *
 * Claude-Code-style recurring prompt: at every `<interval>` tick, the
 * App auto-submits `<prompt>` as if the user typed it. Useful for "keep
 * checking the deploy" / "rerun tests" / "watch the build status until
 * green" — anything the user wants probed periodically without holding
 * the keyboard.
 *
 * Cancellation contract (enforced in App.tsx, not here — this file is
 * pure):
 *   - `/loop stop`               → explicit stop slash
 *   - user types anything else   → loop dies, user takes over
 *   - Esc / /new / /clear / exit → loop dies
 *   - one loop per session       → re-issuing /loop replaces the prior
 *
 * Interval bounds:
 *   - Minimum: 5 seconds (anything tighter and the model couldn't even
 *     finish a turn before the next firing — we'd queue submits and
 *     drift forever).
 *   - Maximum: 6 hours (the upper end of "let it run while I sleep";
 *     beyond that you should be writing a cron, not a TUI loop).
 */

/** Lower bound on loop interval (ms). Faster than this would queue submits faster than turns finish. */
export const MIN_LOOP_INTERVAL_MS = 5_000;
/** Upper bound on loop interval (ms). Beyond a few hours, use cron. */
export const MAX_LOOP_INTERVAL_MS = 6 * 60 * 60_000;

/**
 * Parse a duration string into milliseconds.
 *
 * Accepted forms (case-insensitive on the unit):
 *   - `45`      → 45_000   (bare number = seconds)
 *   - `30s`     → 30_000
 *   - `5m`      → 300_000
 *   - `2h`      → 7_200_000
 *   - `1.5m`    → 90_000   (fractional supported)
 *
 * Returns `null` on:
 *   - empty input
 *   - non-numeric / unknown unit
 *   - negative or zero values
 *   - values outside [MIN_LOOP_INTERVAL_MS, MAX_LOOP_INTERVAL_MS]
 *
 * Caller surfaces `null` as a usage hint to the user. Pure.
 */
export function parseLoopInterval(raw: string): { ms: number } | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = /^([0-9]+(?:\.[0-9]+)?)(s|sec|secs|m|min|mins|h|hr|hrs)?$/.exec(s);
  if (!m) return null;
  const n = Number.parseFloat(m[1] ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? "s";
  let ms: number;
  if (unit === "s" || unit === "sec" || unit === "secs") ms = Math.round(n * 1000);
  else if (unit === "m" || unit === "min" || unit === "mins") ms = Math.round(n * 60_000);
  else if (unit === "h" || unit === "hr" || unit === "hrs") ms = Math.round(n * 60 * 60_000);
  else return null;
  if (ms < MIN_LOOP_INTERVAL_MS) return null;
  if (ms > MAX_LOOP_INTERVAL_MS) return null;
  return { ms };
}

export interface ParsedLoopArgs {
  intervalMs: number;
  prompt: string;
}

/**
 * Parse the full `/loop <interval> <prompt>` invocation. Args is the
 * commander-style tail (already split on whitespace, slash command
 * stripped). Returns `null` when the shape is wrong; caller emits a
 * usage hint.
 *
 * Special tokens:
 *   - `stop` (case-insensitive) as the only arg → caller should stop
 *     the active loop. Returns a sentinel: `{ stop: true }`.
 *   - empty args → returns `{ status: true }` so the caller can print
 *     the active-loop status (or "no loop active").
 *
 * Otherwise the first token is the interval, the rest is the prompt.
 * The prompt may itself be a slash command (`/loop 30s /status` is a
 * valid way to keep refreshing the status panel).
 */
export type LoopCommand =
  | { kind: "start"; intervalMs: number; prompt: string }
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "error"; message: string };

export function parseLoopCommand(args: readonly string[]): LoopCommand {
  if (args.length === 0) return { kind: "status" };
  const first = (args[0] ?? "").toLowerCase();
  if (args.length === 1 && (first === "stop" || first === "off" || first === "cancel")) {
    return { kind: "stop" };
  }
  const interval = parseLoopInterval(args[0] ?? "");
  if (!interval) {
    return {
      kind: "error",
      message:
        "usage: /loop <interval> <prompt>   (interval = 5s..6h, e.g. 30s, 5m, 1h)\n" +
        "       /loop stop                  (cancel an active loop)\n" +
        "       /loop                       (show active-loop status)",
    };
  }
  const prompt = args.slice(1).join(" ").trim();
  if (!prompt) {
    return {
      kind: "error",
      message: `usage: /loop ${args[0]} <prompt>   — interval is fine but the prompt is missing.`,
    };
  }
  return { kind: "start", intervalMs: interval.ms, prompt };
}

/**
 * Format the active loop into a single-line status pill for the
 * modeline. `nextFireMs` is wall-clock ms until next firing; the
 * caller computes it from the stored `nextFireAt - Date.now()`.
 *
 * Examples:
 *   "loop: `npm test` · next in 28s · iter 3"
 *   "loop: `check deploy status` · firing now · iter 1"
 */
export function formatLoopStatus(prompt: string, nextFireMs: number, iter: number): string {
  const preview = prompt.length > 36 ? `${prompt.slice(0, 33)}…` : prompt;
  const when = nextFireMs <= 0 ? "firing now" : `next in ${formatDuration(nextFireMs)}`;
  return `loop: \`${preview}\` · ${when} · iter ${iter}`;
}

/**
 * Human-friendly duration. Used by the loop status pill so a 4-minute
 * 23-second wait reads as "4m23s" instead of "263000".
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h${mm}m`;
}
