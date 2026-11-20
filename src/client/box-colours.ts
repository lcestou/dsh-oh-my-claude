// Box colours: each box tints its Claude model names (the picker rows and the composer's model
// chip, both dsh's `renderModelLabel` span with `data-provider-id`) in a colour of its own, so a
// session shows at a glance which box it runs on. A box nobody picked a colour for gets a shade
// of the accent; a picked one is the hint `boxColour:<providerId>`. The pickers live in Boxes and
// in Customize (box-colour-swatch.tsx, which also keeps the sheet on the page); this module is
// the pure part: the colours and the sheet's text.
import { gated, hexToRgb, isColourInt, themeOf } from "./theme.js";

/** The default mount: This box's own login, which keeps the accent unless a colour is picked. */
export const THIS_BOX_PROVIDER = "claude-code";
/** The hint that holds a box's picked colour, a 0xRRGGBB number like `themeAccent`. */
export const boxColourKey = (provider: string): string => `boxColour:${provider}`;
/** A turn of the colour wheel between neighbouring boxes: the golden angle, so any number of
 *  boxes keeps the shades apart without a fixed palette running out. */
const STEP_DEGREES = 137.5;

/** `#rrggbb` from a stored hint; undefined for anything that is not a whole 0xRRGGBB number, so
 *  a broken hint falls back to the automatic shade instead of painting black. */
export function hexOf(n: boolean | number | undefined): string | undefined {
  return isColourInt(n) ? `#${n.toString(16).padStart(6, "0")}` : undefined;
}

/** Hue, saturation and lightness (0-360, 0-1, 0-1) of an `#rrggbb` colour. */
function hslOf(hex: string): [number, number, number] {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** One 0-1 channel as two hex digits. */
const byte = (v: number): string =>
  Math.round(v * 255)
    .toString(16)
    .padStart(2, "0");

/** `#rrggbb` from hue, saturation and lightness, the inverse of `hslOf`. */
function hexOfHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${byte(f(0))}${byte(f(8))}${byte(f(4))}`;
}

/** The automatic colour of the `index`-th box after This box: the accent's hue turned by the
 *  golden angle per step, its saturation and lightness kept, so every shade reads as well as the
 *  accent does on dsh's light and dark backgrounds. A grey accent has no hue to turn and comes
 *  back as itself; nothing then tells the boxes apart but a picked colour. */
export function autoShade(accent: string, index: number): string {
  const [h, s, l] = hslOf(accent);
  return hexOfHsl((h + STEP_DEGREES * (index + 1)) % 360, s, l);
}

/**
 * Every box's colour, by provider id. This box is the accent unless a colour is picked for it;
 * every other box is its picked colour or its automatic shade, numbered in provider-id order so
 * a box keeps its shade in every tab and on every device whatever order the list arrives in.
 */
export function boxColours(
  hints: Record<string, boolean | number>,
  providers: readonly string[],
): Map<string, string> {
  const accent = themeOf(hints).accent;
  const others = [...new Set(providers)].filter((p) => p !== THIS_BOX_PROVIDER).toSorted();
  const out = new Map<string, string>();
  out.set(THIS_BOX_PROVIDER, hexOf(hints[boxColourKey(THIS_BOX_PROVIDER)]) ?? accent);
  others.forEach((p, i) => out.set(p, hexOf(hints[boxColourKey(p)]) ?? autoShade(accent, i)));
  return out;
}

/** A provider id safe inside a CSS attribute selector. Ids are `claude-code-<slug>`, so anything
 *  else is a mount this plugin did not name and gets no rule. */
const SAFE_ID = /^claude-code(-[a-z0-9-]+)?$/;

/**
 * The style sheet for the box colours: one rule per box on its label span, gated on the
 * "Claude model names" theme group so switching that group off removes these tints too. The
 * selector adds `[data-model-id]` to outrank the accent's prefix rule in turn-status.tsx without
 * `!important`. Empty when there is only This box at its default colour, which the accent rule
 * already paints.
 */
export function boxColourSheet(
  hints: Record<string, boolean | number>,
  providers: readonly string[],
): string {
  const colours = boxColours(hints, providers);
  const accent = themeOf(hints).accent;
  return [...colours]
    .filter(([p, c]) => SAFE_ID.test(p) && !(p === THIS_BOX_PROVIDER && c === accent))
    .map(
      ([p, c]) =>
        `${gated("models", `[data-provider-id="${p}"][data-model-id]`, false)}{color:${c}}`,
    )
    .join("");
}
