// The plugin's event stream to open tabs: one long GET per tab, server-sent events, one message
// per change of anything the tab used to poll for (`GET /dsh-oh-my-claude/events`, registered in
// sessions.ts). dsh's own HMR plugin serves the same shape from dsh-client-hmr (`/plugins/events`);
// this adds a heartbeat for proxies, a per-connection session filter and coalescing for the one
// kind that changes per frame. What is sent is built by the adapter from the same maps its routes
// read, so an event body and the matching route body are one function's output.
import type { ServerResponse } from "node:http";

/** One message: `kind` names the SSE event, `session` scopes it (null: every tab hears it) and
 *  `data` is the matching GET route's body. */
export interface OmcEvent {
  kind: string;
  session: string | null;
  data: object;
}

/** One open stream: the response held open and the session its per-session kinds are filtered
 *  to (null: tab-wide kinds only). */
interface Connection {
  res: ServerResponse;
  session: string | null;
}

/** Heartbeat period, an SSE `ping` event (not a comment: a comment never reaches an EventSource
 *  listener, and the client's staleness clock has to hear the beat). Under nginx's default 60 s
 *  read timeout, so a proxied stream stays up while nothing happens; a client that hears neither
 *  a message nor a ping for 60 s treats the stream as down (`streamUp()` in src/client/events.ts). */
export const HEARTBEAT_MS = 25_000;

/** Format one event as SSE text. `data` is one line: JSON has no raw newlines. */
export const frame = (e: OmcEvent): string =>
  `event: ${e.kind}\ndata: ${JSON.stringify({ session: e.session, data: e.data })}\n\n`;

/**
 * Open connections and the fan-out to them. `publish` writes synchronously to every matching
 * response; a closed socket's write is a no-op and its `close` event removes it. A socket that has
 * stopped draining (a phone with the screen off) is skipped by every write, because Node would
 * otherwise buffer each frame in process memory without bound: every kind is a current value, so
 * the next event or the client's 30 s fallback carries it once the socket drains. `coalesce` holds
 * a per-session timer so a kind that changes per frame (the live turn) goes out at most once per
 * `ms`, built at send time so the body is current; `flush` sends one now and cancels the pending
 * one. The hub owns no state beyond its timers.
 */
export class EventHub {
  readonly connections = new Set<Connection>();
  private readonly pending = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; build: () => OmcEvent }
  >();
  private beat: ReturnType<typeof setInterval> | undefined;

  /** Hold `res` open as an event stream for `session` (null: only tab-wide kinds). Writes the
   *  headers, a `: connected` comment and every snapshot event, then keeps the response until the
   *  socket closes. Starts the heartbeat with the first connection and stops it with the last. */
  attach(res: ServerResponse, session: string | null, snapshot: OmcEvent[]): void {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-store",
      connection: "keep-alive",
      // nginx (the NAS proxy) honours this per response; without it a buffering proxy holds every
      // event until its buffer fills.
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");
    for (const e of snapshot) res.write(frame(e));
    const c: Connection = { res, session };
    this.connections.add(c);
    // `res` alone, as dsh's twin does: the response's close is the socket's.
    res.on("close", () => {
      this.connections.delete(c);
      if (this.connections.size === 0 && this.beat !== undefined) {
        clearInterval(this.beat);
        this.beat = undefined;
      }
    });
    if (this.beat === undefined) {
      const ping = frame({ kind: "ping", session: null, data: {} });
      this.beat = setInterval(() => {
        for (const { res: r } of this.connections) if (!r.writableNeedDrain) r.write(ping);
      }, HEARTBEAT_MS);
      this.beat.unref?.();
    }
  }

  /** Send `e` to every connection whose session matches, or to all when `e.session` is null. */
  publish(e: OmcEvent): void {
    const text = frame(e);
    for (const c of this.connections) {
      if (e.session !== null && c.session !== e.session) continue;
      if (c.res.writableNeedDrain) continue;
      c.res.write(text);
    }
  }

  /** Publish `build()` under `key` at most once per `ms`; a call while one is pending replaces
   *  the builder and keeps the timer, so the body sent is the newest. Callers key by kind and
   *  session (`live-turn:<id>`), so two kinds for one session never replace each other. */
  coalesce(key: string, build: () => OmcEvent, ms = 1000): void {
    const p = this.pending.get(key);
    if (p) {
      p.build = build;
      return;
    }
    const entry = {
      build,
      timer: setTimeout(() => {
        this.pending.delete(key);
        this.publish(entry.build());
      }, ms),
    };
    this.pending.set(key, entry);
  }

  /** Cancel a pending coalesced event under `key` and publish `e` now. */
  flush(key: string, e: OmcEvent): void {
    const p = this.pending.get(key);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(key);
    }
    this.publish(e);
  }

  /** End every response and stop the timers. Called by the route's disposer only: a box mount
   *  going away must not close the root's streams, and a reload disposes the route anyway. */
  close(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (this.beat !== undefined) clearInterval(this.beat);
    this.beat = undefined;
    for (const c of this.connections) c.res.end();
    this.connections.clear();
  }
}

/** The one hub every adapter instance publishes to and the route attaches to: the plugin mounts
 *  one adapter per SSH box, and a box's session publishes from the box's instance. */
export const hub = new EventHub();
