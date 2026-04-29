import { describe, expect, it } from "vitest";
import type { DisplayEvent } from "../src/cli/ui/EventLog.js";
import { eventToAtom, viewportLog } from "../src/cli/ui/log-frame.js";
import { rowText } from "../src/frame/index.js";

const W = 80;

function infoEvent(text: string, id = "i"): DisplayEvent {
  return { id, role: "info", text };
}

function warnEvent(text: string, id = "w"): DisplayEvent {
  return { id, role: "warning", text };
}

function errorEvent(text: string, id = "e"): DisplayEvent {
  return { id, role: "error", text };
}

describe("eventToAtom — info", () => {
  it("produces a frame atom for a short info message", () => {
    const a = eventToAtom(infoEvent("▸ hello world"), undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(a.frame.rows.length).toBe(1);
    expect(rowText(a.frame.rows[0]!)).toContain("▸");
    expect(rowText(a.frame.rows[0]!)).toContain("hello world");
  });
  it("wraps long info text across multiple rows", () => {
    const long = "x".repeat(200);
    const a = eventToAtom(infoEvent(long), undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(a.frame.rows.length).toBeGreaterThan(2);
    // Every row has the same width (the Frame invariant).
    for (const r of a.frame.rows) {
      let visible = 0;
      for (const c of r) if (!c.tail) visible += c.width;
      expect(visible).toBe(a.frame.width);
    }
  });
  it("auto-tones glyph color (warn / ok / err)", () => {
    const okAtom = eventToAtom(infoEvent("✓ done"), undefined, W);
    const warnAtom = eventToAtom(infoEvent("▲ careful"), undefined, W);
    const errAtom = eventToAtom(infoEvent("✗ failed"), undefined, W);
    if (okAtom.kind !== "frame" || warnAtom.kind !== "frame" || errAtom.kind !== "frame") {
      throw new Error("expected frame atoms");
    }
    // Just verify the glyph cell carries different colors. The bar
    // (first cell) shares the glyph color.
    expect(okAtom.frame.rows[0]![0]!.fg).not.toBe(warnAtom.frame.rows[0]![0]!.fg);
    expect(warnAtom.frame.rows[0]![0]!.fg).not.toBe(errAtom.frame.rows[0]![0]!.fg);
  });
});

describe("eventToAtom — warning / error", () => {
  it("warning atom carries the warn glyph", () => {
    const a = eventToAtom(warnEvent("be careful"), undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(rowText(a.frame.rows[0]!)).toContain("▲ warn");
  });
  it("error atom carries the err glyph", () => {
    const a = eventToAtom(errorEvent("oops"), undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(rowText(a.frame.rows[0]!)).toContain("✦ error");
  });
});

describe("eventToAtom — fallback to ink", () => {
  it("streaming assistant falls back to ink atom", () => {
    const a = eventToAtom(
      { id: "s1", role: "assistant", text: "...", streaming: true } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("ink");
  });
  it("plan-replay falls back to ink atom", () => {
    const a = eventToAtom(
      { id: "pr1", role: "plan-replay", text: "..." } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("ink");
  });
  it("plan-resumed falls back to ink atom", () => {
    const a = eventToAtom(
      { id: "ps1", role: "plan-resumed", text: "..." } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("ink");
  });
});

describe("eventToAtom — complex assistant", () => {
  it("assistant with reasoning produces a frame atom", () => {
    const a = eventToAtom(
      { id: "a1", role: "assistant", text: "hi", reasoning: "thinking..." } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(a.frame.rows.length).toBeGreaterThan(3);
  });
});

describe("eventToAtom — plan", () => {
  it("plan role produces a frame atom with header", () => {
    const a = eventToAtom({ id: "p1", role: "plan", text: "step 1\nstep 2" }, undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    const allText = a.frame.rows.map(rowText).join("\n");
    expect(allText).toContain("plan proposed");
  });
});

describe("eventToAtom — ctx-breakdown", () => {
  it("ctx-breakdown produces a frame atom with bar + legend", () => {
    const a = eventToAtom(
      {
        id: "c1",
        role: "ctx-breakdown",
        text: "",
        ctxBreakdown: {
          systemTokens: 1000,
          toolsTokens: 2000,
          logTokens: 3000,
          inputTokens: 500,
          toolsCount: 5,
          ctxMax: 8000,
        },
      } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    const allText = a.frame.rows.map(rowText).join("\n");
    expect(allText).toContain("context");
    expect(allText).toContain("system");
  });
});

describe("eventToAtom — user", () => {
  it("produces frame atom with cyan glyph", () => {
    const a = eventToAtom({ id: "u1", role: "user", text: "hello" }, undefined, W);
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(rowText(a.frame.rows[0]!)).toContain("◇");
    expect(rowText(a.frame.rows[0]!)).toContain("hello");
  });
  it("wraps long user input across rows, accent bar on every row", () => {
    const long = "x".repeat(200);
    const a = eventToAtom({ id: "u1", role: "user", text: long }, undefined, W);
    if (a.kind !== "frame") throw new Error("expected frame");
    expect(a.frame.rows.length).toBeGreaterThan(2);
    // Every row has a non-empty body
    for (const r of a.frame.rows) {
      let visible = 0;
      for (const c of r) if (!c.tail) visible += c.width;
      expect(visible).toBe(a.frame.width);
    }
  });
  it("includes turn separator when leadSeparator set", () => {
    const a = eventToAtom(
      { id: "u1", role: "user", text: "hi", leadSeparator: true } as DisplayEvent,
      undefined,
      W,
    );
    if (a.kind !== "frame") throw new Error("expected frame");
    // Should have AT LEAST 2 rows: separator + body
    expect(a.frame.rows.length).toBeGreaterThanOrEqual(2);
    // First row contains the brand mark
    expect(rowText(a.frame.rows[0]!)).toContain("◆");
  });
});

describe("eventToAtom — tool compact", () => {
  it("produces frame atom for non-error tool with cyan pill", () => {
    const a = eventToAtom(
      {
        id: "t1",
        role: "tool",
        text: "ok",
        toolName: "list_directory",
        durationMs: 50,
      } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    const row = rowText(a.frame.rows[0]!);
    expect(row).toContain("list_directory");
  });
  it("error tool gets red pill", () => {
    const a = eventToAtom(
      { id: "t2", role: "tool", text: "ERROR: nope", toolName: "x" } as DisplayEvent,
      undefined,
      W,
    );
    if (a.kind !== "frame") throw new Error("expected frame");
    // The pill cell should carry red foreground
    const firstCell = a.frame.rows[0]!.find((c) => !c.tail && c.char !== "│" && c.char !== " ");
    expect(firstCell?.fg).toBe("red");
  });
});

describe("eventToAtom — edit_file diff", () => {
  it("produces multi-row frame for edit_file tool", () => {
    const text =
      "edited foo.ts (10→12 chars)\n@@ -1,2 +1,2 @@\n  - oldline\n  + newline\n  context";
    const a = eventToAtom(
      { id: "ef1", role: "tool", text, toolName: "edit_file" } as DisplayEvent,
      undefined,
      W,
    );
    expect(a.kind).toBe("frame");
    if (a.kind !== "frame") return;
    expect(a.frame.rows.length).toBeGreaterThan(3);
    // The diff body lines should include - and + markers
    const allText = a.frame.rows.map(rowText).join("\n");
    expect(allText).toContain("−"); // removal glyph
    expect(allText).toContain("+");
  });
});

describe("viewportLog — basic slicing", () => {
  // Build 10 single-row info atoms = 10 cumulative rows total.
  const atoms = Array.from({ length: 10 }, (_, i) =>
    eventToAtom(infoEvent(`row${i}`, `i${i}`), undefined, W),
  );

  it("offset=0 returns the bottom of the stack", () => {
    const v = viewportLog(atoms, 0, 5);
    expect(v.atoms.length).toBe(5);
    // The last 5 atoms (index 5..9). Each is a 1-row frame.
    expect(v.totalRows).toBe(10);
    expect(v.maxScrollRows).toBe(5);
  });
  it("offset>0 reveals older rows", () => {
    const v = viewportLog(atoms, 3, 5);
    expect(v.atoms.length).toBe(5);
    // Should be atoms 2..6 (cumulative rows 2..7, viewport 2..7).
    if (v.atoms[0]!.kind !== "frame") throw new Error("expected frame");
    expect(rowText(v.atoms[0]!.frame.rows[0]!)).toContain("row2");
  });
  it("clamps offset past max", () => {
    const v = viewportLog(atoms, 999, 5);
    expect(v.atoms.length).toBe(5);
    if (v.atoms[0]!.kind !== "frame") throw new Error("expected frame");
    expect(rowText(v.atoms[0]!.frame.rows[0]!)).toContain("row0");
  });
  it("topSkip / bottomSkip = 0 when atoms align with viewport", () => {
    const v = viewportLog(atoms, 0, 5);
    expect(v.topSkip).toBe(0);
    expect(v.bottomSkip).toBe(0);
  });
});

describe("viewportLog — mixed frame + ink atoms", () => {
  it("snaps at ink atom boundaries (no row-precise topSkip)", () => {
    // 1-row info + ink-fallback (plan-replay, ~10 rows) + 1-row info
    const atoms = [
      eventToAtom(infoEvent("first", "i0"), undefined, W),
      eventToAtom({ id: "pr0", role: "plan-replay", text: "..." } as DisplayEvent, undefined, W),
      eventToAtom(infoEvent("last", "i1"), undefined, W),
    ];
    // Viewport = 4 rows, offset = 0 → last 4 rows: tail of ink + last info
    const v = viewportLog(atoms, 0, 4);
    // First atom in slice should be the ink one (since viewport starts
    // mid-ink) but topSkip stays 0 because ink atoms don't support
    // row-precise clip.
    expect(v.atoms[0]!.kind).toBe("ink");
    expect(v.topSkip).toBe(0); // ink atoms snap; no clip
  });
  it("frame atom at top supports row-precise topSkip", () => {
    // Single 10-row info (long text wrapped) → only 5 rows visible at offset=0
    const longInfo = eventToAtom(
      infoEvent(Array.from({ length: 10 }, () => "x".repeat(60)).join("\n")),
      undefined,
      W,
    );
    if (longInfo.kind !== "frame") throw new Error("expected frame");
    const total = longInfo.frame.rows.length;
    expect(total).toBeGreaterThan(5);
    const v = viewportLog([longInfo], 0, 5);
    expect(v.atoms.length).toBe(1);
    expect(v.topSkip).toBe(total - 5); // clip the top so bottom 5 rows show
    expect(v.bottomSkip).toBe(0);
  });
});

describe("viewportLog — clamping invariants", () => {
  it("non-empty atoms always produces at least one rendered atom", () => {
    const atoms = [eventToAtom(infoEvent("only"), undefined, W)];
    const v = viewportLog(atoms, 0, 5);
    expect(v.atoms.length).toBeGreaterThan(0);
  });
  it("totalRows == sum of atom heights", () => {
    const atoms = [
      eventToAtom(infoEvent("a"), undefined, W),
      eventToAtom(infoEvent("b"), undefined, W),
      eventToAtom(infoEvent("c"), undefined, W),
    ];
    const v = viewportLog(atoms, 0, 10);
    expect(v.totalRows).toBe(3);
  });
  it("maxScrollRows == max(0, totalRows - available)", () => {
    const atoms = Array.from({ length: 10 }, (_, i) =>
      eventToAtom(infoEvent(`r${i}`, `i${i}`), undefined, W),
    );
    expect(viewportLog(atoms, 0, 4).maxScrollRows).toBe(6);
    expect(viewportLog(atoms, 0, 100).maxScrollRows).toBe(0);
  });
});
