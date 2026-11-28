// Plan-window history: one row per window a Claude login has had, with the highest percent seen in
// it and when it was first and last read. Pure, with no import at all, so the client bundle can
// import `seriesOf`, `typicalPercent` and the reply types; reading the file and keeping it is
// usage-history-store.ts's.

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
export const HISTORY_KEEP_MS = 90 * 86_400_000;

/** Rows kept per login however young: about 45 days of back-to-back 5-hour windows plus the weekly
 *  ones, so a login used round the clock cannot grow the file without bound. */
export const HISTORY_ROWS_MAX = 240;

/** Ended windows sent per series: twelve 5-hour windows, eight of every weekly kind. */
const showMax = (series: string): number => (series === "session" ? 12 : 8);

/** A series' window length for the `partial` test: 5 hours for the 5-hour series, a week for
 *  every other, since each other kind the API sends is weekly. */
const seriesMs = (series: string): number =>
  series === "session" ? 5 * 3_600_000 : 7 * 86_400_000;

/** Two readings of one window can name resets a minute or two apart: the endpoint answers a
 *  slightly different instant each time and the reader rounds to the minute, so 16:59:59.6 and
 *  17:00:00.2 can land either side of a minute. Resets this close are one window. */
export const SAME_WINDOW_MS = 120_000;

/** The series a window belongs to. A model-scoped weekly window is keyed by its model's display
 *  name, so a rename on Anthropic's side starts a new series rather than joining the old one. */
export const seriesOf = (w: HistoryWindow): string =>
  w.kind ?? (w.model ? `model:${w.model}` : `label:${w.label}`);

/**
 * Fold one fresh reply's windows into a login's rows; returns the new list, or the same array when
 * nothing changed (so the caller can skip the write). A window without a reset time is skipped,
 * since nothing names it. A reading joins the row of its series whose reset is within
 * `SAME_WINDOW_MS` of its own, and the row keeps the reset it was first seen with. A reading older than the row's last one is ignored, so a slow read that
 * lands after a newer one cannot lower `lastAt`. Rows past `HISTORY_KEEP_MS` or beyond
 * `HISTORY_ROWS_MAX` are dropped, oldest first.
 */
export function recordWindows(
  rows: Array<HistoryRow>,
  windows: ReadonlyArray<HistoryWindow>,
  fetchedAt: number,
): Array<HistoryRow> {
  let next: Array<HistoryRow> | undefined;

  for (const w of windows) {
    if (w.resetsAt === null) {
      continue;
    }

    const series = seriesOf(w);
    const list = next ?? rows;
    const at = w.resetsAt;

    const i = list.findIndex(
      (r) => r.series === series && Math.abs(r.resetsAt - at) <= SAME_WINDOW_MS,
    );

    const pct = Math.round(w.usedPercent);
    const r = i === -1 ? undefined : list[i];

    if (r === undefined) {
      next = [
        ...list,
        { series, resetsAt: w.resetsAt, peak: pct, firstAt: fetchedAt, lastAt: fetchedAt },
      ];
      continue;
    }

    if (fetchedAt <= r.lastAt) {
      continue;
    }

    next = [...list];
    next[i] = { ...r, peak: Math.max(r.peak, pct), lastAt: fetchedAt };
  }

  if (!next) {
    return rows;
  }

  const floor = fetchedAt - HISTORY_KEEP_MS;
  const kept = next.filter((r) => r.resetsAt >= floor).toSorted((a, b) => a.resetsAt - b.resetsAt);

  return kept.slice(-HISTORY_ROWS_MAX);
}

/**
 * The ended windows of each series, oldest first. A window has ended when its reset is past, or
 * when a later window of the same series exists (Anthropic reset it early, so the old reset time
 * never arrives). It really ended at its reset or when the next window was first seen, whichever
 * came first, and `partial` is measured against that end: an early-reset window read up to the
 * moment it was replaced is not partial. Every series the rows know is present, empty when none
 * of its windows has ended.
 */
export function historyView(rows: ReadonlyArray<HistoryRow>, now: number): UsageHistory {
  const bySeries = new Map<string, Array<HistoryRow>>();

  for (const r of rows) {
    bySeries.set(r.series, [...(bySeries.get(r.series) ?? []), r]);
  }

  return Object.fromEntries(
    [...bySeries].map(([series, list]) => [series, endedOf(series, list, now)]),
  );
}

/** One series' ended windows, oldest first, at most `showMax` of them; see `historyView` for when
 *  a window counts as ended and how `partial` is measured. */
function endedOf(
  series: string,
  rows: ReadonlyArray<HistoryRow>,
  now: number,
): Array<HistoryEnded> {
  const list = rows.toSorted((a, b) => a.resetsAt - b.resetsAt);
  const len = seriesMs(series);
  const ended: Array<HistoryEnded> = [];
  list.forEach((r, i) => {
    const next = list[i + 1];

    if (r.resetsAt > now && !next) {
      return;
    }

    const end = next ? Math.min(r.resetsAt, next.firstAt) : r.resetsAt;
    ended.push({ resetsAt: r.resetsAt, percent: r.peak, partial: end - r.lastAt > len / 10 });
  });

  return ended.slice(-showMax(series));
}

/** Every login's rows with those whose reset is older than `HISTORY_KEEP_MS` before `now` taken
 *  out; a login left with none is dropped. Answers the same map when nothing went. */
export function pruneLogins(
  logins: ReadonlyMap<string, Array<HistoryRow>>,
  now: number,
): Map<string, Array<HistoryRow>> {
  const floor = now - HISTORY_KEEP_MS;
  const out = new Map<string, Array<HistoryRow>>();
  let changed = false;

  for (const [key, rows] of logins) {
    const kept = rows.filter((r) => r.resetsAt >= floor);

    if (kept.length !== rows.length) {
      changed = true;
    }

    if (kept.length) {
      out.set(key, kept);
    }
  }

  return changed ? out : new Map(logins);
}

/** The median end percent of at least three ended windows, rounded; undefined below three, where a
 *  "typical" figure would be one window's figure under another name. Partial windows count at the
 *  percent last read, which pulls the median down a little when many were read early. */
export function typicalPercent(list: ReadonlyArray<HistoryEnded>): number | undefined {
  if (list.length < 3) {
    return undefined;
  }

  const p = list.map((e) => e.percent).toSorted((a, b) => a - b);
  const mid = p.length >> 1;
  const below = p[mid - 1];
  const at = p[mid];

  // Never undefined with three or more values; the check only types them.
  if (below === undefined || at === undefined) {
    return undefined;
  }

  return Math.round(p.length % 2 ? at : (below + at) / 2);
}
