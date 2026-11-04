// Ctrl+R in the composer: a search over the prompts typed before, the way the Claude Code
// terminal's history search works. A card opens above the composer with a search field; the
// rows are the prompts that match, newest first; Ctrl+S or Ctrl+Down cycles the scope (this session, the
// workspace, everywhere on the box); Enter sends the row, Tab writes it into the composer and
// Escape closes. The match rule is a pure function (`historyMatches`) so it is testable without
// a DOM; the component owns the key listener, the list and the fetch.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { t, useLocale, type OmcKey } from "./i18n.js";
import { useHintFlag } from "./hints.js";
import { SearchField } from "./search-field.js";
import {
  ROUTE,
  T,
  boxParam,
  inOwnComposer,
  isClaudeSession,
  meta,
  readJson,
  rowBtn,
  type ClientCtx,
} from "./shared.js";

/** Where the search looks: one session, every transcript of the workspace, or the whole box. */
export type HistoryScope = "session" | "workspace" | "box";

/** The scopes in the order Ctrl+S and Ctrl+Down walk them, round and round; Ctrl+Up walks back. */
export const SCOPES: readonly HistoryScope[] = ["session", "workspace", "box"];

/** The scope after `scope` in Ctrl+S's cycle; the last wraps to the first. */
export const nextScope = (scope: HistoryScope): HistoryScope =>
  SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length] ?? "session";

/** The scope before `scope`, for Ctrl+Up; the first wraps to the last. */
export const prevScope = (scope: HistoryScope): HistoryScope =>
  SCOPES[(SCOPES.indexOf(scope) + SCOPES.length - 1) % SCOPES.length] ?? "session";

/** One prompt as the history route answers it. */
export interface HistoryItem {
  text: string;
  time: number;
}

/** How many rows the card shows at once; more than this and the list scrolls. */
const SHOWN = 8;

/** The scope button's text, per scope. */
const SCOPE_KEY = {
  session: "main.history.scope.session",
  workspace: "main.history.scope.workspace",
  box: "main.history.scope.box",
} satisfies Record<HistoryScope, OmcKey>;

/**
 * The entries whose text holds every word of `query`, case-insensitively, in any order and at any
 * position, newest first as given. A query of nothing but spaces matches everything, so the card
 * opens on the full list. Each word is matched as a substring, not fuzzily: "fix test" finds
 * "run the test then fix it" and does not find "fixture", which keeps the rows predictable.
 */
export function historyMatches(entries: ReadonlyArray<HistoryItem>, query: string): HistoryItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const text = e.text.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** True for the keydown that opens the search: Ctrl+R alone, inside dsh's composer, outside an
 *  IME composition. Cmd+R on a Mac stays the browser's reload, as the terminal's binding is Ctrl. */
export const isOpenKey = (e: KeyboardEvent): boolean =>
  e.key.toLowerCase() === "r" &&
  e.ctrlKey &&
  !e.altKey &&
  !e.metaKey &&
  !e.shiftKey &&
  !e.isComposing &&
  e.target instanceof Element &&
  e.target.closest("[data-composer-input]") !== null;

/** Puts the keyboard back in dsh's composer once the card closes. */
const focusComposer = () => document.querySelector<HTMLElement>("[data-composer-input]")?.focus();

/**
 * Whether the history card is open for one Claude session's composer, and the setter. Ctrl+R in
 * the composer opens it; the card itself closes it. Off with the `historySearchOff` hint, and
 * inert without the composer's `setDraft`, since the card could then do nothing with a pick. A
 * session switch closes it. Lives apart from the card so the dock, which draws nothing while it
 * has no cards, can see that this one wants drawing.
 */
export function useHistoryOpen({
  sessionId,
  ctx,
  setDraft,
}: {
  sessionId: string;
  ctx: ClientCtx;
  setDraft: ((text: string) => void) | undefined;
}): [boolean, (open: boolean) => void] {
  const [off] = useHintFlag("historySearchOff");
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [sessionId]);
  useEffect(() => {
    if (off || !setDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isOpenKey(e) || !inOwnComposer(e.target, sessionId) || !isClaudeSession(ctx, sessionId))
        return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [off, ctx, sessionId, setDraft]);
  return [open, setOpen];
}

/**
 * The history card for one Claude session's composer, drawn while `open`. The list for a scope
 * is read when the card first opens on it and kept until a turn ends (or the session changes),
 * so typing in the field costs no request. Enter needs the composer's `submit`; without it Enter
 * fills the box like Tab. Gets wrong: a prompt longer than the card is cut to one line per row,
 * so two prompts with the same first words look alike until one is picked.
 */
export function HistorySearch({
  sessionId,
  ctx,
  open,
  onClose,
  setDraft,
  submit,
  running,
}: {
  sessionId: string;
  ctx: ClientCtx;
  open: boolean;
  onClose: () => void;
  setDraft: (text: string) => void;
  submit: (() => void) | undefined;
  running: boolean;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<HistoryScope>("session");
  const [at, setAt] = useState(0);
  const [lists, setLists] = useState<Partial<Record<HistoryScope, HistoryItem[]>>>({});
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  // A turn ending adds a prompt, so every scope's list is stale; the next open re-reads.
  // An already empty cache is kept as is: a fresh object here on mount re-ran the fetch effect
  // and cancelled the first read a beat after it was sent.
  const clear = () => setLists((cur) => (Object.keys(cur).length === 0 ? cur : {}));
  useEffect(() => {
    if (!running) clear();
  }, [running]);
  useEffect(clear, [sessionId]);
  // Each open starts clean, and the field takes the keyboard, so typing filters at once.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setAt(0);
    document.querySelector<HTMLElement>("[data-omc-history-query]")?.focus();
  }, [open]);
  // The scope's list, read once per open scope; the empty list is a real answer and stays.
  useEffect(() => {
    if (!open || lists[scope] !== undefined) return;
    const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
    if (!cwd) return;
    let live = true;
    setError("");
    fetch(
      `${ROUTE}/history?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}&scope=${scope}${boxParam(ctx, sessionId)}`,
    )
      .then((r) => readJson<{ prompts?: HistoryItem[] }>(r))
      .then((b) => live && setLists((cur) => ({ ...cur, [scope]: b.prompts ?? [] })))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [open, scope, lists, ctx, sessionId]);
  // Two ways out that do not depend on the keyboard being in the field. Zen and Arc take Ctrl+S
  // at the browser level and move the keyboard to their sidebar, outside the page, so the card
  // sat open with no Esc able to reach it (owner, 2026-11-04). The window losing focus is that
  // moment, and closing then hands the composer back when the page is clicked again. Esc on the
  // document (capture, before dsh's own Esc Esc stop) covers the keyboard landing elsewhere in
  // the page. The card is transient, so closing on a tab switch costs nothing. Declared above
  // the early return below, so a closed render runs the same hooks as an open one; the listeners
  // themselves exist only while the card is open.
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    const onBlur = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      // An Escape meant for a dialog or menu someone opened over the card (a dsh dialog, the ✻
      // panel's Rewind) is theirs: taking it here closed the card and left that dialog open.
      if (e.target instanceof Element) {
        const surface = e.target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
        if (surface && !surface.closest("[data-omc-history-search]")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  if (!open) return null;
  const entries = lists[scope];
  const rows = historyMatches(entries ?? [], query);
  const picked = rows[Math.min(at, Math.max(0, rows.length - 1))];
  const close = () => {
    onClose();
    focusComposer();
  };
  closeRef.current = close;
  const fill = () => {
    if (picked) setDraft(picked.text);
    close();
  };
  const move = (step: number) => {
    if (rows.length === 0) return;
    const next = (Math.min(at, rows.length - 1) + step + rows.length) % rows.length;
    setAt(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-omc-history-row="${next}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      fill();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!picked) return;
      setDraft(picked.text);
      close();
      // On the next frame: dsh's composer takes the draft on its own render first.
      if (submit) requestAnimationFrame(() => submit());
    } else if (ctrl && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // A second pair of scope keys: Zen and Arc take Ctrl+S at the browser level to toggle
      // their sidebar, so the card never sees it there (owner, 2026-11-04). No browser binds
      // Ctrl with an arrow, and the arrows alone already walk the rows, so the modifier reads
      // as the other axis. Before the plain arrow branches, which would otherwise take these.
      e.preventDefault();
      setScope(e.key === "ArrowDown" ? nextScope(scope) : prevScope(scope));
      setAt(0);
    } else if (e.key === "ArrowDown" || (ctrl && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (ctrl && e.key.toLowerCase() === "s") {
      e.preventDefault();
      setScope(nextScope(scope));
      setAt(0);
    }
  };
  return (
    <section
      aria-label={t("main.history.title")}
      data-omc-history-search=""
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "8px 10px",
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* The keys live on the field: it holds the focus while the card is open, and a row
            click closes the card, so nothing else here ever takes a keystroke. */}
        <SearchField
          value={query}
          onChange={(next) => {
            setQuery(next);
            setAt(0);
          }}
          onKeyDown={onKey}
          placeholder={t("main.history.placeholder")}
          label={t("main.history.title")}
          hook="data-omc-history-query"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          data-omc-history-scope={scope}
          aria-label={t("main.history.scopeLabel")}
          title={t("main.history.scopeTip")}
          onClick={() => {
            setScope(nextScope(scope));
            setAt(0);
          }}
          style={{ ...rowBtn, flex: "none", fontSize: 12, padding: "4px 10px" }}
        >
          {t(SCOPE_KEY[scope])}
        </button>
      </div>
      <div
        ref={listRef}
        data-omc-history-rows=""
        style={{ maxHeight: SHOWN * 28, overflowY: "auto" }}
      >
        {entries === undefined ? (
          <span style={{ ...meta, padding: "2px 0" }}>{t("loading")}</span>
        ) : rows.length === 0 ? (
          <span style={{ ...meta, padding: "2px 0" }}>{t("main.history.none")}</span>
        ) : (
          rows.map((row, i) => (
            <button
              key={`${row.time}:${row.text}`}
              type="button"
              aria-current={row === picked ? "true" : undefined}
              data-omc-history-row={i}
              tabIndex={-1}
              onMouseEnter={() => setAt(i)}
              onClick={() => {
                setAt(i);
                setDraft(row.text);
                close();
              }}
              style={{
                ...rowBtn,
                width: "100%",
                height: 28,
                padding: "0 8px",
                fontSize: 13,
                background:
                  row === picked
                    ? "var(--dsw-alias-bg-hover, rgba(128,128,128,.12))"
                    : "transparent",
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                }}
              >
                {row.text}
              </span>
            </button>
          ))
        )}
      </div>
      <div style={{ ...meta, whiteSpace: "normal" }} aria-hidden="true">
        {t("main.history.keys")}
      </div>
      {error && <span style={{ ...meta, color: T.err }}>{error}</span>}
    </section>
  );
}
