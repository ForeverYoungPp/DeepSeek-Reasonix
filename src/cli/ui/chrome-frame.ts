/**
 * StatsPanel chrome → Frame compiler. Phase 6a of the Frame-compiler
 * migration. Replaces the Ink layout used by `<StatsPanel>` /
 * `<ChromeRow>` / `<ChromeRule>` / `<BudgetRow>` with deterministic
 * Frame composition.
 *
 * Layout (single sticky chrome at the top of the TUI):
 *
 *     ◈ reasonix · <project> › <session>     [↑ x.y.z] [mode] [⇧ pro]
 *                                            [$X.XXXX] [w $5.00] [c ████ 70%]
 *     ───────────────────────────────────────────────────────────────────
 *     budget  $0.0123 / $5.00  (0%)        ← only when budgetUsd is set
 *
 * Why migrate the chrome:
 *   · the StatsPanel chrome is the most visible "always-rendered"
 *     surface — every render of the TUI passes through it
 *   · in 0.13.0 the negative-marginTop scroll bug overwrote chrome
 *     cells; verifying chrome integrity required snapshot tests, which
 *     were impossible against a JSX subtree
 *   · once chrome is a Frame, App.tsx's outer composition becomes a
 *     vstack(chrome, log, prompt) over Frame data — no flex layout
 *     anywhere
 */

import type { EditMode } from "../../config.js";
import { type Frame, empty, stringWidth, text, vstack } from "../../frame/index.js";
import type { Cell } from "../../frame/index.js";
import type { SessionSummary } from "../../telemetry.js";
import { COLOR, GRADIENT } from "./theme.js";

/** Below 120 cols we drop the session crumb / balance pill / cache bar. */
const NARROW_BREAKPOINT = 120;
/** Cold-start window where the cache-hit ratio is still 0% — show
 *  the cost cell muted instead of the live gradient color. */
const COLD_START_TURNS = 3;

const SPACE: Cell = { char: " ", width: 1 };

export interface ChromeFrameProps {
  summary: SessionSummary;
  width: number;
  rootDir?: string;
  sessionName?: string | null;
  editMode?: EditMode;
  planMode?: boolean;
  proArmed?: boolean;
  escalated?: boolean;
  updateAvailable?: string | null;
  balance?: { currency: string; total: number } | null;
  budgetUsd?: number | null;
}

/**
 * Compile the entire chrome region (chrome row + horizontal rule +
 * optional budget row) to a single Frame. App.tsx will render this
 * Frame as a stack of `<Box height={1}><Text>{ansi}</Text></Box>`
 * rows above the log viewport.
 */
export function chromeFrame(props: ChromeFrameProps): Frame {
  const narrow = props.width < NARROW_BREAKPOINT;
  const coldStart = props.summary.turns <= COLD_START_TURNS;
  const top = chromeRowFrame({ ...props, narrow, coldStart });
  const rule = chromeRuleFrame(props.width);
  const parts: Frame[] = [top, rule];
  if (props.budgetUsd !== null && props.budgetUsd !== undefined) {
    parts.push(budgetFrame(props.summary.totalCostUsd, props.budgetUsd, props.width));
  }
  return vstack(...parts);
}

/**
 * Single-row chrome: brand + project crumb on the left, status pills
 * on the right, with the inter-region gap filled by spaces. Truncates
 * the project crumb / drops pills on narrow terminals.
 */
function chromeRowFrame(props: ChromeFrameProps & { narrow: boolean; coldStart: boolean }): Frame {
  // ─── LEFT segments ────────────────────────────────────────────
  const left: Cell[] = [];
  // Brand mark (gradient[0]) + " "
  appendCells(left, "◈ ", { fg: GRADIENT[0]!, bold: true });
  appendCells(left, "reasonix", { fg: COLOR.brand, bold: true });
  if (props.rootDir) {
    const projectName = baseName(props.rootDir);
    appendCells(left, "  ·  ", { fg: COLOR.info, dim: true });
    appendCells(left, projectName);
    if (!props.narrow && props.sessionName) {
      appendCells(left, "  ›  ", { fg: COLOR.info, dim: true });
      appendCells(left, props.sessionName, { fg: COLOR.info });
    }
  }

  // ─── RIGHT segments (built from right to left logically, but we
  //     append in display order then position via spacer) ────────
  const right: Cell[] = [];
  if (props.updateAvailable) {
    appendCells(right, `↑ ${props.updateAvailable}`, { fg: COLOR.warn, bold: true });
    appendCells(right, "  ");
  }
  const modePill = pickModePill(props.planMode, props.editMode);
  if (modePill) {
    appendCells(right, `[${modePill.label}]`, { fg: modePill.color, bold: true });
    appendCells(right, "  ");
  }
  if (props.escalated || props.proArmed) {
    const proColor = props.escalated ? COLOR.err : COLOR.warn;
    appendCells(right, "[⇧ pro]", { fg: proColor, bold: true });
    appendCells(right, "  ");
  }
  // Cost — always shown
  const costText = `[$${props.summary.totalCostUsd.toFixed(4)}]`;
  const showCostMuted = props.summary.turns === 0 || props.coldStart;
  appendCells(right, costText, {
    fg: showCostMuted ? COLOR.info : sessionCostColor(props.summary.totalCostUsd),
    bold: !showCostMuted,
    dim: showCostMuted,
  });
  // Balance pill
  if (props.balance && !props.narrow) {
    appendCells(right, "  ");
    const balanceColor =
      props.balance.total < 1 ? COLOR.err : props.balance.total < 5 ? COLOR.warn : COLOR.ok;
    const cur = props.balance.currency === "USD" ? "$" : "";
    const suf = props.balance.currency !== "USD" ? ` ${props.balance.currency}` : "";
    appendCells(right, `[w ${cur}${props.balance.total.toFixed(2)}${suf}]`, { fg: balanceColor });
  }
  // Cache bar — only after a few turns (so 0% on turn 1 isn't shown
  // as a red alarm)
  if (props.summary.turns > 3 && !props.narrow) {
    const cachePct = Math.round(props.summary.cacheHitRatio * 100);
    const cacheColor =
      props.summary.cacheHitRatio >= 0.7
        ? COLOR.ok
        : props.summary.cacheHitRatio >= 0.4
          ? COLOR.warn
          : COLOR.err;
    appendCells(right, "  ");
    appendCells(right, "[", { dim: true });
    appendCells(right, "c ", { dim: true });
    // Bar: 6 cells, ratio mapped to filled count
    const filled = Math.round(props.summary.cacheHitRatio * 6);
    for (let i = 0; i < 6; i++) {
      right.push({ char: i < filled ? "█" : "░", width: 1, fg: cacheColor });
    }
    appendCells(right, " ");
    appendCells(right, `${cachePct}%`, { fg: cacheColor });
    appendCells(right, "]", { dim: true });
  }

  // ─── Compose with spacer ──────────────────────────────────────
  return composeRow(left, right, props.width);
}

/**
 * Place the left segment at column 0 and the right segment flush
 * against the rightmost cell, padding the middle with spaces.
 *
 * Overflow strategy — right side is more important (it carries the
 * status pills the user actively watches):
 *   1. left + right <= width  →  spacer between
 *   2. left + right >  width  →  truncate left from its right edge
 *                                until right fits in full
 *   3. right alone > width    →  truncate right from its LEFT edge
 *                                (drop update / mode / pro pills first;
 *                                cost / balance / cache live at the
 *                                rightmost end and survive longest)
 *
 * The wallet pill is in the middle of the right group, so the case-3
 * "drop earliest pills" rule keeps it visible even on terminals with
 * many active pills competing for space.
 */
function composeRow(left: Cell[], right: Cell[], width: number): Frame {
  const leftW = visualWidth(left);
  const rightW = visualWidth(right);

  // Case 3: right alone overflows — keep its tail.
  if (rightW > width) {
    const out: Cell[] = [];
    let needed = width;
    for (let i = right.length - 1; i >= 0 && needed > 0; i--) {
      const c = right[i]!;
      const cw = c.tail ? 0 : c.width;
      if (cw <= needed) {
        out.unshift(c);
        if (!c.tail) needed -= c.width;
      } else {
        break;
      }
    }
    while (visualWidth(out) < width) out.unshift(SPACE);
    return { width, rows: [out] };
  }

  // Case 2: combined overflow — truncate left.
  if (leftW + rightW > width) {
    const budget = width - rightW;
    const cells: Cell[] = [];
    let used = 0;
    for (const c of left) {
      const cw = c.tail ? 0 : c.width;
      if (used + cw > budget) break;
      cells.push(c);
      used += cw;
    }
    while (used < budget) {
      cells.push(SPACE);
      used += 1;
    }
    cells.push(...right);
    // Verify width invariant — if right contained tail cells whose
    // head was outside the slice, we'd be off; pad/truncate as
    // last resort.
    let cur = visualWidth(cells);
    while (cur < width) {
      cells.push(SPACE);
      cur += 1;
    }
    return { width, rows: [cells] };
  }

  // Case 1: fits with spacer.
  const gap = width - leftW - rightW;
  const cells = [...left];
  for (let i = 0; i < gap; i++) cells.push(SPACE);
  cells.push(...right);
  return { width, rows: [cells] };
}

/** Faint horizontal rule under the chrome — `cols-2` of `─`. */
function chromeRuleFrame(width: number): Frame {
  const w = Math.max(20, width - 2);
  return text("─".repeat(w), { width, fg: COLOR.info, dim: true });
}

/**
 * Budget row, only when `budgetUsd` is set: `budget  $X / $Y  (Z%)`
 * with amber at 80%, red at 100%.
 */
function budgetFrame(spent: number, cap: number, width: number): Frame {
  if (cap <= 0) return empty(width);
  const pct = Math.max(0, (spent / cap) * 100);
  const color = pct >= 100 ? "#f87171" : pct >= 80 ? "#fbbf24" : "#94a3b8";
  const cells: Cell[] = [];
  appendCells(cells, "  budget  ", { dim: true });
  appendCells(cells, `$${spent.toFixed(4)} / $${cap.toFixed(2)}`, { fg: color });
  appendCells(cells, `  (${pct.toFixed(0)}%)`, { dim: true });
  // Pad to width
  let curW = visualWidth(cells);
  while (curW < width) {
    cells.push(SPACE);
    curW += 1;
  }
  return { width, rows: [cells] };
}

// ─── helpers ─────────────────────────────────────────────────────

/**
 * Append a styled string to a cell array. Mutates in-place.
 *
 * The width passed to `text()` is the EXACT visual width of `s` so
 * `text()` doesn't right-pad — that way `appendCells(out, "  ")`
 * (intentional inter-pill spacer) still emits two SPACE cells, where
 * an earlier "pad-then-strip-trailing" approach was eating them and
 * collapsing pills into each other on the chrome row.
 */
function appendCells(
  out: Cell[],
  s: string,
  opts: { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean } = {},
): void {
  if (s.length === 0) return;
  const w = stringWidth(s);
  if (w === 0) return;
  const f = text(s, { ...opts, width: w });
  if (f.rows.length === 0) return;
  for (const c of f.rows[0]!) out.push(c);
}

function visualWidth(cells: readonly Cell[]): number {
  let w = 0;
  for (const c of cells) if (!c.tail) w += c.width;
  return w;
}

function baseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? norm : norm.slice(i + 1);
}

function pickModePill(
  planMode: boolean | undefined,
  editMode: EditMode | undefined,
): { label: string; color: string } | null {
  if (planMode) return { label: "PLAN", color: COLOR.err };
  if (editMode === "yolo") return { label: "yolo", color: COLOR.err };
  if (editMode === "auto") return { label: "auto", color: COLOR.primary };
  if (editMode === "review") return { label: "review", color: COLOR.info };
  return null;
}

function sessionCostColor(cost: number): string | undefined {
  if (cost <= 0) return undefined;
  if (cost >= 5) return COLOR.err;
  if (cost >= 0.5) return COLOR.warn;
  return COLOR.ok;
}
