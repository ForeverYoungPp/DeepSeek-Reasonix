/**
 * Error classes for Plan Mode tools. Each one implements the
 * `toToolResult` protocol so `ToolRegistry.dispatch` serializes the
 * structured payload into the tool-result JSON — the TUI parses that
 * shape to mount the right picker (approve / checkpoint / revise).
 *
 * Types live in plan-types.ts; registration logic in plan-core.ts.
 * Dependency direction: plan-core → plan-errors → plan-types.
 */

import type { PlanStep, StepCompletion } from "./plan-types.js";

/**
 * Thrown by `submit_plan` when the model has produced a plan for the
 * user to approve. Carries the markdown body, optional structured
 * steps, and an optional one-line summary. The TUI uses all three to
 * render the PlanConfirm picker.
 */
export class PlanProposedError extends Error {
  readonly plan: string;
  readonly steps?: PlanStep[];
  readonly summary?: string;
  constructor(plan: string, steps?: PlanStep[], summary?: string) {
    super(
      "PlanProposedError: plan submitted. STOP calling tools now — the TUI has shown the plan to the user. Wait for their next message; it will either approve (you'll then implement the plan), request a refinement (you should explore more and submit an updated plan), or cancel (drop the plan and ask what they want instead). Don't call any tools in the meantime.",
    );
    this.name = "PlanProposedError";
    this.plan = plan;
    this.steps = steps;
    this.summary = summary;
  }

  /**
   * Structured tool-result shape. Consumed by the TUI to extract the
   * plan without regex-scraping the error message. Optional fields
   * are omitted from the payload when absent so consumers don't see
   * `undefined` keys in the JSON.
   */
  toToolResult(): { error: string; plan: string; steps?: PlanStep[]; summary?: string } {
    const payload: { error: string; plan: string; steps?: PlanStep[]; summary?: string } = {
      error: `${this.name}: ${this.message}`,
      plan: this.plan,
    };
    if (this.steps && this.steps.length > 0) payload.steps = this.steps;
    if (this.summary) payload.summary = this.summary;
    return payload;
  }
}

/**
 * Thrown by `mark_step_complete`. The registry serializes the
 * structured payload via `toToolResult`, the TUI catches the error
 * tag and pauses the loop until the user decides continue / revise /
 * stop. The error message tells the model to stop calling tools so
 * it doesn't race past the picker.
 */
export class PlanCheckpointError extends Error {
  readonly stepId: string;
  readonly title?: string;
  readonly result: string;
  readonly notes?: string;
  constructor(update: { stepId: string; title?: string; result: string; notes?: string }) {
    super(
      "PlanCheckpointError: step complete — STOP calling tools. The TUI has paused the plan for user review. Wait for the next user message; it will either say continue (proceed to the next step), request a revision (adjust the remaining plan), or stop (summarize and end).",
    );
    this.name = "PlanCheckpointError";
    this.stepId = update.stepId;
    this.title = update.title;
    this.result = update.result;
    this.notes = update.notes;
  }

  toToolResult(): { error: string } & StepCompletion {
    const payload: { error: string } & StepCompletion = {
      error: `${this.name}: ${this.message}`,
      kind: "step_completed",
      stepId: this.stepId,
      result: this.result,
    };
    if (this.title) payload.title = this.title;
    if (this.notes) payload.notes = this.notes;
    return payload;
  }
}

/**
 * Thrown by `revise_plan`. Carries the proposed remaining-step list,
 * a one-sentence reason, and an optional updated summary out to the
 * TUI. Mirrors PlanProposedError / PlanCheckpointError. The picker
 * shows a diff between the current remaining steps and the proposed
 * ones; the user accepts (replaces) or rejects (keeps current).
 *
 * Why a separate tool from submit_plan: revising is surgical (replace
 * the tail of an in-flight plan), submitting is a fresh proposal.
 * Different intent, different UI. Calling submit_plan again mid-
 * execution would reset the whole plan including done steps, which
 * is heavier than usually needed.
 */
export class PlanRevisionProposedError extends Error {
  readonly reason: string;
  readonly remainingSteps: PlanStep[];
  readonly summary?: string;
  constructor(reason: string, remainingSteps: PlanStep[], summary?: string) {
    super(
      "PlanRevisionProposedError: revision submitted. STOP calling tools now — the TUI has paused for the user to review your proposed change. Wait for their next message; it will say 'revision accepted' (proceed with the new step list), 'revision rejected' (keep the original plan and continue), or 'revision cancelled' (drop the proposal entirely). Don't call any tools in the meantime.",
    );
    this.name = "PlanRevisionProposedError";
    this.reason = reason;
    this.remainingSteps = remainingSteps;
    this.summary = summary;
  }

  toToolResult(): {
    error: string;
    reason: string;
    remainingSteps: PlanStep[];
    summary?: string;
  } {
    const payload: {
      error: string;
      reason: string;
      remainingSteps: PlanStep[];
      summary?: string;
    } = {
      error: `${this.name}: ${this.message}`,
      reason: this.reason,
      remainingSteps: this.remainingSteps,
    };
    if (this.summary) payload.summary = this.summary;
    return payload;
  }
}
