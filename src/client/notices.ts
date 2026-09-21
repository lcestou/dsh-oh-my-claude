// A notice when a session the browser is not showing stops working and waits for the user. The
// transition logic is here, away from the DOM, so it can be checked without a page.
import { t } from "./i18n.js";

/** The three fields of dsh's `SessionSummary` this needs. */
export interface NoticeRow {
  running?: boolean;
  /** dsh's own bit: finished while not selected and not yet opened. */
  completed?: boolean;
  displayTitle?: string;
}
export interface NoticeSnapshot {
  byId: Record<string, NoticeRow>;
  current?: string;
}

/**
 * Sessions that went from working to waiting since the last snapshot, minus the one on screen.
 * The first snapshot of a page load is the baseline and never fires: everything already finished
 * would otherwise arrive as news the moment the tab opens.
 */
export function newlyWaiting(prev: NoticeSnapshot | null, next: NoticeSnapshot): string[] {
  if (prev === null) return [];
  const out: string[] = [];
  for (const id of Object.keys(next.byId)) {
    if (id === next.current) continue;
    const was = prev.byId[id];
    const now = next.byId[id];
    // A session that arrived with this snapshot has no transition to report yet.
    if (was === undefined || now === undefined) continue;
    const stopped = was.running === true && now.running !== true;
    const finished = now.completed === true && was.completed !== true;
    if (stopped || finished) out.push(id);
  }
  return out;
}

/** What kind of answer a session is waiting for. */
export type AwaitingKind = "approval" | "question" | "plan";

/** One session's open prompt, as the adapter reports it. */
export interface AwaitingRow {
  id: string;
  kind: AwaitingKind;
}

/**
 * Background sessions that newly began waiting for an answer since the last tick: present in
 * `next`, not the same open prompt as last tick (compared by request id, so a prompt re-asked
 * under a new id is news again), and not the one on screen.
 *
 * The first poll of a page load is the baseline and never fires, the same rule `newlyWaiting`
 * follows: without it, reloading the page while a prompt is open re-announces a question the
 * person is already looking at.
 */
export function newlyAwaiting(
  prev: Readonly<Record<string, AwaitingRow>> | null,
  next: Readonly<Record<string, AwaitingRow>>,
  current: string | undefined,
): string[] {
  if (prev === null) return [];
  const out: string[] = [];
  for (const [id, row] of Object.entries(next)) {
    if (id === current) continue;
    const was = prev[id];
    if (was !== undefined && was.id === row.id) continue;
    out.push(id);
  }
  return out;
}

/** The desktop-notice body for each kind of wait. */
export const awaitingBody = (kind: AwaitingKind): string =>
  kind === "question"
    ? t("notice.question")
    : kind === "plan"
      ? t("notice.plan")
      : t("notice.approval");

/** The one return shape `recapNext` uses. Kept narrow so the caller reads what it gets without a
 *  widening cast. */
export interface RecapStep {
  /** Session id to the moment it stopped working, so a return can tell a walk away from a glance. */
  pending: Record<string, number>;
  fire?: string;
}

/**
 * How long a session must have sat finished before returning to it earns a recap, unless the
 * dropdown in Settings says otherwise. Five minutes, the same bar the CLI's own away summary uses ("shown when you return after being away for 5+ minutes",
 * `awaySummaryEnabled` in claude 2.1.270). Below it you already know what you left, and the recap is
 * a model call.
 */
export const RECAP_AWAY_MS = 5 * 60_000;

/** What the settings dropdown offers, with `RECAP_AWAY_MS` among them as the default. */
export const RECAP_AWAY_CHOICES = [60_000, RECAP_AWAY_MS, 15 * 60_000, 30 * 60_000, 60 * 60_000];

/**
 * The recap queue after this snapshot, and the session to recap now. A session joins the queue when
 * it stops working while unselected, and leaves it when it becomes the one on screen: that is the
 * return the recap is named for. Leaving the queue is not the same as firing, though. A return
 * inside `awayMs` drops the entry silently, because flicking to another tab and back is not
 * being away. Never persisted, so a reload forgets: a recap of work from before a page load is
 * history, not a return.
 */
export function recapNext(
  pending: Readonly<Record<string, number>>,
  waiting: readonly string[],
  current: string | undefined,
  now: number,
  awayMs: number,
): RecapStep {
  const next = { ...pending };
  for (const id of waiting) if (id !== current) next[id] ??= now;
  if (current !== undefined) {
    const since = next[current];
    delete next[current];
    if (since !== undefined && now - since >= awayMs) return { pending: next, fire: current };
  }
  return { pending: next };
}

/**
 * The recap's two settings live in the box-wide hints store, like every other row of the settings
 * section and unlike the notices toggle below, which is browser-local because the notification
 * permission it depends on is. Nothing here is per-browser: the answer lands in the Asides ring,
 * which is the box's, so whether to spend the call is the box's question too.
 *
 * Reading them is a pure function of a hints object so this module stays free of both the store and
 * the DOM. `recapOn` absent means off, which is the default a feature that bills a model call gets.
 */
export const recapOnIn = (hints: Record<string, boolean | number>): boolean =>
  hints.recapOn === true;

/**
 * The chosen bar from the stored value, falling back to the default for anything that is not one of
 * the offered choices: unset, a stale choice from an older build, or the wrong kind entirely
 * (`Number` sends a boolean to 0 or 1, neither of which is offered).
 */
export const recapAwayIn = (stored: boolean | number | undefined): number => {
  const ms = Number(stored);
  return RECAP_AWAY_CHOICES.includes(ms) ? ms : RECAP_AWAY_MS;
};

/**
 * What the recap asks, lifted from the CLI's own away summary (claude 2.1.270) so a recap here reads
 * like a recap there. The word budget keeps it inside the two-line card, "no markdown" matters
 * because the bubble renders plain text, and the next action is the part worth reading on return.
 */
export const RECAP_QUESTION =
  "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no " +
  "markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause " +
  "narrative, fix internals, secondary to-dos, and em-dash tangents.";

const MARK = "● ";

/** The tab title with one mark while any session waits, and without it when none does. */
export const markTitle = (title: string, waiting: number): string =>
  waiting > 0 ? MARK + stripMark(title) : stripMark(title);

/** dsh rewrites the title as the session changes, so the mark is stripped before it is re-applied. */
export const stripMark = (title: string): string =>
  title.startsWith(MARK) ? title.slice(MARK.length) : title;

const KEY = "omc.sessionNotices";

/** Off until asked for: a permission prompt nobody invited is the one people refuse for good. */
export const noticesOn = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false; // storage denied (private mode, third-party rules): treat as off
  }
};

/** Writes the session-notices toggle to localStorage, `on` or `off`; browser-local because the
 *  notification permission it depends on is granted per browser, and a denied write stays off. */
export const setNoticesOn = (on: boolean): void => {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Nothing to do: the toggle reads back as off, which is what the browser will honour anyway.
  }
};
