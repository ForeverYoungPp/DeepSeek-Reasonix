import { render } from "ink";
import React, { useState } from "react";
import { loadApiKey } from "../../config.js";
import { loadDotenv } from "../../env.js";
import { McpClient } from "../../mcp/client.js";
import { bridgeMcpTools } from "../../mcp/registry.js";
import { parseMcpSpec } from "../../mcp/spec.js";
import { SseTransport } from "../../mcp/sse.js";
import { type McpTransport, StdioTransport } from "../../mcp/stdio.js";
import { ToolRegistry } from "../../tools.js";
import { App } from "../ui/App.js";
import { Setup } from "../ui/Setup.js";

export interface ChatOptions {
  model: string;
  system: string;
  transcript?: string;
  harvest?: boolean;
  branch?: number;
  session?: string;
  /** Zero or more MCP server specs. Each: `"name=cmd args..."` or `"cmd args..."`. */
  mcp?: string[];
  /** Global prefix — only used when a single anonymous server is given. */
  mcpPrefix?: string;
}

interface RootProps extends ChatOptions {
  initialKey: string | undefined;
  tools: ToolRegistry | undefined;
  mcpSpecs: string[];
}

function Root({ initialKey, tools, mcpSpecs, ...appProps }: RootProps) {
  const [key, setKey] = useState<string | undefined>(initialKey);
  if (!key) {
    return (
      <Setup
        onReady={(k) => {
          process.env.DEEPSEEK_API_KEY = k;
          setKey(k);
        }}
      />
    );
  }
  process.env.DEEPSEEK_API_KEY = key;
  return (
    <App
      model={appProps.model}
      system={appProps.system}
      transcript={appProps.transcript}
      harvest={appProps.harvest}
      branch={appProps.branch}
      session={appProps.session}
      tools={tools}
      mcpSpecs={mcpSpecs}
    />
  );
}

export async function chatCommand(opts: ChatOptions): Promise<void> {
  loadDotenv();
  const initialKey = loadApiKey();

  const requestedSpecs = opts.mcp ?? [];
  const clients: McpClient[] = [];
  const successfulSpecs: string[] = [];
  const failedSpecs: Array<{ spec: string; reason: string }> = [];
  let tools: ToolRegistry | undefined;

  if (requestedSpecs.length > 0) {
    tools = new ToolRegistry();
    for (const raw of requestedSpecs) {
      try {
        const spec = parseMcpSpec(raw);
        const prefix = spec.name
          ? `${spec.name}_`
          : requestedSpecs.length === 1 && opts.mcpPrefix
            ? opts.mcpPrefix
            : "";
        const transport: McpTransport =
          spec.transport === "sse"
            ? new SseTransport({ url: spec.url })
            : new StdioTransport({ command: spec.command, args: spec.args });
        const mcp = new McpClient({ transport });
        await mcp.initialize();
        const bridge = await bridgeMcpTools(mcp, { registry: tools, namePrefix: prefix });
        const label = spec.name ?? "anon";
        const source =
          spec.transport === "sse" ? spec.url : `${spec.command} ${spec.args.join(" ")}`;
        process.stderr.write(
          `▸ MCP[${label}]: ${bridge.registeredNames.length} tool(s) from ${source}\n`,
        );
        clients.push(mcp);
        successfulSpecs.push(raw);
      } catch (err) {
        // Per-server failure is non-fatal: one broken server shouldn't
        // kill a chat that has working servers configured. We record
        // the failure, show a visible warning, and keep going. User
        // can fix via `reasonix setup` (unchecks the broken entry)
        // without losing their other servers.
        const reason = (err as Error).message;
        failedSpecs.push({ spec: raw, reason });
        process.stderr.write(
          `▸ MCP setup SKIPPED for "${raw}": ${reason}\n  → this server will not be available this session. Run \`reasonix setup\` to remove it, or fix the underlying issue (missing npm package, network, etc.).\n`,
        );
      }
    }
    // If every requested server failed, drop the empty registry so the
    // loop still runs as a bare chat instead of advertising zero tools.
    if (successfulSpecs.length === 0) {
      tools = undefined;
    }
  }
  const mcpSpecs = successfulSpecs;

  const { waitUntilExit } = render(
    <Root initialKey={initialKey} tools={tools} mcpSpecs={mcpSpecs} {...opts} />,
    { exitOnCtrlC: true },
  );
  try {
    await waitUntilExit();
  } finally {
    for (const c of clients) await c.close();
  }
}
