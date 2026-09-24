import assert from "node:assert/strict";
import { askBody, clampQuote, previewOf, QUOTE_MAX, quoteMarkdown } from "./selection.js";

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
console.log("selection ok");
