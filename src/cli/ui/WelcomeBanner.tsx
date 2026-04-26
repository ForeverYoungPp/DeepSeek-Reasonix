/**
 * Friendly first-impression card. Rendered when the chat is at turn
 * 0 with no live activity — gives the user concrete next-steps
 * instead of a near-empty terminal that just shows the prompt.
 *
 * The hints are deliberately a tight curated subset — full reference
 * is `/help`. Goal here is to remove the "what do I type?" friction
 * without overwhelming.
 */

import { Box, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope
import React from "react";

export interface WelcomeBannerProps {
  /** True when running `reasonix code`. Surfaces code-mode hints. */
  inCodeMode?: boolean;
}

export function WelcomeBanner({ inCodeMode }: WelcomeBannerProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Box>
        <Text bold color="cyan">
          Hi
        </Text>
        <Text>{" — type a message to start, or try:"}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Hint cmd="/help" desc="every command + keyboard shortcut" />
        <Hint cmd="/skill" desc="invoke a stored playbook" />
        {inCodeMode ? (
          <>
            <Hint cmd="@path" desc="inline a file in your message" />
            <Hint cmd="!cmd" desc="run a shell command, output goes to context" />
          </>
        ) : null}
        <Hint cmd="/exit" desc="quit" />
      </Box>
    </Box>
  );
}

function Hint({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <Box>
      <Text dimColor>{"  "}</Text>
      <Text bold color="magenta">
        {cmd.padEnd(8)}
      </Text>
      <Text dimColor>{`  ${desc}`}</Text>
    </Box>
  );
}
