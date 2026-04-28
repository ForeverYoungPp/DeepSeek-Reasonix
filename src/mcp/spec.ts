/**
 * Parse the `--mcp` CLI argument into a transport-tagged spec.
 *
 * Accepted forms:
 *   "name=command args..."             → stdio, namespaced (tools prefixed with `name_`)
 *   "command args..."                  → stdio, anonymous
 *   "name=https://host/sse"            → HTTP+SSE (2024-11-05), namespaced
 *   "https://host/sse"                 → HTTP+SSE (2024-11-05), anonymous
 *   "name=streamable+https://host/mcp" → Streamable HTTP (2025-03-26), namespaced
 *   "streamable+https://host/mcp"      → Streamable HTTP (2025-03-26), anonymous
 *   ("http://" / "streamable+http://" also honored — useful for local dev.)
 *
 * The identifier regex before `=` is deliberately narrow
 * (`[a-zA-Z_][a-zA-Z0-9_]*`) so Windows drive letters ("C:\\...") and
 * other strings containing `=` or `:` don't accidentally trigger the
 * namespace branch. If a user ever wants their command to literally start
 * with `foo=...` as a bare command, they can wrap it in quotes inside the
 * shell command string.
 *
 * Transport selection:
 *   - body starts with `streamable+http(s)://` → Streamable HTTP. The
 *     `streamable+` prefix is stripped from the URL we hand the transport.
 *   - body starts with `http(s)://`            → HTTP+SSE (2024-11-05).
 *     Default for plain http URLs to preserve back-compat with users who
 *     already have `--mcp https://...` config entries pointed at SSE
 *     servers; opt into Streamable HTTP explicitly.
 *   - anything else                            → stdio (including ws://,
 *     which will surface later as a spawn error).
 */

import { shellSplit } from "./shell-split.js";

export interface StdioMcpSpec {
  transport: "stdio";
  /** Namespace prefix applied to each registered tool, or null if anonymous. */
  name: string | null;
  /** Argv[0]. */
  command: string;
  /** Remaining argv. */
  args: string[];
}

export interface SseMcpSpec {
  transport: "sse";
  name: string | null;
  /** Fully qualified SSE endpoint URL. */
  url: string;
}

export interface StreamableHttpMcpSpec {
  transport: "streamable-http";
  name: string | null;
  /** Fully qualified Streamable HTTP endpoint URL (no `streamable+` prefix). */
  url: string;
}

export type McpSpec = StdioMcpSpec | SseMcpSpec | StreamableHttpMcpSpec;

const NAME_PREFIX = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;
const HTTP_URL = /^https?:\/\//i;
const STREAMABLE_PREFIX = /^streamable\+(https?:\/\/.+)$/i;

export function parseMcpSpec(input: string): McpSpec {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("empty MCP spec");
  }

  const nameMatch = NAME_PREFIX.exec(trimmed);
  const name = nameMatch ? nameMatch[1]! : null;
  const body = (nameMatch ? nameMatch[2]! : trimmed).trim();

  if (!body) {
    throw new Error(`MCP spec has name but no command: ${input}`);
  }

  const streamMatch = STREAMABLE_PREFIX.exec(body);
  if (streamMatch) {
    return { transport: "streamable-http", name, url: streamMatch[1]! };
  }

  if (HTTP_URL.test(body)) {
    return { transport: "sse", name, url: body };
  }

  const argv = shellSplit(body);
  if (argv.length === 0) {
    throw new Error(`MCP spec has name but no command: ${input}`);
  }
  const [command, ...args] = argv;
  return { transport: "stdio", name, command: command!, args };
}
