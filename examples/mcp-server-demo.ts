/**
 * Bundled demo MCP server.
 *
 * A minimal stdio MCP server that exposes three tools: echo, add, get_time.
 * Useful for:
 *   - running the MCP integration end-to-end without installing
 *     an external server
 *   - giving the integration tests a real subprocess to spawn
 *   - showing the minimal shape of a server for folks writing their own
 *
 * Usage:
 *   npx tsx examples/mcp-server-demo.ts          # speaks MCP on stdin/stdout
 *   reasonix chat --mcp "npx tsx examples/mcp-server-demo.ts"
 *
 * Spec reference: https://spec.modelcontextprotocol.io/ (2024-11-05)
 * Only the subset this demo needs is implemented — initialize, tools/list,
 * tools/call, notifications/initialized (no-op).
 */

import { createInterface } from "node:readline";

const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

const TOOLS = [
  {
    name: "echo",
    description: "Echoes the provided message back.",
    inputSchema: {
      type: "object",
      properties: { msg: { type: "string", description: "What to echo" } },
      required: ["msg"],
    },
  },
  {
    name: "add",
    description: "Adds two integers and returns the sum.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "integer" },
        b: { type: "integer" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "get_time",
    description: "Returns the server's current ISO-8601 timestamp.",
    inputSchema: { type: "object", properties: {} },
  },
];

function send(msg: JsonRpcSuccess | JsonRpcError): void {
  // Stdio MCP framing: one JSON per line.
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handleRequest(req: JsonRpcRequest): JsonRpcSuccess | JsonRpcError | null {
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize": {
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          serverInfo: { name: "reasonix-demo-mcp", version: "0.0.1" },
          capabilities: { tools: { listChanged: false } },
        },
      };
    }

    case "notifications/initialized":
      // No response for notifications.
      return null;

    case "tools/list": {
      return { jsonrpc: "2.0", id: id ?? 0, result: { tools: TOOLS } };
    }

    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      const name = params.name ?? "";
      const args = params.arguments ?? {};
      const out = callTool(name, args);
      if (out.error) {
        return {
          jsonrpc: "2.0",
          id: id ?? 0,
          result: {
            content: [{ type: "text", text: out.error }],
            isError: true,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id: id ?? 0,
        result: { content: [{ type: "text", text: out.text }] },
      };
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `method not found: ${req.method}` },
      };
  }
}

function callTool(
  name: string,
  args: Record<string, unknown>,
): { text: string; error?: string } {
  if (name === "echo") {
    const msg = typeof args.msg === "string" ? args.msg : "";
    return { text: `echo: ${msg}` };
  }
  if (name === "add") {
    const a = typeof args.a === "number" ? args.a : Number(args.a);
    const b = typeof args.b === "number" ? args.b : Number(args.b);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return { text: "", error: "add: both a and b must be numbers" };
    }
    return { text: String(a + b) };
  }
  if (name === "get_time") {
    return { text: new Date().toISOString() };
  }
  return { text: "", error: `unknown tool: ${name}` };
}

function main(): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      // malformed input — respond with parse error
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "parse error" },
      });
      return;
    }
    const resp = handleRequest(req);
    if (resp) send(resp);
  });
  rl.on("close", () => process.exit(0));
}

main();
