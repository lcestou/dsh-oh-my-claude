import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { createPortal } from "react-dom";
import {
  PANEL_INSET,
  PANEL_ATTR,
  panelSurface,
  tabStyle,
  ensurePanelStyle,
  T,
  isOwnedActive,
  useActiveClaude,
  useNarrow,
  useDismiss,
  PANEL_ACCENT,
} from "./shared.js";
import { t, useLocale, type OmcKey } from "./i18n.js";
import { Tooltip } from "@deepseek-ai/dsh-client-ui-primitives";
import { Spark } from "./spark.js";
import { TuneBody } from "./tune.js";
import { easeMs, markHint, readHints, useFitAbove, useHeightEase } from "./panel/shared.js";
import { RestoreBody, useTranscripts } from "./panel/restore.js";
import { MemoryBody } from "./panel/memory.js";
import { InstructionsBody } from "./panel/instructions.js";
import { SkillsBody } from "./panel/skills.js";
import { RewindBody } from "./panel/rewind.js";
import { ChangesBody } from "./panel/changes.js";
import { McpBody } from "./panel/mcp.js";
import { AsidesBody } from "./panel/asides.js";
import { DiagnosticsBody } from "./panel/diagnostics.js";
import { TasksBody } from "./panel/tasks.js";

export { AccessShield, AccessTrigger } from "./panel/access.js";
export { sessionLabel } from "./panel/shared.js";

// Module-level variable so reopening lands on the last picked tab.
let lastTab = "Memory";

/**
 * Single consolidated trigger for the Oh My Claude panel. One button replaces the five legacy
 * composer-slot buttons (Restore, Memory, Rewind, Changes, MCP). Clicking it opens a tabbed
 * dialog whose body is each legacy control's dialog content, moved verbatim into a body component.
 */
export function OhMyClaudeControl({ sessionId, ctx }: import("./shared.js").RestoreButtonProps) {
  // Subscribed, not read: the button must come up on the picker change itself, and this slot is
  // not re-rendered for one (see useActiveClaude).
  const isMine = useActiveClaude(ctx, sessionId);
  useLocale();
  // `open` is what is mounted, `shown` is what the transition draws. A close flips `shown` first
  // and unmounts a duration later, so the panel fades out instead of blinking away.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [tab, setTab] = useState(lastTab);
  // A blank session with transcripts to restore: the panel opens on Restore, the disc carries a
  // dot until the panel has been opened once here, and the very first time on this box the disc
  // pulses a few times. The dot and the default tab need no memory; the pulse is remembered on
  // the box through the hints store, so it fires once and never again after an update.
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const restorable = useTranscripts(entry?.blank === false ? undefined : entry?.cwd).filter(
    (s) => !isOwnedActive(s),
  ).length;
  const [seenRestore, setSeenRestore] = useState(false);
  const [pulse, setPulse] = useState(false);
  // A first-run pointer at the spark, for a box that has never used the plugin. The box counts as
  // used once either hint is set, so nobody upgrading sees it: the restore pulse has fired on every
  // box that has had a transcript to restore. Declared before the pulse effect below, so both read
  // the hints as they stood on load, before the pulse marks its own.
  const [tip, setTip] = useState(false);
  useEffect(() => {
    let live = true;
    void readHints().then((h) => {
      if (live && h !== null && !h.sparkTip && !h.restorePulse) setTip(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const dropTip = () => {
    if (!tip) return;
    setTip(false);
    markHint("sparkTip");
  };
  useEffect(() => {
    if (restorable === 0 || entry?.blank === false) return;
    let live = true;
    void readHints().then((h) => {
      if (!live || h === null || h.restorePulse) return;
      markHint("restorePulse");
      setPulse(true);
      setTimeout(() => live && setPulse(false), 4000);
    });
    return () => {
      live = false;
    };
  }, [restorable, entry?.blank]);
  // dsh's composer card, found when the panel opens: the panel is portalled into it and sits over
  // the composer the way dsh's own slash menu does. `data-composer-card` is the hook dsh's menu
  // dismisses by, so it is as stable as that menu. Null on a host without it: the panel then
  // floats fixed above the control, as before.
  const [card, setCard] = useState<HTMLElement | null>(null);
  // Phone sheet (fallback only): fixed, above the control, wherever the composer sits.
  const [above, setAbove] = useState(0);
  const maxHeight = useFitAbove(panelRef, 400, open);
  useHeightEase(panelRef, open);

  // dsh's chat width handles sit at the edges of the conversation column, outside this panel's
  // box, so a panel above them still leaves them hoverable and the column resizes under an open
  // dialog. They are dsh's own elements: mark the body instead, and the plugin's style block
  // switches their pointer events off for as long as the panel is mounted.
  useEffect(() => {
    if (!open) return;
    document.body.dataset.omcPanelOpen = "1";
    return () => {
      delete document.body.dataset.omcPanelOpen;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    ensurePanelStyle(); // hover, focus and active rules for everything inside; idempotent
    // One frame after mount, so the browser has a closed style to transition away from.
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  // False when an outside click closed the panel: that click already moved focus where the person
  // wanted it, and pulling it back to the trigger lit up the trigger's tooltip.
  const refocus = useRef(true);
  const close = useCallback((how?: "pointer" | "key") => {
    refocus.current = how !== "pointer";
    setShown(false);
    closeTimer.current = setTimeout(() => setOpen(false), easeMs());
  }, []);
  // A pending close must not unmount a panel the next click just reopened.
  const openPanel = useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
    setShown(false);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // The panel, not the trigger: a portal takes it out of the trigger's DOM subtree.
  useDismiss(open, close, panelRef);

  // On open, move focus onto the selected tab so a keyboard user lands inside the panel instead of
  // on the trigger behind the portal; on close, hand focus back to whatever held it first. No trap:
  // the panel is not modal and the page around it stays usable. An outside click is the exception:
  // focus stays where that click put it.
  useEffect(() => {
    if (!open) return;
    // Record the focused element before focus moves, so close can return it.
    const before = document.activeElement;
    document.getElementById(`omc-tab-${tab}`)?.focus();
    return () => {
      if (refocus.current && before instanceof HTMLElement && document.contains(before))
        before.focus();
    };
  }, [open]);

  if (!isMine) return null;
  // Restore only fits a blank session; the Restore body hides itself for the same reason.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;

  // Over the composer, like dsh's slash menu: absolute in the card, 4 px above it, its full width,
  // on dsh's menu surface (the `--dsw-specific-menu` fill and the prominent elevation), 20 px
  // corners. z-index 100 is what dsh gives that menu. Without a card (an older host), fall back to
  // a fixed float centred in the viewport by insets (`100vw` counts the scrollbar; an inset cannot
  // overshoot), sized to the tab strip on desktop and to the phone under 640 px.
  // overflow hidden so the body is the only scroller and the tab strip cannot scroll out of it.
  const panelStyle: CSSProperties = card
    ? {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 4px)",
        maxHeight,
        zIndex: 100,
        background: `var(--dsw-specific-menu, ${T.card})`,
        // dsh 0.1.7 made that fill translucent and leans on the blur behind it; without this the
        // card reads as see-through over the chat. Older dsh has no such variable and no need
        // for one: the fill was opaque, and an unset backdrop filter is simply none.
        backdropFilter: "var(--dsw-menu-backdrop-filter)",
        boxShadow: `var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.26))`,
        // SAFETY: a custom property is not in CSSProperties; the browser reads it as written.
        ...({ "--dsw-elevation-stroke-color": "var(--dsw-alias-border-l1)" } as CSSProperties),
        borderRadius: 20,
        padding: 4,
      }
    : {
        position: "fixed",
        left: 12,
        right: 12,
        marginInline: "auto",
        bottom: above,
        width: narrow ? "auto" : "fit-content",
        maxWidth: narrow ? undefined : "calc(100vw - 24px)",
        // dvh, not vh: on a phone the browser chrome slides away and vh keeps measuring the tall value.
        maxHeight: narrow ? "60dvh" : "min(400px, 80dvh)",
        zIndex: 200,
        padding: 6,
        ...panelSurface,
        borderRadius: 10,
      };
  // In the card the panel only fades: `useFitAbove` measures the element's bottom
  // on mount, and a 6 px rise still applied at that moment would size it 6 px too tall.
  // The panel's own type base, so text a tab leaves unsized inherits 13 px on a 1.5 line instead
  // of dsh's 16/26 body, which spread every wrapped note in the panel over 26 px lines.
  Object.assign(panelStyle, {
    fontSize: 13,
    lineHeight: 1.5,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    // A wheel that reaches the panel's end, or lands on its tab strip, stays here instead of
    // scrolling the chat behind it.
    overscrollBehavior: "contain",
    opacity: shown ? 1 : 0,
    transform: shown || card ? "none" : "translateY(6px)",
    transition: `opacity ${easeMs()}ms ease, transform ${easeMs()}ms ease`,
  } satisfies CSSProperties);

  // The tab's key is both its React key and its stable `data-omc-label` hook; the visible label
  // comes from `panel.tab.<key>` at render, so the key stays English while the label translates.
  const tabs = [
    ...(blank ? [{ key: "Restore" }] : []),
    { key: "Memory" },
    { key: "Instructions" },
    { key: "Skills" },
    { key: "Rewind" },
    { key: "Changes" },
    { key: "MCP" },
    { key: "Asides" },
    { key: "Diagnostics" },
    { key: "Tasks" },
    { key: "Tune" },
  ] as const;
  // Fall back when an earlier session stored a tab no longer present (e.g. removed Permissions).
  // SAFETY: tabs is const-as, so tb.key is a literal string; the map produces string[].
  if (!(tabs.map((tb) => tb.key) as readonly string[]).includes(lastTab)) lastTab = "Memory";

  return (
    <span ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      {/* dsh's own bubble, as on the composer's "+" and "Add attachment" buttons, in place of the
          browser's title tooltip. Off while the panel is open so it does not sit on the tab strip. */}
      <Tooltip label="Oh My Claude" side="top" delayMs={500} disabled={open}>
        <button
          type="button"
          // The same disc as dsh's own composer buttons (`+` and Add attachment): 28 px, no border,
          // but bare at rest and filled with their hover shade only under the pointer or while the
          // panel is open; the mark at 15 px reads at the size of their 14 px strokes. Written on
          // the tokens rather than dsh's hashed class, which a build renames. dsh gives every
          // element `corner-shape: superellipse(1.5)` where the browser knows the property and its
          // round buttons opt back out, so ours does too (the rule beside the hover one in
          // shared.ts) or a 999 px radius draws a squircle.
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: "none",
            borderRadius: 999,
            background: open ? T.hoverSolid : "transparent",
            color: PANEL_ACCENT,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
            cursor: "pointer",
            position: "relative",
          }}
          aria-label="Oh My Claude"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-omc-panel-trigger=""
          {...(pulse ? { "data-omc-pulse": "" } : {})}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            setSeenRestore(true);
            dropTip();
            setTab(
              blank && restorable > 0
                ? "Restore"
                : lastTab === "Restore" && !blank
                  ? "Memory"
                  : lastTab,
            );
            const host = rootRef.current?.closest<HTMLElement>("[data-composer-card]") ?? null;
            setCard(host);
            const rect = rootRef.current?.getBoundingClientRect();
            if (!host && rect) setAbove(Math.max(12, window.innerHeight - rect.top + 8));
            openPanel();
          }}
        >
          <Spark size={15} color="currentColor" />
          {blank && restorable > 0 && !seenRestore && !open && (
            <span
              data-omc-restore-badge=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 7,
                height: 7,
                borderRadius: 999,
                background: PANEL_ACCENT,
                boxShadow: "0 0 0 2px var(--dsw-specific-input-major, #fff)",
              }}
            />
          )}
        </button>
      </Tooltip>
      {tip && !open && (
        <span
          data-omc-spark-tip=""
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
          role="status"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px 6px 10px",
            borderRadius: 10,
            whiteSpace: "nowrap",
            fontSize: 12,
            color: T.text,
            background: `var(--dsw-specific-menu, ${T.card})`,
            backdropFilter: "var(--dsw-menu-backdrop-filter)",
            boxShadow: `var(--dsw-elevation-prominent, 0 10px 28px rgba(0,0,0,.26))`,
          }}
        >
          {t("panel.tip")}
          <button
            type="button"
            aria-label={t("panel.dismiss")}
            title={t("panel.dismiss")}
            onClick={dropTip}
            style={{
              background: "none",
              border: "none",
              padding: "0 2px",
              cursor: "pointer",
              color: T.faint,
            }}
          >
            ×
          </button>
        </span>
      )}
      {open &&
        portal(
          card,
          <div
            ref={panelRef}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal popover; <dialog> hides unless open and brings its own box
            role="dialog"
            aria-label="Oh My Claude"
            {...{ [PANEL_ATTR]: "1" }}
            style={panelStyle}
          >
            <div
              role="tabpanel"
              id="omc-tabpanel"
              aria-labelledby={`omc-tab-${tab}`}
              // width:0 + minWidth:100% keeps the body from contributing to the panel's fit-content
              // width: it fills whatever the tab strip sets, and its own long lines scroll rather than
              // widen the panel past the tabs.
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                overflow: "auto",
                overscrollBehavior: "contain",
                // The panel's one inset, top and bottom as well as the sides: every tab's first row, cards and
                // headings line up on it.
                padding: PANEL_INSET,
                width: card || narrow ? undefined : 0,
                minWidth: card || narrow ? undefined : "100%",
              }}
            >
              {tab === "Restore" && <RestoreBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Memory" && <MemoryBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Instructions" && <InstructionsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Skills" && <SkillsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Rewind" && <RewindBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Changes" && <ChangesBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "MCP" && <McpBody sessionId={sessionId} ctx={ctx} onClose={close} />}
              {tab === "Asides" && <AsidesBody sessionId={sessionId} />}
              {tab === "Diagnostics" && <DiagnosticsBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Tasks" && <TasksBody sessionId={sessionId} ctx={ctx} />}
              {tab === "Tune" && <TuneBody sessionId={sessionId} ctx={ctx} />}
            </div>
            {/* Under the body, not over it: the panel is anchored to its bottom edge, so a taller tab
              pushes the top up and leaves the strip where the pointer left it. */}
            <div
              role="tablist"
              // ARIA APG keeps the strip itself out of the Tab order (only the selected tab is
              // focusable), but this lint rule makes a role="tablist" with a key handler focusable,
              // so tabIndex={-1} satisfies it without adding a Tab stop of its own.
              tabIndex={-1}
              // Arrow keys step the tabs in list order, wrapping at the ends; Home/End jump to the
              // first and last. Only the selected tab is in the Tab order, so arrows are how a
              // keyboard user moves. "Next" is next in the list, not the next row, matching ARIA APG.
              onKeyDown={(e) => {
                // Only these four keys are ours; every other key keeps its default, so focus can
                // still leave the strip.
                if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                const order = tabs.map((tb) => tb.key);
                const index = order.indexOf(tab);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % order.length
                    : e.key === "ArrowLeft"
                      ? (index - 1 + order.length) % order.length
                      : e.key === "Home"
                        ? 0
                        : order.length - 1;
                const key = order[next];
                // next is always a valid index, so this never fires; it narrows key to string.
                if (!key) return;
                lastTab = key;
                setTab(key);
                // Reach the button by the id it already carries, not by a ref.
                document.getElementById(`omc-tab-${key}`)?.focus();
              }}
              style={{
                display: "flex",
                flex: "0 0 auto",
                borderTop: `1px solid color-mix(in srgb, ${PANEL_ACCENT} 18%, ${T.border})`,
                // On the body's inset, rule included: dsh's own tab strips (the plugin settings
                // page) keep their underline inside the content column, not edge to edge.
                marginInline: PANEL_INSET,
                paddingTop: 4,
                gap: narrow ? 0 : 2,
                // Wrap rather than scroll sideways: a strip that scrolls hides the tab that did not
                // fit, and the panel is anchored to its bottom edge, so a second row grows upward.
                flexWrap: "wrap",
                rowGap: 4,
              }}
            >
              {tabs.map((tabDef) => {
                // SAFETY: every tabs[].key has a matching panel.tab.<key> entry in the dictionary.
                const label = t(`panel.tab.${tabDef.key}` as OmcKey);
                return (
                  <button
                    key={tabDef.key}
                    role="tab"
                    data-omc-label={tabDef.key}
                    id={`omc-tab-${tabDef.key}`}
                    aria-controls="omc-tabpanel"
                    aria-selected={tab === tabDef.key}
                    // Only the selected tab is in the Tab order; arrows move between tabs (the tablist
                    // handler), so the others stay out of the way.
                    tabIndex={tab === tabDef.key ? 0 : -1}
                    // The strip sits under the body, so the lit edge is the mirror of a top tab bar:
                    // accent along the bottom, corners rounded on that side only, no box around each
                    // tab (nine bordered boxes read as buttons, not as tabs). Hover is in the sheet.
                    // 8 px sides on a phone: the strip's inset would otherwise push the last tab
                    // onto a fourth row at 390 px.
                    style={
                      narrow
                        ? { ...tabStyle(tab === tabDef.key), paddingInline: 8 }
                        : tabStyle(tab === tabDef.key)
                    }
                    onClick={() => {
                      lastTab = tabDef.key;
                      setTab(tabDef.key);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>,
        )}
    </span>
  );
}

/** Render `node` inside dsh's composer card when one was found, else in place. */
const portal = (card: HTMLElement | null, node: ReactElement) =>
  card ? createPortal(node, card) : node;
