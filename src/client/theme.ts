export const THEME_GROUPS = [
  "row",
  "prose",
  "composer",
  "models",
  "send",
  "panel",
  "rainbow",
] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];
export const THEME_DEFAULT_ACCENT = 0xd97757;

const OFF_KEY = {
  row: "themeRowOff",
  prose: "themeProseOff",
  composer: "themeComposerOff",
  models: "themeModelsOff",
  send: "themeSendOff",
  panel: "themePanelOff",
  rainbow: "themeRainbowOff",
} satisfies Record<ThemeGroup, string>;

/** True only when the value is an integer in the 0 to 0xffffff range, so a boolean, a fraction or
 *  an out-of-range number is rejected as a hex accent and the default is used instead. */
const isColourInt = (v: boolean | number | undefined): v is number =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffff;

type ThemeResult = { groups: ThemeGroup[]; accent: string; shimmer: string; shimmerDark: string };

/** Hints in, body tokens and accent out. Absent keys mean on and the default colour. */
export function themeOf(hints: Record<string, boolean | number>): ThemeResult {
  const n = isColourInt(hints.themeAccent) ? hints.themeAccent : THEME_DEFAULT_ACCENT;
  const accent = "#" + n.toString(16).padStart(6, "0");
  // The CLI's two shimmers (2.1.280 theme table, `dO`: `v` is light, `B` is dark): rgb(245,149,117)
  // on its light theme, rgb(235,159,127) on its dark one, the dark closer to the accent so the sweep
  // does not blow out against a dark page. A custom accent has no CLI value, so its dark mix keeps
  // more of the accent by the same margin.
  const shimmer = accent === "#d97757" ? "#f59575" : `color-mix(in srgb, ${accent} 72%, white)`;
  const shimmerDark = accent === "#d97757" ? "#eb9f7f" : `color-mix(in srgb, ${accent} 80%, white)`;

  if (hints.themeOff === true) {
    return { groups: [], accent, shimmer, shimmerDark };
  }

  const groups = THEME_GROUPS.filter((g) => hints[OFF_KEY[g]] !== true);
  return { groups, accent, shimmer, shimmerDark };
}

/** "#rrggbb" (lower case, six digits) to its channels. */
export function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Marker hint for the one-time split below; a number, because the store drops `false`. */
const SPLIT_MARK = "themeSplit";

/**
 * The hints that carry an old "Links, rules and quotes" off switch over to the two groups split out
 * of it (the composer's command text, chips and cursor, and the model names in the picker), or null
 * when there is nothing to write. Without it, someone who had turned that group off would see the
 * composer and the picker turn orange again after the split. Runs once per box: the marker is
 * written either way, so ticking the old group back on later never re-copies a stale off.
 */
export function themeSplitPatch(
  hints: Record<string, boolean | number>,
): Record<string, boolean | number> | null {
  if (hints[SPLIT_MARK] !== undefined) return null;
  if (hints.themeProseOff !== true) return { [SPLIT_MARK]: 1 };
  return { themeComposerOff: true, themeModelsOff: true, [SPLIT_MARK]: 1 };
}
