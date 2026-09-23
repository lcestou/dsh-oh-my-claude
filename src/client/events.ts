// The tab's end of the plugin's event stream (src/events.ts on the server). One EventSource per
// tab, reopened when the open session changes; readers subscribe by kind and get the same body
// the matching GET route answers. `streamUp()` lets each fallback timer slow to 30 s while the
// stream is alive, and `pollEvery()` is the period they ask for.
import type { FallbackRecord } from "../translator.js";
import type { AwaitingRow } from "./notices.js";
import { ROUTE, whenContextGone } from "./shared.js";

/** `GET /live-turn` while a turn runs, every field optional because the body is `{}` once the turn
 *  has ended. The ages were computed when the server built the body; `polledAt` on the reader adds
 *  the time since. */
export interface LiveTurnBody {
  tokens?: number;
  thinkingMs?: number;
  idleMs?: number;
  tool?: boolean;
  thoughtMs?: number;
  thoughtAgoMs?: number;
  effort?: string;
  relayName?: string;
  relayMs?: number;
  elapsedMs?: number;
}
/** One `/btw` side question and, once the CLI answers, its answer or error. */
export interface AsideItem {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  at: number;
  dismissed?: boolean;
}
/** A box whose Claude needs a login, as the card names it. */
export interface LoginNeed {
  host: string;
  label: string;
}
/** A typed steer still in the CLI's queue. */
export interface WaitingSteerRow {
  id: string;
  text: string;
  at: number;
}
/** Steers taken back from Claude for an edit: one hold, possibly several messages joined. */
export interface HeldSteerRow {
  id: string;
  text: string;
}
/** The steer card's half of the side-questions body. */
export interface SteerCardData {
  waiting: WaitingSteerRow[];
  held: HeldSteerRow[];
}
/** One finished turn's accounting, as the cost line sums them. */
export interface TurnRecord {
  at: number;
  costUsd: number;
  durationMs: number;
  apiMs: number;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ttftMs?: number;
}
/** `GET /turns`: the records and their sums. */
export interface TurnsReply {
  turns: TurnRecord[];
  total: {
    costUsd: number;
    durationMs: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    count: number;
  };
}
/** `GET /idle`: when the watchdog would end the process, or null when it is not armed. */
export interface IdleReply {
  deadline: number | null;
  timeoutMs: number;
}
/** What `GET /permission-mode` reports. */
export interface PermissionModeState {
  mode: string;
  override: string | null;
  modes: string[];
  accessMode: string | null;
  ceiling: string;
  /** The mode the running process is in; null without a process. Differs from `mode` after a pick
   *  the CLI could not take live, until the next turn respawns. */
  liveMode?: string | null;
  live?: boolean;
  error?: string;
}

/** Each kind's body: what the matching GET route answers today, so a reader parses one shape
 *  whether it came from the stream or from its fallback fetch. `ping` is the heartbeat and has no
 *  readers. */
export interface EventData {
  "live-turn": LiveTurnBody;
  awaiting: Record<string, AwaitingRow>;
  asides: {
    items: AsideItem[];
    loginNeeded: LoginNeed | null;
    fallback: FallbackRecord | null;
    steers: SteerCardData;
  };
  idle: IdleReply;
  turns: TurnsReply;
  hints: Record<string, boolean | number>;
  "permission-mode": PermissionModeState;
  ping: Record<string, never>;
}

/** The event names the stream carries; each is registered as its own EventSource listener. */
export const KINDS = [
  "live-turn",
  "awaiting",
  "asides",
  "idle",
  "turns",
  "hints",
  "permission-mode",
  "ping",
] as const;

type Listener<K extends keyof EventData> = (session: string | null, data: EventData[K]) => void;
const subscribers = new Map<keyof EventData, Set<Listener<keyof EventData>>>();
let source: EventSource | undefined;
let openSession: string | null = null;
let lastMessageAt = 0;

/** Without a message or a heartbeat for this long the stream counts as down and the timers run at
 *  their old rates; the server pings every 25 s (HEARTBEAT_MS in src/events.ts). */
export const STALE_MS = 60_000;
/** Fallback period while the stream is up: a safety net for an event the stream lost, not a rate.
 *  Must stay under HOLD_IDLE_MS (60 s, src/adapter.ts): the asides fallback read is what re-arms an
 *  open steer edit's hold, and a pushed event does not. */
export const SLOW_MS = 30_000;

/** True while a stream is open and heard from within STALE_MS. */
export function streamUp(now = Date.now()): boolean {
  return source !== undefined && source.readyState === 1 && now - lastMessageAt < STALE_MS;
}

/** The period a fallback timer should use: SLOW_MS while the stream is up, else the caller's own
 *  rate for a running session (`fast`) or at rest (`slow`). */
export function pollEvery(running: boolean, fast: number, slow: number): number {
  return streamUp() ? SLOW_MS : running ? fast : slow;
}

/** Route one parsed message to its kind's listeners; exported for the test. */
export function dispatch<K extends keyof EventData>(
  kind: K,
  session: string | null,
  data: EventData[K],
): void {
  const set = subscribers.get(kind);
  if (!set) return;
  for (const fn of set) fn(session, data);
}

/** Listen for one kind; returns the unsubscribe. */
export function subscribe<K extends keyof EventData>(kind: K, fn: Listener<K>): () => void {
  let set = subscribers.get(kind);
  if (!set) subscribers.set(kind, (set = new Set()));
  // SAFETY: the set is keyed by K, so every listener in it takes EventData[K]
  const wide = fn as Listener<keyof EventData>;
  set.add(wide);
  return () => {
    set.delete(wide);
  };
}

/** One of KINDS, or undefined for an event name the server never sends. */
const kindOf = (name: string): keyof EventData | undefined => KINDS.find((k) => k === name);

// One watcher for the bundle, not one per open: `whenContextGone` keeps every closure it is given.
whenContextGone(() => {
  source?.close();
  source = undefined;
});

/** Open (or reopen) the stream for `session` (null: only the tab-wide kinds). Idempotent for the
 *  same session while the source is alive. The browser retries a dropped EventSource on its own
 *  (network error, 5xx); a 404 or a 200 that is not `text/event-stream` closes it for good, which
 *  is what the reload gap between the old route's dispose and the new bundle's register answers
 *  with, so a CLOSED source is reopened here on the next call. A reconnect gets a fresh snapshot
 *  from the server. */
export function openStream(session: string | null): void {
  // A socket that died without a FIN (a proxy dropped it) stays OPEN in the browser's eyes and
  // never errors; the staleness clock is the only thing that notices, so replace it too.
  const stale =
    source !== undefined &&
    source.readyState === EventSource.OPEN &&
    Date.now() - lastMessageAt >= STALE_MS;
  if (
    source !== undefined &&
    openSession === session &&
    source.readyState !== EventSource.CLOSED &&
    !stale
  )
    return;
  source?.close();
  openSession = session;
  const q = session ? `?session=${encodeURIComponent(session)}` : "";
  const s = new EventSource(`${ROUTE}/events${q}`);
  source = s;
  const onAny = (ev: MessageEvent) => {
    lastMessageAt = Date.now();
    const kind = kindOf(ev.type);
    if (kind === undefined) return;
    try {
      // SAFETY: our own server wrote this frame (src/events.ts `frame`): `{ session, data }` with
      // `data` the matching route's body for `kind`
      const body = JSON.parse(String(ev.data)) as {
        session: string | null;
        data: EventData[typeof kind];
      };
      dispatch(kind, body.session, body.data);
    } catch {
      // a malformed frame is dropped; the next snapshot or event replaces it
    }
  };
  for (const kind of KINDS) s.addEventListener(kind, onAny);
  s.addEventListener("open", () => {
    lastMessageAt = Date.now();
  });
  s.addEventListener("error", () => {
    // CLOSED and not retrying: forget it so the next `openStream` opens a new one.
    if (s.readyState === EventSource.CLOSED && source === s) source = undefined;
  });
  // `onopen`, every event and the ping refresh the clock; a stream with none of them for STALE_MS
  // falls back to the timers, which is the intent.
}
