import { DEEPSEEK_CONTEXT_TOKENS, DEFAULT_CONTEXT_TOKENS } from "../../../../telemetry.js";
import { countTokens } from "../../../../tokenizer.js";
import type { SlashHandler } from "../dispatch.js";
import { compactNum, formatToolList } from "../helpers.js";

const think: SlashHandler = (_args, loop) => {
  const raw = loop.scratch.reasoning;
  if (!raw || !raw.trim()) {
    return {
      info:
        "no reasoning cached. `/think` shows the full thinking-mode thought for the most recent " +
        "turn — only thinking-mode models (deepseek-v4-flash / -v4-pro / -reasoner) produce it, " +
        "and only once the turn completes.",
    };
  }
  return { info: `↳ full thinking (${raw.length} chars):\n\n${raw.trim()}` };
};

const tool: SlashHandler = (args, _loop, ctx) => {
  // EventLog renders tool results as a one-line summary for display.
  // When the user wants to check what the model actually read (e.g.
  // to verify it isn't hallucinating a file's contents), they need
  // the full text. `/tool` is the escape hatch.
  const history = ctx.toolHistory?.() ?? [];
  if (history.length === 0) {
    return {
      info:
        "no tool calls yet in this session. `/tool` lists them once the model has actually " +
        "used a tool; `/tool N` dumps the full (untruncated) output of the Nth-most-recent.",
    };
  }
  const raw = (args[0] ?? "").toLowerCase();
  if (raw === "" || raw === "list" || raw === "ls") {
    return { info: formatToolList(history) };
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return {
      info: "usage: /tool [N]   (no arg → list; N=1 → most recent result in full, N=2 → previous, …)",
    };
  }
  if (n > history.length) {
    return {
      info: `only ${history.length} tool call(s) in history — asked for #${n}. Try /tool with no arg to see the list.`,
    };
  }
  const entry = history[history.length - n];
  if (!entry) {
    return { info: `could not read tool call #${n}` };
  }
  return {
    info: `↳ tool<${entry.toolName}> #${n} (${entry.text.length} chars):\n\n${entry.text}`,
  };
};

const context: SlashHandler = (_args, loop) => {
  // Measure each slice of the next request locally so the user can see
  // *where* context is being spent — a much more useful number than
  // the "last turn's total" the gauge shows. Tokenization is lazy so
  // the first /context call carries the data-file load cost (~100ms);
  // subsequent calls are pure compute.
  const systemTokens = countTokens(loop.prefix.system);
  const toolsTokens = countTokens(JSON.stringify(loop.prefix.toolSpecs));
  const entries = loop.log.toMessages();
  let userTokens = 0;
  let assistantTokens = 0;
  let toolResultTokens = 0;
  let toolCallTokens = 0;
  const toolBreakdown: Array<{ name: string; tokens: number; turn: number }> = [];
  let logTurn = 0;
  for (const e of entries) {
    const content = typeof e.content === "string" ? e.content : "";
    if (e.role === "user") {
      userTokens += countTokens(content);
      logTurn += 1;
    } else if (e.role === "assistant") {
      assistantTokens += countTokens(content);
      if (Array.isArray(e.tool_calls) && e.tool_calls.length > 0) {
        toolCallTokens += countTokens(JSON.stringify(e.tool_calls));
      }
    } else if (e.role === "tool") {
      const n = countTokens(content);
      toolResultTokens += n;
      toolBreakdown.push({ name: e.name ?? "?", tokens: n, turn: logTurn });
    }
  }
  const logTokens = userTokens + assistantTokens + toolResultTokens + toolCallTokens;
  const ctxMax = DEEPSEEK_CONTEXT_TOKENS[loop.model] ?? DEFAULT_CONTEXT_TOKENS;
  // For /context's "input" segment we count what the user is about to
  // submit if they hit enter right now. The slash itself runs synchronously
  // off the prompt buffer, but App.tsx doesn't pass that buffer through —
  // approximate as 0 here. The breakdown still adds up because system +
  // tools + log are the big chunks; input is usually <1% pre-send.
  const inputTokens = 0;
  const topTools = [...toolBreakdown].sort((a, b) => b.tokens - a.tokens).slice(0, 5);

  // Structured payload — EventLog renders this as a 4-color stacked
  // char-bar via Box+Text segments. The `info` field is a fallback
  // for log replay / dashboards that don't know about the rich form.
  const total = systemTokens + toolsTokens + logTokens + inputTokens;
  const winPct = ctxMax > 0 ? Math.round((total / ctxMax) * 100) : 0;
  const fallbackInfo = `context: ~${compactNum(total)} of ${compactNum(ctxMax)} (${winPct}%) · system ${compactNum(systemTokens)} · tools ${compactNum(toolsTokens)} · log ${compactNum(logTokens)}`;
  return {
    info: fallbackInfo,
    ctxBreakdown: {
      systemTokens,
      toolsTokens,
      logTokens,
      inputTokens,
      ctxMax,
      toolsCount: loop.prefix.toolSpecs.length,
      logMessages: entries.length,
      topTools,
    },
  };
};

const status: SlashHandler = (_args, loop, ctx) => {
  const branchBudget = loop.branchOptions.budget ?? 1;
  const ctxMax = DEEPSEEK_CONTEXT_TOKENS[loop.model] ?? DEFAULT_CONTEXT_TOKENS;
  const summary = loop.stats.summary();
  const lastPromptTokens = summary.lastPromptTokens;
  const ctxPct = ctxMax > 0 ? Math.round((lastPromptTokens / ctxMax) * 100) : 0;
  // 16-cell context bar — narrower than /context's 48 since /status is
  // a quick glance, not the deep dive. Same `█/░` characters so the
  // visual grammar stays consistent across slashes.
  const ctxBar = lastPromptTokens > 0 ? renderTinyBar(ctxPct, 16) : "";
  const ctxLine =
    lastPromptTokens > 0
      ? `  ctx     ${ctxBar} ${compactNum(lastPromptTokens)}/${compactNum(ctxMax)} (${ctxPct}%)`
      : "  ctx     no turns yet";

  // Cost / cache hit row — the high-signal numbers from StatsPanel.
  // Cache pct only shown after the cold-start window so a 0.0% on
  // turn 1 doesn't read as broken.
  const cost = summary.totalCostUsd;
  const cacheLine =
    summary.turns > 3
      ? (() => {
          const cachePct = Math.round(summary.cacheHitRatio * 100);
          return `  cost    $${cost.toFixed(4)} · cache ${renderTinyBar(cachePct, 12)} ${cachePct}% · turns ${summary.turns}`;
        })()
      : `  cost    $${cost.toFixed(4)} · turns ${summary.turns} (cache warming up)`;

  // Budget row — only when a cap is set
  const budgetLine =
    typeof loop.budgetUsd === "number"
      ? (() => {
          const pct = Math.round((cost / loop.budgetUsd!) * 100);
          const tag = pct >= 100 ? " ▲ EXHAUSTED" : pct >= 80 ? " ▲ 80%+" : "";
          return `  budget  $${cost.toFixed(4)} / $${loop.budgetUsd!.toFixed(2)} (${pct}%)${tag}`;
        })()
      : "";

  const pending = ctx.pendingEditCount ?? 0;
  const sessionLine = loop.sessionName
    ? `  session "${loop.sessionName}" · ${loop.log.length} messages in log (resumed ${loop.resumedMessageCount})`
    : "  session (ephemeral — no persistence)";
  const mcpCount = ctx.mcpSpecs?.length ?? 0;
  const toolCount = loop.prefix.toolSpecs.length;
  const mcpLine = `  mcp     ${mcpCount} server(s), ${toolCount} tool(s) in registry`;
  const pendingLine =
    pending > 0 ? `  edits   ${pending} pending (/apply to commit, /discard to drop)` : "";
  const planLine = ctx.planMode ? "  plan    ON — writes gated (submit_plan + approval)" : "";
  const modeLine =
    ctx.editMode === "yolo"
      ? "  mode    YOLO — edits + shell auto-run with no prompt (/undo still rolls back · Shift+Tab to flip)"
      : ctx.editMode === "auto"
        ? "  mode    AUTO — edits apply immediately (u to undo within 5s · Shift+Tab to flip)"
        : ctx.editMode === "review"
          ? "  mode    review — edits queue for /apply or y  (Shift+Tab to flip)"
          : "";
  const dashLine = ctx.getDashboardUrl?.()
    ? `  dash    ${ctx.getDashboardUrl?.()} (open in browser · /dashboard stop)`
    : "";
  const lines = [
    `  model   ${loop.model}`,
    `  flags   harvest=${loop.harvestEnabled ? "on" : "off"} · branch=${branchBudget > 1 ? branchBudget : "off"} · stream=${loop.stream ? "on" : "off"} · effort=${loop.reasoningEffort}`,
    cacheLine,
    ctxLine,
    mcpLine,
    sessionLine,
  ];
  if (budgetLine) lines.push(budgetLine);
  if (pendingLine) lines.push(pendingLine);
  if (planLine) lines.push(planLine);
  if (modeLine) lines.push(modeLine);
  if (dashLine) lines.push(dashLine);
  return { info: lines.join("\n") };
};

/**
 * Tiny `[██████░░░░] 60%`-style bar for use inside slash text output.
 * Char-only, no color (info text strings render dimColor in EventLog).
 * The visual is intentionally subtle — these slashes are scanned for
 * numbers, not stared at.
 */
function renderTinyBar(pct: number, width: number): string {
  const w = Math.max(4, width);
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((w * clamped) / 100);
  return `[${"█".repeat(filled)}${"░".repeat(w - filled)}]`;
}

const compact: SlashHandler = (args, loop) => {
  // Manual companion to the automatic 60%/80% auto-compact. Re-applies
  // token-aware truncation with a tighter cap (default 4000 tokens per
  // tool result) and rewrites the session file so the shrink persists.
  // Useful when the ctx gauge in StatsPanel goes yellow/red mid-session
  // and the user wants to keep chatting without /forget'ing everything.
  const tight = Number.parseInt(args[0] ?? "", 10);
  const cap = Number.isFinite(tight) && tight >= 100 ? tight : 4000;
  const { healedCount, tokensSaved, charsSaved } = loop.compact(cap);
  if (healedCount === 0) {
    return {
      info: `▸ nothing to compact — no tool result or tool-call args in history exceed ${cap.toLocaleString()} tokens.`,
    };
  }
  return {
    info: `▸ compacted ${healedCount} payload(s) to ${cap.toLocaleString()} tokens each (tool results + tool-call args), saved ${tokensSaved.toLocaleString()} tokens (${charsSaved.toLocaleString()} chars). Session file rewritten.`,
  };
};

export const handlers: Record<string, SlashHandler> = {
  think,
  reasoning: think,
  tool,
  context,
  status,
  compact,
};
