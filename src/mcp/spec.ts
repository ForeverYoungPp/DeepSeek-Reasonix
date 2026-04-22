/**
 * Parse the `--mcp` CLI argument into name + command + args.
 *
 * Two accepted forms:
 *   "name=command args..."   → namespaced (tools prefixed with `name_`)
 *   "command args..."        → anonymous (tools registered under their native names)
 *
 * The identifier regex before `=` is deliberately narrow
 * (`[a-zA-Z_][a-zA-Z0-9_]*`) so Windows drive letters ("C:\\...") and
 * other strings containing `=` or `:` don't accidentally trigger the
 * namespace branch. If a user ever wants their command to literally start
 * with `foo=...` as a bare command, they can wrap it in quotes inside the
 * shell command string.
 */

import { shellSplit } from "./shell-split.js";

export interface McpSpec {
  /** Namespace prefix applied to each registered tool, or null if anonymous. */
  name: string | null;
  /** Argv[0]. */
  command: string;
  /** Remaining argv. */
  args: string[];
}

const NAME_PREFIX = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;

export function parseMcpSpec(input: string): McpSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("empty MCP spec");
  }

  const nameMatch = NAME_PREFIX.exec(trimmed);
  const name = nameMatch ? nameMatch[1]! : null;
  const body = nameMatch ? nameMatch[2]! : trimmed;

  const argv = shellSplit(body);
  if (argv.length === 0) {
    throw new Error(`MCP spec has name but no command: ${input}`);
  }
  const [command, ...args] = argv;
  return { name, command: command!, args };
}
