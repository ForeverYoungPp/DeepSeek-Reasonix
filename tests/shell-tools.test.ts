import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools.js";
import {
  NeedsConfirmationError,
  formatCommandResult,
  isAllowed,
  registerShellTools,
  runCommand,
  tokenizeCommand,
} from "../src/tools/shell.js";

describe("tokenizeCommand", () => {
  it("splits on whitespace", () => {
    expect(tokenizeCommand("git status -s")).toEqual(["git", "status", "-s"]);
  });

  it("keeps double-quoted spans as single tokens", () => {
    expect(tokenizeCommand('grep "hello world" src')).toEqual(["grep", "hello world", "src"]);
  });

  it("keeps single-quoted spans as single tokens (literal, no backslash escapes)", () => {
    expect(tokenizeCommand("echo 'a \\\\ b'")).toEqual(["echo", "a \\\\ b"]);
  });

  it("supports \\ escapes inside double quotes", () => {
    expect(tokenizeCommand('echo "a \\"b\\" c"')).toEqual(["echo", 'a "b" c']);
  });

  it("rejects unclosed quotes", () => {
    expect(() => tokenizeCommand('grep "unclosed')).toThrow(/unclosed/);
    expect(() => tokenizeCommand("grep 'unclosed")).toThrow(/unclosed/);
  });

  it("collapses runs of whitespace", () => {
    expect(tokenizeCommand("   git   status   ")).toEqual(["git", "status"]);
  });

  it("returns an empty array for an empty command", () => {
    expect(tokenizeCommand("")).toEqual([]);
    expect(tokenizeCommand("   ")).toEqual([]);
  });
});

describe("isAllowed", () => {
  it("matches exact prefix and prefix+args", () => {
    expect(isAllowed("git status")).toBe(true);
    expect(isAllowed("git status -s")).toBe(true);
    expect(isAllowed("git statuses")).toBe(false); // no trailing space → not a prefix match
  });

  it("normalizes internal whitespace", () => {
    expect(isAllowed("git   status   -s")).toBe(true);
  });

  it("rejects mutating operations not on the list", () => {
    expect(isAllowed("git commit -m hi")).toBe(false);
    expect(isAllowed("npm install lodash")).toBe(false);
    expect(isAllowed("rm -rf dist")).toBe(false);
    expect(isAllowed("curl http://example.com")).toBe(false);
  });

  it("accepts test-runner commands", () => {
    expect(isAllowed("pytest tests/")).toBe(true);
    expect(isAllowed("cargo test --release")).toBe(true);
    expect(isAllowed("npm test")).toBe(true);
  });

  it("respects extra allowed prefixes", () => {
    expect(isAllowed("my-lint src/")).toBe(false);
    expect(isAllowed("my-lint src/", ["my-lint"])).toBe(true);
  });
});

describe("runCommand", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "reasonix-shell-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("captures stdout and reports exit 0 on success", async () => {
    // `node -e '...'` is cross-platform; avoids cmd/bash differences.
    const r = await runCommand("node -e \"process.stdout.write('hello')\"", { cwd: tmp });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("hello");
    expect(r.timedOut).toBe(false);
  });

  it("captures stderr and reports non-zero exit on failure", async () => {
    const r = await runCommand("node -e \"process.stderr.write('oops'); process.exit(2)\"", {
      cwd: tmp,
    });
    expect(r.exitCode).toBe(2);
    expect(r.output).toContain("oops");
  });

  it("runs inside the given cwd, not the test's cwd", async () => {
    writeFileSync(join(tmp, "marker.txt"), "present");
    const r = await runCommand(
      "node -e \"const fs=require('fs');process.stdout.write(fs.readFileSync('marker.txt','utf8'))\"",
      { cwd: tmp },
    );
    expect(r.output).toContain("present");
  });

  it("kills a command that exceeds the timeout", async () => {
    // Sleep longer than timeout; 500ms sleep, 100ms timeout.
    const r = await runCommand('node -e "setTimeout(()=>{},5000)"', {
      cwd: tmp,
      timeoutSec: 0.1 as unknown as number, // cast: the function accepts seconds; 0.1s = 100ms
    });
    expect(r.timedOut).toBe(true);
  });

  it("truncates long output with a marker", async () => {
    const r = await runCommand("node -e \"process.stdout.write('x'.repeat(50000))\"", {
      cwd: tmp,
      maxOutputChars: 1000,
    });
    expect(r.output).toMatch(/\[… truncated \d+ chars …\]$/);
  });

  it("rejects empty commands", async () => {
    await expect(runCommand("", { cwd: tmp })).rejects.toThrow(/empty command/);
  });

  it("rejects commands with unclosed quotes", async () => {
    await expect(runCommand('echo "unclosed', { cwd: tmp })).rejects.toThrow(/unclosed/);
  });
});

describe("registerShellTools — dispatch integration", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "reasonix-shell-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("registers run_command", () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp });
    expect(registry.size).toBe(1);
  });

  it("auto-runs allowlisted commands and returns formatted output", async () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp, extraAllowed: ["node"] });
    const out = await registry.dispatch(
      "run_command",
      JSON.stringify({ command: "node --version" }),
    );
    expect(out).toMatch(/\$ node --version/);
    expect(out).toMatch(/\[exit 0\]/);
  });

  it("refuses non-allowlisted commands with NeedsConfirmationError", async () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp });
    const out = await registry.dispatch(
      "run_command",
      JSON.stringify({ command: "rm -rf node_modules" }),
    );
    expect(out).toMatch(/NeedsConfirmationError/);
    expect(out).toMatch(/rm -rf node_modules/);
  });

  it("allowAll:true bypasses the allowlist entirely", async () => {
    const registry = new ToolRegistry();
    registerShellTools(registry, { rootDir: tmp, allowAll: true, extraAllowed: [] });
    const out = await registry.dispatch(
      "run_command",
      JSON.stringify({ command: "node -e \"process.stdout.write('ok')\"" }),
    );
    expect(out).toMatch(/\[exit 0\]/);
    expect(out).toContain("ok");
  });
});

describe("formatCommandResult", () => {
  it("marks the exit code on success", () => {
    expect(formatCommandResult("ls", { exitCode: 0, output: "a\nb", timedOut: false })).toBe(
      "$ ls\n[exit 0]\na\nb",
    );
  });

  it("marks a killed-on-timeout run", () => {
    expect(formatCommandResult("sleep 10", { exitCode: null, output: "", timedOut: true })).toBe(
      "$ sleep 10\n[killed after timeout]",
    );
  });

  it("elides the body when output is empty", () => {
    expect(formatCommandResult("true", { exitCode: 0, output: "", timedOut: false })).toBe(
      "$ true\n[exit 0]",
    );
  });
});

describe("NeedsConfirmationError", () => {
  it("carries the rejected command on the instance", () => {
    const e = new NeedsConfirmationError("rm -rf /");
    expect(e.command).toBe("rm -rf /");
    expect(e.name).toBe("NeedsConfirmationError");
    expect(e.message).toMatch(/rm -rf \//);
  });

  it("tells the model to stop and wait, not to retry", () => {
    const e = new NeedsConfirmationError("npm install");
    expect(e.message).toMatch(/STOP calling tools/i);
    expect(e.message).toMatch(/y.*run.*n.*deny/i);
    expect(e.message).not.toMatch(/apply-shell/);
  });
});
