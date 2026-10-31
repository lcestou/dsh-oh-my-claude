// Prompt recall in the composer: Up in an empty box brings back the session's last prompt, Up again
// older ones, Down newer ones and back to empty, the way the Claude Code terminal's history works.
// The walk is a pure state machine (`recallStep`) so the rules are testable without a DOM; the hook
// around it owns the list, the key listener and the caret check.
import { useEffect, useRef } from "react";
import { ROUTE, boxParam, isClaudeSession, readJson, type ClientCtx } from "./shared.js";
import { useHintFlag } from "./hints.js";

/** Where the walk stands: the prompts newest first, the index shown (null when not walking), and
 *  the text last written into the box, which the edit lock compares the draft against. */
export interface RecallState {
  entries: string[];
  at: number | null;
  shown: string | null;
}

/** What one arrow press does: the next state and, when the box should change, its new text
 *  (`""` empties it); no `set` means the key was not the walk's to take. */
export interface RecallMove {
  state: RecallState;
  set?: string;
}

/** Fired on `window` by the Rewind tab after a rewind: the prompts behind the rewound point are
 *  gone from the transcript, so the walk's list is read again before its next use. */
export const REWOUND_EVENT = "omc-rewound";

/** No list, not walking. */
export const IDLE: RecallState = { entries: [], at: null, shown: null };

/** The move to entry `i`, or no move when the list has no such entry. */
const moveTo = (s: RecallState, i: number): RecallMove => {
  const text = s.entries[i];
  return text === undefined ? { state: s } : { state: { ...s, at: i, shown: text }, set: text };
};

/**
 * One arrow press against the walk. Rules: Up from an empty box starts at the newest entry no
 * matter where an earlier walk stood; while walking, a draft that is not byte for byte the text
 * last recalled means the person edited it, and both arrows do nothing (the edit lock); Up past the
 * oldest entry and Down from an empty box do nothing; Down from the newest entry empties the box
 * and ends the walk. Never changes `entries`.
 */
export function recallStep(s: RecallState, key: "up" | "down", draft: string): RecallMove {
  if (key === "up") {
    if (draft === "") return moveTo({ ...s, at: null, shown: null }, 0);
    if (s.at === null || draft !== s.shown) return { state: s };
    return moveTo(s, s.at + 1);
  }
  if (s.at === null || draft === "" || draft !== s.shown) return { state: s };
  if (s.at === 0) return { state: { ...s, at: null, shown: null }, set: "" };
  return moveTo(s, s.at - 1);
}

/** The user lines this plugin itself sends the CLI (a reattach after a dsh restart, a usage limit
 *  reset: `src/adapter/turn.ts`). The transcript stores them as prompts; nobody typed them. */
const PLUGIN_NOTICE = "[Oh My Claude] ";

/** The route's prompts (newest first) as walk entries: trimmed, blanks and the plugin's own notices
 *  dropped, and a prompt sent twice in a row kept once, the way a shell's history collapses repeats. */
export const recallEntries = (prompts: ReadonlyArray<{ text: string }>): string[] =>
  prompts
    .map((p) => p.text.trim())
    .filter((text) => text !== "" && !text.startsWith(PLUGIN_NOTICE))
    .filter((text, i, all) => text !== all[i - 1]);

/** The full prompts of one transcript, by the dsh session's id or a bare transcript id (the route
 *  resolves either). An unreadable or missing transcript answers an empty list, never throws. */
const promptsOf = (ctx: ClientCtx, sessionId: string, id: string, cwd: string): Promise<string[]> =>
  fetch(
    `${ROUTE}/rewind?session=${encodeURIComponent(id)}&cwd=${encodeURIComponent(cwd)}&full=1${boxParam(ctx, sessionId)}`,
  )
    .then((r) => readJson<{ prompts?: { text: string }[] }>(r))
    .then((b) => recallEntries(b.prompts ?? []))
    .catch(() => []);

/** The session's own prompts, or, while it has none (a session that has not sent anything yet),
 *  the prompts of the workspace's most recently written transcript, so a fresh session recalls
 *  what the last one in this workspace asked, as the terminal's per-project history does. */
async function loadEntries(ctx: ClientCtx, sessionId: string, cwd: string): Promise<string[]> {
  const own = await promptsOf(ctx, sessionId, sessionId, cwd);
  if (own.length > 0) return own;
  const list = await fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(cwd)}`)
    .then((r) => readJson<{ sessions?: { id: string }[] }>(r))
    .catch(() => ({ sessions: [] }));
  const last = list.sessions?.[0];
  return last ? promptsOf(ctx, sessionId, last.id, cwd) : [];
}

/** The top of the caret's rectangle, or null without a selection. A collapsed range on an empty
 *  line has no box of its own, so the element it sits in answers for it. */
function caretTop(): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.height > 0) return rect.top;
  const node = range.startContainer;
  const el = node instanceof Element ? node : node.parentElement;
  return el ? el.getBoundingClientRect().top : null;
}

/**
 * Mounts prompt recall on the composer for one Claude session. Off with the `recallOff` hint.
 *
 * Costs nothing until Up is pressed in an empty box: the list is read then, not at mount or at
 * every turn end, since the route folds the whole transcript and most turns are never recalled.
 * A turn ending marks the list stale, so the next empty-box Up re-reads it and the prompt just
 * sent is the newest entry; a walk already under way keeps its list, so its indexes never shift.
 *
 * The key listener is one capture listener on the document, filtered to the composer, with no
 * modifier held and no IME composition open. From an empty box Up is taken outright. In a filled
 * box the editor goes first: the key is let through, and one frame later the step happens only if
 * nothing claimed the key (`defaultPrevented`, a command menu for instance), the caret's line did
 * not move (it was already on the top line for Up, the bottom one for Down) and the draft is
 * unchanged; so a wrapped line, a tall box or a narrow phone never need measuring, the editor
 * decides what a line is. Gets wrong: a caret with no selection reads as unmoved.
 */
export function useComposerRecall({
  sessionId,
  ctx,
  setDraft,
  draft,
  running,
}: {
  sessionId: string;
  ctx: ClientCtx;
  setDraft: ((text: string) => void) | undefined;
  draft: string;
  running: boolean;
}): void {
  const [off] = useHintFlag("recallOff");
  const state = useRef<RecallState>(IDLE);
  const stale = useRef(true);
  const loading = useRef<Promise<string[]> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setRef = useRef(setDraft);
  setRef.current = setDraft;
  // An emptied box (sent, cleared, or walked down past the newest) ends the walk. Whitespace alone,
  // a stray newline after a send, counts as empty: the walk starts from it and replaces it.
  const empty = draft.trim() === "";
  useEffect(() => {
    if (empty) state.current = { ...state.current, at: null, shown: null };
  }, [empty]);
  useEffect(() => {
    state.current = IDLE;
    stale.current = true;
    loading.current = null;
  }, [sessionId]);
  useEffect(() => {
    if (!running) stale.current = true;
  }, [running]);
  useEffect(() => {
    const onRewound = () => {
      stale.current = true;
    };
    window.addEventListener(REWOUND_EVENT, onRewound);
    return () => window.removeEventListener(REWOUND_EVENT, onRewound);
  }, []);
  useEffect(() => {
    if (off) return;
    /** The list, read now if stale, shared between presses that land during one read. */
    const entries = (): Promise<string[]> => {
      if (!stale.current) return Promise.resolve(state.current.entries);
      if (loading.current) return loading.current;
      const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
      if (!cwd) return Promise.resolve([]);
      const read = loadEntries(ctx, sessionId, cwd).then((list) => {
        if (loading.current === read) {
          loading.current = null;
          stale.current = false;
          state.current = { ...state.current, entries: list };
        }
        return list;
      });
      loading.current = read;
      return read;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (!(e.target instanceof Element) || !e.target.closest("[data-composer-input]")) return;
      const set = setRef.current;
      if (!set) return;
      const key = e.key === "ArrowUp" ? "up" : "down";
      const draftNow = draftRef.current;
      if (draftNow.trim() === "") {
        // Only a Claude session has a list; elsewhere the key is the editor's. Nothing to recall
        // is known only after a read; a known-empty list leaves the key alone too.
        if (key === "down" || !isClaudeSession(ctx, sessionId)) return;
        if (!stale.current && state.current.entries.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        void entries().then(() => {
          if (draftRef.current.trim() !== "") return;
          const next = recallStep(state.current, "up", "");
          if (next.set === undefined) return;
          state.current = next.state;
          set(next.set);
        });
        return;
      }
      const before = caretTop();
      requestAnimationFrame(() => {
        if (e.defaultPrevented || caretTop() !== before || draftRef.current !== draftNow) return;
        const next = recallStep(state.current, key, draftNow);
        if (next.set === undefined) return;
        state.current = next.state;
        set(next.set);
      });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [off, ctx, sessionId]);
}
