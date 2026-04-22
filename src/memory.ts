import { createHash } from "node:crypto";
import type { ChatMessage, ToolSpec } from "./types.js";

export interface ImmutablePrefixOptions {
  system: string;
  toolSpecs?: readonly ToolSpec[];
  fewShots?: readonly ChatMessage[];
}

export class ImmutablePrefix {
  readonly system: string;
  readonly toolSpecs: readonly ToolSpec[];
  readonly fewShots: readonly ChatMessage[];

  constructor(opts: ImmutablePrefixOptions) {
    this.system = opts.system;
    this.toolSpecs = Object.freeze([...(opts.toolSpecs ?? [])]);
    this.fewShots = Object.freeze([...(opts.fewShots ?? [])]);
  }

  toMessages(): ChatMessage[] {
    return [{ role: "system", content: this.system }, ...this.fewShots.map((m) => ({ ...m }))];
  }

  tools(): ToolSpec[] {
    return this.toolSpecs.map((t) => structuredClone(t) as ToolSpec);
  }

  get fingerprint(): string {
    const blob = JSON.stringify({
      system: this.system,
      tools: this.toolSpecs,
      shots: this.fewShots,
    });
    return createHash("sha256").update(blob).digest("hex").slice(0, 16);
  }
}

export class AppendOnlyLog {
  private _entries: ChatMessage[] = [];

  append(message: ChatMessage): void {
    if (!message || typeof message !== "object" || !("role" in message)) {
      throw new Error(`invalid log entry: ${JSON.stringify(message)}`);
    }
    this._entries.push(message);
  }

  extend(messages: ChatMessage[]): void {
    for (const m of messages) this.append(m);
  }

  /**
   * Bulk-replace entries. Intentionally named to be hard to reach for —
   * this is the one mutation path that breaks the log's append-only
   * spirit, reserved for compaction flows (`/compact`) and recovery
   * where the caller has consciously decided to drop old history. Any
   * other use is almost certainly wrong; append() is what you want.
   */
  compactInPlace(replacement: ChatMessage[]): void {
    this._entries = [...replacement];
  }

  get entries(): readonly ChatMessage[] {
    return this._entries;
  }

  toMessages(): ChatMessage[] {
    return this._entries.map((e) => ({ ...e }));
  }

  get length(): number {
    return this._entries.length;
  }
}

export class VolatileScratch {
  reasoning: string | null = null;
  planState: Record<string, unknown> | null = null;
  notes: string[] = [];

  reset(): void {
    this.reasoning = null;
    this.planState = null;
    this.notes = [];
  }
}
