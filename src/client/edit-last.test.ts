// Offline self-check: bun src/client/edit-last.test.ts. The double-Escape timing without a DOM.
import assert from "node:assert/strict";
import { escapeStep } from "./edit-last.js";

// A first press only remembers its time.
assert.deepEqual(escapeStep(null, 1000, 500), { fire: false, lastAt: 1000 });
// A second one inside the gap fires and forgets, so a third starts over.
assert.deepEqual(escapeStep(1000, 1400, 500), { fire: true, lastAt: null });
// Exactly on the gap still counts; one past it is a new first press.
assert.deepEqual(escapeStep(1000, 1500, 500), { fire: true, lastAt: null });
assert.deepEqual(escapeStep(1000, 1501, 500), { fire: false, lastAt: 1501 });
console.log("edit-last: ok");
