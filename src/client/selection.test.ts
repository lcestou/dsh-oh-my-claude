import assert from "node:assert/strict";
import {
  askBody,
  clampQuote,
  previewOf,
  QUOTE_MAX,
  quoteBlocks,
  quoteMarkdown,
  quoteSpans,
} from "./selection.js";

assert.equal(quoteMarkdown("one"), "> one\n\n");
assert.equal(quoteMarkdown("a\r\n\r\nb"), "> a\n>\n> b\n\n");
assert.equal(quoteMarkdown("  x\n\t\n"), ">   x\n>\n>\n\n");
assert.deepEqual(clampQuote("abc"), { text: "abc", trimmed: false });
const long = "z".repeat(QUOTE_MAX + 5);
assert.deepEqual(clampQuote(long), { text: "z".repeat(4000), trimmed: true });
assert.equal(previewOf(" a\n\n  b\tc "), "a b c");
assert.deepEqual(askBody("s1", "  why?  ", "> x"), {
  session: "s1",
  question: "why?",
  quote: "> x",
});
assert.deepEqual(askBody("s1", "", "p"), { session: "s1", question: "", quote: "p" });
// Quote lines: `> ` at a line's start is a quote, `>` elsewhere is not, and fenced code is skipped.
const one = (text: string) => quoteSpans([{ text, newLine: true }]);
assert.deepEqual(one("> Ask\nTest"), [
  { seg: 0, start: 0, end: 1, mark: true },
  { seg: 0, start: 1, end: 5, mark: false },
]);
assert.deepEqual(one("a > b\nx >= 5\n->"), [], "a > mid-line is not a quote");
assert.deepEqual(one(">5 items"), [], "no space after the marker: plain");
assert.deepEqual(
  one(">\n"),
  [{ seg: 0, start: 0, end: 1, mark: true }],
  "a bare > line is part of a quote",
);
assert.deepEqual(one("```\n> npm test\n```\n> real"), [
  { seg: 0, start: 19, end: 20, mark: true },
  { seg: 0, start: 20, end: 25, mark: false },
]);
assert.deepEqual(
  quoteSpans([
    { text: "> one ", newLine: true },
    { text: "two\n", newLine: false },
    { text: "> three", newLine: false },
  ]),
  [
    { seg: 0, start: 0, end: 1, mark: true },
    { seg: 0, start: 1, end: 6, mark: false },
    { seg: 1, start: 0, end: 3, mark: false },
    { seg: 2, start: 0, end: 1, mark: true },
    { seg: 2, start: 1, end: 7, mark: false },
  ],
  "a line carries across segments, and a segment ending on a newline starts the next line",
);
assert.deepEqual(
  quoteSpans([
    { text: "> a", newLine: true },
    { text: "b", newLine: true },
  ]),
  [
    { seg: 0, start: 0, end: 1, mark: true },
    { seg: 0, start: 1, end: 3, mark: false },
  ],
  "a new paragraph ends the quote line",
);
assert.deepEqual(quoteBlocks("> Ask\nTest"), [
  { quote: true, text: "Ask" },
  { quote: false, text: "Test" },
]);
assert.deepEqual(quoteBlocks("hi\n\n> a\n>\n> b\nafter"), [
  { quote: false, text: "hi\n" },
  { quote: true, text: "a\n\nb" },
  { quote: false, text: "after" },
]);
assert.deepEqual(quoteBlocks("```\n> x\n```"), [{ quote: false, text: "```\n> x\n```" }]);
assert.deepEqual(quoteBlocks("a > b"), [{ quote: false, text: "a > b" }]);
console.log("selection ok");
