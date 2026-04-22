import { describe, expect, it } from "vitest";
import { parseMcpSpec } from "../src/mcp/spec.js";

describe("parseMcpSpec", () => {
  it("parses a namespaced spec", () => {
    const spec = parseMcpSpec("fs=npx -y @scope/fs /tmp/dir");
    expect(spec.name).toBe("fs");
    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual(["-y", "@scope/fs", "/tmp/dir"]);
  });

  it("parses an anonymous spec (no name=)", () => {
    const spec = parseMcpSpec("npx -y @scope/fs /tmp/dir");
    expect(spec.name).toBeNull();
    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual(["-y", "@scope/fs", "/tmp/dir"]);
  });

  it("does NOT treat Windows drive letters as a namespace", () => {
    // `C:\...` matches the colon but NOT the identifier regex [a-zA-Z_]\w* =
    // So it stays anonymous with the whole path as command.
    const spec = parseMcpSpec("C:\\path\\to\\server.exe arg1");
    expect(spec.name).toBeNull();
    expect(spec.command).toBe("C:\\path\\to\\server.exe");
    expect(spec.args).toEqual(["arg1"]);
  });

  it("handles quoted args in the body", () => {
    const spec = parseMcpSpec('myserver=cmd "path with spaces" --flag');
    expect(spec.name).toBe("myserver");
    expect(spec.command).toBe("cmd");
    expect(spec.args).toEqual(["path with spaces", "--flag"]);
  });

  it("trims leading/trailing whitespace", () => {
    const spec = parseMcpSpec("  fs=npx pkg  ");
    expect(spec.name).toBe("fs");
    expect(spec.command).toBe("npx");
    expect(spec.args).toEqual(["pkg"]);
  });

  it("throws on empty input", () => {
    expect(() => parseMcpSpec("")).toThrow(/empty MCP spec/);
    expect(() => parseMcpSpec("   ")).toThrow(/empty MCP spec/);
  });

  it("throws when name is given but no command follows", () => {
    expect(() => parseMcpSpec("fs=")).toThrow(/has name but no command/);
    expect(() => parseMcpSpec("fs=   ")).toThrow(/has name but no command/);
  });

  it("allows underscores and digits in the name (but not leading digit)", () => {
    expect(parseMcpSpec("my_fs2=cmd").name).toBe("my_fs2");
    // Leading digit → not a valid identifier → whole thing is command
    // (since `2fs` doesn't match identifier regex).
    const s = parseMcpSpec("2fs=cmd");
    expect(s.name).toBeNull();
    expect(s.command).toBe("2fs=cmd");
  });
});
