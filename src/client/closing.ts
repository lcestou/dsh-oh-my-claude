// The line a finished Claude turn keeps in its header, the way the CLI ends one in the terminal:
// `✻ Crunched for 27s · done 3:21 AM`. Everything here is read off dsh's own finished turn, so a
// reload draws the same line the live turn ended with.

/** The CLI's own closing verbs, in its order (Claude Code 2.1.281: `var ag=["Baked", … "Worked"]`).
 *  Re-read on a CLI update; the minified name changes, the words have not so far. */
export const CLOSING_VERBS = [
  "Baked",
  "Brewed",
  "Churned",
  "Cogitated",
  "Cooked",
  "Crunched",
  "Sautéed",
  "Worked",
];
/** The same eight in the register the Chinese spinner verbs use: kitchen and workshop, past tense. */
export const ZH_CLOSING_VERBS = [
  "烘焙了",
  "酿造了",
  "翻搅了",
  "琢磨了",
  "烹调了",
  "运算了",
  "煸炒了",
  "忙活了",
];

/**
 * One verb per turn, stable across reloads: the CLI's own string hash (`e=(e<<5)-e+c|0`) of `key`,
 * modulo the list. The CLI hashes a message uuid the page never sees, so the pick does not match the
 * terminal's for the same turn; it only has to stay put for this one.
 */
export const closingVerb = (key: string, verbs: readonly string[]): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return verbs[(h >>> 0) % verbs.length] ?? verbs[0] ?? "";
};

/**
 * The duration out of dsh's finished-turn label: `Took 38s` in English, `用时 38s` in Chinese (dsh's
 * `message.turnProcess.took`). Undefined for anything else, which is how a running turn's label
 * ("Deep diving for 12s") and a dsh that reworded the template both read: not finished, leave it.
 */
export const tookDuration = (label: string): string | undefined => {
  const m = /^(?:Took|用时)\s*(\S.*)$/.exec(label.trim());
  return m?.[1]?.trim();
};

/**
 * dsh's message clock (`03:33` today, a date and `03:33` on another day) in the CLI's form for
 * English (`3:33 AM`); `zh` keeps dsh's 24-hour clock, which is how Chinese reads a time. Anything
 * that does not end in `HH:MM` comes back unchanged.
 */
export const clockText = (dshClock: string, zh: boolean): string => {
  const m = /^(.*?)(\d{1,2}):(\d{2})$/.exec(dshClock.trim());
  if (m === null || zh) return dshClock.trim();
  const [, before = "", hh = "0", mm = "00"] = m;
  const h = Number(hh);
  return `${before}${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
};
