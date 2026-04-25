/**
 * `/plans` — show this session's plan history. Both the live in-flight
 * plan (if any) and the archive of completed `.done.json` files. Local
 * to the current session by design — a plan lives with its project,
 * and resuming one just means cd'ing back to that project directory.
 */

import { listPlanArchives, loadPlanState, relativeTime } from "../../../../code/plan-store.js";
import type { SlashHandler } from "../dispatch.js";

const plans: SlashHandler = (_args, loop) => {
  const sessionName = loop.sessionName;
  if (!sessionName) {
    return {
      info: "no session attached — `/plans` is per-session. Run `reasonix code` in a project to get a session.",
    };
  }
  const lines: string[] = [];
  // Active (in-flight) plan summary first — it's the one the user is
  // most likely asking about.
  const active = loadPlanState(sessionName);
  if (active && active.steps.length > 0) {
    const total = active.steps.length;
    const done = active.completedStepIds.length;
    const when = relativeTime(active.updatedAt);
    lines.push(
      `▸ active plan: ${done}/${total} step${total === 1 ? "" : "s"} done · last touched ${when}`,
    );
  } else {
    lines.push("▸ active plan: (none)");
  }

  // Archives (completed plans) — newest first.
  const archives = listPlanArchives(sessionName);
  if (archives.length === 0) {
    lines.push("");
    lines.push(
      "no archived plans yet for this session — they auto-archive when every step is done",
    );
    return { info: lines.join("\n") };
  }
  lines.push("");
  lines.push(`Archived (${archives.length}):`);
  for (const a of archives) {
    const when = relativeTime(a.completedAt);
    const total = a.steps.length;
    const done = a.completedStepIds.length;
    const completion = done >= total ? "complete" : `${done}/${total}`;
    // Filename minus path for compactness.
    const file = a.path.split(/[\\/]/).pop() ?? a.path;
    lines.push(
      `  ✓ ${when.padEnd(10)}  ${total} step${total === 1 ? "" : "s"} · ${completion}  ${file}`,
    );
  }
  return { info: lines.join("\n") };
};

export const handlers: Record<string, SlashHandler> = {
  plans,
};
