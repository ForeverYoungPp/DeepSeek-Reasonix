import type { CacheFirstLoop } from "../../loop.js";
import { deleteSession, listSessions } from "../../session.js";

export interface SlashResult {
  /** Text to display back to the user as a system/info line. */
  info?: string;
  /** Exit the app. */
  exit?: boolean;
  /** Clear the visible history. */
  clear?: boolean;
  /** Unknown command — display usage hint. */
  unknown?: boolean;
}

/**
 * Extra runtime context a slash handler may care about but that isn't
 * already on the loop. Kept as an optional object so tests that only
 * need loop-scoped commands can skip it, and callers only populate the
 * slots that apply to their session.
 */
export interface SlashContext {
  /**
   * The exact `--mcp` / config-derived spec strings that were bridged
   * into this session (one entry per server). Used by `/mcp`. Empty or
   * omitted → no MCP servers attached.
   */
  mcpSpecs?: string[];
}

export function parseSlash(text: string): { cmd: string; args: string[] } | null {
  if (!text.startsWith("/")) return null;
  const parts = text.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";
  if (!cmd) return null;
  return { cmd, args: parts.slice(1) };
}

export function handleSlash(
  cmd: string,
  args: string[],
  loop: CacheFirstLoop,
  ctx: SlashContext = {},
): SlashResult {
  switch (cmd) {
    case "exit":
    case "quit":
      return { exit: true };

    case "clear":
      return { clear: true };

    case "help":
    case "?":
      return {
        info: [
          "Commands:",
          "  /help                    this message",
          "  /status                  show current settings",
          "  /preset <fast|smart|max> one-tap presets — see below",
          "  /model <id>              deepseek-chat or deepseek-reasoner",
          "  /harvest [on|off]        Pillar 2: structured plan-state extraction",
          "  /branch <N|off>          run N parallel samples (N>=2), pick most confident",
          "  /mcp                     list MCP servers + tools attached to this session",
          "  /setup                   (exit + reconfigure) → run `reasonix setup`",
          "  /sessions                list saved sessions (current is marked with ▸)",
          "  /forget                  delete the current session from disk",
          "  /clear                   clear displayed history (log + session kept)",
          "  /exit                    quit",
          "",
          "Presets:",
          "  fast   deepseek-chat   no harvest  no branch    ~1¢/100turns  ← default",
          "  smart  reasoner        harvest                  ~10x cost, slower",
          "  max    reasoner        harvest     branch 3     ~30x cost, slowest",
          "",
          "Sessions (auto-enabled by default, named 'default'):",
          "  reasonix chat --session <name>   use a different named session",
          "  reasonix chat --no-session       disable persistence for this run",
        ].join("\n"),
      };

    case "mcp": {
      const specs = ctx.mcpSpecs ?? [];
      const toolSpecs = loop.prefix.toolSpecs ?? [];
      if (specs.length === 0 && toolSpecs.length === 0) {
        return {
          info:
            "no MCP servers attached. Run `reasonix setup` to pick some, " +
            'or launch with --mcp "<spec>". `reasonix mcp list` shows the catalog.',
        };
      }
      const lines: string[] = [];
      if (specs.length > 0) {
        lines.push(`MCP servers (${specs.length}):`);
        for (const spec of specs) lines.push(`  · ${spec}`);
        lines.push("");
      }
      if (toolSpecs.length > 0) {
        lines.push(`Tools in registry (${toolSpecs.length}):`);
        for (const t of toolSpecs) lines.push(`  · ${t.function.name}`);
      }
      lines.push("");
      lines.push("To change this set, exit and run `reasonix setup`.");
      return { info: lines.join("\n") };
    }

    case "setup":
      return {
        info:
          "To reconfigure (preset, MCP servers, API key), exit this chat and run " +
          "`reasonix setup`. Changes take effect on next launch.",
      };

    case "sessions": {
      const items = listSessions();
      if (items.length === 0) {
        return {
          info: "no saved sessions yet — chat normally and your messages will be saved automatically",
        };
      }
      const lines = ["Saved sessions:"];
      for (const s of items) {
        const sizeKb = (s.size / 1024).toFixed(1);
        const when = s.mtime.toISOString().replace("T", " ").slice(0, 16);
        const marker = s.name === loop.sessionName ? "▸" : " ";
        lines.push(
          `  ${marker} ${s.name.padEnd(22)} ${String(s.messageCount).padStart(5)} msgs  ${sizeKb.padStart(7)} KB  ${when}`,
        );
      }
      lines.push("");
      lines.push("Resume with: reasonix chat --session <name>");
      return { info: lines.join("\n") };
    }

    case "forget": {
      if (!loop.sessionName) {
        return { info: "not in a session — nothing to forget" };
      }
      const name = loop.sessionName;
      const ok = deleteSession(name);
      return {
        info: ok
          ? `▸ deleted session "${name}" — current screen still shows the conversation, but next launch starts fresh`
          : `could not delete session "${name}" (already gone?)`,
      };
    }

    case "status": {
      const branchBudget = loop.branchOptions.budget ?? 1;
      return {
        info:
          `model=${loop.model}  ` +
          `harvest=${loop.harvestEnabled ? "on" : "off"}  ` +
          `branch=${branchBudget > 1 ? branchBudget : "off"}  ` +
          `stream=${loop.stream ? "on" : "off"}`,
      };
    }

    case "model": {
      const id = args[0];
      if (!id) return { info: "usage: /model <id>   (try deepseek-chat or deepseek-reasoner)" };
      loop.configure({ model: id });
      return { info: `model → ${id}` };
    }

    case "harvest": {
      const arg = (args[0] ?? "").toLowerCase();
      const on = arg === "" ? !loop.harvestEnabled : arg === "on" || arg === "true" || arg === "1";
      loop.configure({ harvest: on });
      return { info: `harvest → ${loop.harvestEnabled ? "on" : "off"}` };
    }

    case "preset": {
      const name = (args[0] ?? "").toLowerCase();
      if (name === "fast" || name === "default") {
        loop.configure({ model: "deepseek-chat", harvest: false, branch: 1 });
        return { info: "preset → fast  (deepseek-chat, no harvest, no branch)" };
      }
      if (name === "smart") {
        loop.configure({ model: "deepseek-reasoner", harvest: true, branch: 1 });
        return { info: "preset → smart  (reasoner + harvest, ~10x cost vs fast)" };
      }
      if (name === "max" || name === "best") {
        loop.configure({ model: "deepseek-reasoner", harvest: true, branch: 3 });
        return {
          info: "preset → max  (reasoner + harvest + branch3, ~30x cost vs fast, slowest)",
        };
      }
      return { info: "usage: /preset <fast|smart|max>" };
    }

    case "branch": {
      const raw = (args[0] ?? "").toLowerCase();
      if (raw === "" || raw === "off" || raw === "0" || raw === "1") {
        loop.configure({ branch: 1 });
        return { info: "branch → off" };
      }
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 2) {
        return { info: "usage: /branch <N>   (N>=2, or 'off')" };
      }
      if (n > 8) {
        return { info: "branch budget capped at 8 to prevent runaway cost" };
      }
      loop.configure({ branch: n });
      return { info: `branch → ${n}  (harvest auto-enabled; streaming disabled)` };
    }

    default:
      return { unknown: true, info: `unknown command: /${cmd}  (try /help)` };
  }
}
