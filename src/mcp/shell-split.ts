/**
 * Split a shell-style command string into argv, respecting single and
 * double quotes. Intended for parsing the user's `--mcp "cmd args..."`
 * flag — NOT a full shell parser (no variable expansion, no subshells,
 * no globs, no `&&` / pipes).
 *
 * The tradeoff: users with paths containing spaces need to quote them
 * (e.g. `--mcp 'npx -y pkg "/my path/here"'`), which is how they'd
 * already quote them at the shell level.
 *
 * Throws on unterminated quotes — better than silently dropping half
 * the command.
 */
export function shellSplit(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let i = 0;
  const s = input;

  while (i < s.length) {
    const ch = s[i]!;

    if (quote) {
      if (ch === quote) {
        quote = null;
        i++;
        continue;
      }
      // backslash escapes inside double quotes only
      if (ch === "\\" && quote === '"' && i + 1 < s.length) {
        cur += s[i + 1];
        i += 2;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      i++;
      continue;
    }

    if (ch === "\\" && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
      continue;
    }

    if (ch === " " || ch === "\t") {
      if (cur.length > 0) {
        tokens.push(cur);
        cur = "";
      }
      i++;
      continue;
    }

    cur += ch;
    i++;
  }

  if (quote) {
    throw new Error(
      `shellSplit: unterminated ${quote === '"' ? "double" : "single"} quote in input`,
    );
  }
  if (cur.length > 0) tokens.push(cur);
  return tokens;
}
