import type { ServerResponse } from "node:http";
import type { JsonValue } from "./dsh.js";
/** One message: `kind` names the SSE event, `session` scopes it (null: every tab hears it) and
 *  `data` is the matching GET route's body. */
export interface OmcEvent {
    kind: string;
    session: string | null;
    data: JsonValue;
}
interface Connection {
    res: ServerResponse;
    session: string | null;
}
/** Heartbeat period, an SSE `ping` event (not a comment: a comment never reaches an EventSource
 *  listener, and the client's staleness clock has to hear the beat). Under nginx's default 60 s
 *  read timeout, so a proxied stream stays up while nothing happens; a client that hears neither
 *  a message nor a ping for 60 s treats the stream as down (`streamUp()` in src/client/events.ts). */
export declare const HEARTBEAT_MS = 25000;
/** Format one event as SSE text. `data` is one line: JSON has no raw newlines. */
export declare const frame: (e: OmcEvent) => string;
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
export declare class EventHub {
    readonly connections: Set<Connection>;
    private readonly pending;
    private beat;
    /** Hold `res` open as an event stream for `session` (null: only tab-wide kinds). Writes the
     *  headers, a `: connected` comment and every snapshot event, then keeps the response until the
     *  socket closes. Starts the heartbeat with the first connection and stops it with the last. */
    attach(res: ServerResponse, session: string | null, snapshot: OmcEvent[]): void;
    /** Send `e` to every connection whose session matches, or to all when `e.session` is null. */
    publish(e: OmcEvent): void;
    /** Publish `build()` for `session` at most once per `ms`; a call while one is pending replaces
     *  the builder and keeps the timer, so the body sent is the newest. */
    coalesce(session: string, build: () => OmcEvent, ms?: number): void;
    /** Cancel a pending coalesced event for `session` and publish `e` now. */
    flush(session: string, e: OmcEvent): void;
    /** End every response and stop the timers. Called by the route's disposer only: a box mount
     *  going away must not close the root's streams, and a reload disposes the route anyway. */
    close(): void;
}
/** The one hub every adapter instance publishes to and the route attaches to: the plugin mounts
 *  one adapter per SSH box, and a box's session publishes from the box's instance. */
export declare const hub: EventHub;
export {};
