// Offline self-check: bun src/client/notices.test.ts. No DOM, no server.
import assert from "node:assert/strict";
import { markTitle, newlyWaiting, recapNext, RECAP_AWAY_MS, stripMark } from "./notices.js";

const snap = (byId: Record<string, { running?: boolean; completed?: boolean }>, current?: string) =>
  ({ byId, current }) as const;

// The first snapshot is a baseline: a page that opens on finished sessions announces nothing.
assert.deepEqual(newlyWaiting(null, snap({ a: { running: false, completed: true } })), []);

// Working to waiting is the transition, in both spellings dsh has for it.
{
  const before = snap({ a: { running: true }, b: { running: false } });
  assert.deepEqual(newlyWaiting(before, snap({ a: { running: false }, b: { running: false } })), [
    "a",
  ]);
  assert.deepEqual(
    newlyWaiting(before, snap({ a: { running: true }, b: { running: false, completed: true } })),
    ["b"],
    "dsh's completed bit counts on its own",
  );
}

// Nothing fires twice: the second snapshot of the same state has no transition in it.
{
  const after = snap({ a: { running: false, completed: true } });
  assert.deepEqual(newlyWaiting(after, after), []);
}

// The session on screen is never announced; the user is looking at it.
{
  const before = snap({ a: { running: true } }, "a");
  assert.deepEqual(newlyWaiting(before, snap({ a: { running: false } }, "a")), []);
}

// A session that arrives already finished is not news either.
assert.deepEqual(newlyWaiting(snap({}), snap({ a: { running: false, completed: true } })), []);

// Still working, so still nothing.
assert.deepEqual(newlyWaiting(snap({ a: { running: true } }), snap({ a: { running: true } })), []);

// A row object shared between the two snapshots hides its own transition: `was` and `now` are the
// same object, so the field read can never differ. This is why the watcher copies the fields into
// fresh rows each tick rather than passing dsh's own row through.
{
  const row = { running: true };
  const before = snap({ a: row });
  row.running = false; // dsh mutates the row in place, keeping the reference
  assert.deepEqual(newlyWaiting(before, snap({ a: row })), [], "shared row cannot be compared");
}

// The title mark goes on once and comes off cleanly, however many times it is re-applied.
{
  assert.equal(markTitle("dsh", 0), "dsh");
  assert.equal(markTitle("dsh", 2), "● dsh");
  assert.equal(markTitle(markTitle("dsh", 1), 1), "● dsh", "no second mark");
  assert.equal(markTitle("● dsh", 0), "dsh");
  assert.equal(stripMark("dsh"), "dsh");
}

// The once-only sequence, run as a sequence: each tick feeds the pending list the last one returned,
// which is what the caller does. Hardcoding each tick's input would pass even if the queue leaked.
{
  const t0 = 1_000_000;
  const back = t0 + RECAP_AWAY_MS; // long enough away to have earned one
  let step = recapNext({}, [], undefined, t0, RECAP_AWAY_MS); // first tick: nothing has stopped yet
  assert.deepEqual(step, { pending: {} });
  step = recapNext(step.pending, ["a"], "b", t0, RECAP_AWAY_MS); // "a" stops while "b" is on screen
  assert.deepEqual(step, { pending: { a: t0 } }, "queued at the moment it stopped, not fired");
  step = recapNext(step.pending, ["a"], "b", t0 + 5_000, RECAP_AWAY_MS); // still stopped, still away
  assert.deepEqual(
    step,
    { pending: { a: t0 } },
    "the queued moment is the first one, not the last",
  );
  step = recapNext(step.pending, [], "a", back, RECAP_AWAY_MS); // the return
  assert.deepEqual(step, { pending: {}, fire: "a" }, "fires once, queue cleared");
  step = recapNext(step.pending, [], "a", back, RECAP_AWAY_MS); // still looking at it
  assert.deepEqual(step, { pending: {} }, "a second tick on the same session asks nothing");
}

// Under the away bar: the entry is dropped, and dropped is not fired. A glance is not a return.
{
  const t0 = 1_000_000;
  const step = recapNext({ a: t0 }, [], "a", t0 + RECAP_AWAY_MS - 1, RECAP_AWAY_MS);
  assert.deepEqual(step, { pending: {} }, "a return inside the bar clears without firing");
}

// The bar itself fires: a check that reads `>` instead of `>=` fails here.
{
  const t0 = 1_000_000;
  assert.deepEqual(recapNext({ a: t0 }, [], "a", t0 + RECAP_AWAY_MS, RECAP_AWAY_MS), {
    pending: {},
    fire: "a",
  });
}

// The bar is the caller's, not a constant: a one-minute setting fires where the default would not.
{
  const t0 = 1_000_000;
  const at = t0 + 60_000;
  assert.deepEqual(recapNext({ a: t0 }, [], "a", at, 60_000), { pending: {}, fire: "a" });
  assert.deepEqual(recapNext({ a: t0 }, [], "a", at, RECAP_AWAY_MS), { pending: {} });
}

// A session that stops while it IS current never enters pending and never fires.
{
  assert.deepEqual(recapNext({}, ["a"], "a", 1, RECAP_AWAY_MS), { pending: {} });
  assert.deepEqual(recapNext({}, [], "a", 1, RECAP_AWAY_MS), { pending: {} });
}

// current: undefined fires nothing; pending survives until a current arrives.
{
  assert.deepEqual(recapNext({ a: 1, b: 2 }, [], undefined, 9_000_000, RECAP_AWAY_MS), {
    pending: { a: 1, b: 2 },
  });
}

console.log("notices ok");
