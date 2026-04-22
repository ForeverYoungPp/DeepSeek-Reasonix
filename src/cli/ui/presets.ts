/**
 * One place that defines what each preset means. Both `slash.ts`
 * (in-chat `/preset`) and the wizard (first-run setup) read from here.
 *
 * Presets are the single vocabulary we teach new users: they don't need
 * to know model IDs, Pillar 2, branch budgets, or cost tradeoffs
 * independently — they pick "fast / smart / max" and we translate.
 */

import type { PresetName } from "../../config.js";

export interface PresetSettings {
  model: string;
  harvest: boolean;
  /** Branch budget. `1` means branching off. */
  branch: number;
}

export const PRESETS: Record<PresetName, PresetSettings> = {
  fast: { model: "deepseek-chat", harvest: false, branch: 1 },
  smart: { model: "deepseek-reasoner", harvest: true, branch: 1 },
  max: { model: "deepseek-reasoner", harvest: true, branch: 3 },
};

export const PRESET_DESCRIPTIONS: Record<PresetName, { headline: string; cost: string }> = {
  fast: {
    headline: "deepseek-chat, no reasoning harvest, no branching",
    cost: "~1¢ per 100 turns · default",
  },
  smart: {
    headline: "deepseek-reasoner + Pillar 2 harvest",
    cost: "~10× cost vs fast · slower · better on multi-step tasks",
  },
  max: {
    headline: "reasoner + harvest + self-consistency (3 branches)",
    cost: "~30× cost vs fast · slowest · for hard single-shots",
  },
};

export function resolvePreset(name: PresetName | undefined): PresetSettings {
  return PRESETS[name ?? "fast"];
}
