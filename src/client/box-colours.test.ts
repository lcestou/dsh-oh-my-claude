// Offline self-check: bun src/client/box-colours.test.ts. The colours each box tints its Claude
// model names with, and the sheet that carries them.
import { strict as assert } from "node:assert";
import { autoShade, boxColourKey, boxColourSheet, boxColours, hexOf } from "./box-colours.js";
import { hexToRgb } from "./theme.js";

const ACCENT = "#d97757"; // the default accent, themeOf({}).accent

/** Lightness of an `#rrggbb` colour, 0-1, the way HSL measures it. */
const lightness = (hex: string): number => {
  const v = hexToRgb(hex).map((c) => c / 255);

  return (Math.max(...v) + Math.min(...v)) / 2;
};

// Shades: each step a different colour, none the accent, all as light as the accent.
const shades = [0, 1, 2, 3].map((i) => autoShade(ACCENT, i));

assert.equal(new Set(shades).size, 4, "every box gets its own shade");

assert.ok(!shades.includes(ACCENT), "no shade repeats This box's accent");

for (const s of shades) {
  assert.ok(Math.abs(lightness(s) - lightness(ACCENT)) < 0.02, `${s} keeps the accent's lightness`);
}

assert.equal(autoShade("#808080", 0), "#808080", "a grey accent has no hue to turn");

// hexOf takes only a whole 0xRRGGBB number.
assert.equal(hexOf(0x00_ff_00), "#00ff00");

assert.equal(hexOf(-1), undefined);

assert.equal(hexOf(0x1_00_00_00), undefined);

assert.equal(hexOf(true), undefined);

// Colours: This box is the accent, the others their shades in provider-id order, whatever order
// the list came in; a picked colour wins over both.
const providers = ["claude-code-zeta", "claude-code", "claude-code-work"];
const auto = boxColours({}, providers);

assert.equal(auto.get("claude-code"), ACCENT);

assert.equal(auto.get("claude-code-work"), autoShade(ACCENT, 0), "work sorts before zeta");

assert.equal(auto.get("claude-code-zeta"), autoShade(ACCENT, 1));

assert.deepEqual(boxColours({}, providers.toReversed()), auto, "the order of the list is moot");

const picked = boxColours(
  { [boxColourKey("claude-code-work")]: 0x33_66_ff, [boxColourKey("claude-code")]: 0x11_22_33 },
  providers,
);

assert.equal(picked.get("claude-code-work"), "#3366ff");

assert.equal(picked.get("claude-code"), "#112233");

assert.equal(picked.get("claude-code-zeta"), autoShade(ACCENT, 1), "a pick moves no other shade");

// A new accent moves the automatic shades with it.
assert.equal(
  boxColours({ themeAccent: 0x33_66_ff }, providers).get("claude-code-work"),
  autoShade("#3366ff", 0),
);

// Sheet: one rule per box other than This box at its default, each on its label span and gated
// on the "Claude model names" theme group.
const sheet = boxColourSheet({}, providers);

assert.equal(
  sheet.split("{color:").length - 1,
  2,
  "two boxes, two rules; This box keeps the accent rule",
);

assert.ok(sheet.includes('[data-provider-id="claude-code-work"][data-model-id]'));

assert.ok(sheet.includes('[data-omc-theme~="models"]'), "gated on the models group");

assert.ok(!sheet.includes('"claude-code"]'), "no rule for This box at the accent");

assert.ok(
  boxColourSheet({ [boxColourKey("claude-code")]: 0x11_22_33 }, providers).includes(
    '[data-provider-id="claude-code"][data-model-id]',
  ),
  "a colour picked for This box gets its own rule",
);

assert.equal(boxColourSheet({}, ["claude-code"]), "", "This box alone needs no sheet");

assert.ok(
  !boxColourSheet({}, ['x"]{}body{', "claude-code-ok"]).includes("body{"),
  "an odd id never reaches the sheet",
);

console.log("box-colours ok");
