// Offline self-check: bun src/client/recall.test.ts. The walk's rules without a DOM: start from
// empty, the edit lock, both ends of the list, and the list builder's trimming and repeat folding.
import assert from "node:assert/strict";
import { IDLE, recallEntries, recallStep, type RecallState } from "./recall.js";

const three: RecallState = { ...IDLE, entries: ["newest", "middle", "oldest"] };

// Up from an empty box with nothing to recall changes nothing and writes nothing.
assert.deepEqual(recallStep(IDLE, "up", ""), { state: IDLE });

// Up from an empty box recalls the newest; Up again walks older; past the oldest it stays put.
let r = recallStep(three, "up", "");
assert.equal(r.set, "newest");
r = recallStep(r.state, "up", "newest");
assert.equal(r.set, "middle");
r = recallStep(r.state, "up", "middle");
assert.equal(r.set, "oldest");
const end = recallStep(r.state, "up", "oldest");
assert.equal(end.set, undefined);
assert.equal(end.state.at, 2);

// Down walks newer, and Down from the newest empties the box and ends the walk.
r = recallStep(end.state, "down", "oldest");
assert.equal(r.set, "middle");
r = recallStep(r.state, "down", "middle");
assert.equal(r.set, "newest");
r = recallStep(r.state, "down", "newest");
assert.equal(r.set, "");
assert.equal(r.state.at, null);

// Edit lock: a draft that differs from the recalled text means the person is editing it, so the
// arrows are plain cursor keys in both directions and the walk's place is kept.
const mid = recallStep(recallStep(three, "up", "").state, "up", "newest").state;
assert.deepEqual(recallStep(mid, "up", "middle edited"), { state: mid });
assert.deepEqual(recallStep(mid, "down", "middle edited"), { state: mid });

// After an edit the box emptied by hand: Up starts over at the newest, not where the walk stood.
assert.equal(recallStep(mid, "up", "").set, "newest");

// Down from an empty box, walking or not, does nothing: the box is already as far down as it goes.
assert.deepEqual(recallStep(three, "down", ""), { state: three });
assert.deepEqual(recallStep(mid, "down", ""), { state: mid });

// Entries: trimmed, blanks dropped, a prompt sent twice in a row kept once, non-adjacent repeats kept.
assert.deepEqual(
  recallEntries([{ text: " a " }, { text: "a" }, { text: "" }, { text: "b" }, { text: "a" }]),
  ["a", "b", "a"],
);
