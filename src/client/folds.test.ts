// Offline self-check: bun src/client/folds.test.ts. No DOM, no network.
// The fold scan claims a paragraph as a tool header from its leading glyph. A person who pastes a
// line opening with `❯` or `◆` had that character eaten and the code block under it folded away,
// so the translator writes an invisible mark behind its own glyphs — but the client cannot simply
// demand the mark, because it hot-reloads into a tab whose server half is still the older build.
// These cases pin the switch: bare glyphs claim until a marked header proves the writer marks them.
import { strict as assert } from "node:assert";

// The predicate reads Node.TEXT_NODE, which bun has no DOM to supply.
// SAFETY: the fake stands in for the DOM constant the browser would provide.
(globalThis as unknown as { Node: { TEXT_NODE: number } }).Node = { TEXT_NODE: 3 };

const { glyphOf } = await import("./index.js");

const MARK = "⁠";

/** The smallest header node `glyphOf` reads: its first text child and its own attributes. */
function head(text: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = {
    firstChild: { nodeType: 3, nodeValue: text },
    hasAttribute: (name: string) => name in attrs,
    getAttribute: (name: string) => attrs[name] ?? null,
    querySelector: () => null,
  };
  return node as unknown as HTMLElement;
}

// Before any marked header: the glyph alone claims the paragraph, which is what keeps a tab folding
// while the dsh process still holds the previous server build.
assert.equal(glyphOf(head("❯ Bash")), "❯");
assert.equal(glyphOf(head("  ▤ Read `src/x.ts`")), "▤");
// A paragraph that leads with anything else is never a header, marked or not.
assert.equal(glyphOf(head("npm test")), "");

// A marked header claims itself and says the running server writes marks.
assert.equal(glyphOf(head(`⌕${MARK} Grep`)), "⌕");

// From here on a bare glyph is prose: the pasted shell line keeps its `❯` and its block stays open.
assert.equal(glyphOf(head("❯ npm test")), "");
// An already-folding header keeps its glyph, so the switch never reopens a block on screen.
assert.equal(glyphOf(head("❯ Bash", { "data-omc-tool": "1" })), "❯");
// And a marked one still claims, whichever way it is written.
assert.equal(glyphOf(head(`⚙${MARK} Task`)), "⚙");

// A header whose glyph was already lifted into the icon span is read from the attribute the span
// carries, not from the text, so a repeat pass over a claimed header does not lose it.
const lifted = {
  firstChild: null,
  hasAttribute: () => false,
  getAttribute: () => null,
  querySelector: () => ({ getAttribute: () => "▤" }),
};
assert.equal(glyphOf(lifted as unknown as HTMLElement), "▤");

console.log("folds ok");
