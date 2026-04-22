/**
 * Tests for the loop's error-message decorator. Scope is narrow:
 * context-overflow errors get a user-friendly hint, everything else
 * passes through unchanged.
 */

import { describe, expect, it } from "vitest";
import { formatLoopError, healLoadedMessages } from "../src/loop.js";
import type { ChatMessage } from "../src/types.js";

describe("formatLoopError", () => {
  it("annotates a DeepSeek 400 'maximum context length' error", () => {
    const raw = new Error(
      'DeepSeek 400: {"error":{"message":"This model\'s maximum context length is 131072 tokens. ' +
        "However, you requested 929452 tokens (929452 in the messages, 0 in the completion). " +
        'Please reduce the length of the messages or completion."}}',
    );
    const out = formatLoopError(raw);
    expect(out).toMatch(/Context overflow/);
    expect(out).toMatch(/\/forget/);
    expect(out).toMatch(/929,452 tokens/); // pretty-printed from the raw JSON
  });

  it("leaves non-overflow errors unchanged", () => {
    const raw = new Error("DeepSeek 401: invalid api key");
    expect(formatLoopError(raw)).toBe("DeepSeek 401: invalid api key");
  });

  it("tolerates an overflow error without a requested-tokens figure", () => {
    const raw = new Error("DeepSeek 400: This model's maximum context length is 131072 tokens.");
    const out = formatLoopError(raw);
    expect(out).toMatch(/Context overflow/);
    expect(out).toMatch(/too many tokens/);
  });
});

describe("healLoadedMessages", () => {
  it("truncates a giant tool result, leaves user/assistant messages alone", () => {
    const big = "X".repeat(80_000);
    const messages: ChatMessage[] = [
      { role: "user", content: "read the big file" },
      { role: "assistant", content: "", tool_calls: [] },
      { role: "tool", tool_call_id: "t1", content: big },
      { role: "assistant", content: "here's what I found" },
    ];
    const { messages: healed, healedCount, healedFrom } = healLoadedMessages(messages, 32_000);
    expect(healedCount).toBe(1);
    expect(healedFrom).toBe(80_000);
    expect(healed[0]).toEqual(messages[0]); // user untouched
    expect(healed[1]).toEqual(messages[1]); // assistant untouched
    expect(typeof healed[2]!.content).toBe("string");
    expect((healed[2]!.content as string).length).toBeLessThan(33_000);
    expect(healed[2]!.content).toContain("truncated");
    expect(healed[3]).toEqual(messages[3]); // trailing assistant untouched
  });

  it("is a no-op when every message fits", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "t1", content: "small result" },
    ];
    const { messages: healed, healedCount } = healLoadedMessages(messages, 32_000);
    expect(healedCount).toBe(0);
    expect(healed).toEqual(messages); // structural equality, same strings
  });

  it("heals multiple oversized tool messages in one pass", () => {
    const messages: ChatMessage[] = [
      { role: "tool", tool_call_id: "t1", content: "A".repeat(40_000) },
      { role: "tool", tool_call_id: "t2", content: "B".repeat(50_000) },
      { role: "tool", tool_call_id: "t3", content: "small" },
    ];
    const { healedCount, healedFrom } = healLoadedMessages(messages, 32_000);
    expect(healedCount).toBe(2);
    expect(healedFrom).toBe(90_000);
  });
});
