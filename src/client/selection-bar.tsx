// The bar over a chat selection: the slot dsh hands the pick-time draft to, the composer it writes
// through, the question box it opens, and the helpers they run through. The entry mounts the slot.
import { t, useLocale } from "./i18n.js";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ROUTE,
  T,
  btn,
  inputStyle,
  btnPrimary,
  DOCK_ATTR,
  ACCENT,
  useActiveClaude,
  type ClientCtx,
  DOCK_CARD,
} from "./shared.js";
import { Spark } from "./spark.js";
import {
  askBody,
  chatSelection,
  clampQuote,
  previewOf,
  QUOTE_MAX,
  quoteMarkdown,
} from "./selection.js";
import { useHintFlag } from "./hints.js";
import { iconBtn } from "./cards.js";

/** dsh's pick-time draft span (`TokenSpan`, dsh-client-ui-conversation `contract/draft-editor.d.ts`). */
type TokenSpan = { readonly start: number; readonly end: number; readonly draftRev: number };
/** The part of dsh's `InputActions` the selection bar calls. `insertText` returns false while a send
 *  is in flight or when the draft moved under the span. Both calls arrived with dsh 0.1.7, the same
 *  release that put `data-chat-flow-kind` on chat nodes; an older dsh has neither, so no bar. */
type ComposerInsert = {
  captureInsertion?: () => TokenSpan;
  insertText?: (text: string, span: TokenSpan) => boolean;
};
/** The slice of dsh's `InputState` the bar reads: the send phase. */
type InputSlice = { phase?: "plain" | "adjudicating" | "claimed" | "submitting" };

/** Off-screen but read by screen readers: the bar's one-shot announcement. */
const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
};

/** Slot wrapper for the selection bar: off on the box-wide switch, on anything but the active Claude
 *  session, and on a dsh older than 0.1.7, whose composer has no `insertText` for Quote to call. */
export function SelectionSlot({
  sessionId,
  ctx,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  inputActions?: ComposerInsert;
  useInput?: <T>(select: (state: InputSlice) => T) => T;
}) {
  const sending =
    useInput?.((state) => state.phase === "adjudicating" || state.phase === "submitting") ?? false;
  const [off] = useHintFlag("selectionOff");
  const mine = useActiveClaude(ctx, sessionId ?? "");
  const capture = inputActions?.captureInsertion;
  const insert = inputActions?.insertText;
  if (off || !mine || sessionId === undefined || capture === undefined || insert === undefined)
    return null;
  return (
    <SelectionBar
      key={sessionId}
      sessionId={sessionId}
      sending={sending}
      capture={capture}
      insert={insert}
    />
  );
}

/** The composer of the conversation `anchor` sits in, or null when dsh renamed the hooks. */
const composerOf = (anchor: Element | null): HTMLElement | null =>
  anchor
    ?.closest("[data-conversation-scroll]")
    ?.querySelector<HTMLElement>("[data-composer-input]") ?? null;

/** How long after a pointer release the selection bar reads the selection: a common double-click
 *  window, so a triple click finishes before the bar can move the chat under it. */
const SELECTION_SETTLE_MS = 450;

/**
 * The selection bar: select text in the chat and it docks on the composer with the passage, an
 * optional question, Quote and Ask. Quote inserts a Markdown quote into the draft where the composer's
 * caret was, leaving the caret after it; Ask sends the passage as an aside, so the answer lands in
 * the aside card and the transcript gains nothing. Hides when the selection collapses unless the
 * person is using the bar. Reads dsh's `data-chat-flow-kind` markup through `chatSelection`, which is
 * not a dsh contract. Always renders a hidden anchor, so it can find its own conversation while hidden.
 */
function SelectionBar({
  sessionId,
  sending,
  capture,
  insert,
}: {
  sessionId: string;
  sending: boolean;
  capture: () => TokenSpan;
  insert: (text: string, span: TokenSpan) => boolean;
}) {
  useLocale();
  const [picked, setPicked] = useState<{ text: string; trimmed: boolean } | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [justShown, setJustShown] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLElement>(null);
  // The listener is added once, so it reads these through refs rather than stale closures.
  const holdRef = useRef(false);
  const questionRef = useRef(question);
  questionRef.current = question;
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const shownRef = useRef(false);
  const nearBottomRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const scroller = anchorRef.current?.closest("[data-conversation-scroll]") ?? null;
      const text = chatSelection(document.getSelection(), scroller ?? document.body);
      const inBar = barRef.current?.contains(document.activeElement) === true;
      if (text !== null) {
        // A streaming re-render can shift a live range without collapsing it; the quote must not
        // change under someone typing their question. A new selection takes focus out first.
        if (inBar) return;
        nearBottomRef.current =
          scroller !== null &&
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 4;
        setPicked(clampQuote(text));
        setNote("");
        return;
      }
      if (holdRef.current || askingRef.current || inBar || questionRef.current.trim() !== "")
        return;
      setPicked(null);
    };
    // A pointer selection is read once the pointer has settled, not while it is still moving: a
    // double click selects a word before the third click of a triple click lands, and the bar
    // appearing in between grew the seat and scrolled the chat, so the third click hit moved text
    // (owner, 2026-09-24). A drag paused mid-way showed the bar the same way. Keyboard selection
    // (Shift+arrows, no pointer down) keeps the short delay.
    let pointerDown = false;
    const onChange = () => {
      clearTimeout(timer);
      if (pointerDown) return;
      timer = setTimeout(read, 150);
    };
    const onDown = () => {
      pointerDown = true;
      clearTimeout(timer);
    };
    // A tap collapses the page selection before its click fires, and a mobile browser may send that
    // click in a later task than pointerup, so the hold lasts until the click (or 400 ms without one).
    const onClick = () => {
      clearTimeout(release);
      release = setTimeout(() => (holdRef.current = false), 0);
    };
    const onUp = () => {
      clearTimeout(release);
      release = setTimeout(() => (holdRef.current = false), 400);
      pointerDown = false;
      clearTimeout(timer);
      // A plain click with nothing selected and no bar up has nothing to read.
      if (document.getSelection()?.isCollapsed !== false && !shownRef.current) return;
      // Past the double-click window a further click starts a new selection, not a longer one.
      timer = setTimeout(read, SELECTION_SETTLE_MS);
    };
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("click", onClick, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp);
    return () => {
      clearTimeout(timer);
      clearTimeout(release);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Announce once per appearance, and keep the newest reply's last lines in view: the composer seat
  // is sticky, so a bar that grows it covers the tail of the chat, often the text just selected.
  const shown = picked !== null;
  useLayoutEffect(() => {
    if (shown === shownRef.current) return;
    shownRef.current = shown;
    if (!shown) {
      setJustShown(false); // so the next appearance is announced again
      return;
    }
    setJustShown(true);
    // Back to the bottom rather than up by the bar's height: the seat also grows by dsh's stack gap.
    const scroller = anchorRef.current?.closest("[data-conversation-scroll]");
    if (nearBottomRef.current && scroller) scroller.scrollTop = scroller.scrollHeight;
    const off = setTimeout(() => setJustShown(false), 1000);
    return () => clearTimeout(off);
  }, [shown]);

  const close = () => {
    setPicked(null);
    setQuestion("");
    setNote("");
  };

  const quote = () => {
    if (picked === null) return;
    const block = quoteMarkdown(picked.text);
    const s = capture();
    // Collapsed to the end of whatever the composer had selected, so selected text is never replaced.
    const at = { ...s, start: s.end };
    if (!insert(at.end > 0 ? `\n\n${block}` : block, at)) {
      setNote(t("main.selection.quoteBusy"));
      return;
    }
    // Lexical's commit already focused the editor with the caret after the quote; a bare DOM focus
    // would put the caret at the start, so it is only a fallback for an editor that kept no focus.
    const box = composerOf(anchorRef.current);
    if (box !== null && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    close();
  };

  const ask = async () => {
    if (picked === null || asking) return;
    setAsking(true);
    setNote("");
    try {
      const r = await fetch(`${ROUTE}/side-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(askBody(sessionId, question, picked.text)),
      });
      if (r.ok) {
        document.getSelection()?.removeAllRanges();
        close();
      } else {
        setNote(t(r.status === 409 ? "main.selection.noProcess" : "main.selection.askFailed"));
      }
    } catch {
      setNote(t("main.selection.askFailed"));
    } finally {
      setAsking(false);
    }
  };

  const onFieldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void ask();
  };

  return (
    <>
      <span ref={anchorRef} hidden data-omc-selection-anchor="" />
      <span aria-live="polite" style={visuallyHidden}>
        {justShown ? t("main.selection.ready") : ""}
      </span>
      {picked === null ? null : (
        // dsh's dock-card box, as the aside card uses, so the bar lines up with the composer and
        // takes the panel's hover and focus rules.
        <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- catches Escape from the field and buttons inside and holds the bar through a tap; every action is a real button inside */}
          <section
            ref={barRef}
            aria-label={t("main.selection.region")}
            data-omc-selection-bar=""
            onPointerDown={() => (holdRef.current = true)}
            onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}
            onKeyDown={(e) => e.key === "Escape" && close()}
            style={{
              boxSizing: "border-box",
              background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
              border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
              borderRadius: "12px 12px 0 0",
              padding: "6px 8px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {/* Header: the passage, one line, so the person sees what they are about to send. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <Spark size={12} />
              <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: "0 0 auto" }}>
                {t("main.selection.title")}
              </span>
              <span
                data-omc-selection-preview=""
                title={picked.text}
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
                {previewOf(picked.text)}
              </span>
              {picked.trimmed ? (
                <span style={{ color: T.faint, fontSize: 11, flex: "0 0 auto" }}>
                  {t("main.selection.trimmed", { max: String(QUOTE_MAX) })}
                </span>
              ) : null}
              <button
                type="button"
                data-omc-selection-close=""
                onClick={close}
                aria-label={t("main.selection.closeAria")}
                style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
              >
                ✕
              </button>
            </div>
            {/* An optional question, then Quote and Ask. Wraps on a narrow phone, field first. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <input
                data-omc-selection-question=""
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onFieldKey}
                aria-label={t("main.selection.questionAria")}
                placeholder={t("main.selection.questionPlaceholder")}
                disabled={asking}
                style={{ ...inputStyle, flex: "1 1 180px" }}
              />
              <button
                type="button"
                data-omc-selection-quote=""
                onClick={quote}
                disabled={asking || sending}
                style={btn}
              >
                {t("main.selection.quote")}
              </button>
              <button
                type="button"
                data-omc-selection-ask=""
                onClick={() => void ask()}
                disabled={asking}
                style={btnPrimary}
              >
                {asking ? t("main.selection.asking") : t("main.selection.ask")}
              </button>
            </div>
            {note !== "" ? (
              <div role="alert" data-omc-selection-note="" style={{ color: T.err, fontSize: 12 }}>
                {note}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
