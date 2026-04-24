/**
 * One place that defines what each preset means. Both `slash.ts`
 * (in-chat `/preset`) and the wizard (first-run setup) read from here.
 *
 * Presets are the single vocabulary we teach new users: they don't need
 * to know model IDs, reasoning effort, or thinking mode independently
 * — they pick "fast / smart / max" and we translate.
 *
 * Design rules (v0.6+):
 *   - Branching (`branch >= 2`) is NEVER in a preset. Self-consistency
 *     sampling is `N×` cost; auto-enabling it would ambush users into
 *     multi-dollar turns without asking. Opt-in only via `/branch N`.
 *   - Harvest (Pillar-2 plan-state extraction) is NEVER in a preset.
 *     In practice it's display sugar — the typed plan state hasn't
 *     fed back into orchestration decisions (branch trigger) often
 *     enough to pay for the extra round-trip. Opt-in only via
 *     `/harvest on`.
 *   - The three tiers differ on only TWO knobs: model (flash/pro) and
 *     reasoning effort (high/max). Same on-the-wire billing axis,
 *     easy to reason about, easy to budget.
 */

import type { PresetName } from "../../config.js";

export interface PresetSettings {
  model: string;
  /**
   * Reasoning-effort cap sent per turn. `high` = shorter chain of
   * thought (cheaper, faster); `max` = agent-class default (deeper,
   * more output tokens). DeepSeek ignores this field on non-thinking
   * calls, so it's safe to pin across models.
   */
  reasoningEffort: "high" | "max";
  /**
   * Pillar-2 plan-state extraction. Every preset ships `false` (see
   * module header); kept in the shape so a user who later flips it on
   * at runtime still round-trips cleanly. `/harvest on` toggles it.
   */
  harvest: boolean;
  /**
   * Branch budget. Every preset ships `1` (off). `/branch N` with
   * N>=2 is the only way to enable self-consistency sampling.
   */
  branch: number;
}

export const PRESETS: Record<PresetName, PresetSettings> = {
  // fast — flash + effort=high. Quick Q&A, one-line tweaks, anything
  // where shallow reasoning is enough. Cheapest turn possible.
  fast: { model: "deepseek-v4-flash", reasoningEffort: "high", harvest: false, branch: 1 },
  // smart — flash + effort=max. Full thinking budget on the cheap
  // model. The default: handles 90%+ of coding work at a fraction
  // of pro's cost.
  smart: { model: "deepseek-v4-flash", reasoningEffort: "max", harvest: false, branch: 1 },
  // max — pro + effort=max. Frontier model for hard tasks: cross-
  // file architecture, subtle bug hunts, anything where flash's
  // reasoning has measurably failed. ~12× per-token vs flash; save
  // for when you need it, or use `/pro` to escalate a single turn.
  max: { model: "deepseek-v4-pro", reasoningEffort: "max", harvest: false, branch: 1 },
};

export const PRESET_DESCRIPTIONS: Record<PresetName, { headline: string; cost: string }> = {
  fast: {
    headline: "v4-flash · effort=high",
    cost: "cheapest · quick Q&A, one-line edits",
  },
  smart: {
    headline: "v4-flash · effort=max",
    cost: "~1.5× fast · default · day-to-day coding",
  },
  max: {
    headline: "v4-pro · effort=max",
    cost: "~12× fast · hard single-shots · use /pro for a single-turn bump",
  },
};

export function resolvePreset(name: PresetName | undefined): PresetSettings {
  return PRESETS[name ?? "smart"];
}
