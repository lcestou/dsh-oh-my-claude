// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/client/steer-restore.test.ts.
// Pins how the steer card pairs a withdrawn attachment steer with dsh putting it back in the composer.
import assert from "node:assert/strict";
import type { WaitingSteerRow } from "./events.js";
import {
  RESTORE_WINDOW_MS,
  noteWithdrawn,
  startWatch,
  stepRestore,
  withdrawnSince,
} from "./steer-restore.js";

const image: WaitingSteerRow = {
  id: "m1",
  text: "look",
  at: 1,
  attachments: [{ kind: "image", name: "a.png", bytes: 9 }],
};
const words: WaitingSteerRow = { id: "m2", text: "plain", at: 2 };
/** Taken back from this tab. */
const withdrawn = new Set(["m1", "m2"]);
const none = new Set<string>();

// The row leaves first, then dsh restores: its id at the head, its words in the empty composer.
{
  let w = startWatch(["x"], [image, words]);
  let r = stepRestore(w, { ids: ["x"], rows: [words], draft: "", at: 100, withdrawn });
  assert.deepEqual(r.remove, [], "nothing to undo before the restore lands");
  w = r.next;
  r = stepRestore(w, { ids: ["r1", "x"], rows: [words], draft: "", at: 200, withdrawn });
  assert.deepEqual(r.remove, ["r1"], "the restored id at the head goes");
  assert.equal(r.clearDraft, false, "the words are not back yet");
  r = stepRestore(r.next, { ids: ["x"], rows: [words], draft: "look\n", at: 300, withdrawn });
  assert.equal(r.clearDraft, true, "the restored words go once they are the row's own");
}
// The restore lands before the list update: it pairs the other way round, in one step.
{
  const w = startWatch([], [image]);
  let r = stepRestore(w, { ids: ["r1"], rows: [image], draft: "look", at: 100, withdrawn });
  assert.deepEqual(r.remove, [], "a head insertion alone waits for its steer");
  r = stepRestore(r.next, { ids: ["r1"], rows: [], draft: "look", at: 150, withdrawn });
  assert.deepEqual(r.remove, ["r1"]);
  assert.equal(r.clearDraft, true, "and the words in the same step");
}
// What is not a restore is left alone.
{
  const w = startWatch(["x"], [image]);
  let r = stepRestore(w, { ids: ["x", "mine"], rows: [image], draft: "", at: 100, withdrawn });
  r = stepRestore(r.next, { ids: ["x", "mine"], rows: [], draft: "", at: 150, withdrawn });
  assert.deepEqual(r.remove, [], "a file the person picked lands at the tail and stays");
  r = stepRestore(startWatch([], [words]), {
    ids: ["r1"],
    rows: [],
    draft: "plain",
    at: 100,
    withdrawn,
  });
  assert.deepEqual(r.remove, [], "a text-only steer leaving pairs with nothing");
  assert.equal(r.clearDraft, false, "and its words, typed again by hand, stay");
  r = stepRestore(startWatch([], [image]), { ids: [], rows: [], draft: "", at: 100, withdrawn });
  r = stepRestore(r.next, {
    ids: ["late"],
    rows: [],
    draft: "look",
    at: 100 + RESTORE_WINDOW_MS,
    withdrawn,
  });
  assert.deepEqual(r.remove, [], "a restore past the window pairs with nothing");
  assert.equal(r.clearDraft, false);
}
// A steer Claude took is not a withdrawal: a file picked into the empty composer right after stays.
{
  let r = stepRestore(startWatch([], [image]), {
    ids: [],
    rows: [],
    draft: "",
    at: 100,
    withdrawn: none,
  });
  r = stepRestore(r.next, { ids: ["picked"], rows: [], draft: "", at: 200, withdrawn: none });
  assert.deepEqual(r.remove, [], "Claude taking a steer pairs with nothing");
}
// The tab's own record of what it took back, aged out after the window.
{
  noteWithdrawn(["h1"], 1000);
  assert.ok(withdrawnSince(1000 + RESTORE_WINDOW_MS - 1).has("h1"));
  assert.equal(withdrawnSince(1000 + RESTORE_WINDOW_MS).has("h1"), false, "gone after the window");
}
console.log("steer-restore ok");
