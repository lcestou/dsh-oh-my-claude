export const THEME_GROUPS = ["row", "prose", "send", "panel", "rainbow"] as const;
export type ThemeGroup = (typeof THEME_GROUPS)[number];
export const THEME_DEFAULT_ACCENT = 0xd97757;

const OFF_KEY = {
  row: "themeRowOff",
  prose: "themeProseOff",
  send: "themeSendOff",
  panel: "themePanelOff",
  rainbow: "themeRainbowOff",
} satisfies Record<ThemeGroup, string>;

const isColourInt = (v: boolean | number | undefined): v is number =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 0xffffff;

type ThemeResult = { groups: ThemeGroup[]; accent: string };

/** Hints in, body tokens and accent out. Absent keys mean on and the default colour. */
export function themeOf(hints: Record<string, boolean | number>): ThemeResult {
  const n = isColourInt(hints.themeAccent) ? hints.themeAccent : THEME_DEFAULT_ACCENT;
  const accent = "#" + n.toString(16).padStart(6, "0");

  if (hints.themeOff === true) {
    return { groups: [], accent };
  }

  const groups = THEME_GROUPS.filter((g) => hints[OFF_KEY[g]] !== true);
  return { groups, accent };
}

/** "#rrggbb" (lower case, six digits) to its channels. */
export function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
