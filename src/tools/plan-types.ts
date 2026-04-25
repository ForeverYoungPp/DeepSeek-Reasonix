/**
 * Shared types for Plan Mode. Consumed by plan-errors.ts (error
 * classes carry these as fields) and plan-core.ts (tool registration
 * validates against them). Kept in a separate module so a consumer
 * that only wants the types doesn't pull in either the error classes
 * or the registration machinery.
 */

export type PlanStepRisk = "low" | "med" | "high";

/**
 * Structured step in a submitted plan. Optional — plans can still be
 * pure markdown. When provided, each step is addressable by `id` so
 * the model can later mark it complete via `mark_step_complete`.
 */
export interface PlanStep {
  id: string;
  title: string;
  action: string;
  /**
   * Optional self-reported risk level. Drives the colored dot gutter
   * in PlanConfirm / PlanCheckpointConfirm: green (low) / yellow
   * (med) / red (high). High-risk steps are the ones the user should
   * actually read before approving — everything else is noise.
   * Omitted when the model didn't categorize (treated as neutral).
   */
  risk?: PlanStepRisk;
}

/**
 * Payload surfaced by `mark_step_complete` via `PlanCheckpointError`.
 * The TUI parses the tool result JSON, pushes a `✓ step` progress row,
 * and mounts the checkpoint picker. `kind` is kept on the payload so
 * consumers that peek at the JSON can dispatch on a stable tag.
 */
export interface StepCompletion {
  kind: "step_completed";
  stepId: string;
  title?: string;
  result: string;
  notes?: string;
}
