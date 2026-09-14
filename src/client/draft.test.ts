// Offline self-check: bun src/client/draft.test.ts. No DOM, no server.
import assert from "node:assert/strict";
import { queueDraft, takeDraft, subscribeDraft } from "./draft.js";

// Session guard: the draft for one session does not leak to another.
queueDraft("session-a", "a text");
assert.equal(takeDraft("session-a"), "a text", "takes its own session");
assert.equal(takeDraft("session-b"), undefined, "returns undefined for other session");

// Taking clears it: a second take returns nothing.
queueDraft("session-a", "again");
takeDraft("session-a");
assert.equal(takeDraft("session-a"), undefined, "clears after first take");

// A later queue replaces the earlier one rather than queuing both.
queueDraft("session-a", "first");
queueDraft("session-a", "second");
assert.equal(takeDraft("session-a"), "second", "last call wins, not both");

// Subscription fires on queue and stops after unsubscribe.
{
  let fired = false;
  const unsub = subscribeDraft(() => {
    fired = true;
  });
  assert.equal(fired, false, "subscribed but not yet queued");
  queueDraft("session-x", "x");
  assert.equal(fired, true, "fires on queueDraft");
  unsub();
  fired = false;
  queueDraft("session-x", "y");
  assert.equal(fired, false, "stops after unsubscribe");
}

console.log("draft ok");
