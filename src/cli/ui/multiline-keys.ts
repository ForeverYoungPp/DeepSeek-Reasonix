/**
 * Pure keystroke → action reducer for PromptInput.
 *
 * Kept separate from the React component so the keyboard semantics
 * are easy to unit-test. The component threads `useInput` through
 * this function and applies the returned action.
 *
 * Edit model:
 *   - Full cursor support. ←/→ move one column. ↑/↓ move across
 *     lines in a multi-line buffer (column preserved when possible).
 *     Ctrl+A / Ctrl+E jump to start / end of the current line.
 *   - Backspace deletes the char before the cursor; Delete deletes
 *     the char under the cursor.
 *   - Printable chars (including multi-char paste bursts) insert
 *     at the cursor.
 *   - Enter submits unless Shift is held (newline), the line ends
 *     with '\' and cursor is at end (bash-style continuation), or
 *     the input is Ctrl+J (LF, terminal-universal newline).
 *   - Parent owns Tab, Esc, PageUp/Down (slash-complete, abort,
 *     unused). Arrow keys are split: empty buffer → parent (history
 *     recall); non-empty → child (cursor movement).
 */

export interface MultilineKey {
  input: string;
  return?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  escape?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
}

export interface MultilineAction {
  /** New buffer value. `null` = unchanged. */
  next: string | null;
  /** New cursor position (0..value.length). `null` = unchanged. */
  cursor: number | null;
  /** When `true`, fire `onSubmit(submitValue ?? value)`. */
  submit: boolean;
  submitValue?: string;
  /**
   * When set, the key was ↑/↓ at a buffer boundary (empty buffer, or
   * cursor already at first/last line) and the component should hand
   * off to the parent's history-recall handler. The child's cursor
   * didn't move; the parent decides whether to swap in a prior
   * prompt. Lets users escape out of a multi-line buffer into
   * history without first emptying it — previously NOOP felt stuck.
   */
  historyHandoff?: "prev" | "next";
  /**
   * Multi-char paste detected. The reducer is pure so it can't
   * allocate a sentinel id or write to the registry — it hands the
   * raw normalized payload up to PromptInput, which registers the
   * paste, picks a sentinel codepoint, and inserts THAT (one char)
   * into the buffer. Result: the user sees a `[paste #N · M lines]`
   * placeholder instead of the full content drowning the typed text.
   */
  pasteRequest?: { content: string };
}

const BACKSLASH_SUFFIX = /\\$/;

const NOOP: MultilineAction = { next: null, cursor: null, submit: false };

function rewriteRawArrowEscape(key: MultilineKey): MultilineKey {
  if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return key;
  // Full CSI sequences — terminals that pass `\x1b` through to Ink's
  // useInput intact (most macOS / Linux setups).
  if (key.input === "\x1b[A") return { ...key, upArrow: true, input: "" };
  if (key.input === "\x1b[B") return { ...key, downArrow: true, input: "" };
  if (key.input === "\x1b[C") return { ...key, rightArrow: true, input: "" };
  if (key.input === "\x1b[D") return { ...key, leftArrow: true, input: "" };
  // ESC-stripped fallbacks — Windows PowerShell + ConPTY routes the
  // leading `\x1b` of a CSI through Ink's parse-keypress, which
  // consumes it. The remaining `[A` / `[B` / `[C` / `[D` lands in
  // `input` as plain text. Without these fallbacks, pressing the
  // arrow key on those terminals inserts the literal `[C` into the
  // user's prompt buffer instead of moving the cursor — which is
  // exactly the "right arrow can't cross newline boundary" symptom
  // (the keystroke wasn't moving anything; it was typing characters).
  if (key.input === "[A") return { ...key, upArrow: true, input: "" };
  if (key.input === "[B") return { ...key, downArrow: true, input: "" };
  if (key.input === "[C") return { ...key, rightArrow: true, input: "" };
  if (key.input === "[D") return { ...key, leftArrow: true, input: "" };
  return key;
}

export function processMultilineKey(
  value: string,
  cursor: number,
  keyIn: MultilineKey,
): MultilineAction {
  // Raw-escape fallback for terminals (some Windows configurations —
  // cmd.exe, older winpty) that don't set `key.upArrow` / etc. on
  // arrow-key press and instead leak the raw ANSI CSI sequence into
  // `input`. Without this, `\x1b[A` lands on the "printable" branch
  // below and the user sees literal escape bytes inserted into their
  // buffer. Rewrite the event into the structured key here.
  const key: MultilineKey = rewriteRawArrowEscape(keyIn);

  // Parent-owned keys: Tab (slash-complete), Esc (abort).
  if (key.tab || key.escape) {
    return NOOP;
  }

  // Buffer-wide navigation. Per-line motion (↑/↓ / Ctrl+A / Ctrl+E)
  // is already covered; PageUp/PageDown are the missing "jump to
  // top / bottom of the WHOLE buffer" pair, useful after pasting a
  // 500-line blob where ↑×500 is absurd. Repurposed from the
  // previous NOOP behavior (PageUp/Down had no binding).
  if (key.pageUp) {
    return cursor === 0 ? NOOP : { next: null, cursor: 0, submit: false };
  }
  if (key.pageDown) {
    return cursor === value.length ? NOOP : { next: null, cursor: value.length, submit: false };
  }

  // Empty buffer + ↑/↓ → parent handles history recall.
  if (value.length === 0 && (key.upArrow || key.downArrow)) {
    return { ...NOOP, historyHandoff: key.upArrow ? "prev" : "next" };
  }

  // Cursor motion.
  if (key.leftArrow) {
    return { next: null, cursor: Math.max(0, cursor - 1), submit: false };
  }
  if (key.rightArrow) {
    return { next: null, cursor: Math.min(value.length, cursor + 1), submit: false };
  }
  if (key.upArrow) {
    const moved = moveCursorUp(value, cursor);
    // Cursor already on the first line — hand off to history recall
    // instead of sitting stuck. Users can now escape into history
    // from the middle of a multi-line draft.
    if (moved === cursor) return { ...NOOP, historyHandoff: "prev" };
    return { next: null, cursor: moved, submit: false };
  }
  if (key.downArrow) {
    const moved = moveCursorDown(value, cursor);
    if (moved === cursor) return { ...NOOP, historyHandoff: "next" };
    return { next: null, cursor: moved, submit: false };
  }

  // Emacs-style line jumps (universal across terminals; Home/End aren't
  // reliably reported by Ink so we don't depend on them).
  if (key.ctrl && key.input === "a") {
    return { next: null, cursor: startOfLine(value, cursor), submit: false };
  }
  if (key.ctrl && key.input === "e") {
    return { next: null, cursor: endOfLine(value, cursor), submit: false };
  }
  // Bash / readline conventions:
  //   Ctrl+U — clear the whole buffer (readline treats this as
  //     "clear from cursor to start"; for our text-area we treat it
  //     as "clear all" because there's no ergonomic way to clear a
  //     huge paste otherwise).
  //   Ctrl+W — delete the word before the cursor.
  if (key.ctrl && key.input === "u") {
    return value.length === 0 ? NOOP : { next: "", cursor: 0, submit: false };
  }
  if (key.ctrl && key.input === "w") {
    if (cursor === 0) return NOOP;
    const wordStart = previousWordStart(value, cursor);
    return {
      next: value.slice(0, wordStart) + value.slice(cursor),
      cursor: wordStart,
      submit: false,
    };
  }

  // Paste-burst detection. If `input` contains a newline (or
  // bracketed-paste markers from a terminal that supports them),
  // this is a paste — surface it as a `pasteRequest` so the parent
  // can register the blob and insert ONE sentinel codepoint instead
  // of the full content. The buffer stays small + readable; the
  // user sees `[paste #N · M lines]` where the paste lives.
  //
  // Always overrides `key.return` for pastes: Ink occasionally sets
  // key.return when a paste's trailing \n looks like Enter, which
  // would submit the partial buffer mid-paste and silently truncate
  // the content. Pastes always insert; Enter only submits typed
  // content. We normalize \r\n and bare \r to \n so mixed-line-
  // ending pastes (Windows clipboard, web copy) land cleanly.
  // Strip both the full marker (`\x1b[200~`) and the ESC-stripped
  // fallback (`[200~`) — the latter shows up on Windows PowerShell +
  // ConPTY where Ink's parse-keypress eats the leading ESC and routes
  // the rest into `input` as plain text.
  const stripped = key.input
    .replaceAll("\u001b[200~", "")
    .replaceAll("\u001b[201~", "")
    .replaceAll("[200~", "")
    .replaceAll("[201~", "");
  // Paste = newline-containing input with MORE than just the newline
  // itself. A bare "\n" is Ctrl+J / one-keystroke newline (handled
  // below); only multi-char input wrapped around a newline is a real
  // paste burst that warrants a sentinel.
  const looksLikePaste =
    stripped.length > 1 && (stripped.includes("\n") || stripped.includes("\r"));
  if (looksLikePaste) {
    const normalized = stripped.replace(/\r\n?/g, "\n");
    return {
      next: null,
      cursor: null,
      submit: false,
      pasteRequest: { content: normalized },
    };
  }
  // Single-char Ctrl+J / LF: insert one newline.
  if (key.input === "\n" || (key.ctrl && key.input === "j")) {
    return insertAt(value, cursor, "\n");
  }

  if (key.return) {
    if (key.shift) return insertAt(value, cursor, "\n");
    // Bash-style line continuation: trailing '\' + Enter (only when the
    // cursor sits at end-of-buffer, so a stray '\' mid-line doesn't
    // trigger it).
    if (cursor === value.length && BACKSLASH_SUFFIX.test(value)) {
      const replaced = `${value.slice(0, -1)}\n`;
      return { next: replaced, cursor: replaced.length, submit: false };
    }
    return { next: null, cursor: null, submit: true, submitValue: value };
  }

  // Backspace = delete the char BEFORE the cursor. We also accept
  // `key.delete` and the raw DEL (0x7f) / BS (0x08) bytes as backspace
  // for the same purpose — some Windows terminals (cmd.exe, certain
  // winpty configs) report plain Backspace without setting
  // `key.backspace`, which used to leave the user typing into a prompt
  // where the Backspace key did nothing. Reasonix doesn't offer a
  // separate forward-delete operation, so collapsing them is safe.
  if (key.backspace || key.delete || key.input === "\x7f" || key.input === "\b") {
    if (cursor === 0) return NOOP;
    return {
      next: value.slice(0, cursor - 1) + value.slice(cursor),
      cursor: cursor - 1,
      submit: false,
    };
  }

  // Bare modifier events (Ctrl/Meta with no printable) and unhandled
  // Ctrl-<letter> chords are dropped so a stray Ctrl+L doesn't insert "l".
  if ((key.ctrl || key.meta) && key.input.length === 0) return NOOP;
  if (key.ctrl || key.meta) return NOOP;

  // Printable input (may be a multi-char paste; pasted newlines land
  // inside the buffer rather than triggering submit on the first line).
  if (key.input.length > 0) {
    return insertAt(value, cursor, key.input);
  }

  return NOOP;
}

function insertAt(value: string, cursor: number, insert: string): MultilineAction {
  return {
    next: value.slice(0, cursor) + insert + value.slice(cursor),
    cursor: cursor + insert.length,
    submit: false,
  };
}

/**
 * Line + column of a cursor inside a buffer. Exported because the
 * renderer needs the same mapping for drawing the cursor block on the
 * right line.
 */
export function lineAndColumn(value: string, cursor: number): { line: number; col: number } {
  let line = 0;
  let col = 0;
  const n = Math.min(cursor, value.length);
  for (let i = 0; i < n; i++) {
    if (value[i] === "\n") {
      line++;
      col = 0;
    } else {
      col++;
    }
  }
  return { line, col };
}

function startOfLine(value: string, cursor: number): number {
  return value.lastIndexOf("\n", cursor - 1) + 1;
}

/**
 * Find the start of the word immediately to the left of the cursor.
 * Skips trailing whitespace first (so Ctrl+W after typing space
 * still removes the previous word, not just the space), then walks
 * back over the word characters until a whitespace boundary or
 * start-of-buffer. Newlines count as whitespace, so Ctrl+W at the
 * start of a line deletes the preceding line's last word — same
 * behavior as bash/readline.
 */
function previousWordStart(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(value[i - 1] ?? "")) i--;
  while (i > 0 && !/\s/.test(value[i - 1] ?? "")) i--;
  return i;
}

function endOfLine(value: string, cursor: number): number {
  const nl = value.indexOf("\n", cursor);
  return nl === -1 ? value.length : nl;
}

function moveCursorUp(value: string, cursor: number): number {
  const curStart = startOfLine(value, cursor);
  if (curStart === 0) return cursor; // already on the first line
  const col = cursor - curStart;
  const prevEnd = curStart - 1; // the '\n' between the two lines
  const prevStart = value.lastIndexOf("\n", prevEnd - 1) + 1;
  const prevLen = prevEnd - prevStart;
  return prevStart + Math.min(col, prevLen);
}

function moveCursorDown(value: string, cursor: number): number {
  const nextNl = value.indexOf("\n", cursor);
  if (nextNl === -1) return cursor; // already on the last line
  const curStart = startOfLine(value, cursor);
  const col = cursor - curStart;
  const nextStart = nextNl + 1;
  const followingNl = value.indexOf("\n", nextStart);
  const nextLen = (followingNl === -1 ? value.length : followingNl) - nextStart;
  return nextStart + Math.min(col, nextLen);
}
