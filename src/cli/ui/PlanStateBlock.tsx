/**
 * Shared Ink block that renders a TypedPlanState. Used by the live chat
 * EventLog AND by the RecordView in replay/diff TUIs, so harvest output
 * looks identical live and on replay.
 *
 * Colors are semantic (not decorative):
 *   - subgoals:       cyan         — structure / plan
 *   - hypotheses:     green        — current beliefs (like assistant)
 *   - uncertainties:  yellow       — attention required (like tool)
 *   - rejected paths: red dim      — ruled out (muted, like error-but-resolved)
 *
 * Only the label is colored + bold. The items themselves render in the
 * terminal's default foreground, so they stay readable on any background —
 * which is why the old single-magenta block was hard to see on dark themes.
 */

import { Box, Text } from "ink";
import React from "react";
import type { TypedPlanState } from "../../harvest.js";

type FieldColor = string;

export function PlanStateBlock({ planState }: { planState: TypedPlanState }) {
  const fields: Array<[string, string[], FieldColor, boolean]> = [];
  if (planState.subgoals.length) fields.push(["subgoals", planState.subgoals, "#67e8f9", false]);
  if (planState.hypotheses.length)
    fields.push(["hypotheses", planState.hypotheses, "#86efac", false]);
  if (planState.uncertainties.length)
    fields.push(["uncertainties", planState.uncertainties, "#fcd34d", false]);
  if (planState.rejectedPaths.length)
    fields.push(["rejected", planState.rejectedPaths, "#94a3b8", true]);
  if (fields.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {fields.map(([label, items, color, dim]) => (
        <Box key={label}>
          <Text backgroundColor={color} color="black" bold dimColor={dim}>
            {` ${label} ${items.length} `}
          </Text>
          <Text>{"  "}</Text>
          <Text dimColor={dim}>{items.join(" · ")}</Text>
        </Box>
      ))}
    </Box>
  );
}
