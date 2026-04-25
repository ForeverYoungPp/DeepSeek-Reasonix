/**
 * Plan Mode — barrel re-export. Existing consumers that import from
 * `./plan.js` continue to work unchanged.
 *
 * Internal layout:
 *   - plan-types.ts   — shared value types (PlanStep, StepCompletion)
 *   - plan-errors.ts  — error classes thrown by the tools
 *   - plan-core.ts    — registerPlanTool + sanitizers
 *
 * Named exports (vs `export *`) so TS catches a collision the moment
 * someone adds a duplicate symbol in one of the modules.
 */

export {
  PlanCheckpointError,
  PlanProposedError,
  PlanRevisionProposedError,
} from "./plan-errors.js";
export type { PlanStep, PlanStepRisk, StepCompletion } from "./plan-types.js";
export { registerPlanTool } from "./plan-core.js";
export type { PlanToolOptions } from "./plan-core.js";
