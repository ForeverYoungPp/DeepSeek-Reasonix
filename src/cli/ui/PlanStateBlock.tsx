/**
 * Shared Ink block that renders a TypedPlanState. Used by the live chat
 * EventLog AND by the RecordView in replay/diff TUIs, so harvest output
 * looks identical live and on replay.
 */

import { Box, Text } from "ink";
import React from "react";
import type { TypedPlanState } from "../../harvest.js";

export function PlanStateBlock({ planState }: { planState: TypedPlanState }) {
  const lines: Array<[string, string[]]> = [];
  if (planState.subgoals.length) lines.push(["subgoals", planState.subgoals]);
  if (planState.hypotheses.length) lines.push(["hypotheses", planState.hypotheses]);
  if (planState.uncertainties.length) lines.push(["uncertainties", planState.uncertainties]);
  if (planState.rejectedPaths.length) lines.push(["rejected", planState.rejectedPaths]);
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {lines.map(([label, items]) => (
        <Text key={label} color="magenta">
          {"‹ "}
          <Text bold>{label}</Text>
          {` (${items.length}): ${items.join(" · ")}`}
        </Text>
      ))}
    </Box>
  );
}
