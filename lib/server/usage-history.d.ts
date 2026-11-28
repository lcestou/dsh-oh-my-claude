/** One window of one login, as far as this box saw it. */
export interface HistoryRow {
    /** Which run of windows this belongs to: `session`, `weekly`, or `model:<name>` (see `seriesOf`). */
    series: string;
    /** The window's reset, epoch ms rounded to the minute by the usage reader; with `series` it names
     *  the window. */
    resetsAt: number;
    /** Highest percent read in this window. Usage only climbs inside a window, so this is also the
     *  last reading. */
    peak: number;
    /** `fetchedAt` of the first and the last reply that carried this window. */
    firstAt: number;
    lastAt: number;
}
/** The file under STATE_DIR: rows per login key, oldest first. */
export interface HistoryFile {
    version: 1;
    logins: Record<string, Array<HistoryRow>>;
}
/** One ended window as the popover draws it. */
export interface HistoryEnded {
    resetsAt: number;
    percent: number;
    /** The last read came more than a tenth of the window before its end, so the window may have
     *  ended higher than `percent`. */
    partial: boolean;
}
/** What the usage route adds to an ok reply: ended windows per series, oldest first, at most
 *  `SHOW_MAX` each. Every list empty means nothing has ended yet since recording began. */
export type UsageHistory = Record<string, Array<HistoryEnded>>;
/** The part of a usage window the history reads. */
export interface HistoryWindow {
    label: string;
    usedPercent: number;
    resetsAt: number | null;
    model?: string;
    kind?: "session" | "weekly";
}
/** Rows whose reset is older than this are dropped from every login each time the store writes,
 *  so a login nobody uses any more ages out too. */
export declare const HISTORY_KEEP_MS: number;
/** Rows kept per login however young: about 45 days of back-to-back 5-hour windows plus the weekly
 *  ones, so a login used round the clock cannot grow the file without bound. */
export declare const HISTORY_ROWS_MAX = 240;
/** Two readings of one window can name resets a minute or two apart: the endpoint answers a
 *  slightly different instant each time and the reader rounds to the minute, so 16:59:59.6 and
 *  17:00:00.2 can land either side of a minute. Resets this close are one window. */
export declare const SAME_WINDOW_MS = 120000;
/** The series a window belongs to. A model-scoped weekly window is keyed by its model's display
 *  name, so a rename on Anthropic's side starts a new series rather than joining the old one. */
export declare const seriesOf: (w: HistoryWindow) => string;
/**
 * Fold one fresh reply's windows into a login's rows; returns the new list, or the same array when
 * nothing changed (so the caller can skip the write). A window without a reset time is skipped,
 * since nothing names it. A reading joins the row of its series whose reset is within
 * `SAME_WINDOW_MS` of its own, and the row keeps the reset it was first seen with. A reading older than the row's last one is ignored, so a slow read that
 * lands after a newer one cannot lower `lastAt`. Rows past `HISTORY_KEEP_MS` or beyond
 * `HISTORY_ROWS_MAX` are dropped, oldest first.
 */
export declare function recordWindows(rows: Array<HistoryRow>, windows: ReadonlyArray<HistoryWindow>, fetchedAt: number): Array<HistoryRow>;
/**
 * The ended windows of each series, oldest first. A window has ended when its reset is past, or
 * when a later window of the same series exists (Anthropic reset it early, so the old reset time
 * never arrives). It really ended at its reset or when the next window was first seen, whichever
 * came first, and `partial` is measured against that end: an early-reset window read up to the
 * moment it was replaced is not partial. Every series the rows know is present, empty when none
 * of its windows has ended.
 */
export declare function historyView(rows: ReadonlyArray<HistoryRow>, now: number): UsageHistory;
/** Every login's rows with those whose reset is older than `HISTORY_KEEP_MS` before `now` taken
 *  out; a login left with none is dropped. Answers the same map when nothing went. */
export declare function pruneLogins(logins: ReadonlyMap<string, Array<HistoryRow>>, now: number): Map<string, Array<HistoryRow>>;
/** The median end percent of at least three ended windows, rounded; undefined below three, where a
 *  "typical" figure would be one window's figure under another name. Partial windows count at the
 *  percent last read, which pulls the median down a little when many were read early. */
export declare function typicalPercent(list: ReadonlyArray<HistoryEnded>): number | undefined;
