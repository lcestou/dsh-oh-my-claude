import assert from "node:assert/strict";
import { askBody, quoteSpans } from "./selection.js";

assert.deepEqual(askBody("s1", "  why?  ", "> x"), {
  session: "s1",
  question: "why?",
  quote: "> x",
});
assert.deepEqual(askBody("s1", "", "p"), { session: "s1", question: "", quote: "p" });
// Quote lines follow dsh's `messageQuoteRanges` (message-quotes/src/client/quote-text.ts).
const one = (text: string) => quoteSpans([{ text, newLine: true }]);
const m = (start: number, end: number, seg = 0) => ({ seg, start, end, mark: true });
const q = (start: number, end: number, seg = 0) => ({ seg, start, end, mark: false });
assert.deepEqual(one("> Ask\nTest"), [m(0, 2), q(2, 5)]);
assert.deepEqual(one(">5 items"), [m(0, 1), q(1, 8)], "no space after the marker is still a quote");
assert.deepEqual(one(">\tx"), [m(0, 2), q(2, 3)], "a tab after the marker is part of it");
assert.deepEqual(one("```\n> npm test\n```"), [m(4, 6), q(6, 14)], "fences are not special");
assert.deepEqual(one("a > b\nx >= 5"), [], "a > mid-line is not a quote");
assert.deepEqual(one("    > x"), [], "four spaces is indented code");
assert.deepEqual(one(">"), [], "a lone > is blank");
assert.deepEqual(one("> \n>"), [], "a block of only markers is blank");
assert.deepEqual(one("  > first\n>second"), [m(2, 4), q(4, 9), m(10, 11), q(11, 17)]);
assert.deepEqual(
  one("> a\n>\n> b"),
  [m(0, 2), q(2, 3), m(4, 5), m(6, 8), q(8, 9)],
  "a bare > inside a block belongs to it",
);
assert.deepEqual(
  one("before\n\n> first\n> line\n\n> second\n\nafter"),
  [m(8, 10), q(10, 15), m(16, 18), q(18, 22), m(24, 26), q(26, 32)],
  "a blank line ends a block",
);
assert.deepEqual(
  quoteSpans([
    { text: "> one ", newLine: true },
    { text: "two\n", newLine: false },
    { text: "> three", newLine: false },
  ]),
  [m(0, 2), q(2, 6), q(0, 3, 1), m(0, 2, 2), q(2, 7, 2)],
  "a line carries across segments, and a segment ending on a newline starts the next line",
);
assert.deepEqual(
  quoteSpans([
    { text: "> a", newLine: true },
    { text: "b", newLine: true },
  ]),
  [m(0, 2), q(2, 3)],
  "a new paragraph ends the quote line",
);
assert.deepEqual(
  quoteSpans([
    { text: ">", newLine: true },
    { text: " x", newLine: false },
  ]),
  [m(0, 1), m(0, 1, 1), q(1, 2, 1)],
  "the marker may span segments",
);
assert.deepEqual(
  quoteSpans([
    { text: ">", newLine: true },
    { text: "> x", newLine: true },
  ]),
  [m(0, 1), m(0, 2, 1), q(2, 3, 1)],
  "paragraphs of quote lines form one block",
);
assert.deepEqual(
  quoteSpans([
    { text: ">", newLine: true },
    { text: "> ", newLine: true },
  ]),
  [],
  "a block of only markers across paragraphs is blank",
);
assert.deepEqual(
  quoteSpans([
    { text: "> a", newLine: true },
    { text: "", newLine: true },
    { text: ">", newLine: true },
  ]),
  [m(0, 2), q(2, 3)],
  "an empty paragraph parts two blocks, so the lone > after it stays plain",
);
assert.deepEqual(
  quoteSpans([
    { text: "", newLine: true },
    { text: "> a", newLine: true },
    { text: "", newLine: true },
    { text: "> b", newLine: true },
  ]),
  [m(0, 2, 1), q(2, 3, 1), m(0, 2, 3), q(2, 3, 3)],
  "empty segments take no span",
);
// A composer chip, as segsIn hands it over: U+FFFC before any `>`, empty after one.
assert.deepEqual(
  quoteSpans([
    { text: "\uFFFC", newLine: true },
    { text: "> x", newLine: false },
  ]),
  [],
  "a chip at the start of a line keeps it from opening with >",
);
assert.deepEqual(
  quoteSpans([
    { text: "> a ", newLine: true },
    { text: "", newLine: false },
    { text: " b", newLine: false },
  ]),
  [m(0, 2), q(2, 4), q(0, 2, 2)],
  "a chip inside a quote line takes no span",
);
console.log("selection ok");
