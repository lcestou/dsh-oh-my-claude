// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/events.test.ts.
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { EventHub, HEARTBEAT_MS, frame, hub, type OmcEvent } from "./events.js";

interface FakeRes {
  res: ServerResponse;
  status: number;
  headers: Record<string, string>;
  chunks: string[];
  ended: boolean;
  onClose: (() => void) | undefined;
  needDrain: boolean;
}

/** A ServerResponse double that records what the hub writes and lets a test flip the drain flag
 *  and fire the close callback. */
const fakeRes = (): FakeRes => {
  const f: FakeRes = {
    res: undefined as unknown as ServerResponse,
    status: 0,
    headers: {},
    chunks: [],
    ended: false,
    onClose: undefined,
    needDrain: false,
  };
  f.res = {
    writeHead: (s: number, h: Record<string, string>) => {
      f.status = s;
      f.headers = h;
    },
    write: (chunk: string) => {
      f.chunks.push(chunk);
      return true;
    },
    end: () => {
      f.ended = true;
    },
    on: (ev: string, cb: () => void) => {
      if (ev === "close") f.onClose = cb;
    },
    get writableNeedDrain() {
      return f.needDrain;
    },
  } as unknown as ServerResponse;
  return f;
};

// A. frame
{
  assert.equal(
    frame({ kind: "idle", session: "s1", data: { deadline: null, timeoutMs: 5 } }),
    'event: idle\ndata: {"session":"s1","data":{"deadline":null,"timeoutMs":5}}\n\n',
    "frame text",
  );
}

// B. attach writes headers, the comment, then each snapshot frame
{
  const h = new EventHub();
  const a = fakeRes();
  const snap: OmcEvent[] = [
    { kind: "awaiting", session: null, data: {} },
    { kind: "idle", session: "s1", data: { deadline: null, timeoutMs: 5 } },
  ];
  h.attach(a.res, "s1", snap);
  assert.equal(a.status, 200, "attach status");
  assert.equal(a.headers["content-type"], "text/event-stream", "attach content type");
  assert.equal(a.headers["x-accel-buffering"], "no", "attach tells nginx not to buffer");
  assert.equal(a.chunks[0], ": connected\n\n", "attach opens with the connected comment");
  assert.equal(a.chunks[1], frame(snap[0]!), "attach writes the first snapshot frame");
  assert.equal(a.chunks[2], frame(snap[1]!), "attach writes the second snapshot frame");
  assert.equal(h.connections.size, 1, "attach registers the connection");
  h.close();
}

// C. publish filters by session and null reaches all
{
  const h = new EventHub();
  const a = fakeRes();
  const b = fakeRes();
  h.attach(a.res, "s1", []);
  h.attach(b.res, "s2", []);
  h.publish({ kind: "idle", session: "s1", data: { deadline: 1, timeoutMs: 5 } });
  assert.equal(a.chunks.length, 2, "s1 connection got the s1 event");
  assert.equal(b.chunks.length, 1, "s2 connection did not get the s1 event");
  h.publish({ kind: "awaiting", session: null, data: {} });
  assert.equal(a.chunks.length, 3, "tab-wide event reaches s1");
  assert.equal(b.chunks.length, 2, "tab-wide event reaches s2");
  assert.equal(
    a.chunks[2],
    'event: awaiting\ndata: {"session":null,"data":{}}\n\n',
    "tab-wide frame text",
  );
  h.close();
}

// D. close callback removes the connection
{
  const h = new EventHub();
  const a = fakeRes();
  h.attach(a.res, "s1", []);
  a.onClose!();
  assert.equal(h.connections.size, 0, "socket close drops the connection");
  h.publish({ kind: "idle", session: "s1", data: {} });
  assert.equal(a.chunks.length, 1, "a dropped connection gets nothing more");
  h.close();
}

// E. a connection that needs drain is skipped
{
  const h = new EventHub();
  const a = fakeRes();
  h.attach(a.res, "s1", []);
  a.needDrain = true;
  h.publish({ kind: "idle", session: "s1", data: {} });
  assert.equal(a.chunks.length, 1, "a socket that needs drain gets no frame");
  a.needDrain = false;
  h.publish({ kind: "idle", session: "s1", data: {} });
  assert.equal(a.chunks.length, 2, "the next frame goes out once it drains");
  h.close();
}

// F. coalesce sends once per window with the newest builder; flush sends now and cancels
const h = new EventHub();
const a = fakeRes();
h.attach(a.res, "s1", []);
h.coalesce("s1", () => ({ kind: "live-turn", session: "s1", data: { tokens: 1 } }), 200);
h.coalesce("s1", () => ({ kind: "live-turn", session: "s1", data: { tokens: 2 } }), 200);
h.coalesce("s1", () => ({ kind: "live-turn", session: "s1", data: { tokens: 3 } }), 200);
assert.equal(a.chunks.length, 1, "nothing goes out before the window ends");
await new Promise((r) => setTimeout(r, 300));
assert.equal(a.chunks.length, 2, "one frame after the window");
assert.equal(
  a.chunks[1],
  'event: live-turn\ndata: {"session":"s1","data":{"tokens":3}}\n\n',
  "the newest builder wins",
);
h.coalesce("s1", () => ({ kind: "live-turn", session: "s1", data: { tokens: 4 } }), 200);
h.flush("s1", { kind: "live-turn", session: "s1", data: {} });
assert.equal(a.chunks.length, 3, "flush publishes at once");
assert.equal(
  a.chunks[2],
  'event: live-turn\ndata: {"session":"s1","data":{}}\n\n',
  "flush frame text",
);
await new Promise((r) => setTimeout(r, 300));
assert.equal(a.chunks.length, 3, "flush cancelled the pending coalesced frame");
h.close();

// G. close ends every response and empties the set
{
  const h = new EventHub();
  const a = fakeRes();
  const b = fakeRes();
  h.attach(a.res, "s1", []);
  h.attach(b.res, null, []);
  h.close();
  assert.equal(a.ended, true, "close ends the first response");
  assert.equal(b.ended, true, "close ends the second response");
  assert.equal(h.connections.size, 0, "close empties the connections");
}

// H. the shared hub and the heartbeat constant
{
  assert.ok(hub instanceof EventHub, "the module exports one shared hub");
  assert.equal(HEARTBEAT_MS, 25_000, "heartbeat period under nginx's 60 s read timeout");
}

console.log("events: frame, attach, publish, close, drain, coalesce, flush ok");
