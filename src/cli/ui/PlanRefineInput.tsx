/**
 * Inline text input shown after the user picks Approve or Refine in
 * PlanConfirm. Collects free-form feedback before the loop resumes.
 *
 * Why both paths: the plan may contain open questions or risks the
 * model asked the user to weigh in on. If the user just picks Approve
 * with no chance to answer, the model implements against its own
 * guesses. This input lets the user answer questions, pass last-minute
 * constraints, or (on Refine) request concrete changes. Empty input is
 * fine for Approve (skip straight to implement) and triggers a
 * "ask the user clarifying questions" path for Refine.
 *
 * Kept minimal: single-line prompt, Enter to submit, Esc to return to
 * the picker without resuming.
 */

import { Box, Text } from "ink";
import React, { useState } from "react";
import { ModalCard } from "./ModalCard.js";
import { useKeystroke } from "./keystroke-context.js";
import { useTick } from "./ticker.js";

export interface PlanRefineInputProps {
  /**
   * Which path the user is on. approve = "implement with these last
   * instructions"; refine = "revise the plan with this feedback";
   * checkpoint-revise = mid-execution pause, user is tweaking the
   * remaining plan after seeing a step's result; choice-custom = user
   * typed an off-list answer to an ask_choice branch. Drives the
   * header + hint text so users know what kind of message they're
   * writing.
   */
  mode: "approve" | "refine" | "checkpoint-revise" | "choice-custom";
  /** Called with trimmed feedback. Empty string is allowed. */
  onSubmit: (feedback: string) => void;
  /** Called when the user presses Esc to return to the picker. */
  onCancel: () => void;
}

export function PlanRefineInput({ mode, onSubmit, onCancel }: PlanRefineInputProps) {
  const [value, setValue] = useState("");

  useKeystroke((ev) => {
    if (ev.paste) {
      // Insert paste content as-is. Multi-line pastes flatten via
      // newlines becoming spaces because this is a single-line input.
      setValue((v) => v + ev.input.replace(/\r?\n/g, " "));
      return;
    }
    if (ev.escape) {
      onCancel();
      return;
    }
    if (ev.return) {
      onSubmit(value.trim());
      return;
    }
    if (ev.backspace || ev.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Filter out non-printable chars; accept ordinary text + CJK.
    if (ev.input && !ev.ctrl && !ev.meta) {
      setValue((v) => v + ev.input);
    }
  });

  const tick = useTick();
  // Slow blink for the cursor block (~480 ms on/off). Same cadence
  // as the wordmark's brand-mark pulse; reads as "input is alive".
  const cursorOn = Math.floor(tick / 4) % 2 === 0;

  const meta =
    mode === "approve"
      ? {
          title: "approving — any last instructions?",
          icon: "📋",
          accent: "#67e8f9",
        }
      : mode === "checkpoint-revise"
        ? {
            title: "revising — what should change before the next step?",
            icon: "✏",
            accent: "#fbbf24",
          }
        : mode === "choice-custom"
          ? {
              title: "custom answer — type whatever fits",
              icon: "🔀",
              accent: "#f0abfc",
            }
          : {
              title: "refining — what should the model change?",
              icon: "✏",
              accent: "#fbbf24",
            };
  const hint =
    mode === "approve"
      ? "Answer questions the plan raised, add constraints, or just press Enter to approve as-is."
      : mode === "checkpoint-revise"
        ? "Scope change, skip steps, alternative approach — the model adjusts the remaining plan."
        : mode === "choice-custom"
          ? "Free-form reply. The model reads it verbatim and proceeds — no need to match the listed options."
          : "Describe what's wrong or missing, or answer questions the plan raised.";
  const blankHint =
    mode === "approve"
      ? " (Enter with blank = approve without extra instructions.)"
      : mode === "checkpoint-revise"
        ? " (Enter with blank = continue with the current plan.)"
        : mode === "choice-custom"
          ? " (Enter with blank = ask the model what you actually want.)"
          : " (Enter with blank = ask the model to list concrete questions.)";

  return (
    <ModalCard accent={meta.accent} icon={meta.icon} title={meta.title}>
      <Box marginBottom={1}>
        <Text dimColor>
          {hint} Enter to send · Esc to return to the picker.
          {value === "" ? blankHint : ""}
        </Text>
      </Box>
      <Box>
        <Text color={meta.accent} bold>
          {"› "}
        </Text>
        <Text>{value}</Text>
        <Text color={meta.accent} bold>
          {cursorOn ? "▍" : " "}
        </Text>
      </Box>
    </ModalCard>
  );
}
