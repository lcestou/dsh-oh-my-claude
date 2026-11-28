import assert from "node:assert/strict";
import { createHighlightRegistry, HIGHLIGHT_RULES, highlightCss } from "./ultrathink.js";

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

// The registry the painter writes through, against a Map standing in for CSS.highlights.
{
  // The registry only carries the value into the target, so a symbol stands in for a Highlight.
  const target = new Map<string, symbol>();
  const sheets: Array<string> = [];
  const h = Symbol("highlight");
  const reg = createHighlightRegistry(target, (css) => sheets.push(css));
  const last = () => sheets.at(-1) ?? "";
  assert.equal(last(), "", "nothing registered: an empty sheet");
  reg.set("omc-rainbow-0", h);
  reg.set("omc-quote", h);
  assert.ok(last().includes("omc-rainbow-0") && last().includes("omc-quote"));
  const writes = sheets.length;
  reg.set("omc-rainbow-0", h);
  assert.equal(sheets.length, writes, "a name already ruled does not rewrite the sheet");
  // The sweep: shimmer names come and go, and the sheet keeps their rules meanwhile.
  reg.set("omc-rainbow-s0", h);
  reg.delete("omc-rainbow-s0");
  assert.ok(last().includes("omc-rainbow-s0"), "a shimmer name leaving does not shrink the sheet");
  // The rainbow switched off while a quote stays: its rules go, the quote's stay.
  reg.delete("omc-rainbow-0");
  assert.ok(!last().includes("omc-rainbow"), "rainbow rules go with the rainbow");
  assert.ok(last().includes("omc-quote"), "the quote rule stays while the quote paints");
  reg.delete("omc-quote");
  assert.equal(last(), "", "the last of ours going empties the sheet");
  assert.equal(reg.delete("omc-quote"), false, "deleting twice answers false");
  // A hot reload: the new registry starts from what the old bundle left registered.
  target.set("omc-quote-mark", h);
  const again: Array<string> = [];
  createHighlightRegistry(target, (css) => again.push(css));
  assert.ok(again[0]?.includes("omc-quote-mark"), "rules for highlights already painting");
}

console.log("highlight rules ok");
