# Reasonix

[![npm version](https://img.shields.io/npm/v/reasonix.svg)](https://www.npmjs.com/package/reasonix)
[![CI](https://github.com/esengine/reasonix/actions/workflows/ci.yml/badge.svg)](https://github.com/esengine/reasonix/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/reasonix.svg)](./LICENSE)
[![downloads](https://img.shields.io/npm/dm/reasonix.svg)](https://www.npmjs.com/package/reasonix)
[![node](https://img.shields.io/node/v/reasonix.svg)](./package.json)

**A DeepSeek-native AI coding assistant in your terminal.** Ink TUI. MCP
first-class. No LangChain.

```bash
npx reasonix
```

One command. First run walks you through a 30-second wizard (API key →
preset → pick MCP servers from a checklist); every run after that drops
straight into chat with your tools wired up. Inside the chat, type `/help`.

Why bother with yet another agent framework? Because every abstraction
here earns its weight against a DeepSeek-specific property — dirt-cheap
tokens, R1 reasoning traces, automatic prefix caching, JSON mode.
Generic wrappers treat DeepSeek as "OpenAI with a different base URL"
and leave these advantages on the table. Reasonix leans into them:
on the same τ-bench-lite workload,
[**94.4% cache hit, ~40% cheaper tokens, 100% pass rate**](#validated-numbers)
vs. a cache-hostile baseline.

---

## What you get

| Feature | How it works | Opt in |
|---|---|---|
| **Setup wizard** | First run of `npx reasonix`: pick preset, multi-select MCP servers from a curated catalog, saved to config so the next run just launches chat | always on (first run) |
| **MCP (stdio + SSE)** | Multi-server bridge — every MCP tool inherits Cache-First + repair + context-safety automatically. `reasonix mcp list` shows the catalog | always on |
| **Cache-First Loop** | Immutable prefix + append-only log = prefix byte-stable across turns → DeepSeek's automatic prefix cache hits at 70–95% | always on |
| **Context safety net** | Tool results capped at 32k chars · oversized sessions auto-heal on load · `/compact` to shrink further · ctx gauge in the status bar · Esc to abort exploration and get a forced summary | always on |
| **R1 Thought Harvesting** | Parses `reasoning_content` into typed `{ subgoals, hypotheses, uncertainties, rejectedPaths }` via a cheap V3 call | `/preset smart` |
| **Self-Consistency Branching** | Runs N parallel samples at spread temperatures; picks the one with the fewest flagged uncertainties | `/preset max` / `/branch N` |
| **Tool-Call Repair** | Auto-flattens deep/wide schemas, scavenges tool calls leaked into `<think>`, repairs truncated JSON, breaks call-storms | always on |
| **Retry layer** | Exponential backoff + jitter on 408/429/500/502/503/504 and network errors. 4xx auth errors don't retry | always on |
| **Ink TUI** | Live cache-hit / cost / context panel. Streams R1 thinking to a compact preview. Renders Markdown (bold / lists / code / stripped LaTeX) | always on |

---

## Why not just use LangChain?

Even on the default `fast` preset (no harvest, no branching), Reasonix bakes
in five DeepSeek-specific defences that generic agent frameworks leave to you:

| | Reasonix default | generic frameworks |
|---|---|---|
| Prefix-stable loop (→ 85–95% cache hit) | ✅ | ❌ prompts rebuilt each turn |
| Auto-flatten deep tool schemas | ✅ | ❌ DeepSeek drops args |
| Retry with jittered backoff (429/503) | ✅ | ❌ custom callbacks |
| Scavenge tool calls leaked into `<think>` | ✅ | ❌ |
| Call-storm breaker on identical-arg repeats | ✅ | ❌ |
| Live cache-hit / cost / vs-Claude panel | ✅ | ❌ |
| First-run config prompt + Markdown TUI | ✅ | ❌ |

Harvest and self-consistency branching are bonuses on top. The everyday
win is that **a plain chat with Reasonix already pays for ~40% less tokens
than the same chat through a naive LangChain setup**, because the prefix
actually stays byte-stable.

## Validated numbers

**τ-bench-lite** — 8 multi-turn tool-use tasks × 3 repeats = 48 runs per
side. Same tools / same prompt / same client on both sides, sole variable
is prefix stability. Measured on live DeepSeek `deepseek-chat`:

| metric | baseline (cache-hostile) | Reasonix | delta |
|---|---:|---:|---:|
| runs | 24 | 24 | — |
| **cache hit** | 46.6% | **94.4%** | **+47.7pp** |
| cost / task | $0.002599 | $0.001579 | **−39% (×0.61)** |
| vs Claude Sonnet 4.6 (token-count estimate) | — | — | **~96% cheaper** |
| pass rate | 96% (23/24) | **100% (24/24)** | Reasonix held the guardrail on every run |

**Verify it yourself — no API key, zero cost:**

```bash
git clone https://github.com/esengine/reasonix.git && cd reasonix && npm install
npx reasonix replay benchmarks/tau-bench/transcripts/t01_address_happy.reasonix.r1.jsonl
npx reasonix diff \
  benchmarks/tau-bench/transcripts/t01_address_happy.baseline.r1.jsonl \
  benchmarks/tau-bench/transcripts/t01_address_happy.reasonix.r1.jsonl
```

The JSONL transcripts committed in `benchmarks/tau-bench/transcripts/`
carry per-turn `usage`, `cost`, and `prefixHash`. Reasonix's prefix hash
stays byte-stable across every model call; baseline's prefix churns on
every turn. The cache delta is *mechanically* attributable to log
stability, not to a different system prompt.

Full 48-run report: [`benchmarks/tau-bench/report.md`][r]. Reproduce
with your own API key: `npx tsx benchmarks/tau-bench/runner.ts --repeats 3`.

[r]: ./benchmarks/tau-bench/report.md

### MCP — works out of the box

Any [MCP](https://spec.modelcontextprotocol.io/) server's tools inherit
Cache-First + repair + context-safety automatically. The wizard (`npx
reasonix`) lets you multi-select from a curated catalog — no flags, no
JSON-by-hand. Three live reference runs:

| server | turns | tool calls | cache hit | cost | vs Claude |
|---|---:|---:|---:|---:|---:|
| bundled demo (`add` / `echo` / `get_time`) | 2 | 1 | **96.6%** (turn 2) | $0.000254 | −94.0% |
| official `@modelcontextprotocol/server-filesystem` | 5 | 4 | **96.7%** overall | $0.001235 | −97.0% |
| **both concurrently** (`demo_add` + `fs_write_file`) | 5 | 4 | **81.1%** | $0.001852 | −95.9% |

The third row is the ecosystem proof: two MCP servers running as
separate subprocesses, tools from both exercised in one conversation.
**One single prefix hash across all 5 turns** — byte-stability survives
concurrent MCP subprocesses.

Reproduce without an API key (replay the committed transcripts):

```bash
npx reasonix replay benchmarks/tau-bench/transcripts/mcp-demo.add.jsonl
npx reasonix replay benchmarks/tau-bench/transcripts/mcp-filesystem.jsonl
```

Supported transports: **stdio** (local `npx` or binary) and **HTTP+SSE**
(remote / hosted servers, MCP 2024-11-05 spec). Pass an `http(s)://`
URL to `--mcp` and Reasonix opens the SSE stream and POSTs JSON-RPC
to the endpoint the server advertises.

[mcp]: ./benchmarks/tau-bench/transcripts/mcp-demo.add.jsonl

---

## Usage

### One command

```bash
npx reasonix
```

First run: a wizard asks for your API key, lets you pick a preset
(fast / smart / max), then offers a multi-select checklist of MCP
servers — filesystem, memory, github, puppeteer, everything. Everything
is saved to `~/.reasonix/config.json`. Subsequent runs drop straight
into chat.

### Inside the chat

A status bar at the top shows cache hit %, cost, Claude-equivalent, and
the **context gauge** (`ctx 42k/131k (32%)` — yellow at 50%, red + a
`/compact` nudge at 80%). A command strip under the input lists the
slash commands:

```
/help                   full list + hints
/preset <fast|smart|max> one-tap bundles (model + harvest + branch)
/mcp                    list attached MCP servers and tools
/compact [cap]          shrink oversized tool results in history
/sessions · /forget     list / delete saved sessions
/setup                  reconfigure (exits and tells you to run `reasonix setup`)
/clear · /exit
```

**Esc while thinking** — abort the current exploration and force the
model to summarize what it already found. No more "model ran 24 tool
calls and gave up" — you get an answer every time.

Sessions live as JSONL under `~/.reasonix/sessions/<name>.jsonl` —
every message appended atomically, so killing the CLI never loses
context. Oversized tool results auto-heal on load, so poisoning a
session with one giant `read_file` doesn't brick your history.

### Advanced — CLI subcommands and flags

```bash
npx reasonix setup                       # reconfigure any time
npx reasonix chat --session work         # a different named session
npx reasonix chat --no-session           # ephemeral — nothing persisted
npx reasonix run "ask anything"          # one-shot, streams to stdout
npx reasonix stats session.jsonl         # summarize a transcript
npx reasonix replay chat.jsonl           # scrub a transcript + rebuild cost/cache
npx reasonix diff a.jsonl b.jsonl --md   # compare two transcripts
npx reasonix mcp list                    # curated MCP server catalog
```

Power users can still bypass config and drive Reasonix with flags:

```bash
npx reasonix chat \
  --preset max \
  --mcp "filesystem=npx -y @modelcontextprotocol/server-filesystem /tmp/safe" \
  --mcp "kb=https://mcp.example.com/sse" \
  --transcript session.jsonl \
  --no-config   # ignore ~/.reasonix/config.json (for CI / reproducing issues)
```

### Library

```ts
import {
  CacheFirstLoop,
  DeepSeekClient,
  ImmutablePrefix,
  ToolRegistry,
} from "reasonix";

const client = new DeepSeekClient(); // reads DEEPSEEK_API_KEY from env
const tools = new ToolRegistry();

tools.register({
  name: "add",
  description: "Add two integers",
  parameters: {
    type: "object",
    properties: { a: { type: "integer" }, b: { type: "integer" } },
    required: ["a", "b"],
  },
  fn: ({ a, b }: { a: number; b: number }) => a + b,
});

const loop = new CacheFirstLoop({
  client,
  tools,
  prefix: new ImmutablePrefix({
    system: "You are a math helper.",
    toolSpecs: tools.specs(),
  }),
  harvest: true,
  branch: 3, // self-consistency budget
});

for await (const ev of loop.step("What is 17 + 25?")) {
  if (ev.role === "assistant_final") console.log(ev.content);
}
console.log(loop.stats.summary());
```

### Configuration

The wizard handles everything on first run. If you'd rather use env vars
(CI, shared boxes, etc.):

```bash
export DEEPSEEK_API_KEY=sk-...        # wins over ~/.reasonix/config.json
export DEEPSEEK_BASE_URL=https://...  # optional alternate endpoint
```

Get a key (free credit on signup): <https://platform.deepseek.com/api_keys>

Re-run `npx reasonix setup` any time to add/remove MCP servers or switch
preset — your existing selections are pre-checked.

---

## Non-goals

- Multi-agent orchestration (use LangGraph).
- RAG / vector stores (use LlamaIndex or do it yourself).
- Multi-provider abstraction (use LiteLLM).
- Web UI / SaaS.

Reasonix does DeepSeek, deeply.

---

## Development

```bash
git clone https://github.com/esengine/reasonix.git
cd reasonix
npm install
npm run dev chat        # run CLI from source via tsx
npm run build           # tsup to dist/
npm test                # vitest (279 tests)
npm run lint            # biome
npm run typecheck       # tsc --noEmit
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for internals.

---

## License

MIT
