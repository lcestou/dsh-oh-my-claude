// The aside dock as this plugin draws it: the composer handle the Run button reads, the slot dsh
// hands it, the undo-steer restore hook, the bubble rows and the idle chip the entry mounts.
import { t, useLocale } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import {
  ROUTE,
  T,
  btn,
  ago,
  DOCK_ATTR,
  ACCENT,
  isClaudeSession,
  claudeProviderOf,
  type ClientCtx,
  DOCK_CARD,
} from "./shared.js";
import {
  pollEvery,
  subscribe,
  type AsideItem,
  type IdleReply,
  type LoginNeed,
  type HeldSteerRow,
  type SteerCardData,
  type WaitingSteerRow,
} from "./events.js";
import { Spark } from "./spark.js";
import { compactThreshold } from "./nudge.js";
import { type RestoreWatch, startWatch, stepRestore, withdrawnSince } from "./steer-restore.js";
import { useHintValue, useHintFlag } from "./hints.js";
import { Chevron } from "./boxes.js";
import { type ContextReply, windowLabel } from "./context-meter.js";
import {
  sameNeed,
  iconBtn,
  HEADER_TOGGLE,
  type ClaudeUpdateCardData,
  sameCard,
  useBindingLimit,
  SteerCard,
  CompactCard,
  LimitCard,
  SuggestionCard,
  LoginCard,
  ClaudeUpdateCard,
} from "./cards.js";

/** The composer actions of the aside dock entry on screen, for the Run button, which is drawn
 *  outside any React tree. Null without a composer, so no button is offered. */
export let dockComposer: ComposerSlot["inputActions"] | null = null;

/** The composer state and actions dsh hands a `conversation.input.dock` entry: the slice the steer
 *  card's restore undo reads and writes. */
type ComposerSlot = {
  inputActions?: {
    setDraft: (text: string) => void;
    removeAttachment?: (id: string) => void;
    /** dsh 0.2.1: sends the draft the way Enter does (queued as a steer while a turn runs). */
    submit?: () => void;
  };
  useInput?: <T>(select: (state: { draft: string; attachmentIds?: readonly string[] }) => T) => T;
};

/** A composer with no attachments, one identity so the selector does not churn. */
const NO_ATTACHMENTS: readonly string[] = [];

/**
 * Undo dsh's composer restore of an attachment steer the card took back. dsh counts a send with a
 * file or image as unfinished until it lands in the chat; when a hold (Edit, Remove, Send now)
 * takes it out of the inbox first, dsh calls the send failed and, in the tab that sent it, puts its
 * attachments back at the head of the composer's row and its text back into an empty composer.
 * The card is the editor, so that copy is a duplicate one Enter away from going out twice. The
 * pairing is `stepRestore`'s; this feeds it every composer and steer-list update and applies what
 * it returns. Gets wrong: text typed before the restore keeps dsh from restoring the words (it only
 * fills an empty composer), and a later restore then brings both drafts back joined, which the
 * step does not recognise and leaves in place. Does nothing on a dsh without `removeAttachment`.
 */
function useUndoSteerRestore(
  waiting: WaitingSteerRow[],
  held: HeldSteerRow[],
  { inputActions, useInput }: ComposerSlot,
) {
  const ids = useInput?.((state) => state.attachmentIds) ?? NO_ATTACHMENTS;
  const draft = useInput?.((state) => state.draft) ?? "";
  const watch = useRef<RestoreWatch>(startWatch(ids, waiting, draft));
  useEffect(() => {
    const at = Date.now();
    const withdrawn = withdrawnSince(at);
    for (const h of held) withdrawn.add(h.id);
    const { next, remove, clearDraft } = stepRestore(watch.current, {
      ids,
      rows: waiting,
      draft,
      at,
      withdrawn,
    });
    watch.current = next;
    const drop = inputActions?.removeAttachment;
    if (!inputActions || !drop) return;
    for (const id of remove) drop(id);
    if (clearDraft) inputActions.setDraft("");
  }, [waiting, held, ids, draft, inputActions]);
}

/**
 * The `/btw` aside bubble: a Claude-orange card docked above the composer, in the same slot and at
 * the same width as dsh's todo and goal panels, that shows each side question and the answer the
 * CLI returns off the transcript. Pending cards read as thinking; each is dismissed on its own. The
 * server keeps only the last few per session, so the list stays short.
 */
/** Render this session's aside items as a collapsible stack, polling `/side-questions` every few
 *  seconds: questions, a login need and a Claude update card, or nothing when the poll is empty. */
export function AsideBubble({
  sessionId,
  ctx,
  inputActions,
  useInput,
}: { sessionId: string; ctx: ClientCtx } & ComposerSlot) {
  useLocale();
  const [items, setItems] = useState<AsideItem[]>([]);
  // What the poll compares its answer against, without listing `items` as a dependency of its effect.
  const itemsRef = useRef<AsideItem[]>([]);
  const [steers, setSteers] = useState<SteerCardData>({ waiting: [], held: [] });
  // The CLI's predicted next prompt, text only, so an unchanged poll answer is the same string
  // and React skips the render.
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // This tab, this text: the next turn replaces the text anyway, so a box-wide store is more
  // than the job needs.
  const [suggestionHidden, setSuggestionHidden] = useState<string | null>(null);
  // What the poll compares its steers against, the same way `itemsRef` serves `items`.
  const steersRef = useRef<SteerCardData>({ waiting: [], held: [] });
  steersRef.current = steers;
  // The poll itself, so the steer card can re-poll the moment an edit lands instead of in 3 s.
  const pollRef = useRef<() => void>(() => {});
  itemsRef.current = items;
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  /** The box whose login the last turn wanted, from the same poll; null once a turn or a login
   *  clears it on the server. Dismissal is this tab's alone. */
  const [need, setNeed] = useState<LoginNeed | null>(null);
  const [needDismissed, setNeedDismissed] = useState<string | null>(null);
  /** A newer Claude Code for the box this session runs on, from the same poll; null once it is
   *  installed, skipped or set to install on its own. */
  const [claudeUpdate, setClaudeUpdate] = useState<ClaudeUpdateCardData | null>(null);
  // Once the card has been clicked it owns its own life: the server answers null the moment
  // `installed` moves, and the person still has to read what happened. Holds the release acted
  // on; the poll drops it when the server stops naming that release (installed, skipped) or names
  // a newer one, so a dismissal cannot flicker back on the one poll that raced the skip.
  const actedRef = useRef<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Only the newest card starts open; the rest fold to their header row, so a stack of answers costs
  // the composer one line each rather than a screen. A click flips a card either way.
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const visibleRef = useRef(true);

  useEffect(() => {
    // Poll this session's asides unconditionally. Do NOT gate on `activeClaudeSession`. That reads
    // the session's provider binding, which is briefly undefined during a restart/reattach; gating
    // the poll on it here meant that if the effect ran in that window the interval never installed
    // and, with deps `[ctx, sessionId]` stable, never retried, so the card died for good ("gone with
    // no way to get it back"). The card only mounts for the open composer's session and its data is
    // this session's own server-persisted asides, so an unconditional per-session poll is correct.
    let alive = true;
    const fetchItems = async () => {
      try {
        // `provider` is the mount the model picker names, so the update card reports the Claude
        // Code that was chosen rather than whichever box this session's turns happen to run on.
        // Switching model repoints the card on the next poll. The read is one store snapshot on a
        // poll that was already happening: no extra request, and the server answers it with a map
        // lookup against updaters its own tick keeps fresh, so nothing here probes a box.
        const picked = claudeProviderOf(ctx, sessionId);
        const r = await fetch(
          `${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}${
            picked === undefined ? "" : `&provider=${encodeURIComponent(picked)}`
          }`,
        );
        if (!r.ok) return;
        // SAFETY: our own JSON route; the union names both shapes the caller checks.
        const body = (await r.json()) as
          | {
              items: AsideItem[];
              loginNeeded?: LoginNeed | null;
              claudeUpdate?: ClaudeUpdateCardData | null;
              steers?: SteerCardData;
              suggestion?: { text: string } | null;
            }
          | { error: string };
        if ("error" in body) return;
        if (alive) {
          const nextNeed = body.loginNeeded ?? null;
          setNeed((cur) => (sameNeed(cur, nextNeed) ? cur : nextNeed));
          // The text alone: a fresh object on every poll would re-render the dock each time.
          setSuggestion(body.suggestion?.text ?? null);
          // The card names a box's Claude Code, so it belongs to a session that runs on Claude
          // Code; the route answers it for any session it is asked about, and a local-model
          // session drew it too (owner, 2026-09-23). Read here, on every poll, rather than once:
          // the provider binding is briefly undefined during a restart, and a poll later it is back.
          const nextUpd = isClaudeSession(ctx, sessionId) ? (body.claudeUpdate ?? null) : null;
          // A card that was acted on stays until it says it is gone (its own countdown after a
          // success, the close otherwise): the server stops naming the release the moment the
          // install lands, and dropping the card on that poll left "Updated" on screen for a
          // blink. Only a newer release takes it over.
          if (nextUpd !== null && nextUpd.latest !== actedRef.current) actedRef.current = null;
          setClaudeUpdate((cur) =>
            actedRef.current !== null ? cur : sameCard(cur, nextUpd) ? cur : nextUpd,
          );
        }
        // A fresh array every three seconds re-rendered the dock in every conversation forever,
        // answer or no answer; only a list that actually moved is worth a render.
        const next = body.items ?? [];
        if (alive && JSON.stringify(next) !== JSON.stringify(itemsRef.current)) setItems(next);
        const nextSteers = body.steers ?? { waiting: [], held: [] };
        if (alive && JSON.stringify(nextSteers) !== JSON.stringify(steersRef.current))
          setSteers(nextSteers);
      } catch {
        // network error: keep the last items on screen
      }
    };
    pollRef.current = () => void fetchItems();
    fetchItems();
    // The items, the steers and the login card arrive on the event stream the moment they change;
    // `claudeUpdate` does not (the updater's tick lives on the route), so the read below stays as
    // the fallback: every 30 s while the stream is up, else every second during a running turn
    // and every three at rest. Self-scheduling so the rate follows the turn without a restart.
    const offAsides = subscribe("asides", (session, data) => {
      if (session !== sessionId || !alive) return;
      setNeed((cur) => (sameNeed(cur, data.loginNeeded) ? cur : data.loginNeeded));
      setSuggestion(data.suggestion?.text ?? null);
      if (JSON.stringify(data.items) !== JSON.stringify(itemsRef.current)) setItems(data.items);
      if (JSON.stringify(data.steers) !== JSON.stringify(steersRef.current)) setSteers(data.steers);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (visibleRef.current) fetchItems();
      const running = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running === true;
      timer = setTimeout(tick, pollEvery(running, 1000, 3000));
    };
    timer = setTimeout(tick, 1000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchItems();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      offAsides();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);

  // Server-side `dismissed` (a closed card, which the route marks and keeps) and the local set (this
  // click, before the next poll confirms it) both hide a card here. The entry itself stays in the ring
  // for the panel's Asides tab.
  const limit = useBindingLimit(sessionId, ctx);
  const [warningsOff] = useHintFlag("limitWarningsOff");
  const [noticeOff] = useHintFlag("limitNoticeOff");
  const [limitDismissed, setLimitDismissed] = useHintValue("limitNoticeDismissed");
  const limitCard =
    limit?.level === "critical" &&
    !warningsOff &&
    !noticeOff &&
    // By the minute: a dismissal stored before the route rounded reset times holds a stray
    // fraction of a second, and an exact match brought the card back on the next read.
    // Unset reads as NaN through `Number`, which matches no minute.
    (limit.window.resetsAt === null ||
      Math.round(Number(limitDismissed) / 60_000) !== Math.round(limit.window.resetsAt / 60_000))
      ? limit.window
      : null;
  const shown = items.filter((it) => !it.dismissed && !dismissed.has(it.id));
  // No `activeClaudeSession` gate here either: the card shows this session's own persisted asides,
  // which only exist for a Claude session, so an empty list is the only reason to hide it. Reading
  // the provider binding at render blinked the card out whenever the binding reloaded.
  const loginCard = need && needDismissed !== need.host ? need : null;
  // Only with a composer to fill: dsh hands `inputActions` to dock entries, so a mount without it
  // (a dsh without the hook) has no Use to offer and shows nothing.
  const suggestionCard =
    suggestion !== null && inputActions && suggestionHidden !== suggestion ? suggestion : null;
  // The guess is what you might type; once you are typing something else it folds away (a short
  // fade, like the update card), and comes back if the box is cleared. Use's own text in the box
  // does not count as typing, so the card hides through `suggestionHidden` there instead.
  const draft = useInput?.((state) => state.draft) ?? "";
  const typingElse = draft.trim() !== "" && draft !== suggestionCard;
  // Sending what was typed empties the box a beat before the server's clear takes the card down,
  // and the card unfolded for that beat (owner, 2026-10-21). So a fold outlasts the typing by a
  // moment: long enough for the clear to land, short enough that a box emptied by hand gets the
  // card back without a wait worth noticing.
  // And while the turn runs: the server drops the guess at the prompt write and the stream says
  // so, but dsh's own send empties the box first, and a card that unfolded in between read as
  // the guess coming back. Read at render; the poll re-renders this once a second while running.
  const running = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running === true;
  // The context nudge: read once the turn is over (mid-turn the CLI declines the read), and
  // again at each session switch. The tens bucket dismissed is this tab's memory, so the card
  // returns at the next 10 % and not before. `loadContext` is the meter popover's cached read;
  // shortcut: up to 10 s stale after a turn, fresh enough for a threshold.
  const [compactOff] = useHintFlag("compactNudgeOff");
  // The threshold is a hint too (`compactNudgeAt`, percent), so a box can move it through
  // POST /hints; the switch card names the default.
  const [compactAtHint] = useHintValue("compactNudgeAt");
  const compactAt = compactThreshold(compactAtHint);
  const [context, setContext] = useState<{ percentage: number; totalTokens: number } | null>(null);
  const [compactDismissed, setCompactDismissed] = useState(-1);
  useEffect(() => {
    if (compactOff || running) return;
    let live = true;
    // A beat after the turn ends, and past `loadContext`'s cache: the read taken at mount, before
    // any process was up, answered "no live process" and a cached copy of that hid the card for
    // the turn that followed (seen 2026-10-22 in the sweep check).
    const timer = setTimeout(() => {
      // SAFETY: the body is our own JSON route; both shapes carry `ok`
      const read = fetch(`${ROUTE}/context?session=${encodeURIComponent(sessionId)}`).then(
        (r) => r.json() as Promise<ContextReply>,
      );
      void read
        .then((r) => {
          if (live)
            setContext(r.ok ? { percentage: r.percentage, totalTokens: r.totalTokens } : null);
        })
        .catch(() => {});
    }, 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sessionId, running, compactOff]);
  const compactBucket = context ? Math.floor(context.percentage / 10) : -1;
  const compactCard =
    !compactOff &&
    context !== null &&
    context.percentage >= compactAt &&
    compactBucket !== compactDismissed
      ? context
      : null;
  // The Run button on shell snippets lives outside React (a body scan); it borrows this entry's
  // composer while the entry is on screen.
  useEffect(() => {
    dockComposer = inputActions ?? null;
    return () => {
      dockComposer = null;
    };
  }, [inputActions]);
  const [foldHold, setFoldHold] = useState(false);
  const wasTyping = useRef(false);
  useEffect(() => {
    if (typingElse) {
      wasTyping.current = true;
      return;
    }
    if (!wasTyping.current) return;
    wasTyping.current = false;
    setFoldHold(true);
    const timer = setTimeout(() => setFoldHold(false), 800);
    return () => clearTimeout(timer);
  }, [typingElse]);
  // Before the early return below: the card is gone once its last row goes, and so would be this.
  useUndoSteerRestore(steers.waiting, steers.held, { inputActions, useInput });
  const anySteers = steers.waiting.length > 0 || steers.held.length > 0;
  if (
    shown.length === 0 &&
    !loginCard &&
    !claudeUpdate &&
    !limitCard &&
    !anySteers &&
    !suggestionCard &&
    !compactCard
  )
    return null;

  const dismissAside = (id: string) => {
    // Hide now, but tell the server to drop it so the next poll (or a remount) does not bring it back.
    setDismissed((prev) => new Set(prev).add(id));
    void fetch(`${ROUTE}/side-questions/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, id }),
    }).catch(() => {});
  };

  const copy = (it: AsideItem) => {
    const text = it.answer ?? it.error ?? it.question;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(it.id);
      setTimeout(() => setCopied((cur) => (cur === it.id ? null : cur)), 1200);
    });
  };

  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const newest = shown[shown.length - 1]?.id;

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      {claudeUpdate && (
        <ClaudeUpdateCard
          update={claudeUpdate}
          sessionId={sessionId}
          onAct={() => {
            actedRef.current = claudeUpdate.latest;
          }}
          onGone={() => setClaudeUpdate(null)}
        />
      )}
      {loginCard && (
        <LoginCard need={loginCard} onDismiss={() => setNeedDismissed(loginCard.host)} />
      )}
      {suggestionCard !== null && inputActions && (
        <SuggestionCard
          text={suggestionCard}
          folded={typingElse || foldHold || running}
          onUse={() => {
            inputActions.setDraft(suggestionCard);
            setSuggestionHidden(suggestionCard);
          }}
          onSend={
            inputActions.submit
              ? () => {
                  // Over any draft, like Use; dsh queues it as a steer while a turn runs.
                  inputActions.setDraft(suggestionCard);
                  inputActions.submit?.();
                  setSuggestionHidden(suggestionCard);
                }
              : undefined
          }
          onDismiss={() => setSuggestionHidden(suggestionCard)}
        />
      )}
      {compactCard !== null && (
        <CompactCard
          percent={compactCard.percentage}
          tokens={compactCard.totalTokens}
          onCompact={() => {
            void fetch(`${ROUTE}/compact`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ session: sessionId }),
            }).catch(() => {});
            setCompactDismissed(compactBucket);
          }}
          onDismiss={() => setCompactDismissed(compactBucket)}
        />
      )}
      {limitCard && (
        <LimitCard
          label={windowLabel(limitCard)}
          usedPercent={limitCard.usedPercent}
          resetsAt={limitCard.resetsAt}
          // The reset time is the key: a later limit, or the same one after it resets, shows again.
          onDismiss={() => limitCard.resetsAt !== null && setLimitDismissed(limitCard.resetsAt)}
        />
      )}
      {shown.map((it) => {
        const open = (it.id === newest) !== toggled.has(it.id);
        return (
          <div
            key={it.id}
            style={{
              // Neutral theme tokens (not a solid-orange bubble) so it reads as a native dock card;
              // the orange lives only on the ✻ mark and label. Fallbacks cover a theme without them.
              boxSizing: "border-box",
              background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
              border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
              // Square bottom, rounded top: it is always the first card above the composer, so it
              // docks onto the message box like a tab (dsh's own QueueDock uses this same radius).
              borderRadius: "12px 12px 0 0",
              overflow: "hidden",
            }}
          >
            {/* The header row holds the fold toggle and, beside it, Copy and close, so no button sits
                inside another. The chevron ends the toggle, just before the actions, as on the
                update card. The toggle carries the old left padding so the bar is one click. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
              <button
                type="button"
                aria-expanded={open}
                data-omc-aside-toggle={it.id}
                onClick={() => toggle(it.id)}
                style={{ ...HEADER_TOGGLE, padding: "6px 0 6px 8px" }}
              >
                <Spark size={12} />
                <span
                  style={{
                    color: ACCENT,
                    fontWeight: 600,
                    fontSize: 12,
                    flex: "0 0 auto",
                  }}
                >
                  {t("main.aside.title")}
                </span>
                {/* Question rides the bar, truncated, so a collapsed card still says what it asked. */}
                <span
                  style={{
                    color: T.muted,
                    fontSize: 12,
                    flex: "1 1 auto",
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.question || t("main.selection.explain")}
                </span>
                <span style={{ color: T.faint, fontSize: 11, flex: "0 0 auto" }}>{ago(it.at)}</span>
                {/* Up when collapsed, down when open, the same convention as the queue dock. */}
                <Chevron open={open} />
              </button>
              <button
                type="button"
                onClick={() => copy(it)}
                aria-label={t("main.aside.copyAria")}
                style={{
                  ...iconBtn,
                  color: copied === it.id ? ACCENT : T.muted,
                  fontSize: 11,
                }}
              >
                {copied === it.id ? t("copied") : t("copy")}
              </button>
              <button
                type="button"
                onClick={() => dismissAside(it.id)}
                aria-label={t("main.aside.dismissAria")}
                style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
              >
                ✕
              </button>
            </div>
            {open ? (
              // A very tall answer scrolls inside the card rather than pushing the composer down.
              <div style={{ padding: "0 10px 8px 24px", maxHeight: "40vh", overflow: "auto" }}>
                {/* The passage a selection-bar aside asked about, a few lines, above its answer. */}
                {it.quote ? (
                  <blockquote
                    data-omc-aside-quote={it.id}
                    style={{
                      margin: "0 0 6px",
                      padding: "0 0 0 8px",
                      borderLeft: `2px solid ${T.border}`,
                      color: T.muted,
                      fontSize: 12,
                      whiteSpace: "pre-wrap",
                      maxHeight: "4.5em",
                      overflow: "hidden",
                    }}
                  >
                    {it.quote}
                  </blockquote>
                ) : null}
                {it.pending ? (
                  <div style={{ color: ACCENT, fontSize: 12, fontStyle: "italic" }}>
                    {t("main.aside.thinking")}
                  </div>
                ) : it.error ? (
                  <div style={{ color: T.err, fontSize: 12 }}>{it.error}</div>
                ) : (
                  <div style={{ color: T.text, fontSize: 13, whiteSpace: "pre-wrap" }}>
                    {it.answer}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {anySteers && (
        <SteerCard steers={steers} sessionId={sessionId} refresh={() => pollRef.current()} />
      )}
    </div>
  );
}

/** Small chip that warns when the idle watchdog is about to kill the process. */
export function IdleChip({ sessionId }: { sessionId: string }) {
  useLocale();
  const [deadline, setDeadline] = useState<number | null>(null);
  const visibleRef = useRef(true);

  useEffect(() => {
    let alive = true;
    const fetchIdle = async () => {
      try {
        const r = await fetch(`${ROUTE}/idle?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: the body is our own JSON route; the union type names both shapes the caller checks
        const body = (await r.json()) as IdleReply | { error: string };
        if ("error" in body) return;
        if (alive) setDeadline(body.deadline ?? null);
      } catch {
        // network error: keep previous deadline
      }
    };
    fetchIdle();
    // The deadline arrives on the event stream (once a second while a turn re-arms it); the read
    // is the fallback: every 30 s while the stream is up, every 5 s when it is not.
    const offIdle = subscribe("idle", (session, data) => {
      if (session === sessionId && alive) setDeadline(data.deadline ?? null);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (visibleRef.current) fetchIdle();
      timer = setTimeout(tick, pollEvery(false, 5_000, 5_000));
    };
    timer = setTimeout(tick, 5_000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchIdle();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      offIdle();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);

  const remainingMs = deadline ? deadline - Date.now() : 0;
  if (!deadline || remainingMs > 60_000) return null;
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  const extend = async () => {
    try {
      await fetch(`${ROUTE}/idle/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId }),
      });
    } catch {
      // extend failed silently; next poll will reflect state
    }
  };
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 11, color: T.warn, fontFamily: T.mono }}>
        {t("main.idle.stopping", { n: seconds })}
      </span>
      <button type="button" style={btn} onClick={extend}>
        {t("main.idle.extend")}
      </button>
    </span>
  );
}
