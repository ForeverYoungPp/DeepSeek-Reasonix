/**
 * Streamable HTTP transport for MCP (spec version 2025-03-26).
 *
 * Wire shape (single endpoint, no separate POST URL handshake):
 *
 *   1. Client POSTs each outgoing JSON-RPC frame to the endpoint with
 *      `Accept: application/json, text/event-stream`. The server picks
 *      ONE of three responses:
 *        a. `202 Accepted`, no body → notification or response
 *           was accepted; nothing more to deliver.
 *        b. `200 OK`, `Content-Type: application/json` → body is a
 *           single JSON-RPC response (or batch). Connection closes.
 *        c. `200 OK`, `Content-Type: text/event-stream` → an SSE
 *           stream of `event: message` frames carrying responses,
 *           server-initiated requests, and notifications. Stream may
 *           close after the matching response or stay open longer.
 *   2. The server may include `Mcp-Session-Id: <opaque>` on the response
 *      to `initialize`. Client echoes that header on every subsequent
 *      request. A 404 on a request with a session id means the session
 *      expired — caller must reinitialize.
 *
 * Compared to 2024-11-05 HTTP+SSE:
 *   - No two-endpoint dance (no `event: endpoint` handshake).
 *   - Replies arrive on the POST response, not on a separate GET stream.
 *   - Session continuity is explicit (`Mcp-Session-Id`), not implicit.
 *
 * Not yet implemented in this transport (acceptable for v1):
 *   - Long-lived GET stream for unsolicited server-initiated frames
 *     (sampling requests, etc.). Most MCP servers we care about today
 *     don't issue server-initiated requests, and POST-only handles
 *     full request/response/notification traffic. Add when a real
 *     server we're integrating against needs it.
 *   - Resumability via `Last-Event-ID` on reconnect.
 */

import { createParser } from "eventsource-parser";
import type { McpTransport } from "./stdio.js";
import type { JsonRpcMessage } from "./types.js";

export interface StreamableHttpTransportOptions {
  /** Streamable HTTP endpoint URL, e.g. `https://mcp.example.com/mcp`. */
  url: string;
  /** Extra headers sent on every request (e.g. `Authorization`). */
  headers?: Record<string, string>;
}

const SESSION_HEADER = "mcp-session-id";

export class StreamableHttpTransport implements McpTransport {
  private readonly url: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly queue: JsonRpcMessage[] = [];
  private readonly waiters: Array<(m: JsonRpcMessage | null) => void> = [];
  private readonly controller = new AbortController();
  /** Session id minted by server on (typically) the initialize response. */
  private sessionId: string | null = null;
  private closed = false;
  /** Background SSE read-loops kicked off by send(); awaited on close(). */
  private readonly streams = new Set<Promise<void>>();

  constructor(opts: StreamableHttpTransportOptions) {
    this.url = opts.url;
    this.extraHeaders = opts.headers ?? {};
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error("MCP Streamable HTTP transport is closed");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      // Both accepted — server picks. application/json first signals a
      // mild preference for the simpler shape when the response is a
      // single message.
      accept: "application/json, text/event-stream",
      ...this.extraHeaders,
    };
    if (this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: this.controller.signal,
      });
    } catch (err) {
      throw new Error(`MCP Streamable HTTP POST ${this.url} failed: ${(err as Error).message}`);
    }

    // Capture session id the first time the server hands one out.
    const serverSessionId = res.headers.get(SESSION_HEADER);
    if (serverSessionId && this.sessionId === null) {
      this.sessionId = serverSessionId;
    }

    if (res.status === 404 && this.sessionId !== null) {
      // Session expired / unknown to the server. Surface as an error so
      // McpClient can recreate; drain the body so the socket goes back
      // to the pool.
      await res.body?.cancel().catch(() => undefined);
      throw new Error(
        `MCP Streamable HTTP session expired (server returned 404 with Mcp-Session-Id "${this.sessionId}"). Reinitialize the client.`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `MCP Streamable HTTP POST ${this.url} → ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
      );
    }

    // 202 Accepted: request was a notification or pure ack — no body.
    if (res.status === 202) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("application/json")) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (err) {
        throw new Error(`MCP Streamable HTTP body wasn't valid JSON: ${(err as Error).message}`);
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) this.pushMessage(item as JsonRpcMessage);
      } else {
        this.pushMessage(parsed as JsonRpcMessage);
      }
      return;
    }

    if (ct.includes("text/event-stream")) {
      // Stream may carry multiple events (progress notifications +
      // the eventual response). Read it concurrently with subsequent
      // sends — return as soon as the stream is wired so callers can
      // pipeline more requests.
      if (!res.body) {
        throw new Error("MCP Streamable HTTP SSE response had no body");
      }
      const stream = this.consumeStream(res.body as AsyncIterable<Uint8Array>);
      this.streams.add(stream);
      stream.finally(() => this.streams.delete(stream));
      return;
    }

    // Unknown content type — drain and treat as a no-op rather than
    // hanging. Servers that want to extend the protocol should not
    // wedge older clients with an unexpected MIME.
    await res.body?.cancel().catch(() => undefined);
  }

  async *messages(): AsyncIterableIterator<JsonRpcMessage> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<JsonRpcMessage | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) this.waiters.shift()!(null);
    try {
      this.controller.abort();
    } catch {
      /* already aborted */
    }
    // Wait for any in-flight SSE streams to wind down so a subsequent
    // process.exit() doesn't trip on a hanging socket. Cap at "done";
    // controller.abort() above unblocks them.
    await Promise.allSettled(Array.from(this.streams));
  }

  /** Visible for tests — confirm session header round-trip. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  // ---------- internals ----------

  private async consumeStream(body: AsyncIterable<Uint8Array>): Promise<void> {
    const parser = createParser({
      onEvent: (ev) => {
        // Per spec, server-side events use the `message` event type
        // (default if `event:` line is missing). Other event types
        // (server pings, custom extensions) we silently ignore.
        const type = ev.event ?? "message";
        if (type !== "message") return;
        try {
          const parsed = JSON.parse(ev.data) as JsonRpcMessage;
          this.pushMessage(parsed);
        } catch {
          /* malformed JSON — drop, mirror SSE behavior */
        }
      },
    });
    const decoder = new TextDecoder();
    try {
      for await (const chunk of body) {
        if (this.closed) break;
        parser.feed(decoder.decode(chunk, { stream: true }));
      }
    } catch (err) {
      if (!this.closed) {
        this.pushMessage({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message: `Streamable HTTP stream error: ${(err as Error).message}`,
          },
        });
      }
    }
  }

  private pushMessage(msg: JsonRpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(msg);
    else this.queue.push(msg);
  }
}
