import { describe, expect, it } from "vitest";
import { Usage } from "../src/client.js";
import { SessionStats, costUsd } from "../src/telemetry.js";

describe("Usage.cacheHitRatio", () => {
  it("computes hit ratio", () => {
    const u = new Usage(0, 0, 0, 80, 20);
    expect(u.cacheHitRatio).toBe(0.8);
  });
  it("is zero on empty", () => {
    expect(new Usage().cacheHitRatio).toBe(0);
  });
});

describe("costUsd", () => {
  it("applies DeepSeek pricing tiers", () => {
    const u = new Usage(1000, 100, 0, 800, 200);
    const c = costUsd("deepseek-chat", u);
    // (800 * 0.07 + 200 * 0.27 + 100 * 1.10) / 1e6
    expect(c).toBeCloseTo((800 * 0.07 + 200 * 0.27 + 100 * 1.1) / 1_000_000, 10);
  });

  it("returns 0 for unknown model", () => {
    expect(costUsd("unknown-model", new Usage(1000, 100))).toBe(0);
  });
});

describe("SessionStats", () => {
  it("aggregates savings vs Claude", () => {
    const stats = new SessionStats();
    stats.record(1, "deepseek-chat", new Usage(1000, 100, 1100, 800, 200));
    const s = stats.summary();
    expect(s.turns).toBe(1);
    expect(s.cacheHitRatio).toBe(0.8);
    expect(s.savingsVsClaudePct).toBeGreaterThan(90);
  });

  it("accumulates across turns", () => {
    const stats = new SessionStats();
    stats.record(1, "deepseek-chat", new Usage(100, 10, 110, 80, 20));
    stats.record(2, "deepseek-chat", new Usage(200, 20, 220, 160, 40));
    expect(stats.turns.length).toBe(2);
    expect(stats.aggregateCacheHitRatio).toBeCloseTo(240 / 300);
  });

  it("summary.lastPromptTokens tracks the most recent turn only", () => {
    const stats = new SessionStats();
    expect(stats.summary().lastPromptTokens).toBe(0);
    stats.record(1, "deepseek-chat", new Usage(5_000, 100, 5_100, 4_000, 1_000));
    expect(stats.summary().lastPromptTokens).toBe(5_000);
    stats.record(2, "deepseek-chat", new Usage(42_000, 200, 42_200, 40_000, 2_000));
    expect(stats.summary().lastPromptTokens).toBe(42_000);
  });
});
