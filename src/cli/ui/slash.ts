import type { CacheFirstLoop } from "../../loop.js";

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

export function parseSlash(text: string): { cmd: string; args: string[] } | null {
  if (!text.startsWith("/")) return null;
  const parts = text.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";
  if (!cmd) return null;
  return { cmd, args: parts.slice(1) };
}

export function handleSlash(cmd: string, args: string[], loop: CacheFirstLoop): SlashResult {
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
          "  /model <id>              deepseek-chat or deepseek-reasoner",
          "  /harvest [on|off]        Pillar 2: structured plan-state extraction",
          "  /branch <N|off>          run N parallel samples (N>=2), pick most confident",
          "  /clear                   clear displayed history (log is kept)",
          "  /exit                    quit",
        ].join("\n"),
      };

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
