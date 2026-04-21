import { loadDotenv } from "../../env.js";
import { CacheFirstLoop, DeepSeekClient, ImmutablePrefix } from "../../index.js";

export interface RunOptions {
  task: string;
  model: string;
  system: string;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  loadDotenv();
  const client = new DeepSeekClient();
  const prefix = new ImmutablePrefix({ system: opts.system });
  const loop = new CacheFirstLoop({ client, prefix, model: opts.model });

  for await (const ev of loop.step(opts.task)) {
    if (ev.role === "assistant_delta" && ev.content) process.stdout.write(ev.content);
    if (ev.role === "tool") process.stdout.write(`\n[tool ${ev.toolName}] ${ev.content}\n`);
    if (ev.role === "error") process.stderr.write(`\n[error] ${ev.error}\n`);
    if (ev.role === "done") process.stdout.write("\n");
  }
  const s = loop.stats.summary();
  process.stdout.write(
    `\n— turns:${s.turns} cache:${(s.cacheHitRatio * 100).toFixed(1)}% ` +
      `cost:$${s.totalCostUsd.toFixed(6)} save-vs-claude:${s.savingsVsClaudePct.toFixed(1)}%\n`,
  );
}
