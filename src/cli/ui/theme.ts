/**
 * Reasonix visual theme.
 *
 * One source of truth for colors, glyphs, and decorative blocks so
 * the TUI reads as one designed surface instead of fifteen
 * components inventing their own palette. All colors are truecolor
 * hex; Ink degrades to the nearest 256-color / 8-color slot on
 * older terminals, so the worst case is still legible.
 *
 * Why a module rather than a context: tests import these strings,
 * Ink components consume them as `color={...}` props, and there's
 * no theming switch (light/dark) — one project, one palette.
 */

/** Brand gradient — the same teal → cyan → blue → purple → fuchsia
 * sweep used by the REASONIX wordmark. Reused for accent bars,
 * progress fills, and decorative dividers. */
export const GRADIENT: ReadonlyArray<string> = [
  "#5eead4", // teal
  "#67e8f9", // cyan
  "#7dd3fc", // sky
  "#93c5fd", // blue
  "#a5b4fc", // indigo
  "#c4b5fd", // violet
  "#d8b4fe", // purple
  "#f0abfc", // fuchsia
];

/** Solid palette — semantic colors used for status, role, and
 * accent surfaces. Sourced from the Tailwind 400/500 row so the
 * tone is consistent with the gradient. */
export const COLOR = {
  primary: "#67e8f9", // cyan-300
  accent: "#c4b5fd", // violet-300
  brand: "#5eead4", // teal-300

  user: "#67e8f9", // user message glyph + bar
  assistant: "#86efac", // green-300, assistant glyph + bar
  tool: "#fcd34d", // amber-300, tool ok pill bg
  toolErr: "#fda4af", // rose-300, tool err pill bg
  info: "#94a3b8", // slate-400, info / dim
  warn: "#fbbf24", // amber-400
  err: "#f87171", // red-400
  ok: "#4ade80", // green-400
} as const;

/**
 * Glyphs — one consistent alphabet for the whole TUI. Geometric
 * shapes (◇ ◆ ▣ ▥) make the role of a row readable at a glance
 * after one or two turns; arrows (› ▸ ▶) consistently mean
 * "selection / focus / next." Brand mark is reserved for the app
 * header.
 */
export const GLYPH = {
  brand: "◈",
  user: "◇",
  assistant: "◆",
  toolOk: "▣",
  toolErr: "▥",
  warn: "▲",
  err: "✦",
  arrow: "›",
  bullet: "·",
  bar: "▎",
  thinBar: "▏",
  block: "█",
  shade1: "░",
  shade2: "▒",
  shade3: "▓",

  // Status icons — checkbox-style states used across plan steps,
  // job rows, history entries. Pair with the COLOR semantics:
  // done→ok, cur→primary, pending→info-faint, fail→err.
  done: "✓",
  cur: "▸",
  pending: "○",
  fail: "✗",
  running: "●",

  // Tree-drawing chars for hierarchical lists (plan steps, sub-loops,
  // hook attachments). 1 cell each; render fine in every monospace
  // font we've tested.
  branch: "┣",
  branchEnd: "┗",
  branchStub: "┃",
  rule: "─",

  // Spinner frames — 4-step rotation. Cycle every 200ms via setInterval
  // (Ink's useEffect setState pattern). Equivalent to ink-spinner but
  // with our own cadence + character set.
  spinFrames: ["◐", "◓", "◑", "◒"] as readonly string[],
} as const;

/**
 * Surface color ramp — 6 steps from canvas (deepest) to selected
 * (lightest). Use these for stacked layers like top chrome over log
 * over modal-backdrop. Lifted from the dashboard's app.css so the web
 * surface and TUI share an identical depth perception (within Ink's
 * ANSI limits).
 *
 * Note: terminals quantize to 256-color or 16-color when truecolor
 * isn't available, so steps that look distinct in a modern terminal
 * may collapse to two visible shades on basic xterm. The ordering
 * stays correct in both — bg-canvas is always darker than bg-sel.
 */
export const SURFACE = {
  canvas: "#070a10",
  shell: "#0b1019",
  card: "#101721",
  elev: "#161f2c",
  sel: "#1a2433",
  line: "#1c2433",
  lineSoft: "#141b27",
} as const;

/**
 * Foreground intensity ramp — 5 steps from boldest text to faintest
 * decoration. Match these against semantic content: `strong` for
 * headings + active selection labels; `default` for body; `dim` for
 * meta; `faint` for hints + foot bars; `ghost` for separators.
 */
export const FG = {
  strong: "#e6edf6",
  default: "#cbd5e1",
  dim: "#94a3b8",
  faint: "#64748b",
  ghost: "#475569",
} as const;

/**
 * Render a horizontal gradient rule of the given width. Each cell
 * picks a color from the brand gradient interpolated across the
 * width, so at cols=80 the rule spans the full sweep. Used for
 * StatsPanel header/footer decoration and other "this section is
 * important" anchors.
 */
export function gradientCells(
  width: number,
  glyph: string = GLYPH.block,
): Array<{ ch: string; color: string }> {
  const cells: Array<{ ch: string; color: string }> = [];
  if (width <= 0) return cells;
  const last = GRADIENT.length - 1;
  for (let i = 0; i < width; i++) {
    const t = width === 1 ? 0 : (i * last) / (width - 1);
    const lo = Math.floor(t);
    const hi = Math.min(last, lo + 1);
    // Pick the closer of the two anchor colors for this cell. Linear
    // hex blending could be fancier but the discrete steps already
    // read as a smooth fade at any reasonable width.
    const color = t - lo < 0.5 ? GRADIENT[lo]! : GRADIENT[hi]!;
    cells.push({ ch: glyph, color });
  }
  return cells;
}
