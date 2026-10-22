// The context nudge's threshold and the Run button's prompt: pure helpers kept out of the
// client bundle's entry so the tests can import them without React or a DOM.

/** The context window's share the nudge card speaks up at. The CLI's own auto-compact sits far
 *  higher (the window minus a 13k-token buffer, about 99% at a million), which lands wherever
 *  the work is; this is the point where the next prompt already carries most of a window and a
 *  compaction at a break costs less than one mid-task. */
export const COMPACT_AT = 75;
/** The thresholds the settings picker offers; a stored value outside this list still works, it
 *  just shows as whatever the browser picks for an unlisted option value. */
export const COMPACT_AT_CHOICES = [50, 60, 70, 75, 80, 90];
/** The threshold a box set through the `compactNudgeAt` hint, or the default: a percent between
 *  1 and 100, so a cleared or malformed hint (true, NaN, 0, 250) falls back rather than silencing
 *  the card or showing it on an empty session. */
export const compactThreshold = (stored: boolean | number | undefined): number => {
  // Number.isFinite does not coerce, so a `true` (which Number() would read as 1%) falls back.
  if (!Number.isFinite(stored)) return COMPACT_AT;
  const pct = Number(stored);
  return pct >= 1 && pct <= 100 ? pct : COMPACT_AT;
};

/** Fence labels dsh shows for a shell snippet; anything else gets no Run button. */
export const SHELL_LANGS = new Set(["bash", "sh", "zsh", "shell", "console", "shellsession"]);
/** What Claude reads above the snippet; not translated, like every prompt. */
export const RUN_PROMPT = "Run this:";
/** The prompt the Run button writes into the composer: the snippet fenced under `RUN_PROMPT`.
 *  The fence is one backtick longer than the longest run of backticks inside the snippet, so a
 *  heredoc or a nested markdown block in the command cannot end the fence early and send half
 *  the snippet as prose. */
export function runDraft(lang: string, snippet: string): string {
  const longest = Math.max(2, ...[...snippet.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${RUN_PROMPT}\n${fence}${lang}\n${snippet}\n${fence}`;
}
