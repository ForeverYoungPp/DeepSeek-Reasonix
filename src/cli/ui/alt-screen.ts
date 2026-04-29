/**
 * Alternate screen buffer lifecycle for the TUI.
 *
 * Reasonix used to render to the main terminal buffer — every
 * historical event scrolled past in the user's normal scrollback.
 * That had nice properties (copy/paste from history, exit-and-still-
 * see-it) but made sticky chrome impossible: the StatsPanel pinned
 * to the top of the live region was always at the bottom of the
 * viewport, just above the prompt.
 *
 * The redesign requires a real "viewport-style" layout: chrome at
 * row 1, scrollable log in the middle, prompt at the bottom. That
 * needs the alternate screen buffer (`\x1b[?1049h`), which:
 *
 *   · gives the app the entire terminal viewport to manage cell-by-cell
 *   · saves the user's previous terminal state, restores on exit
 *   · means session output is NOT in the user's scrollback after quit —
 *     the transcript file is the durable record (Reasonix already writes
 *     `~/.reasonix/sessions/<name>.jsonl` and optional `--transcript`)
 *
 * Trade-off accepted: lose post-exit scrollback access in exchange for
 * a real fixed header / scrollable middle / fixed footer layout.
 *
 * The escape sequences are the standard `xterm` private modes:
 *   `\x1b[?1049h` → switch to alt buffer + save cursor
 *   `\x1b[?1049l` → restore main buffer + cursor
 *   `\x1b[H`      → cursor to home (1,1) — start clean inside alt buffer
 *
 * Compatibility: every modern terminal (iTerm2, Windows Terminal,
 * WezTerm, gnome-terminal, kitty, alacritty, VS Code) supports 1049.
 * Plain `xterm` does too. Old conhost falls back to no-op (the codes
 * print as garbage characters, but that's a museum-piece risk).
 */

import { useEffect } from "react";

/** True iff stdout looks like a real TTY we should write escapes to. */
function isInteractiveTty(): boolean {
  return Boolean(process.stdout?.isTTY);
}

/**
 * Enter the alt screen on mount, restore on unmount. Mouse tracking
 * is INTENTIONALLY OFF by default — having the app intercept clicks
 * + drags fights the user's text-selection workflow (terminal can't
 * do native shift+drag selection while the app is consuming events,
 * and Ink's continuous re-rendering clears any selection that does
 * survive). PgUp / PgDn / Home / End cover scrolling without it.
 *
 * Wheel scrolling can be enabled per-session via `setMouseTracking()`
 * — the slash command `/mouse on` flips it on at runtime for users
 * who'd rather wheel-scroll than copy-paste.
 *
 * Restore is idempotent and runs on SIGINT / SIGTERM / exit, so the
 * user's terminal returns to a sane state regardless of how the
 * process dies.
 */
export function useAltScreen(): void {
  useEffect(() => {
    if (!isInteractiveTty()) return;
    // Enter alt buffer + clear + cursor home. NO mouse tracking by
    // default — see module comment.
    process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H");

    // Belt-and-suspenders restore on every plausible exit path.
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      try {
        // Best-effort disable both mouse modes (1002 + 1006) in case
        // they were turned on at runtime, then leave alt screen.
        process.stdout.write("\x1b[?1006l\x1b[?1002l\x1b[?1049l");
      } catch {
        /* terminal closed, nothing to do */
      }
    };

    process.once("exit", restore);
    process.once("SIGINT", () => {
      restore();
      // Re-emit so default exit-on-SIGINT can still fire.
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      restore();
      process.exit(143);
    });

    return restore;
  }, []);
}

/**
 * Runtime toggle for mouse-event tracking (button + wheel). Invoked by
 * the `/mouse on|off` slash command. Off by default to keep native
 * text selection working; users who want wheel scrolling can flip it
 * on per-session.
 */
let mouseTrackingOn = false;
export function setMouseTracking(on: boolean): void {
  if (!isInteractiveTty()) return;
  if (on === mouseTrackingOn) return;
  if (on) {
    process.stdout.write("\x1b[?1002h\x1b[?1006h");
  } else {
    process.stdout.write("\x1b[?1006l\x1b[?1002l");
  }
  mouseTrackingOn = on;
}
export function isMouseTrackingOn(): boolean {
  return mouseTrackingOn;
}
