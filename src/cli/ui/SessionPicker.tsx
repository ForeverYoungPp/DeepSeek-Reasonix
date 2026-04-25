import { Box, Text } from "ink";
import React from "react";
import { SingleSelect } from "./Select.js";

export type SessionChoice = "resume" | "new" | "delete";

export interface SessionPickerProps {
  sessionName: string;
  messageCount: number;
  /** mtime of the session file; used to render "last active Nh ago". */
  lastActive: Date;
  onChoose: (choice: SessionChoice) => void;
}

export function SessionPicker({
  sessionName,
  messageCount,
  lastActive,
  onChoose,
}: SessionPickerProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {`Session "${sessionName}" has ${messageCount} prior message${messageCount === 1 ? "" : "s"}`}
        </Text>
        <Text dimColor>{` · last active ${relativeTime(lastActive)}`}</Text>
      </Box>
      <SingleSelect
        initialValue="new"
        items={[
          {
            value: "new",
            label: "Start new conversation",
            hint: "Previous messages kept on disk; your turn starts fresh.",
          },
          {
            value: "resume",
            label: "Resume",
            hint: `Continue where you left off (${messageCount} messages in context).`,
          },
          {
            value: "delete",
            label: "Delete and start new",
            hint: "Wipes the session file irreversibly. Other sessions untouched.",
          },
        ]}
        onSubmit={(v) => onChoose(v as SessionChoice)}
      />
      <Box marginTop={1}>
        <Text dimColor>[↑↓] navigate · [Enter] select</Text>
      </Box>
    </Box>
  );
}

/**
 * "Nh ago" / "Nm ago" / "yesterday" style relative time. Deliberately
 * coarse — the picker just needs a sense of "how stale is this session".
 */
function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}
