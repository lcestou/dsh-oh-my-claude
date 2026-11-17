import assert from "node:assert/strict";
import { HIGHLIGHT_RULES, highlightCss } from "./ultrathink.js";

// Only the names in play get a rule: every `::highlight()` rule in the page makes each style
// recalc work out every element's highlight styles, so an empty set must write nothing at all.
assert.equal(highlightCss([]), "");
assert.equal(
  highlightCss(["someone-else", "omc-unknown"]),
  "",
  "names that are not ours write nothing",
);
const two = highlightCss(["omc-rainbow-s1", "omc-rainbow-0"]);
assert.equal(
  two,
  `::highlight(omc-rainbow-0){${HIGHLIGHT_RULES["omc-rainbow-0"]}}::highlight(omc-rainbow-s1){${HIGHLIGHT_RULES["omc-rainbow-s1"]}}`,
  "sorted, so the same set always writes the same text",
);
assert.equal(highlightCss(new Set(["omc-rainbow-0", "omc-rainbow-s1"])), two, "any iterable");
// Every name the painter registers has a rule: seven colours and ultracode, their shimmer shades,
// and the two quote names.
assert.equal(Object.keys(HIGHLIGHT_RULES).length, 18);
assert.ok(highlightCss(["omc-quote"]).includes("::highlight(omc-quote)"));
console.log("highlight rules ok");
