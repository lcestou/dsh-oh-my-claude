// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/client/events.test.ts.
// The stream itself needs a browser (EventSource); this pins the routing and the fallback period.
import assert from "node:assert/strict";
import { KINDS, SLOW_MS, dispatch, pollEvery, streamUp, subscribe } from "./events.js";

{
  const got: Array<[string | null, number | null]> = [];
  const other: number[] = [];
  const off = subscribe("idle", (session, data) => got.push([session, data.deadline]));
  const offOther = subscribe("turns", () => other.push(1));
  dispatch("idle", "s1", { deadline: 42, timeoutMs: 5 });
  assert.deepEqual(got, [["s1", 42]], "an idle event reaches the idle subscriber");
  assert.equal(other.length, 0, "an idle event does not reach the turns subscriber");
  off();
  dispatch("idle", "s1", { deadline: 43, timeoutMs: 5 });
  assert.equal(got.length, 1, "an unsubscribed listener hears nothing more");
  offOther();
  dispatch("turns", "s1", {
    turns: [],
    total: {
      costUsd: 0,
      durationMs: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      count: 0,
    },
  });
  assert.equal(other.length, 0, "a kind with no subscribers dispatches to nobody");
}

{
  assert.equal(streamUp(), false, "no source: the stream is down");
  assert.equal(pollEvery(true, 1000, 3000), 1000, "stream down, running: the fast rate");
  assert.equal(pollEvery(false, 1000, 3000), 3000, "stream down, at rest: the slow rate");
  assert.equal(SLOW_MS, 30_000, "the fallback period while the stream is up");
  assert.ok(SLOW_MS < 60_000, "under HOLD_IDLE_MS, so a fallback read still re-arms a steer hold");
  assert.equal(KINDS.length, 8, "seven kinds and the ping");
  assert.ok(KINDS.includes("ping"), "the heartbeat is an event the listener hears");
}

console.log("client events: dispatch, subscribe, pollEvery ok");
