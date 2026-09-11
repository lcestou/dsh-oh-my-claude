// Offline checks for the composer's keyword matcher: a keyword typed as an example is not a
// trigger, so the CLI does not paint it, and neither do we. Expected offsets are literals; a
// matcher that reports the quoted word, or drops the plain one, fails here.
import assert from "node:assert/strict";
import { keywordMatches } from "./shared.js";

const spans = (text: string): [number, number][] =>
  keywordMatches(text, "ultracode").map((m) => [m.start, m.end]);

// The plain word is painted; the same word in quotes, right beside it, is not.
assert.deepEqual(spans('ultracode here, not "ultracode" quoted, and ultrathink too'), [[0, 9]]);

// Every wrapper the CLI's matcher treats as a quotation.
for (const text of [
  "run `ultracode` on it",
  'say "ultracode" out loud',
  "the [ultracode] keyword",
  "an {ultracode} block",
  "call (ultracode) later",
  "an <ultracode> tag",
  "the 'ultracode' word",
])
  assert.deepEqual(spans(text), [], text);

// A slash command is the CLI's own, not a keyword: nothing in the whole line.
assert.deepEqual(spans("/effort ultracode"), []);

// Glued to a path or a flag character, before or after.
for (const text of [
  "src/ultracode",
  "docs\\ultracode",
  "non-ultracode",
  "ultracode/mode",
  "ultracode\\mode",
  "ultracode-mode",
  "ultracode?",
])
  assert.deepEqual(spans(text), [], text);

// A dotted member is a reference; a sentence's full stop is not.
assert.deepEqual(spans("ultracode.run() next"), []);
assert.deepEqual(spans("turn on ultracode. Then wait"), [[8, 17]]);

// An apostrophe inside a word does not open a quotation, so what follows still counts.
assert.deepEqual(spans("don't forget ultracode"), [[13, 22]]);

// Case is ignored, and each plain occurrence is its own span.
assert.deepEqual(spans("ULTRACODE and ultracode"), [
  [0, 9],
  [14, 23],
]);

// A word that merely contains the keyword is not the keyword.
assert.deepEqual(spans("ultracodes and preultracode"), []);

console.log("keyword matcher checks passed");
