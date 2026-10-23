// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box. Filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import { installLocale, t, useLocale } from "./i18n.js";
import { useEffect, useState } from "react";
import {
  ROUTE,
  fmtCost,
  fmtDuration,
  cacheShare,
  T,
  readJson,
  ACCENT,
  SHIMMER,
  SessionData,
  isOwnedActive,
  activeClaudeSession,
  type ClientCtx,
  type DirectoryFlowOwnerProps,
  openHere,
  whenContextGone,
  guard,
  retire,
  revive,
} from "./shared.js";
import { themeSplitPatch, hasTheme } from "./theme.js";
import { PluginUpdateBadge } from "./update-pill.js";
import { ReportBlock } from "./report.js";
import { ChangelogBlock } from "./changelog.js";
import { Spark } from "./spark.js";
import { AccessShield, AccessTrigger, OhMyClaudeControl } from "./panel.js";
import { AddWorkflow, AddWorkspaceFlow, BOXES_EVENT } from "./picker.js";

import { sparkNode } from "./spark.js";
import { HINTS_EVENT, loadHints, writeHints, applyTheme } from "./hints.js";
import { watchSessionNotices } from "./session-notices.js";
import { ToolIconSprites, watchToolFolds } from "./tool-folds.js";
import {
  DockStatus,
  RowMark,
  watchEventStream,
  watchTurnStatus,
  claudeRunningTitles,
} from "./turn-status.js";
import { BoxData, Boxes, Card } from "./boxes.js";
import { Sessions } from "./sessions-tab.js";
import { CostLine } from "./cost.js";
import {
  ClaudeUpdateSwitch,
  CompactNudgeSwitch,
  ContextRowMask,
  ContextSwitch,
  CostSwitch,
  DockStatusSwitch,
  LimitWarningsSwitch,
  ProxyFirstPartySwitch,
  ReturnRecapSwitch,
  SelectionSwitch,
  SpendGuardField,
  StaleModelRepair,
  StarLine,
  StarterSwitch,
  SuggestionSwitch,
  TerminalSyncSwitch,
  ThemeSwitch,
  ToolRowsSwitch,
  UpdateNoticeSwitch,
  WorkspaceModelMemory,
  WorkspaceModelSwitch,
} from "./settings-card.js";

import { watchContextMeter } from "./context-meter.js";
import { watchUltrathink } from "./ultrathink.js";
import { watchRunButtons } from "./run-button.js";
import { DraftRelay, StarterSlot } from "./cards.js";
import { AsideBubble, IdleChip } from "./dock.js";
import { SelectionSlot } from "./selection-bar.js";
export { type SessionData, isOwnedActive, fmtCost, fmtDuration, cacheShare };
// The entry keeps its export list while the split runs, re-exporting from the module that owns each.
export { spinnerFrameAt, bracketOpen, pickVerb, mergeVerbs } from "./verbs.js";
export { summarize } from "./boxes.js";
export { type GroupInfo, pageSessions } from "./sessions-tab.js";
export { costDetails, formatCacheRead, isStatsRow } from "./cost.js";
export { glyphOf } from "./tool-folds.js";
export { stopTurnLine, claudeRunningTitles } from "./turn-status.js";

/** The client bundle's name, exported so dsh can identify this plugin. */
export const name = "dsh-oh-my-claude-client";
/** Services injected into the client plugin by dsh. */
export const inject = ["slots", "sessions", "workspaces", "modelDirectories"];

/** A deep link from another box's panel: open that session here once dsh is ready. */
function followDeepLink(ctx: ClientCtx) {
  const m = /[#&]claude-session=([^&]+)(?:&cwd=([^&]*))?/.exec(window.location.hash ?? "");
  if (!m) return;
  const id = decodeURIComponent(m[1] ?? "");
  const cwd = decodeURIComponent(m[2] ?? "");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  const started = Date.now();
  const tick = async () => {
    const ready = ctx.sessions.list.getSnapshot()?.phase === "ready";
    if (!ready && Date.now() - started < 15000) return void setTimeout(tick, 250);
    try {
      const body = await readJson<{ sessions?: SessionData[] } | null>(
        await fetch(`${ROUTE}/sessions?all=1`),
      );
      const sessions = body?.sessions ?? [];
      const s = sessions.find((x) => x.id === id) ?? { id, cwd };
      await openHere(ctx, s, s.cwd ?? cwd);
    } catch (e) {
      console.warn(
        `[dsh-oh-my-claude] deep link failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };
  void tick();
}

/**
 * Tint dsh's running indicator (its state-dot matrix) Claude-orange for Claude sessions, both the
 * sidebar row dot and the job/subagent/plan dots inside the open conversation, leaving every other
 * provider dsh's own colour. dsh colours the `ongoing` dot from the
 * `--dsh-state-ongoing` custom property; an inline `color` on the svg overrides it, and clearing it
 * hands the row straight back to dsh. A session that switches off a Claude mount reverts on the
 * next pass.
 *
 * The row carries no session id in the DOM, so a running dot is matched to a session by the title
 * text beside it (dsh renders `displayTitle` there, the same string the list store holds).
 * ponytail: title match, not id; two running sessions with the same title share a tint. Swap for a
 * per-row id the day dsh puts one on the row.
 */
/** The title span sits next to the slot that holds the dot; the dot's nearest span ancestor is that
 *  slot, so its next sibling is the title. Structural, so no hashed class name is needed. */
const spinnerRowTitle = (dot: Element): string | null =>
  dot.closest("span")?.nextElementSibling?.textContent?.trim() ?? null;

/** Whether the row-mark entry registered: the scan then reads the per-row mark, and falls back to
 *  the title match on a dsh without the row-action slot. */
let markActive = false;

/** The composer's primary send/stop button shares the local CSS-module class `_primary` with one
 *  button in a settings view, so class alone is not enough. The real one shares an ancestor with
 *  the message box (a contenteditable). Walk up until an ancestor holds one; null means it is not
 *  the composer button. Structural, so no hashed class is needed. */
const inComposer = (node: Element, box: Element | null): boolean => {
  // `contains` per level, against a message box the caller looked up once. The walk used to run a
  // fresh subtree query at every ancestor, which is the whole document by the time it reaches the
  // top; the query then moved out here, and now out again to the scan, which checks several
  // buttons per pass and was paying for one lookup each.
  if (box === null) return false;
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement)
    if (p.contains(box)) return true;
  return false;
};

/** Keep the composer's send button on the accent while the open session is Claude, and, only on a
 *  dsh without the row-action slot, tint the running Claude rows' sidebar glyphs by title match.
 *  Runs once a second while the tab is visible, waking on visibilitychange; everywhere else the
 *  running glyphs are coloured by the stylesheet off the body and row marks, with no walk. */
function watchSessionSpinners(ctx: ClientCtx) {
  const MARK = "data-omc-spinner";
  const SEND_MARK = "data-omc-send";
  const scan = () => {
    // A hidden tab is not being looked at, and this pass is two document-wide queries a second. The
    // visibility listener below runs it once the moment the tab comes back.
    if (document.hidden) return;
    const openClaude = activeClaudeSession(ctx) !== undefined;
    // The glyphs are tinted by the stylesheet: the ones inside the open conversation off
    // `body[data-omc-claude]`, a sidebar row's off the `data-omc-claude` mark the row-action slot
    // paints on its own row. Only a dsh without that slot needs this walk, which tints the running
    // Claude rows by matching each glyph to a session by title, the identity the mark replaces.
    if (!markActive) {
      const titles = claudeRunningTitles(ctx);
      const rowsOn = hasTheme("row");
      for (const dot of document.querySelectorAll<SVGElement>(
        '[role="treeitem"] svg[data-state="ongoing"]',
      )) {
        const title = spinnerRowTitle(dot);
        const want = rowsOn && title !== null && titles.has(title);
        if (want) {
          dot.style.color = ACCENT;
          dot.setAttribute(MARK, "1");
        } else if (dot.hasAttribute(MARK)) {
          dot.style.color = "";
          dot.removeAttribute(MARK);
        }
      }
    }
    // The composer's send/stop button (one button, aria-label toggles). dsh fills it from
    // `--dsw-alias-button-info-*`; overriding those two vars on the button recolours both the base
    // and hover states in one place, and clearing them hands it back to dsh's blue on the next pass.
    // One message-box lookup for the pass: `inComposer` is asked about every primary button dsh
    // draws, and each ask used to run its own subtree query for the same element.
    const box = document.querySelector("[contenteditable]");
    // Only the composer's own button is wanted, so only its form is searched: a substring class
    // match over the whole document, once a second, is the kind of query a browser cannot index.
    const composerRoot = box?.closest("form") ?? document;
    for (const sendBtn of composerRoot.querySelectorAll<HTMLElement>('button[class*="_primary"]')) {
      const sendWant = openClaude && hasTheme("send") && inComposer(sendBtn, box);
      if (sendWant) {
        sendBtn.style.setProperty("--dsw-alias-button-info-fill", ACCENT);
        sendBtn.style.setProperty("--dsw-alias-button-info-hover", SHIMMER);
        sendBtn.setAttribute(SEND_MARK, "1");
      } else if (sendBtn.hasAttribute(SEND_MARK)) {
        sendBtn.style.removeProperty("--dsw-alias-button-info-fill");
        sendBtn.style.removeProperty("--dsw-alias-button-info-hover");
        sendBtn.removeAttribute(SEND_MARK);
      }
    }
  };
  scan();
  // A dot going from idle to running is an attribute flip (`data-state`), not an added node, and a
  // new session row can appear at any time; a 1s poll catches both with one scan a second. A
  // body-subtree MutationObserver used to sit here too, but it re-ran the whole-document scan on
  // every mutation dsh made, so a streaming turn (hundreds of chunk appends a second) became
  // hundreds of full-page scans and janked mobile. The poll alone is enough for a sidebar dot's
  // colour. ponytail: if a newly-running row ever needs to tint faster than 1s, observe the sidebar
  // container only and coalesce with requestAnimationFrame, never document.body per mutation.
  const beat = setInterval(guard(scan), 1000);
  const wake = guard(scan);
  document.addEventListener("visibilitychange", wake);
  // On teardown, stop the scan beat and the visibility wake, so nothing rescans once the context
  // is gone.
  whenContextGone(() => {
    clearInterval(beat);
    document.removeEventListener("visibilitychange", wake);
  });
}

/** Read the hints and paint the Claude look from them; once per box, also carry an old
 *  "Links, rules and quotes" off over to the groups split from it. The write fires HINTS_EVENT,
 *  which lands back here with the marker set and stops. A failed read is logged, not thrown. */
const reapplyTheme = () =>
  void loadHints().then((hints) => {
    applyTheme(hints);
    const patch = themeSplitPatch(hints);
    if (patch) writeHints(patch);
  }, console.error);

/** Wire the plugin into a mounted dsh context: follow deep links and start every watcher, so a
 *  fresh session gets turn status, notices, folds and hints. */
export function apply(ctx: ClientCtx) {
  // A context applied after an earlier one of this same module was disposed starts live, and dsh's
  // own dispose is what ends it.
  revive();
  ctx.effect?.(() => retire);
  // First, so every string drawn below is already in the language the person picked.
  whenContextGone(installLocale(ctx));
  followDeepLink(ctx);
  watchContextMeter(ctx);
  watchEventStream(ctx);
  watchTurnStatus(ctx);
  watchRunButtons(ctx);
  watchSessionNotices(ctx);
  watchSessionSpinners(ctx);
  watchUltrathink(ctx);
  watchToolFolds();

  // The Claude look: apply the stored switches once the hints load, and again on every change
  // (a Settings switch dispatches HINTS_EVENT after its POST). Removed with the module, like the
  // interval in watchTurnStatus, so a hot reload does not stack listeners.
  // The sheets read bare var(--omc-accent); until the hints land nothing has set it and a fresh
  // page would paint the status row, links and rules unaccented for a fetch. Write the defaults
  // now, synchronously; the stored switches overwrite them a moment later.
  applyTheme({});
  reapplyTheme();
  window.addEventListener(HINTS_EVENT, reapplyTheme);
  whenContextGone(() => window.removeEventListener(HINTS_EVENT, reapplyTheme));

  const SECTION_LABEL = "Oh My Claude";

  /**
   * Renders nothing; on each mount and update finds the settings nav row labelled SECTION_LABEL
   * (by role and text, not by dsh's hashed classes) and puts the spark where dsh drew its gear,
   * keeping the gear's class so the row lays out as before. Idempotent: a swapped row is marked.
   */
  function SectionNavIcon() {
    useEffect(() => {
      const cell = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"] nav button'),
      ).find((b) => b.textContent?.trim() === SECTION_LABEL);
      const gear = cell?.querySelector("svg");
      if (!gear || gear.hasAttribute("data-omc-spark")) return;
      const spark = sparkNode(16, "currentColor");
      spark.setAttribute("class", gear.getAttribute("class") ?? "");
      spark.setAttribute("data-omc-spark", "1");
      gear.replaceWith(spark);
    });
    return null;
  }

  function Section(props: { close?: () => void }) {
    useLocale();
    const [boxes, setBoxes] = useState<BoxData[]>([]);
    const [openBoxes, setOpenBoxes] = useState(true);
    const [openSessions, setOpenSessions] = useState(false);
    const [openChangelog, setOpenChangelog] = useState(false);
    const [openReport, setOpenReport] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
      fetch(`${ROUTE}/boxes`)
        .then((r) => readJson<{ boxes?: BoxData[] }>(r))
        .then((b) => setBoxes(b.boxes ?? []))
        .catch((e: Error) => {
          setError(e.message);
          setBoxes([]);
        });
    }, []);
    return (
      <div data-omc-settings="">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Spark size={16} />
          <h2 id="dsh-oh-my-claude-heading" style={{ margin: 0, fontSize: 18 }}>
            Oh My Claude
          </h2>
          {/* A newer plugin on npm is a fact about the plugin, so it sits by its name, not in a
              box row: the one place everyone who opens this section looks. */}
          <span style={{ marginLeft: "auto" }}>
            <PluginUpdateBadge />
          </span>
        </div>
        <StarLine />
        <ThemeSwitch />
        {/* Second, right under the look switch: the working line is part of the Claude look (its
            row group), so it reads as the next thing to decide about that look. */}
        <DockStatusSwitch />
        <StarterSwitch />
        <SelectionSwitch />
        <UpdateNoticeSwitch />
        <ClaudeUpdateSwitch />
        <CostSwitch />
        <LimitWarningsSwitch />
        <WorkspaceModelSwitch />
        <ToolRowsSwitch />
        <SuggestionSwitch />
        <CompactNudgeSwitch />
        {/* The switches that start off sit together after the ones that start on, so the card reads
            as what the plugin does by default first, then what you can add to it. The proxy control
            keeps company with them rather than with the spend field it used to precede: it answers
            a switch's question, not a number's. Terminal mirror stays last, on its own, because it
            is the one experiment here. */}
        <ContextSwitch ctx={ctx} />
        <ReturnRecapSwitch />
        <SpendGuardField />
        <ProxyFirstPartySwitch />
        <TerminalSyncSwitch />
        {error && <p style={{ color: T.err, fontSize: 13 }}>{error}</p>}
        {boxes !== null && (
          <Card
            id="dsh-oh-my-claude-sessions-card"
            title={t("main.section.sessionsTitle")}
            summary={t("main.section.sessionsSummary")}
            open={openSessions}
            onToggle={() => setOpenSessions((v) => !v)}
          >
            <Sessions ctx={ctx} boxes={boxes} close={props.close} />
          </Card>
        )}
        {boxes !== null && (
          <Boxes
            ctx={ctx}
            boxes={boxes}
            setBoxes={setBoxes}
            open={openBoxes}
            onToggle={() => setOpenBoxes((v) => !v)}
          />
        )}
        <Card
          id="dsh-oh-my-claude-changelog-card"
          title={t("main.section.changelogTitle")}
          summary={t("main.section.changelogSummary")}
          open={openChangelog}
          onToggle={() => setOpenChangelog((v) => !v)}
        >
          <ChangelogBlock />
        </Card>
        <Card
          id="dsh-oh-my-claude-report-card"
          title={t("main.section.reportTitle")}
          summary={t("main.section.reportSummary")}
          open={openReport}
          onToggle={() => setOpenReport((v) => !v)}
        >
          <ReportBlock />
        </Card>
      </div>
    );
  }

  ctx.slots.inject("settings.section", () => {
    ctx.slots.register(
      {
        name: "settings.section",
        id: "claude-code-sessions",
        order: 19,
        label: SECTION_LABEL,
        inject: () => ({}),
      },
      Section,
    );
    return null;
  });

  // dsh draws a settings nav glyph per section id and gives every other id its gear; the slot
  // spec has no field for one. `settings.action` is a list slot in the dialog's header that
  // mounts whenever the dialog opens (`settings.header` is single, dsh's own title holds it), so
  // a registrant there that renders nothing can swap our row's gear for the spark, in the row's
  // own text colour like dsh's glyphs.
  ctx.slots.inject("settings.action", () => {
    ctx.slots.register(
      { name: "settings.action", id: "claude-nav-icon", order: 99, inject: () => ({}) },
      SectionNavIcon,
    );
    return null;
  });

  // Cost readout in dsh's footer stats row.
  ctx.slots.inject("conversation.composer.dock", () => {
    ctx.slots.register(
      { name: "conversation.composer.dock", id: "claude-cost", order: 10 },
      (props) => (props.sessionId ? <CostLine sessionId={props.sessionId} ctx={ctx} /> : null),
    );
    return null;
  });

  // `/btw` answers dock above the composer beside dsh's todo and goal panels, at their width.
  ctx.slots.inject("conversation.input.dock", () => {
    // The working line again, above the composer, while the turn header's is off screen or not
    // drawn. Lowest order of the dock so it sits nearest the chat, the way a status bar did.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-dock-status", order: 42 },
      (props) => (props.sessionId ? <DockStatus sessionId={props.sessionId} ctx={ctx} /> : null),
    );
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-aside", order: 45 },
      (props) =>
        props.sessionId ? (
          <AsideBubble
            sessionId={props.sessionId}
            ctx={ctx}
            inputActions={props.inputActions}
            useInput={props.useInput}
          />
        ) : null,
    );
    // Above the aside so a fresh tab reads top-down: what to type first, then anything that answered
    // later. dsh hands composer-slot entries the composer's own `inputActions` and `useInput`, which
    // is what lets the card fill the box without sending it.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-starter", order: 44 },
      (props) => <StarterSlot {...props} ctx={ctx} />,
    );
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-draft-relay", order: 43 },
      (props) => <DraftRelay {...props} />,
    );
    // The tool headers' icons are cloned out of this hidden sheet; it rides along with the dock
    // because that is mounted wherever a conversation is, which is the only place headers exist.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-tool-icons", order: 46 },
      () => <ToolIconSprites />,
    );
    // Renderless: folds away the chat rows for context this plugin withheld from the CLI.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-context-rows", order: 48 },
      (props) => <ContextRowMask {...props} ctx={ctx} />,
    );
    // Renderless: applies the workspace's remembered Claude model to a blank session.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-workspace-model", order: 47 },
      (props) =>
        props.sessionId ? <WorkspaceModelMemory sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    // Renderless: moves a session off a model id the CLI has since renamed.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-stale-model", order: 49 },
      (props) =>
        props.sessionId ? <StaleModelRepair sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    // Select text in the chat and this bar docks on the composer: quote it into the draft, or ask
    // about it as an aside. Highest order of the dock, so it sits on the composer itself.
    ctx.slots.register(
      { name: "conversation.input.dock", id: "claude-selection", order: 50 },
      (props) => <SelectionSlot {...props} ctx={ctx} />,
    );
    return null;
  });

  // Add workspace, with a box to pick it on: the directory picker as a slot occupant in both the
  // sidebar and the hero, so the dialog is ours on every dsh. Shadowing is per cell, not per
  // session; priority -1 replaces dsh's picker. The seats are taken only while at least one SSH
  // box is saved, which is what makes the box dropdown worth the takeover: with none, dsh's own
  // local-only dialog answers the "+" and the hero button (owner, 2026-09-23). The box list is
  // reread when the Boxes card saves and when the tab comes back into view, so a box added here or
  // on another device seats the dialog without a reload, and removing the last one vacates it.
  // On an older dsh that refuses a second occupant of a cell the register throws, and we take the
  // sidebar "+" over by click instead until an upgrade; that fallback gates on the boxes itself.
  {
    const seats = new Map<string, () => void>();
    const declared = new Set<{ name: string; id: string }>();
    let boxed = false;
    let fallback = false;
    /** Take one declared cell while a box is saved and it is not ours yet. */
    const seat = (cell: { name: string; id: string }) => {
      if (!boxed || seats.has(cell.name) || fallback) return;
      try {
        seats.set(
          cell.name,
          ctx.slots.register(
            { name: cell.name, id: cell.id, order: 300, priority: -1 },
            // SAFETY: `DshSlots.register` types the owner props as the generic session shape, but
            // dsh's directory-flow slots hand the DirectoryFlowOwnerProps contract; the cast names
            // the truth.
            (props) => <AddWorkflow {...(props as DirectoryFlowOwnerProps)} ctx={ctx} />,
          ),
        );
      } catch {
        // Older dsh refuses a second occupant of a cell; take the sidebar "+" over by click until
        // an upgrade, when the slot occupant takes over again on the next restart.
        fallback = true;
        ctx.slots.inject("sidebar.footer.action", () => {
          ctx.slots.register(
            { name: "sidebar.footer.action", id: "claude-add-workspace", order: 90 },
            () => <AddWorkspaceFlow ctx={ctx} />,
          );
          return null;
        });
      }
    };
    /** Hand every seat back to dsh's own picker. */
    const vacate = () => {
      for (const off of seats.values()) off();
      seats.clear();
    };
    const refresh = () =>
      fetch(`${ROUTE}/ssh-boxes`)
        .then((r) => readJson<{ boxes?: unknown[] }>(r))
        .then((b) => {
          boxed = (b.boxes?.length ?? 0) > 0;
          if (boxed) for (const cell of declared) seat(cell);
          else vacate();
        })
        .catch(() => {
          // The route is down; the seats stay as they were until the next reread.
        });
    for (const cell of [
      { name: "sidebar.workspaces.directoryFlow", id: "oh-my-claude-workflow" },
      { name: "conversation.hero.workspace.directoryFlow", id: "oh-my-claude-workflow-hero" },
    ]) {
      ctx.slots.inject(cell.name, () => {
        declared.add(cell);
        seat(cell);
        return null;
      });
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(BOXES_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    void refresh();
    ctx.effect?.(
      () => () => {
        window.removeEventListener(BOXES_EVENT, refresh);
        document.removeEventListener("visibilitychange", onVisible);
        vacate();
      },
      "add-workspace-seats",
    );
  }

  // Header chips in the session header.
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register(
      { name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 },
      (props) => (props.sessionId ? <IdleChip sessionId={props.sessionId} /> : null),
    );
    return null;
  });

  // One Oh My Claude control in the composer's left group.
  ctx.slots.inject("conversation.input.left", () => {
    ctx.slots.register(
      { name: "conversation.input.left", id: "oh-my-claude", order: 50 },
      // Session-scoped slots receive `sessionId` (dsh-client-ui-jobs reads it the same way).
      (props) =>
        props.sessionId ? <OhMyClaudeControl sessionId={props.sessionId} ctx={ctx} /> : null,
    );
    return null;
  });

  // The running Claude rows carry `data-omc-claude`, which the spinner scan reads instead of
  // matching each dot to a session by title. dsh's row-action strip is a list slot fed the row's
  // session id, so one renderless entry per row can mark its own row. A dsh without that slot
  // never runs the inject callback, and the scan keeps its title match.
  ctx.slots.inject("sidebar.workspaces.session.row.action", () => {
    try {
      const off = ctx.slots.register(
        { name: "sidebar.workspaces.session.row.action", id: "oh-my-claude-mark", order: 300 },
        (props) => (props.sessionId ? <RowMark sessionId={props.sessionId} ctx={ctx} /> : null),
      );
      markActive = true;
      // The flag is module state and the entry is not: when dsh retires the entry (a redeclared
      // slot, a hot reload's old context) the scan has to go back to its title match.
      ctx.effect?.(
        () => () => {
          off();
          markActive = false;
        },
        "row-mark-entry",
      );
    } catch {
      // A dsh that refuses the entry leaves the scan on its title match.
      markActive = false;
    }
    return null;
  });

  // The permission control takes over dsh's composer permission slot (a single cell). Shadowing is
  // per cell, not per session, so this would also replace dsh's control in a non-Claude session;
  // register the entry only while the current session is Claude and dispose it otherwise, following
  // the model picker the way useActiveClaude does. On an older dsh that refuses a second occupant
  // of the cell the register throws, and we fall back to the DOM-mutating AccessShield in
  // conversation.input.left.
  ctx.slots.inject("conversation.input.permission", () => {
    let dispose: (() => void) | undefined;
    // The active session's model-directory store, so a model switch off a Claude mount re-reads.
    // Subscribed once per session, never re-subscribed from inside its own notification: a
    // listener that leaves and rejoins a Set while it is being iterated is visited again, and the
    // tab spins forever.
    let providerOff: (() => void) | undefined;
    let providerFor: string | undefined;
    const stopProvider = () => {
      try {
        providerOff?.();
      } catch {
        // A disposed context retires the bundle on its own.
      }
      providerOff = undefined;
      providerFor = undefined;
    };
    const sync = () => {
      const active = activeClaudeSession(ctx);
      if (active !== providerFor) {
        stopProvider();
        if (active) {
          providerFor = active;
          try {
            providerOff = ctx.modelDirectories.directoryFor(active).store.subscribe(sync);
          } catch {
            // Unbound in this tab; the list store below still reports the session identity.
          }
        }
      }
      if (active && !dispose) {
        try {
          dispose = ctx.slots.register(
            {
              name: "conversation.input.permission",
              id: "oh-my-claude-access",
              order: 30,
              priority: -1,
            },
            (props) => <AccessTrigger sessionId={props.sessionId ?? active} ctx={ctx} />,
          );
        } catch {
          // Older dsh refuses a second occupant of the cell; keep the old AccessShield.
          dispose = ctx.slots.register(
            { name: "conversation.input.left", id: "claude-access", order: 40 },
            (props) =>
              props.sessionId ? <AccessShield sessionId={props.sessionId} ctx={ctx} /> : null,
          );
        }
      } else if (!active && dispose) {
        dispose();
        dispose = undefined;
      }
    };
    const listOff = ctx.sessions.list.subscribe?.(sync);
    sync();
    ctx.effect?.(
      () => () => {
        listOff?.();
        stopProvider();
        dispose?.();
      },
      "permission-access-sync",
    );
    return null;
  });
}
