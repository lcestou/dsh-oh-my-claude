import assert from "node:assert/strict";
import { clampQuote, previewOf, QUOTE_MAX, quoteMarkdown } from "./selection.js";

assert.equal(quoteMarkdown("one"), "> one\n\n");
assert.equal(quoteMarkdown("a\r\n\r\nb"), "> a\n>\n> b\n\n");
assert.equal(quoteMarkdown("  x\n\t\n"), ">   x\n>\n>\n\n");
assert.deepEqual(clampQuote("abc"), { text: "abc", trimmed: false });
const long = "z".repeat(QUOTE_MAX + 5);
assert.deepEqual(clampQuote(long), { text: "z".repeat(4000), trimmed: true });
assert.equal(previewOf(" a\n\n  b\tc "), "a b c");
console.log("selection ok");
