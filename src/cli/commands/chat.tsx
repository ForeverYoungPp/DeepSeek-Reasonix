import { render } from "ink";
import React, { useState } from "react";
import { loadApiKey } from "../../config.js";
import { loadDotenv } from "../../env.js";
import { McpClient } from "../../mcp/client.js";
import { bridgeMcpTools } from "../../mcp/registry.js";
import { shellSplit } from "../../mcp/shell-split.js";
import { StdioTransport } from "../../mcp/stdio.js";
import type { ToolRegistry } from "../../tools.js";
import { App } from "../ui/App.js";
import { Setup } from "../ui/Setup.js";

export interface ChatOptions {
  model: string;
  system: string;
  transcript?: string;
  harvest?: boolean;
  branch?: number;
  session?: string;
  /** Shell-style command string: `"npx -y @modelcontextprotocol/server-filesystem /tmp"`. */
  mcp?: string;
  /** Name prefix applied to every MCP tool so names from multiple servers don't collide. */
  mcpPrefix?: string;
}

interface RootProps extends ChatOptions {
  initialKey: string | undefined;
  tools: ToolRegistry | undefined;
}

function Root({ initialKey, tools, ...appProps }: RootProps) {
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
    />
  );
}

export async function chatCommand(opts: ChatOptions): Promise<void> {
  loadDotenv();
  const initialKey = loadApiKey();

  // Spawn + bridge any MCP server BEFORE rendering. This surfaces spawn
  // errors up-front (clearer than seeing them mid-TUI) and gives us a
  // ready ToolRegistry to hand to the loop.
  let mcp: McpClient | undefined;
  let tools: ToolRegistry | undefined;
  if (opts.mcp) {
    const argv = shellSplit(opts.mcp);
    if (argv.length === 0) {
      process.stderr.write("error: --mcp requires a command\n");
      process.exit(2);
    }
    const [command, ...args] = argv;
    if (!command) {
      process.stderr.write("error: --mcp command is empty\n");
      process.exit(2);
    }
    const transport = new StdioTransport({ command, args });
    mcp = new McpClient({ transport });
    try {
      await mcp.initialize();
      const bridge = await bridgeMcpTools(mcp, { namePrefix: opts.mcpPrefix });
      tools = bridge.registry;
      process.stderr.write(
        `▸ MCP: ${bridge.registeredNames.length} tool(s) from ${argv.join(" ")}\n`,
      );
    } catch (err) {
      process.stderr.write(`MCP setup failed: ${(err as Error).message}\n`);
      await mcp.close();
      process.exit(1);
    }
  }

  const { waitUntilExit } = render(<Root initialKey={initialKey} tools={tools} {...opts} />, {
    exitOnCtrlC: true,
  });
  try {
    await waitUntilExit();
  } finally {
    await mcp?.close();
  }
}
