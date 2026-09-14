// A notice when a session the browser is not showing stops working and waits for the user. The
// transition logic is here, away from the DOM, so it can be checked without a page.

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

/** The one return shape `recapNext` uses. Kept narrow so the caller reads what it gets without a
 *  widening cast. */
export interface RecapStep {
  pending: string[];
  fire?: string;
}

/**
 * The recap queue after this snapshot, and the session to recap now. A session joins the queue when
 * it stops working while unselected, and leaves it when it becomes the one on screen: that is the
 * return the recap is named for. Never persisted, so a reload forgets: a recap of work from before a
 * page load is history, not a return.
 */
export function recapNext(
  pending: readonly string[],
  waiting: readonly string[],
  current: string | undefined,
): RecapStep {
  const next = new Set(pending);
  for (const id of waiting) if (id !== current) next.add(id);
  if (current !== undefined && next.delete(current)) return { pending: [...next], fire: current };
  return { pending: [...next] };
}

const RECAP_KEY = "omc.returnRecap";

/** Off by default: it costs a model call, and the transcript is right there to scroll. */
export const recapOn = (): boolean => {
  try {
    return window.localStorage.getItem(RECAP_KEY) === "on";
  } catch {
    return false; // storage denied: treat as off, which is what the switch will read back
  }
};

export const setRecapOn = (on: boolean): void => {
  try {
    window.localStorage.setItem(RECAP_KEY, on ? "on" : "off");
  } catch {
    // Nothing to do: the switch reads back off, which is the honest state.
  }
};

/** What the recap asks. One line, because the answer docks in a card two lines tall. */
export const RECAP_QUESTION = "One line: what did you do in this session since my last message?";

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

export const setNoticesOn = (on: boolean): void => {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Nothing to do: the toggle reads back as off, which is what the browser will honour anyway.
  }
};
