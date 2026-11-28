// Offline self-check: bun src/client/history-search.test.ts. The match rule and the scope cycle
// without a DOM.
import assert from "node:assert/strict";
import { SCOPES, SCOPE_BUTTON, historyMatches, nextScope, prevScope } from "./history-search.js";

const rows = [
  { text: "run the test then fix it", time: 3 },
  { text: "Fixture for the parser", time: 2 },
  { text: "write docs", time: 1 },
];

// Blank query: everything, in the order given.
assert.deepEqual(historyMatches(rows, "   "), rows);

// Every word must appear, any order, any case, as a substring.
assert.deepEqual(
  historyMatches(rows, "fix test").map((r) => r.time),
  [3],
);

assert.deepEqual(
  historyMatches(rows, "FIX").map((r) => r.time),
  [3, 2],
);

assert.deepEqual(historyMatches(rows, "nothing here"), []);

// Ctrl+S and Ctrl+Down walk the scopes round and round; Ctrl+Up walks them back.
assert.equal(nextScope("session"), "workspace");

assert.equal(nextScope("workspace"), "box");

assert.equal(nextScope("box"), "session");

assert.equal(prevScope("session"), "box");

assert.equal(prevScope("box"), "workspace");

assert.equal(prevScope("workspace"), "session");

assert.equal(SCOPES.length, 3);

console.log("history-search: ok");

// The scope button sizes to its label. At the list row's 100% it took the whole line beside the
// search field and squeezed the field to its padding, so typed text was hidden.
assert.equal(SCOPE_BUTTON.width, "auto");

assert.equal(SCOPE_BUTTON.flex, "none");
