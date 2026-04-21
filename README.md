# Reasonix

[![npm version](https://img.shields.io/npm/v/reasonix.svg)](https://www.npmjs.com/package/reasonix)
[![CI](https://github.com/esengine/reasonix/actions/workflows/ci.yml/badge.svg)](https://github.com/esengine/reasonix/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/reasonix.svg)](./LICENSE)
[![downloads](https://img.shields.io/npm/dm/reasonix.svg)](https://www.npmjs.com/package/reasonix)
[![node](https://img.shields.io/node/v/reasonix.svg)](./package.json)

**The DeepSeek-native agent framework.** TypeScript. Ink TUI. No LangChain.

Reasonix is not another generic agent wrapper. Every abstraction is justified
by a DeepSeek-specific property — dirt-cheap tokens, R1 reasoning traces,
automatic prefix caching, JSON mode. Generic frameworks treat DeepSeek as
"OpenAI with a different base URL" and leave these advantages on the table.
Reasonix leans into them.

```bash
npx reasonix chat          # first run prompts for your DeepSeek key
                           # inside the TUI, type /help for everything else
```

No flag soup. All feature toggles live behind slash commands in the TUI.

---

## What you get

| Feature | How it works | Opt in |
|---|---|---|
| **Cache-First Loop** | Immutable prefix + append-only log = prefix byte-stable across turns → DeepSeek's automatic prefix cache hits at 70–95% | always on |
| **R1 Thought Harvesting** | Parses `reasoning_content` into typed `{ subgoals, hypotheses, uncertainties, rejectedPaths }` via a cheap V3 call | `--harvest` |
| **Self-Consistency Branching** | Runs N parallel samples at spread temperatures; picks the one with the fewest flagged uncertainties | `--branch <N>` |
| **Tool-Call Repair** | Auto-flattens deep/wide schemas, scavenges tool calls leaked into `<think>`, repairs truncated JSON, breaks call-storms | always on |
| **Retry layer** | Exponential backoff + jitter on 408/429/500/502/503/504 and network errors. 4xx auth errors don't retry | always on |
| **Ink TUI** | Live cache-hit / cost panel. Streams R1 thinking to a compact preview. Renders Markdown (bold / lists / code / stripped LaTeX) | always on |

---

## Validated numbers

Measured on live DeepSeek API:

| scenario | model | turns | cache hit | cost | Claude 4.6 would be | savings |
|---|---|---|---|---|---|---|
| Chinese multi-turn chat | `deepseek-chat` | 5 | **85.2%** | $0.000923 | $0.015174 | **93.9%** |
| Tool-use (calculator) | `deepseek-chat` | 2 | **94.9%** | $0.000142 | $0.003351 | **95.8%** |
| R1 math + harvest | `deepseek-reasoner` | 1 | 72.7% | $0.006478 | $0.044484 | 85.4% |

---

## Usage

### CLI

```bash
npx reasonix chat                # just chat — everything else is inside
npx reasonix run "ask anything"  # one-shot, streams to stdout
npx reasonix stats session.jsonl # read back a saved transcript
```

### Inside the chat — slash commands

```
/help                    list all commands
/status                  show model / harvest / branch / stream state
/model deepseek-reasoner switch to R1 for thinking-heavy tasks
/model deepseek-chat     switch back
/harvest on              Pillar 2: parse R1 reasoning into typed plan state
/harvest off             disable (saves one cheap V3 call per turn)
/branch 3                run 3 parallel samples per turn, pick most confident
/branch off              disable branching
/clear                   clear displayed history (log is kept)
/exit                    quit
```

The header updates live: you'll see `harvest · branch3` appear next to the
model name once you turn those on. `turns N · type /help` is always in the
top-right corner.

### Flags (for automation / CI)

The same knobs are also available as CLI flags if you're scripting:

```bash
npx reasonix chat -m deepseek-reasoner --harvest --branch 3 --transcript session.jsonl
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

On first run the CLI prompts for your DeepSeek API key and saves it to
`~/.reasonix/config.json`. Alternatives:

```bash
export DEEPSEEK_API_KEY=sk-...        # env var (wins over config file)
export DEEPSEEK_BASE_URL=https://...  # optional alternate endpoint
```

Get a key (free credit on signup): <https://platform.deepseek.com/api_keys>

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
npm test                # vitest (89 tests)
npm run lint            # biome
npm run typecheck       # tsc --noEmit
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for internals.

---

## License

MIT
