import assert from "node:assert/strict";
import { PHONE_CSS, PHONE_MAX } from "./phone-style.js";

// Every rule sits inside one of the two media queries: a rule at the top level would reach the
// desktop, which the phone pass promised to leave as it was.
const allowed = ["@media (pointer: coarse) {", `@media (max-width: ${PHONE_MAX}px) {`];
let depth = 0;
for (const line of PHONE_CSS.split("\n")) {
  const text = line.trim();
  if (text.startsWith("@media")) {
    assert.equal(depth, 0, `nested media query: ${text}`);
    assert.ok(allowed.includes(text), `unexpected media query: ${text}`);
    depth = 1;
  } else if (text === "}") {
    assert.equal(depth, 1, "a closing brace with no media query open");
    depth = 0;
  } else {
    assert.equal(depth, 1, `rule outside a phone media query: ${text}`);
    assert.ok(text.endsWith("}"), `one rule per line: ${text}`);
  }
}
assert.equal(depth, 0, "a media query left open");
// The layout line is the one the panel's useNarrow draws.
assert.equal(PHONE_MAX, 640);
// dsh's switches keep dsh's size.
assert.ok(PHONE_CSS.includes(':not([role="switch"])'));
