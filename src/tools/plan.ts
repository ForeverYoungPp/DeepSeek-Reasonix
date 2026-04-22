/**
 * Plan Mode — read-only exploration phase for `reasonix code`.
 *
 * Shape (mirrors claude-code's plan/act split, adapted for Reasonix):
 *
 *   1. User types `/plan` → registry switches to plan-mode enforcement
 *      (write tools refused at dispatch; reads + allowlisted shell
 *      still work).
 *   2. Model explores, then calls `submit_plan` with a markdown plan.
 *   3. `submit_plan` throws `PlanProposedError`, which the TUI renders
 *      as a picker: Approve / Refine / Cancel.
 *   4. Approve → registry leaves plan mode, a synthetic user message
 *      "The plan has been approved. Implement it now." is pushed into
 *      the loop so the next turn executes.
 *
 * The read-only enforcement lives in `ToolRegistry.dispatch` via
 * `readOnly` / `readOnlyCheck`; this file only ships the `submit_plan`
 * escape hatch and the error type that carries the plan out of the
 * registry without stuffing it into the message.
 *
 * We do not change `ImmutablePrefix.toolSpecs` when plan mode toggles —
 * that would break Pillar 1's prefix cache. Instead the same full spec
 * list stays pinned, and the registry enforces mode at dispatch time.
 * The refusal string teaches the model the rule; cache hits stay
 * intact.
 */

import type { ToolRegistry } from "../tools.js";

/**
 * Thrown by `submit_plan` when plan mode is active, carrying the plan
 * text the TUI will render for the user's approval.
 *
 * Implements the `toToolResult` protocol so `ToolRegistry.dispatch`
 * serializes the full plan into the tool-result JSON (not just the
 * error message). The TUI parses `{ error, plan }` from the tool event
 * and mounts the `PlanConfirm` picker.
 */
export class PlanProposedError extends Error {
  readonly plan: string;
  constructor(plan: string) {
    super(
      "PlanProposedError: plan submitted. STOP calling tools now — the TUI has shown the plan to the user. Wait for their next message; it will either approve (you'll then implement the plan), request a refinement (you should explore more and submit an updated plan), or cancel (drop the plan and ask what they want instead). Don't call any tools in the meantime.",
    );
    this.name = "PlanProposedError";
    this.plan = plan;
  }

  /**
   * Structured tool-result shape. Consumed by the TUI to extract the
   * plan without regex-scraping the error message.
   */
  toToolResult(): { error: string; plan: string } {
    return { error: `${this.name}: ${this.message}`, plan: this.plan };
  }
}

export interface PlanToolOptions {
  /**
   * Optional side-channel callback fired when the model submits a plan.
   * The TUI uses this to preview the plan in real time (the tool-result
   * event is also emitted; this is just earlier and friendlier to
   * test harnesses that don't want to parse JSON).
   */
  onPlanSubmitted?: (plan: string) => void;
}

export function registerPlanTool(registry: ToolRegistry, opts: PlanToolOptions = {}): ToolRegistry {
  registry.register({
    name: "submit_plan",
    description:
      "Submit a concrete plan to the user for review before executing. Use this for tasks that warrant a review gate — multi-file refactors, architecture changes, anything that would be expensive or confusing to undo. Skip it for small fixes (one-line typo, obvious bug with a clear fix) — just make the change. The user will either approve (you then implement it), ask for refinement, or cancel. If the user has already enabled /plan mode, writes are blocked at dispatch and you MUST use this. Write the plan as markdown with a one-line summary, a bulleted list of files to touch and what will change, and any risks or open questions.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        plan: {
          type: "string",
          description:
            "Markdown-formatted plan. Lead with a one-sentence summary. Then a file-by-file breakdown of what you'll change and why. Flag any risks or open questions at the end so the user can weigh in before you start.",
        },
      },
      required: ["plan"],
    },
    fn: async (args: { plan: string }) => {
      const plan = (args?.plan ?? "").trim();
      if (!plan) {
        throw new Error("submit_plan: empty plan — write a markdown plan and try again.");
      }
      // Always fire the picker, not just inside plan mode. Plan mode's
      // role is the *stronger* constraint — it forces you into read-only
      // until you submit. Outside plan mode, submit_plan is your own
      // call: use it when the task is large enough to deserve a review
      // gate (multi-file refactors, architecture changes, anything
      // that would be expensive to undo), skip it for small fixes.
      opts.onPlanSubmitted?.(plan);
      throw new PlanProposedError(plan);
    },
  });
  return registry;
}
