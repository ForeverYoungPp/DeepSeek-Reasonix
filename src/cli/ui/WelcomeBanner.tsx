/**
 * Welcome card on the empty session. The first thing a user sees
 * after launching `reasonix code` — needs to communicate, in the
 * ~5 seconds before they type, three things: brand, what to type,
 * how to escape. Card framing uses a gradient top rule + left-side
 * accent bar + sectioned hints so it reads as a designed surface
 * rather than a bare list. No bordered Boxes — those amplified
 * Ink's Windows eraseLines miscount.
 */

import { Box, Text, useStdout } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope
import React from "react";
import { COLOR, gradientCells } from "./theme.js";

export interface WelcomeBannerProps {
  /** True when running `reasonix code`. Surfaces code-mode hints. */
  inCodeMode?: boolean;
}

export function WelcomeBanner({ inCodeMode }: WelcomeBannerProps): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const ruleWidth = Math.min(60, Math.max(28, cols - 4));
  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <GradientRule width={ruleWidth} />
      <BarRow>
        <Text bold color={COLOR.brand}>
          ◈ welcome
        </Text>
        <Text dimColor>{"  ·  type a message to start"}</Text>
      </BarRow>
      <BarRow />
      <BarRow>
        <Text bold color={COLOR.primary}>
          quick start
        </Text>
      </BarRow>
      <Hint cmd="/help" desc="every command + keyboard shortcut" />
      <Hint cmd="/skill" desc="invoke a stored playbook" />
      {inCodeMode ? (
        <>
          <Hint cmd="@path" desc="inline a file in your message" />
          <Hint cmd="!cmd" desc="run a shell command, output goes to context" />
        </>
      ) : null}
      <Hint cmd="/exit" desc="quit (Ctrl+C also works)" />
      <BarRow />
      <BarRow>
        <Text dimColor italic>
          tip:
        </Text>
        <Text dimColor>{"  Ctrl+J inserts a newline · trailing \\ also continues"}</Text>
      </BarRow>
      <Box marginTop={1}>
        <GradientRule width={ruleWidth} thin />
      </Box>
    </Box>
  );
}

/**
 * One-line gradient rule. `thin` swaps the half-block top/bottom so
 * the top of the card reads as a "header band" (▄ — bottom-half
 * filled) and the bottom as "section close" (▁ — minimal pixel
 * row). Same primitive the StatsPanel uses, kept consistent.
 */
function GradientRule({ width, thin }: { width: number; thin?: boolean }) {
  const cells = gradientCells(width, thin ? "▁" : "▄");
  return (
    <Box>
      {cells.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-width gradient row, never reordered
        <Text key={`wrule-${i}`} color={c.color}>
          {c.ch}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Card row — left-side accent bar followed by content. Children
 * optional so we can use this for blank spacer rows (bar only).
 */
function BarRow({ children }: { children?: React.ReactNode }) {
  return (
    <Box>
      <Text color={COLOR.brand} bold>
        ▎
      </Text>
      <Text> </Text>
      {children}
    </Box>
  );
}

/**
 * Single hint row — bold accent cmd token + dim description.
 * Padded so all cmd tokens line up regardless of length, like a
 * man-page synopsis.
 */
function Hint({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <BarRow>
      <Text bold color={COLOR.accent}>
        {cmd.padEnd(8)}
      </Text>
      <Text dimColor>{`  ${desc}`}</Text>
    </BarRow>
  );
}
