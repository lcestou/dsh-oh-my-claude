// Offline self-check: bun src/client/theme.test.ts. Pure, no DOM, no network.
import assert from "node:assert/strict";
import { themeOf, hexToRgb, THEME_GROUPS } from "./theme.js";

assert.deepEqual(themeOf({}), {
  groups: ["row", "prose", "send", "panel", "rainbow"],
  accent: "#d97757",
  shimmer: "#f59575",
});
assert.deepEqual(themeOf({ themeOff: true }).groups, []);
assert.deepEqual(themeOf({ themeProseOff: true }).groups, ["row", "send", "panel", "rainbow"]);
assert.deepEqual(themeOf({ themeRowOff: true, themeRainbowOff: true }).groups, [
  "prose",
  "send",
  "panel",
]);
assert.equal(themeOf({}).shimmer, "#f59575");
assert.equal(themeOf({ themeAccent: 0xd97757 }).shimmer, "#f59575");
assert.equal(themeOf({ themeAccent: 0x3366cc }).shimmer, "color-mix(in srgb, #3366cc 72%, white)");
assert.equal(themeOf({ themeAccent: 0x3366cc }).accent, "#3366cc");
assert.equal(themeOf({ themeAccent: 0x0066cc }).accent, "#0066cc");
assert.equal(themeOf({ themeAccent: -1 }).accent, "#d97757");
assert.equal(themeOf({ themeAccent: 0x1000000 }).accent, "#d97757");
assert.equal(themeOf({ themeAccent: 100.5 }).accent, "#d97757");
assert.equal(themeOf({ themeAccent: true }).accent, "#d97757");
assert.equal(themeOf({ themeOff: true, themeAccent: 0x3366cc }).accent, "#3366cc");
assert.deepEqual(hexToRgb("#d97757"), [217, 119, 87]);
assert.deepEqual(hexToRgb("#0066cc"), [0, 102, 204]);
assert.equal(THEME_GROUPS.length, 5);

console.log("theme.test.ts: ok");
