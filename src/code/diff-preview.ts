/**
 * Render a SEARCH/REPLACE edit block as a compact unified-diff-style
 * preview for the code-mode confirm gate. Shows the user what's about
 * to land on disk BEFORE they press `y` — catches "wrong file" and
 * "wrong replacement" mistakes that the old path + line-count summary
 * couldn't.
 *
 * Not a full Myers diff: we trim shared leading/trailing lines as
 * context and render the middle divergence as `-old` / `+new`. That's
 * enough for the common SEARCH/REPLACE shape (small change inside a
 * function body, wrapped with a few lines of surrounding code for
 * uniqueness) and avoids pulling in a diff library.
 */

import type { EditBlock } from "./edit-blocks.js";

export interface DiffPreviewOptions {
  /** How many lines of unchanged context to show at each end. Default 2. */
  contextLines?: number;
  /** Hard cap on total rendered lines. Default 20 — beyond this the preview collapses. */
  maxLines?: number;
  /** Indent applied to every output line. Default 8 spaces — matches the pending-preview nesting. */
  indent?: string;
}

export interface AllBlockDiffOptions extends DiffPreviewOptions {
  /**
   * Prefix each block's path-header with a 1-based `[N]` label. Used by
   * the pending-edits preview so the user can address individual blocks
   * via `/apply <N>` / `/discard <N>`. Off by default — single-block
   * surfaces (modal confirm, /show) don't need numbering.
   */
  numbered?: boolean;
}

/** Render one edit block's diff. Returns an array of formatted lines. */
export function formatEditBlockDiff(block: EditBlock, opts: DiffPreviewOptions = {}): string[] {
  const contextLines = Math.max(0, opts.contextLines ?? 2);
  const maxLines = Math.max(4, opts.maxLines ?? 20);
  const indent = opts.indent ?? "        ";

  const search = block.search === "" ? [] : block.search.split("\n");
  const replace = block.replace.split("\n");

  // New-file case: no search to compare, show the full new content
  // (capped). Mark every line `+` so the user knows it's all additions.
  if (search.length === 0) {
    return renderAllPlus(replace, indent, maxLines);
  }

  // Common leading / trailing lines — shared context we can collapse.
  let leading = 0;
  while (
    leading < search.length &&
    leading < replace.length &&
    search[leading] === replace[leading]
  ) {
    leading++;
  }
  let trailing = 0;
  while (
    trailing < search.length - leading &&
    trailing < replace.length - leading &&
    search[search.length - 1 - trailing] === replace[replace.length - 1 - trailing]
  ) {
    trailing++;
  }

  const searchMiddle = search.slice(leading, search.length - trailing);
  const replaceMiddle = replace.slice(leading, replace.length - trailing);

  // Trim context to `contextLines` on each side.
  const leadShown = search.slice(Math.max(0, leading - contextLines), leading);
  const leadHidden = leading - leadShown.length;
  const trailShown = search.slice(
    search.length - trailing,
    search.length - trailing + contextLines,
  );
  const trailHidden = trailing - trailShown.length;

  const out: string[] = [];
  if (leadHidden > 0) {
    out.push(`${indent}  … ${leadHidden} unchanged line${leadHidden === 1 ? "" : "s"} above`);
  }
  for (const l of leadShown) out.push(`${indent}  ${l}`);
  for (const l of searchMiddle) out.push(`${indent}- ${l}`);
  for (const l of replaceMiddle) out.push(`${indent}+ ${l}`);
  for (const l of trailShown) out.push(`${indent}  ${l}`);
  if (trailHidden > 0) {
    out.push(`${indent}  … ${trailHidden} unchanged line${trailHidden === 1 ? "" : "s"} below`);
  }

  return capLines(out, maxLines, indent);
}

/**
 * Render the full set of blocks back-to-back, each preceded by a
 * path-and-size header so the user can tell which file owns each
 * diff chunk. Blocks are separated by a blank line for breathing room.
 */
export function formatAllBlockDiffs(
  blocks: readonly EditBlock[],
  opts: AllBlockDiffOptions = {},
): string[] {
  const out: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    const removed = b.search === "" ? 0 : countLines(b.search);
    const added = countLines(b.replace);
    const tag = b.search === "" ? "NEW " : "    ";
    if (i > 0) out.push("");
    const label = opts.numbered ? `[${i + 1}] ` : "";
    out.push(`  ${label}${tag}${b.path}  (-${removed} +${added} lines)`);
    out.push(...formatEditBlockDiff(b, opts));
  }
  return out;
}

function countLines(s: string): number {
  if (s.length === 0) return 0;
  return (s.match(/\n/g)?.length ?? 0) + 1;
}

/**
 * One row of a side-by-side diff. `left` is the old/before column,
 * `right` is the new/after column. `kind` drives color + glyph in
 * the renderer.
 */
export interface SplitDiffRow {
  left: { num: number | null; text: string; kind: "ctx" | "del" | "pad" };
  right: { num: number | null; text: string; kind: "ctx" | "add" | "pad" };
}

export interface SplitDiffOptions extends DiffPreviewOptions {
  /** Starting 1-based line number for the old side. Default 1. */
  startLine?: number;
}

/**
 * Side-by-side diff rows for an EditBlock — git-difftool / delta-style
 * "old | new" layout. Each removed line pairs with the corresponding
 * added line at the same offset; unpaired remainders pad with blanks
 * on the missing side. Common leading/trailing context shows the same
 * line on both sides.
 *
 * Why pair rather than fully Myers-aligned: Myers needs an O(N²) edit
 * graph to compute LCS for arbitrary text. The SEARCH/REPLACE shape
 * here is small (typically <30 lines per block) and the fix usually
 * REPLACES a contiguous span — pairing by index gets the visually-
 * correct result for the 95% case without the algorithm cost.
 */
export function formatEditBlockSplit(
  block: EditBlock,
  opts: SplitDiffOptions = {},
): SplitDiffRow[] {
  const contextLines = Math.max(0, opts.contextLines ?? 2);
  const maxLines = Math.max(4, opts.maxLines ?? 40);
  const startLine = opts.startLine ?? 1;

  const search = block.search === "" ? [] : block.search.split("\n");
  const replace = block.replace.split("\n");

  // New-file case: empty old column, every replace line on the right.
  if (search.length === 0) {
    const rows: SplitDiffRow[] = [];
    let n = startLine;
    for (const l of replace) {
      rows.push({
        left: { num: null, text: "", kind: "pad" },
        right: { num: n++, text: l, kind: "add" },
      });
    }
    return capRows(rows, maxLines);
  }

  // Trim shared leading + trailing context — same logic as the
  // unified diff renderer, kept in lockstep so both stay accurate.
  let leading = 0;
  while (
    leading < search.length &&
    leading < replace.length &&
    search[leading] === replace[leading]
  ) {
    leading++;
  }
  let trailing = 0;
  while (
    trailing < search.length - leading &&
    trailing < replace.length - leading &&
    search[search.length - 1 - trailing] === replace[replace.length - 1 - trailing]
  ) {
    trailing++;
  }

  const searchMiddle = search.slice(leading, search.length - trailing);
  const replaceMiddle = replace.slice(leading, replace.length - trailing);
  const leadStartIdx = Math.max(0, leading - contextLines);
  const leadShown = search.slice(leadStartIdx, leading);
  const trailShown = search.slice(
    search.length - trailing,
    search.length - trailing + contextLines,
  );

  const rows: SplitDiffRow[] = [];
  let leftNum = startLine + leadStartIdx;
  let rightNum = startLine + leadStartIdx;

  // Leading context — identical on both sides.
  for (const l of leadShown) {
    rows.push({
      left: { num: leftNum++, text: l, kind: "ctx" },
      right: { num: rightNum++, text: l, kind: "ctx" },
    });
  }

  // Paired removed/added rows (up to min length).
  const pairedCount = Math.min(searchMiddle.length, replaceMiddle.length);
  for (let i = 0; i < pairedCount; i++) {
    rows.push({
      left: { num: leftNum++, text: searchMiddle[i]!, kind: "del" },
      right: { num: rightNum++, text: replaceMiddle[i]!, kind: "add" },
    });
  }
  // Extra removed lines (more old than new) — left only.
  for (let i = pairedCount; i < searchMiddle.length; i++) {
    rows.push({
      left: { num: leftNum++, text: searchMiddle[i]!, kind: "del" },
      right: { num: null, text: "", kind: "pad" },
    });
  }
  // Extra added lines (more new than old) — right only.
  for (let i = pairedCount; i < replaceMiddle.length; i++) {
    rows.push({
      left: { num: null, text: "", kind: "pad" },
      right: { num: rightNum++, text: replaceMiddle[i]!, kind: "add" },
    });
  }

  // Trailing context — identical on both sides.
  for (const l of trailShown) {
    rows.push({
      left: { num: leftNum++, text: l, kind: "ctx" },
      right: { num: rightNum++, text: l, kind: "ctx" },
    });
  }

  return capRows(rows, maxLines);
}

function capRows(rows: SplitDiffRow[], maxRows: number): SplitDiffRow[] {
  if (rows.length <= maxRows) return rows;
  const head = rows.slice(0, maxRows - 1);
  const hidden = rows.length - head.length;
  // Replace the trailing slot with a "more lines hidden" marker row,
  // rendered as a pad on both sides with a special text so the
  // renderer can pick it up.
  head.push({
    left: { num: null, text: `… (${hidden} more lines)`, kind: "pad" },
    right: { num: null, text: "", kind: "pad" },
  });
  return head;
}

function renderAllPlus(lines: string[], indent: string, maxLines: number): string[] {
  const out = lines.map((l) => `${indent}+ ${l}`);
  return capLines(out, maxLines, indent);
}

function capLines(lines: string[], maxLines: number, indent: string): string[] {
  if (lines.length <= maxLines) return lines;
  const head = lines.slice(0, maxLines - 1);
  const hidden = lines.length - head.length;
  head.push(`${indent}… (${hidden} more diff lines — full content applies on /apply)`);
  return head;
}
