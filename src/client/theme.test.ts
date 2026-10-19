// Offline self-check: bun src/client/theme.test.ts. Pure, no DOM, no network.
import assert from "node:assert/strict";
import { themeOf, themeSplitPatch, hexToRgb, THEME_GROUPS } from "./theme.js";

assert.deepEqual(themeOf({}), {
  groups: ["row", "prose", "composer", "models", "send", "panel", "rainbow"],
  accent: "#d97757",
  shimmer: "#f59575",
  shimmerDark: "#eb9f7f",
});
assert.deepEqual(themeOf({ themeOff: true }).groups, []);
assert.deepEqual(themeOf({ themeProseOff: true }).groups, [
  "row",
  "composer",
  "models",
  "send",
  "panel",
  "rainbow",
]);
assert.deepEqual(themeOf({ themeRowOff: true, themeRainbowOff: true }).groups, [
  "prose",
  "composer",
  "models",
  "send",
  "panel",
]);
// Each split group turns off alone.
assert.deepEqual(themeOf({ themeModelsOff: true }).groups.includes("models"), false);
assert.deepEqual(themeOf({ themeModelsOff: true }).groups.includes("prose"), true);
assert.deepEqual(themeOf({ themeComposerOff: true }).groups.includes("composer"), false);
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
assert.equal(THEME_GROUPS.length, 7);

console.log("theme.test.ts: ok");

// The CLI's dark-theme shimmer for the default accent; a closer white mix for a custom one.
{
  assert.equal(themeOf({}).shimmerDark, "#eb9f7f");
  assert.equal(
    themeOf({ themeAccent: 0x3366cc }).shimmerDark,
    "color-mix(in srgb, #3366cc 80%, white)",
  );
  console.log("shimmer-dark ok");
}

// The one-time split: an old "Links, rules and quotes" off carries over to the two groups taken out
// of it, the marker is written either way, and a box that already split is left alone.
{
  assert.deepEqual(themeSplitPatch({ themeProseOff: true }), {
    themeComposerOff: true,
    themeModelsOff: true,
    themeSplit: 1,
  });
  assert.deepEqual(themeSplitPatch({}), { themeSplit: 1 });
  assert.equal(themeSplitPatch({ themeSplit: 1 }), null);
  assert.equal(themeSplitPatch({ themeSplit: 1, themeProseOff: true }), null);
  console.log("theme split ok");
}
