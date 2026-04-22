import { type DeepSeekClient, Usage } from "./client.js";
import {
  type BranchOptions,
  type BranchSample,
  aggregateBranchUsage,
  runBranches,
} from "./consistency.js";
import { type HarvestOptions, type TypedPlanState, emptyPlanState, harvest } from "./harvest.js";
import { DEFAULT_MAX_RESULT_CHARS, truncateForModel } from "./mcp/registry.js";
import { AppendOnlyLog, type ImmutablePrefix, VolatileScratch } from "./memory.js";
import { type RepairReport, ToolCallRepair } from "./repair/index.js";
import { appendSessionMessage, loadSessionMessages, rewriteSession } from "./session.js";
import { SessionStats, type TurnStats } from "./telemetry.js";
import { ToolRegistry } from "./tools.js";
import type { ChatMessage, ToolCall } from "./types.js";

export type EventRole =
  | "assistant_delta"
  | "assistant_final"
  | "tool"
  | "done"
  | "error"
  | "warning"
  | "branch_start"
  | "branch_progress"
  | "branch_done";

export interface BranchSummary {
  budget: number;
  chosenIndex: number;
  uncertainties: number[]; // per-sample uncertainty counts
  temperatures: number[];
}

export interface BranchProgress {
  completed: number;
  total: number;
  latestIndex: number;
  latestTemperature: number;
  latestUncertainties: number;
}

export interface LoopEvent {
  turn: number;
  role: EventRole;
  content: string;
  reasoningDelta?: string;
  toolName?: string;
  /**
   * Raw JSON-string arguments the model sent for a tool call (role === "tool").
   * Populated so transcripts can persist *why* a tool was called, not just
   * what it returned. Needed by `reasonix diff` to explain divergences.
   */
  toolArgs?: string;
  stats?: TurnStats;
  planState?: TypedPlanState;
  repair?: RepairReport;
  branch?: BranchSummary;
  branchProgress?: BranchProgress;
  error?: string;
}

export interface CacheFirstLoopOptions {
  client: DeepSeekClient;
  prefix: ImmutablePrefix;
  tools?: ToolRegistry;
  model?: string;
  maxToolIters?: number;
  stream?: boolean;
  /**
   * Pillar 2 — structured harvesting of R1 reasoning into a typed plan state.
   * Pass `true` for defaults or an options object. Off by default (adds a
   * cheap but non-zero V3 call per turn).
   */
  harvest?: boolean | HarvestOptions;
  /**
   * Self-consistency branching. Pass a number for just a budget (e.g. 3) or
   * a full `BranchOptions` object. Disables streaming for the branched turn
   * because all samples must complete before selection. Auto-enables harvest
   * since the default selector scores samples by plan-state uncertainty.
   */
  branch?: number | BranchOptions;
  /**
   * Session name. When set, the loop pre-loads the session's prior messages
   * into its log on construction, and appends every new log entry to
   * `~/.reasonix/sessions/<name>.jsonl` so the next run can resume.
   */
  session?: string;
}

/**
 * Pillar 1 — Cache-First Loop.
 *
 * - prefix is immutable (cache target)
 * - log is append-only (preserves prior-turn prefix)
 * - scratch is per-turn volatile (never sent upstream)
 *
 * Yields a stream of events so a TUI can render progressively.
 */
export interface ReconfigurableOptions {
  model?: string;
  harvest?: boolean | HarvestOptions;
  branch?: number | BranchOptions;
  stream?: boolean;
}

export class CacheFirstLoop {
  readonly client: DeepSeekClient;
  readonly prefix: ImmutablePrefix;
  readonly tools: ToolRegistry;
  readonly maxToolIters: number;
  readonly log = new AppendOnlyLog();
  readonly scratch = new VolatileScratch();
  readonly stats = new SessionStats();
  readonly repair: ToolCallRepair;

  // Mutable via configure() — slash commands in the TUI / library callers tweak
  // these mid-session so users don't have to restart to try harvest or branch.
  model: string;
  stream: boolean;
  harvestEnabled: boolean;
  harvestOptions: HarvestOptions;
  branchEnabled: boolean;
  branchOptions: BranchOptions;
  sessionName: string | null;

  /** Number of messages that were pre-loaded from the session file. */
  readonly resumedMessageCount: number;

  private _turn = 0;
  private _streamPreference: boolean;
  /**
   * Set by {@link abort} to short-circuit the tool-call loop after the
   * current iteration. Reset at the start of each `step()` so an Esc
   * during one turn doesn't poison the next.
   */
  private _aborted = false;

  constructor(opts: CacheFirstLoopOptions) {
    this.client = opts.client;
    this.prefix = opts.prefix;
    this.tools = opts.tools ?? new ToolRegistry();
    this.model = opts.model ?? "deepseek-chat";
    // 24 is a compromise: enough for real filesystem / MCP exploration
    // (which legitimately chains read_file → list_directory → read_file)
    // without letting a confused model burn unlimited cost. When this
    // ceiling is hit the loop forces a final no-tools summary call —
    // see the post-loop branch at the bottom of step() — so the user
    // never sees a silent stop, just a "hit tool-call budget" summary.
    this.maxToolIters = opts.maxToolIters ?? 24;

    // Resolve branch config first (since it forces harvest on).
    if (typeof opts.branch === "number") {
      this.branchOptions = { budget: opts.branch };
    } else if (opts.branch && typeof opts.branch === "object") {
      this.branchOptions = opts.branch;
    } else {
      this.branchOptions = {};
    }
    this.branchEnabled = (this.branchOptions.budget ?? 1) > 1;

    // Branching requires harvest for its default selector to work.
    const harvestForced = this.branchEnabled;
    this.harvestEnabled =
      harvestForced ||
      opts.harvest === true ||
      (typeof opts.harvest === "object" && opts.harvest !== null);
    this.harvestOptions =
      typeof opts.harvest === "object" && opts.harvest !== null
        ? opts.harvest
        : (this.branchOptions.harvestOptions ?? {});

    // Streaming is incompatible with branching (need all samples to select).
    this._streamPreference = opts.stream ?? true;
    this.stream = this.branchEnabled ? false : this._streamPreference;

    const allowedNames = new Set([...this.prefix.toolSpecs.map((s) => s.function.name)]);
    this.repair = new ToolCallRepair({ allowedToolNames: allowedNames });

    // Session resume: pre-load prior messages into the log if a session name
    // is provided. New messages appended to the log are also persisted.
    //
    // Heal-on-load: if a previous run (or a pre-alpha.6 client) stored a
    // tool result bigger than the cap, the next API call would blow past
    // DeepSeek's 131k-token limit *before the user even types anything*.
    // Truncating here lets the user pick up their session history without
    // losing the conversational context around the oversized call.
    this.sessionName = opts.session ?? null;
    if (this.sessionName) {
      const prior = loadSessionMessages(this.sessionName);
      const { messages, healedCount, healedFrom } = healLoadedMessages(
        prior,
        DEFAULT_MAX_RESULT_CHARS,
      );
      for (const msg of messages) this.log.append(msg);
      this.resumedMessageCount = messages.length;
      if (healedCount > 0) {
        process.stderr.write(
          `▸ session "${this.sessionName}": healed ${healedCount} oversized tool result(s) (was ${healedFrom.toLocaleString()} chars total). Old payloads were truncated to fit DeepSeek's context window; the conversation is preserved.\n`,
        );
      }
    } else {
      this.resumedMessageCount = 0;
    }
  }

  /**
   * Shrink the log by re-truncating oversized tool results to a tighter
   * cap, and persist the result back to disk so the next launch doesn't
   * re-inherit a fat session file. Returns a summary the TUI can
   * display.
   *
   * Only tool-role messages are touched (same rationale as
   * {@link healLoadedMessages}). User and assistant messages carry
   * authored intent we can't mechanically shrink without losing
   * meaning.
   */
  compact(tightCapChars = 4000): { healedCount: number; charsSaved: number } {
    const before = this.log.toMessages();
    const { messages, healedCount, healedFrom } = healLoadedMessages(before, tightCapChars);
    const afterBytes = messages
      .filter((m) => m.role === "tool")
      .reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
    const charsSaved = healedFrom - afterBytes;
    if (healedCount > 0) {
      this.log.compactInPlace(messages);
      if (this.sessionName) {
        try {
          rewriteSession(this.sessionName, messages);
        } catch {
          /* disk full or perms — compaction still applies in-memory */
        }
      }
    }
    return { healedCount, charsSaved };
  }

  private appendAndPersist(message: ChatMessage): void {
    this.log.append(message);
    if (this.sessionName) {
      try {
        appendSessionMessage(this.sessionName, message);
      } catch {
        /* disk full or permission denied shouldn't kill the chat */
      }
    }
  }

  /**
   * Reconfigure model/harvest/branch/stream mid-session. The loop's log,
   * scratch, and stats are preserved — only the per-turn behavior changes.
   * Used by the TUI's slash commands and by library callers who want to
   * flip a knob between turns.
   */
  configure(opts: ReconfigurableOptions): void {
    if (opts.model !== undefined) this.model = opts.model;
    if (opts.stream !== undefined) this._streamPreference = opts.stream;

    if (opts.branch !== undefined) {
      if (typeof opts.branch === "number") {
        this.branchOptions = { budget: opts.branch };
      } else if (opts.branch && typeof opts.branch === "object") {
        this.branchOptions = opts.branch;
      } else {
        this.branchOptions = {};
      }
      this.branchEnabled = (this.branchOptions.budget ?? 1) > 1;
    }

    if (opts.harvest !== undefined) {
      const want =
        opts.harvest === true || (typeof opts.harvest === "object" && opts.harvest !== null);
      this.harvestEnabled = want || this.branchEnabled;
      if (typeof opts.harvest === "object" && opts.harvest !== null) {
        this.harvestOptions = opts.harvest;
      }
    } else if (this.branchEnabled) {
      // branch turned on without explicit harvest → force it on
      this.harvestEnabled = true;
    }

    // Branching always forces non-streaming; otherwise honor preference.
    this.stream = this.branchEnabled ? false : this._streamPreference;
  }

  private buildMessages(pendingUser: string | null): ChatMessage[] {
    const msgs: ChatMessage[] = [...this.prefix.toMessages(), ...this.log.toMessages()];
    if (pendingUser !== null) msgs.push({ role: "user", content: pendingUser });
    return msgs;
  }

  /**
   * Signal the currently-running {@link step} that the user wants to
   * stop exploring. Takes effect at the next iteration boundary — if a
   * tool call is mid-flight it will be allowed to finish, then the
   * loop diverts to the forced-summary path so the user gets an
   * answer instead of a cliff. Called by the TUI on Esc.
   */
  abort(): void {
    this._aborted = true;
  }

  async *step(userInput: string): AsyncGenerator<LoopEvent> {
    this._turn++;
    this.scratch.reset();
    this._aborted = false;
    let pendingUser: string | null = userInput;
    const toolSpecs = this.prefix.tools();
    // 70% of the iter budget is the "you're getting close" threshold. We
    // only warn once per step so the user sees a single signal, not a
    // string of identical yellow lines stacked up.
    const warnAt = Math.max(1, Math.floor(this.maxToolIters * 0.7));
    let warnedForIterBudget = false;

    for (let iter = 0; iter < this.maxToolIters; iter++) {
      if (this._aborted) {
        yield {
          turn: this._turn,
          role: "warning",
          content: `aborted at iter ${iter}/${this.maxToolIters} — forcing summary from what was gathered`,
        };
        yield* this.forceSummaryAfterIterLimit({ reason: "aborted" });
        return;
      }
      if (!warnedForIterBudget && iter >= warnAt) {
        warnedForIterBudget = true;
        yield {
          turn: this._turn,
          role: "warning",
          content: `${iter}/${this.maxToolIters} tool calls used — approaching budget. Press Esc to force a summary now.`,
        };
      }
      const messages = this.buildMessages(pendingUser);

      let assistantContent = "";
      let reasoningContent = "";
      let toolCalls: ToolCall[] = [];
      let usage: TurnStats["usage"] | null = null;

      let branchSummary: BranchSummary | undefined;
      let preHarvestedPlanState: TypedPlanState | undefined;

      try {
        if (this.branchEnabled) {
          const budget = this.branchOptions.budget ?? 1;
          yield {
            turn: this._turn,
            role: "branch_start",
            content: "",
            branchProgress: {
              completed: 0,
              total: budget,
              latestIndex: -1,
              latestTemperature: -1,
              latestUncertainties: -1,
            },
          };

          // Queue samples as they complete so we can yield progress events
          // in resolution order (not launch order).
          const queue: BranchSample[] = [];
          let waiter: ((s: BranchSample) => void) | null = null;

          const onSampleDone = (sample: BranchSample) => {
            if (waiter) {
              const w = waiter;
              waiter = null;
              w(sample);
            } else {
              queue.push(sample);
            }
          };

          const branchPromise = runBranches(
            this.client,
            {
              model: this.model,
              messages,
              tools: toolSpecs.length ? toolSpecs : undefined,
            },
            {
              ...this.branchOptions,
              harvestOptions: this.harvestOptions,
              onSampleDone,
            },
          );

          for (let k = 0; k < budget; k++) {
            const sample: BranchSample =
              queue.shift() ??
              (await new Promise<BranchSample>((resolve) => {
                waiter = resolve;
              }));
            yield {
              turn: this._turn,
              role: "branch_progress",
              content: "",
              branchProgress: {
                completed: k + 1,
                total: budget,
                latestIndex: sample.index,
                latestTemperature: sample.temperature,
                latestUncertainties: sample.planState.uncertainties.length,
              },
            };
          }

          const result = await branchPromise;
          assistantContent = result.chosen.response.content;
          reasoningContent = result.chosen.response.reasoningContent ?? "";
          toolCalls = result.chosen.response.toolCalls;

          // Cost accounting: sum usage across ALL samples, not just the winner.
          // (We paid for all three.) Harvest-call tokens are not tracked; they
          // amount to rounding error compared to the main R1 calls.
          const agg = aggregateBranchUsage(result.samples);
          usage = new Usage(
            agg.promptTokens,
            agg.completionTokens,
            agg.totalTokens,
            agg.promptCacheHitTokens,
            agg.promptCacheMissTokens,
          );
          preHarvestedPlanState = result.chosen.planState;
          branchSummary = summarizeBranch(result.chosen, result.samples);
          yield {
            turn: this._turn,
            role: "branch_done",
            content: "",
            branch: branchSummary,
          };
        } else if (this.stream) {
          const callBuf: Map<number, ToolCall> = new Map();
          for await (const chunk of this.client.stream({
            model: this.model,
            messages,
            tools: toolSpecs.length ? toolSpecs : undefined,
          })) {
            if (chunk.contentDelta) {
              assistantContent += chunk.contentDelta;
              yield {
                turn: this._turn,
                role: "assistant_delta",
                content: chunk.contentDelta,
              };
            }
            if (chunk.reasoningDelta) {
              reasoningContent += chunk.reasoningDelta;
              yield {
                turn: this._turn,
                role: "assistant_delta",
                content: "",
                reasoningDelta: chunk.reasoningDelta,
              };
            }
            if (chunk.toolCallDelta) {
              const d = chunk.toolCallDelta;
              const cur = callBuf.get(d.index) ?? {
                id: d.id,
                type: "function" as const,
                function: { name: "", arguments: "" },
              };
              if (d.id) cur.id = d.id;
              if (d.name) cur.function.name = (cur.function.name ?? "") + d.name;
              if (d.argumentsDelta)
                cur.function.arguments = (cur.function.arguments ?? "") + d.argumentsDelta;
              callBuf.set(d.index, cur);
            }
            if (chunk.usage) usage = chunk.usage;
          }
          toolCalls = [...callBuf.values()];
        } else {
          const resp = await this.client.chat({
            model: this.model,
            messages,
            tools: toolSpecs.length ? toolSpecs : undefined,
          });
          assistantContent = resp.content;
          reasoningContent = resp.reasoningContent ?? "";
          toolCalls = resp.toolCalls;
          usage = resp.usage;
        }
      } catch (err) {
        yield {
          turn: this._turn,
          role: "error",
          content: "",
          error: formatLoopError(err as Error),
        };
        return;
      }

      const turnStats = this.stats.record(this._turn, this.model, usage ?? new Usage());

      // Commit the user turn to the log only on success of the first round-trip.
      if (pendingUser !== null) {
        this.appendAndPersist({ role: "user", content: pendingUser });
        pendingUser = null;
      }

      this.scratch.reasoning = reasoningContent || null;
      const planState = preHarvestedPlanState
        ? preHarvestedPlanState
        : this.harvestEnabled
          ? await harvest(reasoningContent || null, this.client, this.harvestOptions)
          : emptyPlanState();

      const { calls: repairedCalls, report } = this.repair.process(
        toolCalls,
        reasoningContent || null,
      );

      this.appendAndPersist(this.assistantMessage(assistantContent, repairedCalls));

      yield {
        turn: this._turn,
        role: "assistant_final",
        content: assistantContent,
        stats: turnStats,
        planState,
        repair: report,
        branch: branchSummary,
      };

      if (repairedCalls.length === 0) {
        yield { turn: this._turn, role: "done", content: assistantContent };
        return;
      }

      for (const call of repairedCalls) {
        const name = call.function?.name ?? "";
        const args = call.function?.arguments ?? "{}";
        const result = await this.tools.dispatch(name, args);
        this.appendAndPersist({
          role: "tool",
          tool_call_id: call.id ?? "",
          name,
          content: result,
        });
        yield {
          turn: this._turn,
          role: "tool",
          content: result,
          toolName: name,
          toolArgs: args,
        };
      }
    }

    // We exhausted the tool-call budget while the model still wanted to
    // call more tools. Rather than stopping silently (which leaves the
    // user staring at a blank prompt), force one final no-tools call so
    // the model must produce a text summary from everything it has
    // already seen.
    yield* this.forceSummaryAfterIterLimit({ reason: "budget" });
  }

  private async *forceSummaryAfterIterLimit(
    opts: { reason: "budget" | "aborted" } = { reason: "budget" },
  ): AsyncGenerator<LoopEvent> {
    try {
      const messages = this.buildMessages(null);
      const resp = await this.client.chat({
        model: this.model,
        messages,
        // no tools → model is forced to answer in text
      });
      const summary =
        resp.content?.trim() ||
        "(model returned no text; try a narrower question or raise --max-tool-iters)";
      const reasonPrefix =
        opts.reason === "aborted"
          ? "[aborted by user (Esc) — summarizing what I found so far]"
          : `[tool-call budget (${this.maxToolIters}) reached — forcing summary from what I found]`;
      const annotated = `${reasonPrefix}\n\n${summary}`;
      const summaryStats = this.stats.record(this._turn, this.model, resp.usage ?? new Usage());
      this.appendAndPersist({ role: "assistant", content: summary });
      yield {
        turn: this._turn,
        role: "assistant_final",
        content: annotated,
        stats: summaryStats,
      };
      yield { turn: this._turn, role: "done", content: summary };
    } catch (err) {
      const label =
        opts.reason === "aborted"
          ? "aborted by user"
          : `tool-call budget (${this.maxToolIters}) reached`;
      yield {
        turn: this._turn,
        role: "error",
        content: "",
        error: `${label} and the fallback summary call failed: ${(err as Error).message}. Run /clear and retry with a narrower question, or raise --max-tool-iters.`,
      };
      yield { turn: this._turn, role: "done", content: "" };
    }
  }

  async run(userInput: string, onEvent?: (ev: LoopEvent) => void): Promise<string> {
    let final = "";
    for await (const ev of this.step(userInput)) {
      onEvent?.(ev);
      if (ev.role === "assistant_final") final = ev.content;
      if (ev.role === "done") break;
    }
    return final;
  }

  private assistantMessage(content: string, toolCalls: ToolCall[]): ChatMessage {
    const msg: ChatMessage = { role: "assistant", content };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    return msg;
  }
}

function summarizeBranch(chosen: BranchSample, samples: BranchSample[]): BranchSummary {
  return {
    budget: samples.length,
    chosenIndex: chosen.index,
    uncertainties: samples.map((s) => s.planState.uncertainties.length),
    temperatures: samples.map((s) => s.temperature),
  };
}

/**
 * Truncate any tool-role message whose content exceeds the cap. User
 * and assistant messages are left alone because (a) they're almost
 * always small, (b) truncating user prompts would corrupt conversational
 * intent in a way the user didn't author. Exported for tests.
 */
export function healLoadedMessages(
  messages: ChatMessage[],
  maxChars: number,
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  let healedCount = 0;
  let healedFrom = 0;
  const out = messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    const content = typeof msg.content === "string" ? msg.content : "";
    if (content.length <= maxChars) return msg;
    healedCount += 1;
    healedFrom += content.length;
    return { ...msg, content: truncateForModel(content, maxChars) };
  });
  return { messages: out, healedCount, healedFrom };
}

/**
 * Annotate the `DeepSeek 400: … maximum context length …` error the API
 * returns when a session's history has grown past 131,072 tokens. The
 * raw message is a JSON blob; we surface a short actionable hint on top
 * so the user knows to `/forget` or `/clear` rather than parsing the
 * JSON themselves. Other errors pass through unchanged — the loop's
 * error channel already formats them well enough.
 */
export function formatLoopError(err: Error): string {
  const msg = err.message ?? "";
  if (msg.includes("maximum context length")) {
    // Pull the "requested X tokens" figure out of the JSON for scale.
    const reqMatch = msg.match(/requested\s+(\d+)\s+tokens/);
    const requested = reqMatch
      ? `${Number(reqMatch[1]).toLocaleString()} tokens`
      : "too many tokens";
    return `Context overflow (DeepSeek 400): session history is ${requested}, past the 131,072-token limit. Usually this means a single tool call returned a huge payload. v0.3.0-alpha.6+ caps new tool results at 32k chars, AND auto-heals oversized history on session load — restart Reasonix and this session should come back trimmed. If it still overflows, run /forget (delete the session) or /clear (drop the displayed history) to start fresh.`;
  }
  return msg;
}
