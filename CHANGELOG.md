# Changelog

All notable changes to Reasonix. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0-alpha.5] — 2026-04-21

**Headline:** `reasonix setup` replaces the CLI-flag maze. New users run
one command, pick from an arrow-key checklist, and every later launch
remembers what they chose. The `--mcp "name=npx -y @scope/pkg /path"`
syntax still works for scripts and power users — it's just no longer
the *only* way to turn MCP on.

### Added

- **`reasonix setup`** — interactive Ink wizard:
  1. Paste API key (skipped if already set via env or previous run)
  2. Pick a preset: `fast` / `smart` / `max` (bundles of model +
     harvest + branch budget — no more "what's the right model id?")
  3. Multi-select MCP servers from the curated catalog (space to
     toggle, enter to confirm). Per-server parameters (filesystem
     directory, sqlite path) are prompted inline.
  4. Review + save to `~/.reasonix/config.json`.
  Re-run any time to reconfigure — existing selections are pre-checked.
- **`reasonix` with no subcommand** — launches the wizard on first run,
  drops straight into chat afterwards using saved defaults. Designed
  so a brand-new user can `npx reasonix` and be chatting in 30s
  without reading `--help`.
- **`--preset <fast|smart|max>`** on both `chat` and `run`. Picks the
  same bundles the wizard offers. Individual flags (`--model`,
  `--harvest`, `--branch`) still override when you want to be specific.
- **`--no-config`** escape hatch on `chat` and `run` — ignore
  `~/.reasonix/config.json` entirely (useful for CI, reproducing
  a bug report against default settings, or isolating shared boxes).
- **`/mcp` slash command** — shows the spec strings attached to the
  current session and the tool registry (handy mid-chat when you want
  to remember what a tool is called).
- **`/setup` slash command** — prints instructions to exit and re-run
  `reasonix setup`. Live reconfiguration mid-session is out of scope:
  changing the tool set would reset the byte-stable prefix and
  invalidate the cache-first guarantees that define Reasonix.

### Changed

- **`ReasonixConfig` schema** grows: `preset`, `mcp` (spec strings),
  `session`, `setupCompleted`. Previous configs (apiKey-only) still
  load; missing fields fall through to hardcoded defaults.
- `reasonix chat` / `reasonix run`: when a flag is not passed, the
  value comes from `~/.reasonix/config.json`. Explicit flags still
  win. `--no-config` short-circuits this.
- Slash handler signature: `handleSlash(cmd, args, loop, ctx?)` — the
  new `ctx` carries per-session state like `mcpSpecs`. Old callers
  that passed three args continue to compile.

### Tests (+21)

- `tests/resolve.test.ts` (+11) — precedence order: flag → --preset
  → config.preset → fast defaults; `--no-config`, `--no-session`,
  `--branch` cap and off cases.
- `tests/config.test.ts` (+2) — full `ReasonixConfig` round-trip,
  `session: null` interpreted as ephemeral.
- `tests/slash.test.ts` (+4) — `/mcp` empty + populated, `/setup`
  prints the reconfigure hint, help lists both.
- `tests/wizard.test.ts` (+4) — `buildSpec` → `parseMcpSpec`
  round-trip on filesystem / memory / spaces-in-path / unknown-entry
  degrade-gracefully.
- Suite: **262 passing** (was 241).

### Fixed

- **Catalog no longer lists Python-only servers.** `fetch` and `sqlite`
  reference MCP servers are distributed as `pip install
  mcp-server-fetch` / `mcp-server-sqlite`, not npm packages. They
  were in the catalog by mistake, which meant picking them in the
  wizard produced a spec that always 404'd on `npm install` when the
  child was spawned. Removed. The remaining five entries
  (`filesystem`, `memory`, `github`, `puppeteer`, `everything`) are
  verified-on-npm as of this release.
- **One broken MCP server no longer kills the whole chat/run.** Before:
  any spawn or initialize failure on any server called
  `process.exit(1)`, losing the session and the other working servers.
  Now: each failure prints a `▸ MCP setup SKIPPED` line pointing at
  `reasonix setup` and the session continues with whatever succeeded.

### Notes

- The wizard's Ink rendering is verified manually — unit-testing
  arrow-key handling would mean pulling in `ink-testing-library`
  (another dev dep) to exercise mechanically obvious `setState`
  calls. The pure data layer (what gets written to config.json) is
  tested end-to-end via `buildSpec → parseMcpSpec`.
- Existing `npm publish --tag alpha` users: if you published
  alpha.4 already, alpha.5 is a *pure additive* upgrade — config
  files written by alpha.4 continue to work; `setupCompleted: false`
  is assumed on migration so the wizard offers itself on first launch.

---

## [0.3.0-alpha.4] — 2026-04-21

**Headline:** MCP over HTTP+SSE. Bridge *remote* / hosted MCP servers,
not just local subprocesses. Pass a URL to `--mcp` and Reasonix opens
an SSE stream and POSTs JSON-RPC to the endpoint the server advertises.

### Added

- **`SseTransport`** (`src/mcp/sse.ts`) — 2024-11-05 HTTP+SSE wire:
  GET the SSE URL, wait for `event: endpoint`, POST every outgoing
  JSON-RPC frame to that URL, read responses off the SSE channel.
  Headers are passthrough, so `Authorization: Bearer ...` works for
  hosted servers behind auth.
- **`--mcp` now accepts URLs.** The parser routes anything starting
  with `http://` or `https://` to `SseTransport`; everything else is
  stdio as before. Both namespaced and anonymous forms work:
    ```
    reasonix chat --mcp "kb=https://mcp.example.com/sse"
    reasonix run  --mcp "http://127.0.0.1:9000/sse" --task "..."
    ```
- `McpSpec` is now a discriminated union:
  `{ transport: "stdio", command, args } | { transport: "sse", url }`.
  Callers who inspected `spec.command` / `spec.args` need to branch on
  `spec.transport` first — not a concern for `--mcp` CLI users.
- `src/index.ts` exports `SseTransport`, `SseTransportOptions`,
  `parseMcpSpec`, and the `McpSpec` union types.

### Tests

- `tests/mcp-sse.test.ts` (+4) — in-process `http.Server` fake that
  implements the SSE wire. Covers: relative-path endpoint resolution,
  absolute endpoint URLs, a full `McpClient.initialize` →
  `listTools` round-trip over SSE, and handshake-failure propagation.
- `parseMcpSpec` SSE cases (+4) — anonymous URL, namespaced URL,
  case-insensitive scheme, and `ws://` staying routed to stdio (no
  surprise detection beyond the two supported schemes).
- Suite: **241 passing** (was 233).

### Notes

- Still targeting MCP protocol `2024-11-05`. The 2025-03-26 spec's
  "Streamable HTTP" transport (single endpoint, no separate SSE GET)
  is a separate body of work — deferred until there's a server in
  the wild worth testing against.

---

## [0.3.0-alpha.3] — 2026-04-22

**Headline:** multi-server MCP + discovery command. Bridge two or more
MCP servers into one chat session, and stop guessing what servers exist
— `reasonix mcp list` prints a curated catalog with copy-paste commands.

### Added

- **Repeatable `--mcp`** — pass the flag multiple times to bridge
  multiple MCP servers into the same `ToolRegistry`. New spec syntax:
    `"name=cmd args..."`   → tools land namespaced as `name_toolname`
    `"cmd args..."`        → anonymous (tools keep native names)
  Example:
    ```
    reasonix chat \
      --mcp "fs=npx -y @modelcontextprotocol/server-filesystem /tmp/safe" \
      --mcp "mem=npx -y @modelcontextprotocol/server-memory"
    ```
  Tools show up as `fs_read_file`, `mem_set`, etc.
- **`reasonix mcp list`** — curated catalog of popular official MCP
  servers (filesystem / fetch / github / memory / sqlite / puppeteer /
  everything) with ready-to-paste `--mcp` commands. Hardcoded because
  the list changes slowly; fetching over the network would make it
  flaky offline. `--json` prints the machine-readable form.
- `src/mcp/spec.ts::parseMcpSpec` — small helper exposed if library
  callers want the same `name=cmd` parsing. Not exported from the
  barrel yet; can be promoted when there's demand.
- `src/mcp/catalog.ts::MCP_CATALOG` — the curated list.

### Fixed

- **`shellSplit` mangled Windows paths outside quotes.** Backslashes
  were being treated as POSIX escape chars, so `C:\path\to\dir` turned
  into `C:pathtodir`. Now backslashes only escape inside double
  quotes; outside, they pass through literally. Matches user
  expectation on Windows; POSIX users who want escape-a-space should
  quote the arg instead.

### Tests

- `parseMcpSpec` (+8) — name=cmd form, anonymous form, Windows drive
  letters (must not look like namespace), identifier edge cases,
  empty / malformed input.
- Multi-server integration test (+1) — spawn two demo subprocesses
  concurrently with different prefixes, dispatch to each, verify no
  cross-talk.
- `shellSplit` Windows-path behavior (+1).
- Suite: **233 passing** (was 224).

---

## [0.3.0-alpha.2] — 2026-04-22

**Headline:** Windows `--mcp` actually works now, plus a second live
data point through the *official* `@modelcontextprotocol/server-filesystem`.

### Fixed

- **Windows `npx`/`pnpm` MCP launch**. `StdioTransport` now defaults to
  `shell: true` on win32 so `.cmd` shims (npx.cmd, pnpm.cmd) resolve.
  Previously `--mcp "npx -y ..."` failed with EPIPE on Windows because
  `spawn("npx")` couldn't find `npx.cmd` without a shell. POSIX behavior
  unchanged.
- **Silenced Node's `DEP0190` deprecation warning.** Under `shell: true`
  with an args array, Node concatenates args without quoting — unsafe
  if any arg contains shell metacharacters. We now build a quoted
  command line ourselves (command bare so PATH lookup works, args
  platform-quoted) and pass it as a single string. No more warning on
  `--mcp` runs.

### Added

- **`StdioTransportOptions.shell?: boolean`** — explicit opt-in/out of
  shell-mode spawning. Platform default still wins when omitted.
- **Second reference transcript** —
  `benchmarks/tau-bench/transcripts/mcp-filesystem.jsonl`. Live run
  through `@modelcontextprotocol/server-filesystem` (14 external tools,
  code we don't control): **5 turns, 4 tool calls, cache 96.7%,
  cost $0.00124, 97% cheaper than Claude** at equivalent tokens. The
  run includes a deliberate permission-denied recovery to show
  cache-first holds under realistic agent messiness.
- README table now shows both MCP data points side-by-side (bundled
  demo vs official external server).

### Tests

- Integration tests explicitly set `shell: false` (they spawn `node.exe`
  by absolute path — no shim needed). Suite still 224/224.

---

## [0.3.0-alpha.1] — 2026-04-22

**Headline:** MCP client lands. Any
[Model Context Protocol](https://spec.modelcontextprotocol.io/) server's
tools now flow through the Cache-First Loop automatically — cache-hit and
repair benefits extend to the entire MCP ecosystem.

Verified end-to-end on live DeepSeek: `reasonix run --mcp "..."` spawns an
MCP server, bridges its tools, calls them from the model. The follow-up
turn after the tool call hit **96.6% cache**, 94% cheaper than Claude at
same token counts. Reference transcript committed at
`benchmarks/tau-bench/transcripts/mcp-demo.add.jsonl`.

### Added

- **`reasonix chat --mcp "<cmd>"`** and **`reasonix run --mcp "<cmd>"`** —
  spawn an MCP server and bridge its tools into the Cache-First Loop.
  Shell-quoted command; use `--mcp-prefix` to namespace tool names when
  mixing servers.
- **Hand-rolled MCP client** (`src/mcp/`) — zero runtime deps. JSON-RPC
  2.0 + MCP initialize / tools/list / tools/call over stdio NDJSON.
  Official `@modelcontextprotocol/sdk` deliberately not used; see
  `src/mcp/README.md` for the reasoning.
- **`bridgeMcpTools(client)`** — walk an MCP server's tools/list result
  and register each into a Reasonix `ToolRegistry`. MCP tools become
  indistinguishable from native tools to the loop, inheriting
  Cache-First + repair (scavenge / flatten / storm) automatically.
- **Bundled demo MCP server** — `examples/mcp-server-demo.ts`, ~160
  lines, zero deps. Exposes `echo` / `add` / `get_time`. Lets any user
  try the whole integration locally with no external install.
- **`shellSplit()`** — small shell-style command parser used by the
  `--mcp` flag. Respects single/double quotes, backslash escapes,
  tab-space runs. Throws on unterminated quotes.
- Library exports: `McpClient`, `StdioTransport`, `bridgeMcpTools`,
  `flattenMcpResult`, `MCP_PROTOCOL_VERSION`, and related types.

### Tests

- **+21 tests**:
  - `tests/mcp.test.ts` (10) — in-process fake transport covering
    handshake, list, call, errors, bridge, name prefixing, result
    flattening.
  - `tests/mcp-shell-split.test.ts` (9) — quote handling, escapes,
    unterminated-quote error, whitespace-only input.
  - `tests/mcp-integration.test.ts` (2) — real subprocess against
    the bundled demo server via `node --import tsx …` (cross-platform,
    avoids Windows `.cmd` resolution).
- Suite: **224 passing** (was 203 at v0.2.2).

### Known limits (next alpha)

- No SSE transport — stdio only.
- No resources / prompts methods — tool-use only.
- No progress notifications — tool calls are assumed complete on first
  response.
- No streaming tool results.

### Also in this release

- **harvest-bench 18-run data + findings** (no release on its own —
  data was illuminating, conclusion was "V3 is strong enough that
  harvest doesn't differentiate on common math", see
  `benchmarks/harvest/report.md`). Informed the decision to ship MCP as
  the v0.3 headline rather than a harvest-accuracy claim.
- **`--timeout` flag** on harvest-bench runner, default 300s. Fixes
  120s-default client timeout on long R1 + harvest runs.

---

## [0.2.2] — 2026-04-21

**Headline:** 48-run bench data (3 repeats × 8 tasks × 2 modes). Reasonix
now scores **100% pass rate (24/24)** against 96% baseline; cache-hit
delta holds at **+47.7pp** with variance well under the last single-run
numbers.

### Fixed

- **t05 predicate relaxed** (`benchmarks/tau-bench/tasks.ts`). The task
  required "no refund on a processing order" and formerly also required
  status to stay `processing`, penalizing an agent who offered
  cancellation as a helpful alternative. The new predicate passes iff
  no refund row is written AND the order ends in `{processing, cancelled}`
  — either refusal or helpful substitution counts. Cancellation was
  marking reasonix as fail on its single run in v0.1; with this fix
  reasonix now passes every refusal task in every repeat.

### Changed

- **README headline numbers updated** to the 48-run set. Baseline shows
  one failure out of 24 (a `t07_wrong_identity` run where baseline
  skipped identity verification); Reasonix held the guardrail on every
  run.
- **`benchmarks/tau-bench/report.md`** regenerated from the 48-run
  results. Cost estimate vs Claude Sonnet 4.6 stays at ~96% cheaper
  per task.
- **`benchmarks/tau-bench/results.json`** replaced with the 48-run data.

### Tests

- +3 tests pinning the three t05 outcomes (refuse / cancel / illegally
  refund). Suite: **172 passing** (was 169).

---

## [0.2.1] — 2026-04-21

**Headline:** v0.2 grows eyes. `reasonix replay` and `reasonix diff` now
open interactive Ink TUIs by default. The stdout paths still work when
piped, so CI / `less` / markdown-export workflows aren't disturbed.

### Added

- **Interactive `reasonix replay <transcript>`** — Ink TUI with
  per-turn navigation (`j`/`k`/space/arrows, `g`/`G` for jump-to-edge,
  `q` to quit). Sidebar re-renders cumulative cost / cache / prefix
  stability as the cursor moves, so "how did the cache hit rate climb
  over the conversation?" is answered visually instead of in
  aggregate.
- **Interactive `reasonix diff <a> <b>`** — split-pane Ink TUI. Both
  sides scroll together; `n` / `N` jump the cursor to the next / prev
  divergent turn (the whole point of a diff tool). Cursor defaults to
  the first divergence so you skip the "identical setup turns".
- **Shared `RecordView` component** (`src/cli/ui/RecordView.tsx`)
  used by both TUIs — consistent visual grammar (user cyan, assistant
  green with cache badge, tool yellow, error red). Replaces the
  inline renderer in `ReplayApp`.
- **Pure navigation helpers** in `src/diff.ts`:
  `findNextDivergence(pairs, fromIdx)` and
  `findPrevDivergence(pairs, fromIdx)`. Unit-testable without Ink.
  Both guard against out-of-bounds `fromIdx`.
- **Pure replay nav helpers** in `src/replay.ts`:
  `groupRecordsByTurn(records)` and `computeCumulativeStats(pages, upToIdx)`.
  Used by the TUI sidebar; also individually testable.
- **New CLI flags** on both commands:
  - `reasonix replay --print` — force stdout pretty-print (auto when
    stdout isn't a TTY, or when `--head` / `--tail` is passed).
  - `reasonix diff --print` — force stdout table.
  - `reasonix diff --tui` — force Ink TUI even when piped (rare
    escape hatch).

### Changed

- **`reasonix replay` default** is now the TUI. Old stdout behavior
  reachable via `--print` or by piping. Non-TTY detection
  automatically flips to stdout mode, so shell pipelines behave as
  they did in 0.2.0.
- **`reasonix diff` default** picks itself from context:
  - `--md <path>` → write markdown + print summary (unchanged).
  - `--print` or piped stdout → stdout summary table.
  - TTY, no `--md`, no `--print` → TUI.

### Tests

- +10 new tests (`replay.test.ts` +6: `groupRecordsByTurn` +
  `computeCumulativeStats`; `diff.test.ts` +4: divergence navigation).
  Suite: **169 passing** (was 159).

---

## [0.2.0] — 2026-04-21

**Headline:** v0.2 makes the v0.1 cache-hit claim *auditable*. Any reader
can now verify the 94.3% / −42% numbers from committed JSONL transcripts
— no API key required.

### Added

- **`reasonix replay <transcript>`** — pretty-print a past transcript and
  rebuild its full session summary (turns, tool calls, cache hit, cost,
  prefix stability) offline. No API calls.
- **`reasonix diff <a> <b>`** — compare two transcripts: aggregate deltas,
  first divergence (with Levenshtein similarity for text + exact match
  for tool-name / args), prefix-stability story. Optional `--md <path>`
  writes a blog-ready markdown report.
- **`benchmarks/tau-bench/transcripts/`** — committed reference transcripts
  (baseline + reasonix on `t01_address_happy`) so anyone can clone the
  repo and run `reasonix replay` / `diff` immediately, without running
  the bench.
- **Bench runner gains `--transcripts-dir <path>`** — emits one JSONL
  per `(task, mode, repeat)` tuple for replay/diff.
- New library exports: `computeReplayStats`, `replayFromFile`,
  `diffTranscripts`, `renderDiffSummary`, `renderDiffMarkdown`,
  `parseTranscript`, `recordFromLoopEvent`, `writeRecord`.

### Changed

- **Transcript format bumped (backward-compatible)**. Records now carry
  `usage`, `cost`, `model`, `prefixHash` (reasonix only), and `toolArgs`.
  All fields optional on read — v0.1 transcripts still parse (cost/cache
  shown as n/a). A `_meta` line at the top records source/model/task
  metadata.
- **Baseline bench runner now emits per-sub-call transcripts**. Previously
  wrote one aggregated record per user turn, which made diff's
  apples-to-apples "model calls" count off. Now both modes emit at the
  same granularity.
- **Diff rendering label change**: "turns (assistant)" → "model calls",
  with "user turns" as a separate row in the summary table. Removes the
  ambiguity that hit when comparing baseline vs reasonix.
- **Top-level README**: `validated numbers` table now shows the 16-run
  τ-bench-lite results (94.3% cache, −42% cost) and links to the
  committed reference transcripts.
- **Exposed `LoopEvent.toolArgs`** so transcript writers can persist
  *what* the model sent to each tool, not just the result.

### Fixed

- Windows-only entrypoint bug in the bench runner
  (`import.meta.url === file://${argv[1]}`) — replaced with
  `pathToFileURL(argv[1]).href` so `main()` actually runs on Windows.

### Tests

- 17 new tests across `transcript.test.ts` (3), `replay.test.ts` (3),
  and `diff.test.ts` (11). Total suite: 159 passing.

---

## [0.1.0] — 2026-04-21

**Headline:** first reproducible evidence for Pillar 1 (Cache-First Loop).

### Added

- **`benchmarks/tau-bench/`** — τ-bench-lite harness. 8 retail-flavored
  multi-turn tool-use tasks with a DeepSeek V3 user simulator,
  deterministic DB-end-state success predicates (no LLM judge), and a
  cache-hostile naive baseline runner. Schema mirrors Sierra's τ-bench
  so upstream tasks can drop in.
- **`benchmarks/tau-bench/runner.ts`** — orchestrator with
  `--task` / `--mode` / `--repeats` / `--dry` / `--verbose` flags.
- **`benchmarks/tau-bench/report.ts`** — renders results JSON into a
  blog-ready markdown summary with explicit scope caveats.
- **Live bench numbers** published in `benchmarks/tau-bench/report.md`:
  - cache hit: baseline 43.9% → reasonix **94.3%** (+50.3pp)
  - cost/task: baseline $0.00278 → reasonix **$0.00162** (−42%)
  - vs Claude Sonnet 4.6 (token-count estimate): **~96% cheaper**
  - pass rate: 100% (baseline) vs 88% (reasonix; 1 predicate too strict,
    documented)

### Tests

- 8 new tests in `tests/benchmarks.test.ts` covering DB isolation,
  check-predicate satisfiability, and tool guards — all runnable without
  an API key. Total suite at this release: 143 passing.

---

Earlier `0.0.x` versions covered Pillar 1 + Pillar 3 internals, retry
layer, first-run API key prompt, harvest MVP, self-consistency
branching, and session persistence. They're not reflected as individual
entries above because the `0.1.0` bench harness is what first produced
*externally verifiable* evidence for their value.

[0.3.0-alpha.3]: https://github.com/esengine/reasonix/releases/tag/v0.3.0-alpha.3
[0.3.0-alpha.2]: https://github.com/esengine/reasonix/releases/tag/v0.3.0-alpha.2
[0.3.0-alpha.1]: https://github.com/esengine/reasonix/releases/tag/v0.3.0-alpha.1
[0.2.2]: https://github.com/esengine/reasonix/releases/tag/v0.2.2
[0.2.1]: https://github.com/esengine/reasonix/releases/tag/v0.2.1
[0.2.0]: https://github.com/esengine/reasonix/releases/tag/v0.2.0
[0.1.0]: https://github.com/esengine/reasonix/releases/tag/v0.1.0
