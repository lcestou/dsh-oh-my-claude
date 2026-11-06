// The actions dsh's own selection popover shows: its Quote, redrawn here, and Ask. dsh opens one
// plugin's surface per selection, so Ask cannot sit beside Quote as a second entry; this entry
// shadows `message-quotes` in the same cell instead, and dsh's admission still decides when it opens.
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "./i18n.js";
import {
  ROUTE,
  T,
  DOCK_ATTR,
  inputStyle,
  panelSurface,
  useActiveClaude,
  type ClientCtx,
} from "./shared.js";
import { askBody, chatSelection, QUOTE_MAX } from "./selection.js";
import { useHintFlag } from "./hints.js";

/** A phone or tablet: the main pointer is a finger. There the OS draws its own copy and paste
 *  toolbar and drag handles at the selection, over dsh's popover, so the actions dock above the
 *  composer instead (`TouchSelectionDock`). A narrow desktop window still has a mouse: popover. */
export const touchScreen = (): boolean => matchMedia("(pointer: coarse)").matches;

/** The marker the stylesheet (turn-status.tsx) paints dsh's floating pill and the accent on. */
const ACTION_ATTR = "data-omc-selection-action";

/** dsh's `TextInteractionSurface` plus the standard props this entry reads. */
export interface SelectionActionsProps {
  ctx: ClientCtx;
  sessionId?: string;
  readText?: () => string | null;
  dismiss?: () => void;
  clearSelection?: () => void;
  inputActions?: { insertQuote?: (text: string) => boolean };
  useSession?: <V>(
    select: (s: {
      removed: boolean;
      subagent: null | { address: { mode: string }; parentAvailable?: boolean };
    }) => V,
  ) => V;
  /** dsh's `messageQuotes` dictionary, so Quote reads exactly as dsh's own button. */
  t?: (key: string) => string;
  /** Drawn by `TouchSelectionDock` above the composer rather than in dsh's popover. */
  docked?: boolean;
}

/** Keeps focus where it is on a press: moving it out of the chat collapses the selection Quote
 *  reads, and Safari, which focuses no button on click, would drop the question box's to the body. */
const keepSelection = (e: React.PointerEvent) => e.preventDefault();

const SURFACE = "[data-text-interaction-surface]";
/** dsh's gap between its popover and the passage. */
const PASSAGE_GAP = 8;

/** The passage the Ask panel belongs to: the index of the line rect dsh anchored its popover to,
 *  and whether the popover sat above that line when Ask opened. */
interface PassageAnchor {
  range: Range;
  line: number;
  above: boolean;
}

/** The area dsh places its popover in (its `visibleBounds`): the viewport cut by the chat column,
 *  every clipping ancestor of the passage, and the composer's top. */
const placementArea = (range: Range, surface: Element) => {
  const area = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const column = surface.parentElement?.getBoundingClientRect();
  if (column) {
    area.left = Math.max(area.left, column.left);
    area.right = Math.min(area.right, column.right);
  }
  const start = range.commonAncestorContainer;
  for (let el = start instanceof Element ? start : start.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      area.left = Math.max(area.left, box.left);
      area.right = Math.min(area.right, box.right);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      area.top = Math.max(area.top, box.top);
      area.bottom = Math.min(area.bottom, box.bottom);
    }
  }
  const composer = surface
    .closest("[data-conversation-scroll]")
    ?.querySelector("[data-composer-seat]")
    ?.getBoundingClientRect();
  if (composer && composer.height > 0) area.bottom = Math.min(area.bottom, composer.top);
  return area;
};

/** Text with all whitespace dropped, to compare a range's text with dsh's projection of it. */
const withoutSpace = (value: string) => value.replace(/\s+/g, "");

/** The anchor for a selection dsh has just placed its popover for: the first line in view, as
 *  dsh's `place()` picks it. Null when the range does not hold the passage dsh read; a range's text
 *  may carry what dsh's leaves out (a code block's label and Copy button) and lacks its line breaks. */
const passageAnchor = (range: Range | null, surface: Element | null, text: string) => {
  if (range === null || surface === null || range.collapsed) return null;
  if (!withoutSpace(range.toString()).includes(withoutSpace(text))) return null;
  const area = placementArea(range, surface);
  const lines = [...range.getClientRects()];
  const line = Math.max(
    0,
    lines.findIndex(
      (r) =>
        r.right > area.left && r.left < area.right && r.bottom > area.top && r.top < area.bottom,
    ),
  );
  const top = lines[line]?.top ?? range.getBoundingClientRect().top;
  return { range, line, above: surface.getBoundingClientRect().bottom <= top };
};

/** Keeps the Ask panel beside its passage: dsh re-places its surface on every scroll, clamped into
 *  view and flipped above or below the passage, so the panel is translated back to the line Ask
 *  opened on, on the same side, and grows away from it. A detached range leaves the last position. */
function usePinnedPanel(
  panelRef: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  anchor: React.RefObject<PassageAnchor | null>,
) {
  useEffect(() => {
    const panel = panelRef.current;
    const surface = panel?.closest<HTMLElement>(SURFACE);
    const passage = anchor.current;
    if (!open || !panel || !surface || !passage) return;
    let dy = 0;
    const align = () => {
      const lines = passage.range.getClientRects();
      const at = lines.item(Math.min(passage.line, lines.length - 1));
      if (at === null || at.height === 0) return;
      const box = panel.getBoundingClientRect();
      const target = passage.above ? at.top - PASSAGE_GAP - box.height : at.bottom + PASSAGE_GAP;
      dy += target - box.top;
      panel.style.transform = `translate(0px, ${dy}px)`;
    };
    // The surface's own box stays where dsh puts it; it must not catch clicks meant for the chat.
    surface.style.pointerEvents = "none";
    const moved = new MutationObserver(align);
    moved.observe(surface, { attributes: true, attributeFilter: ["style"] });
    const resized = new ResizeObserver(align);
    resized.observe(panel);
    return () => {
      moved.disconnect();
      resized.disconnect();
      panel.style.transform = "";
      surface.style.pointerEvents = "";
    };
  }, [panelRef, open, anchor]);
}

/**
 * Quote does what dsh's button does: dsh's quote chip goes into the composer. Ask, in a Claude
 * session while the switch is on, turns the popover into a question box; Enter sends the passage
 * as an aside, a blank question asks Claude to explain it, and Esc (dsh's) closes the popover.
 */
export function SelectionActions(props: SelectionActionsProps) {
  useLocale();
  const { ctx, sessionId = "", readText, dismiss, clearSelection, inputActions } = props;
  // dsh's own Quote's condition (message-quotes' QuoteSelectionAction).
  const enabled =
    props.useSession?.(
      (s) =>
        !s.removed &&
        (s.subagent === null ||
          (s.subagent.address.mode === "continuable" && s.subagent.parentAvailable === true)),
    ) ?? true;
  const claude = useActiveClaude(ctx, sessionId);
  const [off] = useHintFlag("selectionOff");
  const [passage, setPassage] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<PassageAnchor | null>(null);
  usePinnedPanel(panelRef, passage !== null, anchor);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // On a touch screen the dock above the composer carries the actions; dsh's popover is closed.
  const touch = props.docked !== true && touchScreen();
  useEffect(() => {
    if (!enabled || touch) dismiss?.();
  }, [enabled, touch, dismiss]);
  useEffect(() => {
    if (passage !== null) fieldRef.current?.focus();
  }, [passage]);

  const quoteLabel = props.t;
  if (
    !enabled ||
    touch ||
    readText === undefined ||
    dismiss === undefined ||
    quoteLabel === undefined
  )
    return null;

  const close = () => {
    clearSelection?.();
    dismiss();
  };

  const quote = () => {
    const text = readText();
    if (text === null) return dismiss();
    if (inputActions?.insertQuote?.(text) !== true) return;
    close();
  };

  const openAsk = (e: React.MouseEvent<HTMLButtonElement>) => {
    const text = readText();
    if (text === null) return dismiss();
    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    // Read while the buttons stand where dsh put them, before the panel grows and dsh re-places it.
    anchor.current = passageAnchor(range, e.currentTarget.closest(SURFACE), text);
    setPassage(text.slice(0, QUOTE_MAX));
  };

  const ask = async () => {
    if (passage === null || asking) return;
    setAsking(true);
    setNote("");
    try {
      const r = await fetch(`${ROUTE}/side-questions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(askBody(sessionId, question, passage)),
      });
      // dsh's clearSelection and dismiss act on whatever selection and popover are current: once
      // this popover is gone (a click elsewhere), a late answer must leave the next one alone.
      if (!mounted.current) return;
      if (r.ok) return close();
      setNote(t(r.status === 409 ? "main.selection.noProcess" : "main.selection.askFailed"));
    } catch {
      if (mounted.current) setNote(t("main.selection.askFailed"));
    } finally {
      if (mounted.current) setAsking(false);
    }
  };

  // The composer's keys: Enter sends, Shift+Enter breaks the line, and Enter while an input method
  // is composing only commits the candidate. Escape mid-composition only drops the candidate, so
  // it is kept from dsh's document keydown, which would close the popover and lose the question.
  const onFieldKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && e.nativeEvent.isComposing) {
      e.stopPropagation();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void ask();
  };

  if (passage === null) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          {...{ [ACTION_ATTR]: "quote" }}
          onPointerDown={keepSelection}
          onClick={quote}
        >
          {quoteLabel("quote.add")}
        </button>
        {claude && !off ? (
          <button
            type="button"
            {...{ [ACTION_ATTR]: "ask" }}
            onPointerDown={keepSelection}
            onClick={openAsk}
          >
            {t("main.selection.ask")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      {...{ [DOCK_ATTR]: "1" }}
      ref={panelRef}
      data-omc-selection-ask-panel=""
      style={{
        ...panelSurface,
        pointerEvents: "auto",
        boxSizing: "border-box",
        width: 320,
        maxWidth: "100%",
        borderRadius: 12,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        data-omc-selection-preview=""
        title={passage}
        style={{
          color: T.muted,
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {passage.replace(/\s+/g, " ").trim()}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <textarea
          ref={fieldRef}
          data-omc-selection-question=""
          rows={1}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onFieldKey}
          aria-label={t("main.selection.questionAria")}
          placeholder={t("main.selection.questionPlaceholder")}
          readOnly={asking}
          style={{
            ...inputStyle,
            flex: "1 1 auto",
            height: "auto",
            // Grows with its lines, as the composer does, up to about six, then scrolls.
            fieldSizing: "content",
            maxHeight: 128,
            padding: "5px 10px",
            resize: "none",
            overflowY: "auto",
          }}
        />
        <button
          type="button"
          {...{ [ACTION_ATTR]: "send" }}
          onPointerDown={keepSelection}
          onClick={() => void ask()}
          // Not `disabled`: that moves focus out of dsh's surface, which then closes on the next
          // selectionchange. `ask` already ignores a second press while one is in flight.
          aria-disabled={asking}
        >
          {asking ? t("main.selection.asking") : t("main.selection.ask")}
        </button>
      </div>
      {note !== "" ? (
        <div role="alert" data-omc-selection-note="" style={{ color: T.err, fontSize: 12 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

/**
 * On a touch screen, the same Quote and Ask above the composer, where the OS's selection toolbar and
 * drag handles never cover them. The passage is read when the selection changes, since a tap on a
 * button can collapse the selection before the tap lands; a collapse from a press outside the dock
 * (a tap elsewhere in the chat) hides it, one inside (the question box) does not.
 */
export function TouchSelectionDock({
  ctx,
  sessionId,
  inputActions,
}: {
  ctx: ClientCtx;
  sessionId?: string;
  inputActions?: SelectionActionsProps["inputActions"];
}) {
  useLocale();
  const touch = touchScreen();
  const [picked, setPicked] = useState<string | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const pressedInside = useRef(false);
  useEffect(() => {
    if (!touch) return;
    const onDown = (e: PointerEvent) => {
      pressedInside.current =
        e.target instanceof Node && dockRef.current?.contains(e.target) === true;
    };
    const onChange = () => {
      const text = chatSelection(document.getSelection(), document.body);
      if (text !== null) setPicked(text);
      else if (!pressedInside.current && document.getSelection()?.isCollapsed !== false)
        setPicked(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    document.addEventListener("selectionchange", onChange);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [touch]);
  if (!touch || picked === null || !sessionId) return null;
  return (
    <div
      ref={dockRef}
      data-omc-selection-dock=""
      style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}
    >
      <SelectionActions
        ctx={ctx}
        sessionId={sessionId}
        docked
        readText={() => picked}
        dismiss={() => setPicked(null)}
        clearSelection={() => document.getSelection()?.removeAllRanges()}
        inputActions={inputActions}
        t={() => t("main.selection.quote")}
      />
    </div>
  );
}

/**
 * Puts Ask into dsh's selection popover (dsh 0.2.2-alpha.2 on), beside its Quote text. Priority -1
 * shadows dsh's `quote` entry; if ours crashes or unloads, dsh's comes back. An older dsh never
 * declares the slot, so there is no selection action at all. The slot is declared per chat view,
 * so the registration is handed back to be undone with it; a dsh that refuses the shadow keeps its
 * own Quote and Ask is simply absent.
 */
export function mountSelectionActions(ctx: ClientCtx): void {
  ctx.slots.inject("conversation.chat.text-interaction", () => {
    try {
      return ctx.slots.register(
        {
          name: "conversation.chat.text-interaction",
          key: "quote",
          priority: -1,
          locale: "messageQuotes",
        },
        (props) => <SelectionActions {...props} ctx={ctx} />,
      );
    } catch (e) {
      // A dsh that refuses the shadow keeps its own Quote; Ask is simply absent.
      console.warn("[oh-my-claude] selection actions not registered:", e);
      return () => {};
    }
  });
  // The touch-screen dock: the composer dock is the one place a phone's own selection toolbar
  // never covers. The renderer draws the lowest order first: dsh's todo is 0, forge 5, goal 10,
  // the queue 20 (0.2.2-rc.1), the plugin's own 42 to 49. -10 puts the buttons above all of them,
  // which suits a row that exists only while text is selected (owner, 2026-11-06). Nothing with a
  // mouse.
  ctx.slots.inject("conversation.input.dock", () => {
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-selection-touch", order: -10 },
      (props) => (
        <TouchSelectionDock
          ctx={ctx}
          sessionId={props.sessionId}
          inputActions={props.inputActions}
        />
      ),
    );
    return null;
  });
}
