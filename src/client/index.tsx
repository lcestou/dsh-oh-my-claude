// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box. Filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import { installLocale, t, useLocale } from "./i18n.js";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { IconPaperclipOutlineRegular } from "./icons.js";
import {
  ROUTE,
  useNarrow,
  fmtCost,
  fmtDuration,
  cacheShare,
  T,
  btn,
  readJson,
  select,
  inputStyle,
  ago,
  btnPrimary,
  DOCK_ATTR,
  ACCENT,
  SHIMMER,
  SessionData,
  isOwnedActive,
  activeClaudeSession,
  useActiveClaude,
  isClaudeSession,
  claudeProviderOf,
  claudeMount,
  type ClientCtx,
  type DirectoryFlowOwnerProps,
  openHere,
  openSessionId,
  numberOr,
  whenContextGone,
  guard,
  retire,
  revive,
  nested,
} from "./shared.js";
import { themeOf, themeSplitPatch, hasTheme } from "./theme.js";
import { PluginUpdateBadge, StarNudge } from "./update-pill.js";
import { livingModelId } from "../model-ids.js";
import { ReportBlock } from "./report.js";
import { pollEvery, subscribe } from "./events.js";
import type {
  AsideItem,
  IdleReply,
  LoginNeed,
  HeldSteerRow,
  SteerAttachmentRow,
  SteerCardData,
  WaitingSteerRow,
} from "./events.js";
import { ChangelogBlock } from "./changelog.js";
import { Spark } from "./spark.js";
import { AccessShield, AccessTrigger, OhMyClaudeControl } from "./panel.js";
import { ConfirmButton } from "./tune.js";
import { AddWorkflow, AddWorkspaceFlow, BOXES_EVENT } from "./picker.js";
import { ClaudeUpdateDetails } from "./claude-updates.js";

import {
  COMPACT_AT,
  COMPACT_AT_CHOICES,
  compactThreshold,
  runDraft,
  SHELL_LANGS,
} from "./nudge.js";
import { worstLimit } from "./limits.js";
import {
  noteWithdrawn,
  type RestoreWatch,
  startWatch,
  stepRestore,
  withdrawnSince,
} from "./steer-restore.js";
import { Switch } from "./switch.js";
import type { ToolMode, ToolModeInfo } from "../rows-probe.js";
import { takeDraft, subscribeDraft, noteDraft } from "./draft.js";
import {
  askBody,
  chatSelection,
  clampQuote,
  previewOf,
  QUOTE_MAX,
  quoteMarkdown,
} from "./selection.js";
import { sparkNode } from "./spark.js";
import { RECAP_AWAY_MS, RECAP_AWAY_CHOICES, recapAwayIn } from "./notices.js";
import { SETTINGS_SCOPES, SCOPE_LABELS } from "./settings.js";
// Type only, so nothing from the server half reaches the bundle: the row renders what the route
// answered, and the route is the only thing that knows how to work the answer out.
import type { ClaudeMdState } from "../switches.js";
import {
  type ChatFlowNode,
  contextDrops,
  maskedRows,
  MASTER_KEY,
  OFF_KEY,
} from "../context-sources.js";
import {
  HINTS_EVENT,
  loadHints,
  useHintValue,
  writeHints,
  useHintFlag,
  applyTheme,
} from "./hints.js";
import { attachTip } from "./tooltip.js";
import { onBodyMutation } from "./dom.js";
import { watchSessionNotices } from "./session-notices.js";
import { ToolIconSprites, watchToolFolds } from "./tool-folds.js";
import {
  DockStatus,
  RowMark,
  watchEventStream,
  watchTurnStatus,
  claudeRunningTitles,
} from "./turn-status.js";
import { BoxData, Boxes, Card, Chevron, LoginSteps, useLoginFlow } from "./boxes.js";
import { Sessions, size } from "./sessions-tab.js";
import { CostLine } from "./cost.js";

import {
  type ContextReply,
  kTokens,
  loadUsage,
  resetText,
  sessionModelOf,
  watchContextMeter,
  windowLabel,
} from "./context-meter.js";
import { watchUltrathink } from "./ultrathink.js";
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

/** The play glyph for the Run button, drawn like dsh's own code-block icons (16-unit box, 1px
 *  `currentColor` stroke, 14px on screen) so it reads as one of them. */
function playIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const attrs: [string, string][] = [
    ["width", "14"],
    ["height", "14"],
    ["viewBox", "0 0 16 16"],
    ["fill", "none"],
    ["aria-hidden", "true"],
    ["stroke-width", "1"],
  ];
  for (const [k, v] of attrs) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M4.5 2.5v11l8.5-5.5z");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

/** The composer actions of the aside dock entry on screen, for the Run button, which is drawn
 *  outside any React tree. Null without a composer, so no button is offered. */
let dockComposer: ComposerSlot["inputActions"] | null = null;
/**
 * A Run button in the banner of every shell code block in a Claude session. Clicking writes the
 * snippet into the composer as a prompt, fenced under "Run this:", and leaves sending to you: the
 * owner found a button that sends at once too easy to hit for something that tells Claude to run
 * a command (2026-10-21). Nothing on the box runs from the click itself. The block is dsh's `.md-code-block`
 * with a `[data-code-block-banner]` holding the language span and an actions div (Wrap lines);
 * a block drawn without its banner yet is left for the next scan.
 */
function watchRunButtons(ctx: ClientCtx) {
  onBodyMutation(() => {
    if (!activeClaudeSession(ctx) || !dockComposer) return;
    for (const block of document.querySelectorAll<HTMLElement>(
      ".md-code-block:not([data-omc-run-seen])",
    )) {
      const banner = block.querySelector<HTMLElement>("[data-code-block-banner]");
      const actions = banner?.querySelector("button")?.parentElement;
      if (!banner || !actions) continue;
      block.setAttribute("data-omc-run-seen", "");
      const lang = banner.firstElementChild?.textContent?.trim().toLowerCase() ?? "";
      if (!SHELL_LANGS.has(lang)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-omc-run", "");
      // dsh's own action look and shape, so the button sits with Copy and Wrap lines as one more
      // icon: its class, a 14px outline glyph, an aria-label, and a bubble like dsh's on hover.
      button.className = actions.querySelector("button")?.className ?? "";
      button.setAttribute("aria-label", t("main.run.button"));
      button.append(playIcon());
      attachTip(button, () => t("main.run.title"));
      button.addEventListener("click", () => {
        const snippet = block.querySelector("pre")?.textContent?.trimEnd() ?? "";
        const composer = dockComposer;
        if (!composer || snippet.trim() === "") return;
        composer.setDraft(runDraft(lang, snippet));
        document.querySelector<HTMLElement>("[data-composer-input]")?.focus();
      });
      actions.append(button);
    }
  });
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

/** dsh's own dock-card box (its QueueDock `_7yHdaG_dock`), to the pixel: composer-card width less one
 *  dock inset each side, centred, and the negative bottom margin every dsh dock card uses to hug the
 *  stack gap below it. Both of this plugin's dock cards sit on it so they line up with the queue,
 *  todo and goal panels instead of spanning the pane. */
const DOCK_CARD: CSSProperties = {
  boxSizing: "border-box",
  width:
    "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
  maxWidth:
    "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
  // dsh stacks the dock and the composer with its stack gap between them; pulling the card up by
  // most of that gap keeps it close, and the 4 px left over is what stops the composer's top edge
  // from clipping the strip's buttons.
  margin: "0 auto calc(4px - var(--dsh-composer-stack-gap))",
  padding: "0 var(--dsh-composer-dock-inset)",
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

/** What the starter route answers: this session's own saved opener and the shared fallback. */
interface StarterReply {
  session: string;
  fallback: string;
}

/** Session ids this tab already applied a remembered model to, so a re-render never re-selects. */
const appliedModel = new Set<string>();

/**
 * On a blank session, select the Claude mount and model this workspace last ran.
 *
 * Up to dsh 0.1.6 a new session arrived on whatever the picker last held, so this only had to
 * choose which Claude model. 0.1.7 makes each workspace's blank session ahead of time on the
 * deployment default (llama on this box) with no selection of its own, so the memory now sets
 * the provider as well: a workspace whose last Claude turn ran on a box's mount reopens on that
 * box, a local one reopens local (owner, 2026-09-22: "it should remember the last one used per
 * workspace, not reset to llama"). A blank the person has already switched by hand is left
 * alone, since a picked provider is a `next` selection dsh records. A row written before the
 * provider was stored names the model only and still needs the session to be Claude already.
 * Once per session id per tab, and never once the session has a message.
 */
function WorkspaceModelMemory({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useEffect(() => {
    const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
    if (!entry || entry.blank === false || !entry.cwd) return;
    const current = claudeProviderOf(ctx, sessionId);
    const picked = entry.projectionValues?.modelSelection?.next?.provider;
    if (appliedModel.has(sessionId)) return;
    appliedModel.add(sessionId);
    let live = true;
    const runApply = async () => {
      const hints = await loadHints();
      if (hints.workspaceModelOff === true || !live) return;
      const q = `cwd=${encodeURIComponent(entry.cwd ?? "")}`;
      const saved = await readJson<{ model?: string; provider?: string }>(
        await fetch(`${ROUTE}/workspace-model?${q}`),
      );
      if (!saved.model || !live) return;
      // The mount to open on: the session's own when it is already Claude, else the remembered
      // one, and only while nobody has picked a provider for this blank by hand. Read again here,
      // not only at mount: the two reads above are async, and a click in the picker during them
      // is a pick this must not overwrite.
      const pickedNow =
        ctx.sessions.list.getSnapshot()?.byId[sessionId]?.projectionValues?.modelSelection?.next
          ?.provider ?? picked;
      const provider =
        current ?? (saved.provider && !pickedNow ? claudeMount(saved.provider) : undefined);
      if (!provider) return;
      const dir = ctx.modelDirectories.directoryFor(sessionId);
      const now = dir.store.getSnapshot().current;
      if (now?.provider === provider && now.model === saved.model) return;
      if (dir.select) await dir.select({ provider, model: saved.model });
    };
    // A session dsh has not bound yet throws from directoryFor (see claudeProviderOf); a route
    // that is not there answers an error. Neither is this component's problem to report.
    void runApply().catch(() => {});
    return () => {
      live = false;
    };
  }, [ctx, sessionId]);
  return null;
}

/**
 * Put a session whose model id the lineup no longer has onto the form it still offers. The CLI
 * renames its picker rows between releases (2.1.274 lists Fable as `claude-fable-5-1` where 2.1.273
 * listed `claude-fable-5-1[1m]`), and a session keeps the id it was given in its own log, so its
 * composer seat read `claude-code/claude-fable-5-1[1m]`: dsh names a selection by finding it in the
 * catalog and prints the raw pair when it is not there (owner, 2026-09-17). Same model, new
 * spelling, so the repair is a plain select; never while a turn runs, since a model change makes the
 * next turn respawn the process. An id with no living form is left alone.
 */
function StaleModelRepair({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useEffect(() => {
    let dir: ReturnType<ClientCtx["modelDirectories"]["directoryFor"]>;
    try {
      dir = ctx.modelDirectories.directoryFor(sessionId);
    } catch {
      return; // unbound in this tab (see claudeProviderOf)
    }
    let settled = false;
    const repair = guard(() => {
      if (settled) return;
      const snap = dir.store.getSnapshot();
      const cur = snap.current;
      if (!cur?.provider.startsWith("claude-code")) return;
      const offered = snap.groups?.find((g) => g.id === cur.provider)?.models.map((m) => m.id);
      if (!offered || offered.length === 0) return; // the catalog has not loaded yet
      if (offered.includes(cur.model)) {
        settled = true;
        return;
      }
      if (ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running) return;
      settled = true;
      const living = livingModelId(cur.model, offered);
      if (living && dir.select)
        void dir.select({ provider: cur.provider, model: living }).catch(() => {});
    });
    repair();
    // The directory store for the catalog arriving, the list store for the turn ending: a session
    // found mid-turn is repaired the moment it stops running.
    const offDir = dir.store.subscribe(repair);
    const offList = ctx.sessions.list.subscribe?.(repair);
    return () => {
      offDir();
      offList?.();
    };
  }, [ctx, sessionId]);
  return null;
}

/**
 * The prompt starter: a card above the composer on a session that has not been used yet, offering the
 * opening line saved for this session, or on a brand-new tab the last one saved anywhere, and
 * writing it into the composer without sending it, so it can be edited first. The card also saves the
 * current draft as the opener, and forgets it again. It hides the moment the session has a message or
 * the composer has text, so it never sits between the user and a prompt they are already writing.
 */
function StarterCard({
  sessionId,
  ctx,
  draft,
  setDraft,
}: {
  sessionId: string;
  ctx: ClientCtx;
  draft: string;
  setDraft: (text: string) => void;
}) {
  useLocale();
  const [starter, setStarter] = useState<StarterReply | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/starter?session=${encodeURIComponent(sessionId)}`)
      .then((r) => readJson<StarterReply>(r))
      .then((b) => {
        if (live) setStarter(b);
      })
      .catch(() => {}); // no store yet: the card simply does not appear
    return () => {
      live = false;
    };
  }, [sessionId]);

  // The card says what the store did, not what the click did: a save that never reached the route
  // has to say so, or the opener is quietly gone by the next tab.
  const save = (text: string) => {
    setStarter({ session: text, fallback: text });
    setNote(t("main.settings.saving"));
    void fetch(`${ROUTE}/starter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, text }),
    })
      .then((r) => {
        setNote(r.ok ? t("main.starter.saved") : t("main.starter.saveFailed"));
      })
      .catch(() => {
        setNote(t("main.starter.saveFailed"));
      })
      .finally(() => setTimeout(() => setNote(""), 1600));
  };

  // Only on an unused session: dsh's own `blank` bit, which is false as soon as the session has a
  // message. `!== false` rather than `=== true` so a session missing from the snapshot (the moment a
  // tab opens) still counts as blank.
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;
  if (!blank || starter === null) return null;
  const opener = starter.session || starter.fallback;
  const busy = draft !== "" && draft !== opener; // they are writing something of their own
  const saveLabel =
    note !== "" ? note : busy ? t("main.starter.saveDraft") : t("main.starter.saved");

  const chip: CSSProperties = {
    ...btn,
    fontSize: 12,
    lineHeight: "16px",
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${T.border}`,
    background: "transparent",
    flex: "none",
  };
  const clipped: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div {...{ [DOCK_ATTR]: "1" }} style={DOCK_CARD}>
      <div
        // One row, always: the opener and the hint shrink with an ellipsis and the buttons keep
        // their width, so a long draft never wraps the row and shoves the buttons under it.
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "nowrap",
          fontSize: 12,
          color: T.faint,
          minWidth: 0,
          // Chip height (16 px line + 2 px padding and 1 px border each side) is the row's floor,
          // so the Save draft chip appearing on the first keystroke does not grow the row and
          // push the composer down.
          minHeight: 22,
        }}
      >
        {opener === "" || busy ? (
          <span style={clipped}>{t("main.starter.empty")}</span>
        ) : (
          <>
            <button
              type="button"
              style={{ ...chip, ...clipped, flex: "0 1 auto" }}
              onClick={() => setDraft(opener)}
              title={opener}
            >
              {opener}
            </button>
            <span style={clipped}>{t("main.starter.fills")}</span>
          </>
        )}
        <span style={{ flex: "1 1 auto" }} />
        <Slide open={draft !== ""}>
          <button
            type="button"
            style={chip}
            onClick={() => save(draft)}
            title={t("main.starter.saveTitle")}
            // Greyed while the composer already matches the saved opener, and while a save runs.
            disabled={!busy || note !== ""}
          >
            {/* Every label the chip can show shares one cell, so Saving… and Saved do not resize it. */}
            <span style={{ display: "inline-grid" }}>
              {[
                t("main.starter.saveDraft"),
                t("main.settings.saving"),
                t("main.starter.saved"),
                t("main.starter.saveFailed"),
              ].map((text) => (
                <span
                  key={text}
                  style={{
                    gridArea: "1 / 1",
                    visibility: text === saveLabel ? "visible" : "hidden",
                  }}
                >
                  {text}
                </span>
              ))}
            </span>
          </button>
        </Slide>
        <Slide open={opener !== ""}>
          <ConfirmButton
            label={t("main.starter.forget")}
            style={chip}
            disabled={opener === ""}
            onAct={() => save("")}
          />
        </Slide>
      </div>
    </div>
  );
}

/** Width of one starter-row chip eased in and out. The wrapper is a one-column grid whose column
 *  goes 0fr to 1fr, which is animatable, so a chip appearing or leaving slides its neighbours over
 *  instead of shoving them. Closed, a negative margin swallows the row gap the empty wrapper would
 *  still claim, and `visibility` drops it from the tab order, delayed on close so the slide is seen. */
const SLIDE_MS = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
/** Reveal a starter-row chip with a slide animation, collapsing its neighbour via a zero-width
 *  column and dropping it from the tab order when closed. */
function Slide({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        display: "grid",
        gridTemplateColumns: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        marginLeft: open ? 0 : -6,
        flex: "none",
        transition: `grid-template-columns ${SLIDE_MS}ms ease, opacity ${SLIDE_MS}ms ease, margin-left ${SLIDE_MS}ms ease, visibility 0s ${open ? 0 : SLIDE_MS}ms`,
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", display: "flex" }}>{children}</span>
    </span>
  );
}

/** One theme group's checkbox: checked means on; the flag is the group's off key. */
function ThemeGroupBox({ flag, group, label }: { flag: string; group: string; label: string }) {
  const [off, setOff] = useHintFlag(flag);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <input
        type="checkbox"
        data-omc-theme-group={group}
        checked={!off}
        onChange={(e) => setOff(!e.target.checked)}
      />
      {label}
    </label>
  );
}

/** The settings row for plan limit warnings: one switch for both, and a Customize fold to keep one
 *  without the other. On by default; the flags live in the box's hints store like every switch. */
function LimitWarningsSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("limitWarningsOff");
  const [ringOff, setRingOff] = useHintFlag("limitRingOff");
  const [noticeOff, setNoticeOff] = useHintFlag("limitNoticeOff");
  return (
    <>
      <div
        data-omc-limit-warnings=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        <div>
          <div>{t("main.settingsUi.limitTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.limitDesc")}</div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.limitTitle")}
        />
      </div>
      {!off && (
        <details data-omc-limit-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                data-omc-limit-ring=""
                checked={!ringOff}
                onChange={(e) => setRingOff(!e.target.checked)}
              />
              {t("main.settingsUi.tintRing")}
              <span style={{ color: T.faint, fontSize: 12 }}>
                {t("main.settingsUi.tintRingHint")}
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                data-omc-limit-notice=""
                checked={!noticeOff}
                onChange={(e) => setNoticeOff(!e.target.checked)}
              />
              {t("main.settingsUi.noticeComposer")}
              <span style={{ color: T.faint, fontSize: 12 }}>
                {t("main.settingsUi.noticeHint")}
              </span>
            </label>
          </div>
        </details>
      )}
    </>
  );
}

/** The star nudge under the heading, hidden for good once dismissed. The flag is box-wide, not
 *  per-browser: someone who hid this line meant to hide it, not to hide it on one laptop. */
function StarLine() {
  const [off, setOff] = useHintFlag("starOff");
  if (off) return null;
  return <StarNudge onDismiss={() => setOff(true)} />;
}

/** The Claude look: the master switch first under the section title, then a fold with one checkbox
 *  per group and the accent colour. Box-wide in the hints store like the switches under it;
 *  applyTheme repaints on the hints event the setters dispatch, so nothing here touches the DOM. */
function ThemeSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("themeOff");
  const [accent, setAccent] = useHintValue("themeAccent");
  const hints: Record<string, boolean | number> = {};
  if (accent !== undefined) hints.themeAccent = accent;
  const hex = themeOf(hints).accent;
  return (
    <>
      <div
        data-omc-theme-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: off ? 12 : 4,
        }}
      >
        <div>
          <div>{t("main.settingsUi.themeTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.themeDesc")}</div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.themeTitle")}
        />
      </div>
      {!off && (
        <details data-omc-theme-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <ThemeGroupBox flag="themeRowOff" group="row" label={t("main.settingsUi.groupRow")} />
            <ThemeGroupBox
              flag="themeProseOff"
              group="prose"
              label={t("main.settingsUi.groupProse")}
            />
            <ThemeGroupBox
              flag="themeComposerOff"
              group="composer"
              label={t("main.settingsUi.groupComposer")}
            />
            <ThemeGroupBox
              flag="themeModelsOff"
              group="models"
              label={t("main.settingsUi.groupModels")}
            />
            <ThemeGroupBox
              flag="themeSendOff"
              group="send"
              label={t("main.settingsUi.groupSend")}
            />
            <ThemeGroupBox
              flag="themePanelOff"
              group="panel"
              label={t("main.settingsUi.groupPanel")}
            />
            <ThemeGroupBox
              flag="themeRainbowOff"
              group="rainbow"
              label={t("main.settingsUi.groupRainbow")}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              {t("main.settingsUi.accent")}
              <input
                type="color"
                data-omc-theme-accent=""
                aria-label={t("main.settingsUi.accentColour")}
                value={hex}
                // `change`, not `input`: a drag through the picker must not post per frame.
                onChange={(e) => setAccent(parseInt(e.target.value.slice(1), 16))}
              />
              {accent !== undefined && (
                <button
                  type="button"
                  style={btn}
                  data-omc-theme-reset=""
                  onClick={() => setAccent(null)}
                >
                  {t("main.settingsUi.reset")}
                </button>
              )}
            </label>
          </div>
        </details>
      )}
    </>
  );
}

/** The settings switch for the selection bar, under the prompt-starter switch. Box-wide, like it. */
function SelectionSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("selectionOff");
  return (
    <div
      data-omc-selection-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.selectionTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.selectionDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.selectionTitle")}
      />
    </div>
  );
}

/** The settings switch for the prompt-starter dock, under the Claude look switch. */
function StarterSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("starterOff");
  return (
    <div
      data-omc-starter-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.starterTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.starterDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.starterTitle")}
      />
    </div>
  );
}

/** What each dsh block cost on the last turn in this workspace, in characters. Read once when the
 *  card renders, which is when Settings opens; nothing polls. A workspace that has not run a turn
 *  yet answers nothing, and a row with no number shows no number rather than a zero: zero would
 *  claim dsh sent nothing, and not knowing is not the same claim. */
function useContextSizes(ctx: ClientCtx): Record<string, number> | null {
  const [sizes, setSizes] = useState<Record<string, number> | null>(null);
  const snap = ctx.sessions.list.getSnapshot();
  const open = openSessionId(ctx);
  const cwd = (open ? snap?.byId[open]?.cwd : "") ?? "";
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const run = async () => {
      const reply = await readJson<{ sizes?: Record<string, number> }>(
        await fetch(`${ROUTE}/context-sizes?cwd=${encodeURIComponent(cwd)}`),
      );
      if (live) setSizes(reply.sizes ?? null);
    };
    // A box whose server predates this route answers an error; the card is still usable without
    // the numbers, so it stays quiet rather than showing the owner a failure they cannot act on.
    void run().catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);
  return sizes;
}

/** What Claude Code loads for itself in this workspace, and whether anything turns it off. Read
 *  once beside the sizes, from the same open. The whole answer is worked out on the box: the count
 *  and total come from the files, and the on/off from that box's settings files plus, for a local
 *  box, dsh's own environment. Null while it is in flight, on a card with no session behind it, or
 *  on a box whose server predates the route, and the row reads as loaded in all three: that is what
 *  a Claude Code session does on a fresh box. */
function useClaudeMd(ctx: ClientCtx): ClaudeMdState | null {
  const [state, setState] = useState<ClaudeMdState | null>(null);
  const snap = ctx.sessions.list.getSnapshot();
  const id = openSessionId(ctx) ?? "";
  const cwd = (id ? snap?.byId[id]?.cwd : "") ?? "";
  // A second account or a named ssh box keeps its own settings files, so the box has to be named;
  // `cwd` alone resolves a remote workspace but not which instance the session is bound to.
  const provider = id ? (claudeProviderOf(ctx, id) ?? "") : "";
  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const run = async () => {
      const onBox = provider ? `&provider=${encodeURIComponent(provider)}` : "";
      const reply = await readJson<ClaudeMdState>(
        await fetch(`${ROUTE}/claude-md?cwd=${encodeURIComponent(cwd)}${onBox}`),
      );
      if (live) setState(reply);
    };
    void run().catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd, provider]);
  return state;
}

/** The sentence beside the CLAUDE.md row. Long only where it has to be: almost nobody disables
 *  these files, so the loaded state says the one thing a reader needs and the off states, which are
 *  the ones worth acting on, name the variable and where it was set. The key is named rather than
 *  linked on purpose: the settings editor below this card is mounted once per box, so a jump would
 *  have to guess which, and the name is greppable on a box this panel is not open on. */
function claudeMdWhy(state: ClaudeMdState | null): string {
  const by = state?.disabledBy;
  if (by === undefined) return t("main.settingsUi.claudeMdLoaded");
  const scope = SETTINGS_SCOPES.find((s) => s === by);
  return scope === undefined
    ? t("main.settingsUi.claudeMdOffEnv")
    : t("main.settingsUi.claudeMdOffScope", { scope: SCOPE_LABELS[scope] });
}

/** One measured size, beside the row it belongs to. Thousands are rounded to one decimal because
 *  the exact character count of a block nobody can edit is noise; the order of magnitude is the
 *  decision. */
function ContextSize({
  source,
  chars,
  files,
}: {
  source: string;
  chars: number | undefined;
  /** Shown before the size where one block is really several files. It is the whole explanation for
   *  a total larger than the file the reader is thinking of, without listing paths the Instructions
   *  tab already lists. */
  files?: number;
}) {
  useLocale();
  if (chars === undefined) return null;
  const shown = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
  const howMany =
    files === undefined
      ? ""
      : t(files === 1 ? "main.settingsUi.filesOne" : "main.settingsUi.filesOther", { n: files });
  return (
    <span data-omc-context-size={source} style={{ color: T.faint, fontSize: 12 }}>
      {" "}
      {howMany}
      {t("main.settingsUi.chars", { n: shown })}
    </span>
  );
}

/** One block the switches can withhold: checked means dsh sends it, and the flag is that block's
 *  off key, so a box that has never opened this card behaves as it did before the card existed. */
function ContextBox({
  source,
  label,
  flag,
  chars,
}: {
  source: string;
  label: string;
  flag: string;
  chars: number | undefined;
}) {
  const [off, setOff] = useHintFlag(flag);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <input
        type="checkbox"
        data-omc-context={source}
        checked={!off}
        onChange={(e) => setOff(!e.target.checked)}
      />
      <span>
        {label}
        <ContextSize source={source} chars={chars} />
      </span>
    </label>
  );
}

/** A block this card cannot move, drawn disabled with the reason beside it rather than in a title,
 *  so it is not mouse-only. Listing it is the point: a block that vanishes from the list is worse
 *  than one the owner can see and not turn off. Checked means it reaches Claude Code; the one row
 *  that draws clear is dsh's system prompt, which the adapter has always dropped. It is backed by
 *  no hint key at all, so there is nothing here for a later edit to wire up by mistake. */
function ContextFixed({
  source,
  label,
  why,
  chars,
  files,
  checked = true,
}: {
  source: string;
  label: string;
  why: string;
  chars: number | undefined;
  files?: number;
  checked?: boolean;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.muted }}>
      <input
        type="checkbox"
        data-omc-context={source}
        checked={checked}
        disabled
        aria-disabled="true"
        readOnly
      />
      <span>
        {label}
        <ContextSize source={source} chars={chars} files={files} />
        <span style={{ color: T.faint, fontSize: 12 }}>: {why}</span>
      </span>
    </label>
  );
}

/** What dsh adds to every prompt besides what the owner typed: the master switch, then a fold with
 *  one checkbox per block the plugin can withhold and one disabled row per block it cannot. The
 *  keys go to the box's hints store, and the adapter reads them when it assembles a turn, so a
 *  session already running keeps whatever it was sent before the switch moved. */
function ContextSwitch({ ctx }: { ctx: ClientCtx }) {
  useLocale();
  const [on, setOn] = useHintFlag(MASTER_KEY);
  const off = !on;
  const sizes = useContextSizes(ctx);
  const claudeMd = useClaudeMd(ctx);
  // The two switchable blocks and nothing else. The runtime snapshot, the tools guidance and the
  // CLAUDE.md copy are all still sent (or already dropped) whatever this switch says, so counting
  // them here would promise a saving the switch cannot deliver.
  const savable =
    sizes && (sizes.instructions !== undefined || sizes.skills !== undefined)
      ? (sizes.instructions ?? 0) + (sizes.skills ?? 0)
      : undefined;
  return (
    <>
      <div
        data-omc-context-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: off ? 12 : 4,
        }}
      >
        <div>
          <div>{t("main.settingsUi.contextTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.contextDesc")}</div>
          {/* The sizes are measured before any switch drops a block, so the number holds in both
              states and only the tense changes: off, it is what the switch is already keeping out.
              "Going by" rather than "on", because the switch may have moved since that turn ran. */}
          {savable !== undefined && (
            <div style={{ color: T.faint, fontSize: 12, marginTop: 2 }}>
              {off ? t("main.settingsUi.offIsSaving") : t("main.settingsUi.offWouldSave")}
              <ContextSize source="total" chars={savable} />
              {t("main.settingsUi.aTurnGoingBy")}
            </div>
          )}
        </div>
        <Switch on={on} onChange={setOn} label={t("main.settingsUi.contextTitle")} />
      </div>
      {!off && (
        <details data-omc-context-custom="" style={NESTED}>
          <summary style={{ cursor: "pointer", color: T.muted }}>
            {t("main.settingsUi.customize")}
          </summary>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 0 0 16px" }}
          >
            <div style={{ color: T.muted, fontSize: 12 }}>{t("main.settingsUi.whatDshAdds")}</div>
            <ContextBox
              source="instructions"
              flag={OFF_KEY.instructions}
              label={t("main.settingsUi.ctxInstructions")}
              chars={sizes?.instructions}
            />
            <ContextBox
              source="skills"
              flag={OFF_KEY.skills}
              label={t("main.settingsUi.ctxSkills")}
              chars={sizes?.skills}
            />
            <ContextFixed
              source="runtime"
              label={t("main.settingsUi.ctxRuntime")}
              why={t("main.settingsUi.ctxRuntimeWhy")}
              chars={sizes?.runtime}
            />
            <ContextFixed
              source="tools"
              label={t("main.settingsUi.ctxTools")}
              why={t("main.settingsUi.ctxToolsWhy")}
              chars={sizes?.tools}
            />
            <div style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.whatClaudeLoads")}
            </div>
            <ContextFixed
              source="claudemd"
              label={t("main.settingsUi.ctxClaudeMd")}
              why={claudeMdWhy(claudeMd)}
              chars={claudeMd?.chars}
              files={claudeMd?.files}
              checked={claudeMd?.disabledBy === undefined}
            />
            <div style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.whatDshWritesNeverSends")}
            </div>
            <ContextFixed
              source="system"
              label={t("main.settingsUi.ctxSystem")}
              why={t("main.settingsUi.ctxSystemWhy")}
              chars={undefined}
              checked={false}
            />
            <div style={{ color: T.faint, fontSize: 12, marginTop: 6 }}>
              {t("main.settingsUi.ctxCaption")}
            </div>
          </div>
        </details>
      )}
    </>
  );
}

/** The part of dsh's chat publication the row mask reads: the render order, and a keyed reader for
 *  the rows. dsh ships the full contract to its own packages only, so the shape is named here. */
type ChatFlow = {
  readonly order: readonly string[];
  readonly nodes: { get: (key: string) => ChatFlowNode | undefined };
};

/** Stable empty order, so a mount without the chat hook does not hand `useMemo` a new array. */
const NO_ROWS: readonly string[] = [];

const ROW_MASK_STYLE_ID = "dsh-oh-my-claude-context-rows";

/**
 * Fold away the chat rows that describe context Claude Code never received. dsh logs every block it
 * assembled and draws a row per block, so a session with the switches off still shows an
 * "Instructions from" row and a "System prompt" row for text this plugin dropped at the seam. That
 * reads as a receipt and it is not one.
 *
 * Renderless, and it writes one sheet rather than touching dsh's DOM: the rows are named by
 * `data-chat-flow-key`, the key dsh's own projection put on the row, so nothing here depends on a
 * generated class name or on the row's text. Only a session running on this plugin's provider is
 * masked; dsh sends all of it to everyone else, and their rows are true.
 */

function ContextRowMask({
  sessionId,
  ctx,
  useChat,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  useChat?: <S>(select: (chat: ChatFlow) => S, eq?: (a: S, b: S) => boolean) => S;
}) {
  const [on] = useHintFlag(MASTER_KEY);
  const [instructionsOff] = useHintFlag(OFF_KEY.instructions);
  const [skillsOff] = useHintFlag(OFF_KEY.skills);
  const order = useChat?.((chat) => chat.order) ?? NO_ROWS;
  const nodes = useChat?.((chat) => chat.nodes);
  const mine = sessionId !== undefined && isClaudeSession(ctx, sessionId);
  // The node map is a new object on every streamed chunk, and the walk below visits every row in
  // the conversation, so keying the memo on the map made a long turn quadratic in the length of
  // the transcript. What decides a row's masking is its source kind, fixed when the row is made,
  // so the walk re-runs when a row is added or removed (`order`) and not when one grows.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const haveNodes = nodes !== undefined;
  const masked = useMemo(() => {
    const current = nodesRef.current;
    if (!mine || current === undefined) return [];
    const drops = contextDrops({
      [MASTER_KEY]: on,
      [OFF_KEY.instructions]: instructionsOff,
      [OFF_KEY.skills]: skillsOff,
    });
    return maskedRows(order, (key) => current.get(key), drops);
  }, [mine, order, haveNodes, on, instructionsOff, skillsOff]);
  useEffect(() => {
    const existing = document.getElementById(ROW_MASK_STYLE_ID);
    const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
    el.id = ROW_MASK_STYLE_ID;
    // A key is dsh's to shape, so it is escaped for the attribute string rather than trusted.
    const css =
      masked.length === 0
        ? ""
        : `${masked
            .map((key) => `[data-chat-flow-key="${key.replace(/["\\]/g, "\\$&")}"]`)
            .join(",")}{display:none}`;
    if (el.textContent !== css) el.textContent = css;
    if (!existing) document.head.appendChild(el);
    // Cleared rather than removed on unmount: leaving the rules behind would hide rows in whatever
    // session the tab moves to next, which may be another provider's.
    return () => {
      el.textContent = "";
    };
  }, [masked]);
  return null;
}

/** The settings switch for the update notice. The flag lives in the box's hints store, which the
 *  server reads before it asks npm: off means no registry read at all, not a hidden pill. */
function UpdateNoticeSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("updateCheckOff");
  return (
    <div
      data-omc-update-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.updateNoticeTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.updateNoticeDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.updateNoticeTitle")}
      />
    </div>
  );
}

/** A fold nested under a Settings row: indented behind a thin rule, the look the update options
 *  have, so what belongs to the row above reads as its child. */
const NESTED: CSSProperties = { ...nested, marginBottom: 12, fontSize: 13 };

/** The settings switch for the whole Claude Code update feature, with its channel, auto-update and
 *  history under it while it is on. The flag lives in the box's hints store and the server reads it
 *  before every check: off means no pointer read, no card and no install, on every box. */
function ClaudeUpdateSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("claudeUpdateOff");
  return (
    <>
      <div
        data-omc-claude-update-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        <div>
          <div>{t("main.settingsUi.claudeUpdateTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.claudeUpdateDesc")}
          </div>
        </div>
        <Switch
          on={!off}
          onChange={(next) => setOff(!next)}
          label={t("main.settingsUi.claudeUpdateTitle")}
        />
      </div>
      {!off && <ClaudeUpdateDetails />}
    </>
  );
}

/**
 * The settings control for a proxy in front of api.anthropic.com: Auto, On or Off.
 *
 * Auto asks the base URL itself, so the common case needs no decision: a proxy that forwards
 * answers an unauthenticated request with Anthropic's own error and request id. The other two are
 * answers a person gave, and detection never overrides one: an endpoint that starts reading as
 * Anthropic must not turn this back on for someone who turned it off.
 */
function ProxyFirstPartySwitch() {
  useLocale();
  const [on] = useHintFlag("proxyFirstParty");
  const [off] = useHintFlag("proxyFirstPartyOff");
  const mode = on ? "on" : off ? "off" : "auto";
  // Both keys in one write: `false` clears a key, and the pair only ever holds the chosen answer.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- writeHints is an import now, so nothing here is captured from the component
  const choose = (next: string) =>
    writeHints({ proxyFirstParty: next === "on", proxyFirstPartyOff: next === "off" });
  return (
    <>
      <div
        data-omc-proxy-first-party-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: 4,
        }}
      >
        <div>
          <div>{t("main.settingsUi.proxyTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.proxyDescBefore")}
            <a
              data-omc-headroom-link=""
              href="https://github.com/headroomlabs-ai/headroom"
              target="_blank"
              rel="noreferrer"
              style={{ color: ACCENT }}
            >
              Headroom
            </a>
            {t("main.settingsUi.proxyDescAfter")}
          </div>
        </div>
        <select
          data-omc-proxy-first-party-mode=""
          aria-label={t("main.settingsUi.proxyTitle")}
          value={mode}
          onChange={(e) => choose(e.target.value)}
          // `0 0 auto` because the row is flex and a shrinkable select collapsed here until only
          // the first letter of "Auto" showed; `fieldSizing: content` then takes the width from
          // the word on show rather than from the longest option, so Off sits narrower than Auto.
          // A browser without it falls back to sizing by the longest option, which is the old look.
          style={{ ...select, flex: "0 0 auto", fieldSizing: "content", minWidth: 0 }}
        >
          <option value="auto">{t("main.settingsUi.auto")}</option>
          <option value="on">{t("main.usage.on")}</option>
          <option value="off">{t("main.usage.off")}</option>
        </select>
      </div>
      <details data-omc-proxy-details="" style={NESTED}>
        <summary style={{ cursor: "pointer", color: T.muted }}>
          {t("main.settingsUi.details")}
        </summary>
        <div style={{ color: T.faint, fontSize: 12, padding: "8px 0 0 16px" }}>
          {t("main.settingsUi.proxyDetails")}
        </div>
      </details>
    </>
  );
}

/** The settings switch for remembering which Claude model a workspace last ran. */
function WorkspaceModelSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("workspaceModelOff");
  return (
    <div
      data-omc-workspace-model-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.wsModelTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.wsModelDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.wsModelTitle")}
      />
    </div>
  );
}

/** Settings > Oh My Claude: on by default, repeats the working line above the composer while the
 *  turn's own header line is off screen. Off leaves only dsh's header line. The switch stores the
 *  off state (`dockStatusOff`), so an unset box gets the line. */
function DockStatusSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("dockStatusOff");
  return (
    <div
      data-omc-dock-status-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.dockStatusTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.dockStatusDesc")}</div>
      </div>
      <Switch
        on={!off}
        onChange={(next) => setOff(!next)}
        label={t("main.settingsUi.dockStatusTitle")}
      />
    </div>
  );
}

/**
 * The settings switch between dsh's native tool rows and inline text for Claude's tool activity.
 * A bridge setting, not a Claude Code one, which is why it sits here and not in the Tune tab.
 * Box-wide, through the plugin's own tool-mode route; the row says why rows are off on a dsh
 * that will not load them, and is disabled then.
 */
function ToolRowsSwitch() {
  useLocale();
  const [info, setInfo] = useState<ToolModeInfo | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/tool-mode`)
      .then((r) => readJson<ToolModeInfo>(r))
      .then((b) => live && setInfo(b))
      .catch(() => live && setErr(t("tune.errToolMode")));
    return () => {
      live = false;
    };
  }, []);
  const locked = info?.rows.ok === false;
  const pick = async (mode: ToolMode) => {
    setErr("");
    try {
      setInfo(
        await readJson<ToolModeInfo>(
          await fetch(`${ROUTE}/tool-mode`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode }),
          }),
        ),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      data-omc-tool-rows-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.toolRowsTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          {err
            ? err
            : locked
              ? t("tune.rowsLocked", { reason: info?.rows.reason ?? "" })
              : t("main.settingsUi.toolRowsDesc")}
        </div>
      </div>
      <Switch
        on={info?.mode === "rows"}
        disabled={info === null || locked}
        onChange={(next) => void pick(next ? "rows" : "inline")}
        label={t("main.settingsUi.toolRowsTitle")}
      />
    </div>
  );
}

/** The settings switch for the cost pill in dsh's footer row. On unless it is turned off. */
function CostSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("costOff");
  return (
    <div
      data-omc-cost-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.costTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.costDesc")}</div>
      </div>
      <Switch on={!off} onChange={(next) => setOff(!next)} label={t("main.settingsUi.costTitle")} />
    </div>
  );
}

/** The suggestions switch, inverted over the `promptSuggestionsOff` hint so a box with no hint
 *  reads as on, the way the Claude Code terminal has it (owner, 2026-10-21: match the CLI; the
 *  call is mostly cache reads). Applies at the next spawn of a session's Claude, which the
 *  description says. */
function SuggestionSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("promptSuggestionsOff");
  return (
    <div
      data-omc-suggestion-switch=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.suggestTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.suggestDesc")}</div>
      </div>
      <Switch on={!off} onChange={(on) => setOff(!on)} label={t("main.settingsUi.suggestTitle")} />
    </div>
  );
}

/** The settings switch for the context nudge and, with it on, the percent it speaks at. Both are
 *  hints like the suggestion switch above: the threshold is the box's, so every tab agrees on when
 *  to speak up. The default is stored as absence, so a box that never touched it follows a moved
 *  default. */
function CompactNudgeSwitch() {
  useLocale();
  const [off, setOff] = useHintFlag("compactNudgeOff");
  const [stored, setStored] = useHintValue("compactNudgeAt");
  const at = compactThreshold(stored);
  return (
    <>
      <div
        data-omc-compact-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: off ? 12 : 4,
        }}
      >
        <div>
          <div>{t("main.settingsUi.compactTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>
            {t("main.settingsUi.compactDesc", { percent: at })}
          </div>
        </div>
        <Switch
          on={!off}
          onChange={(on) => setOff(!on)}
          label={t("main.settingsUi.compactTitle")}
        />
      </div>
      {!off && (
        <label
          data-omc-compact-at=""
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            marginBottom: 12,
            paddingLeft: 16,
          }}
        >
          <span style={{ color: T.muted }}>{t("main.settingsUi.compactAtLabel")}</span>
          <select
            style={select}
            aria-label={t("main.settingsUi.compactAtAria")}
            value={String(at)}
            onChange={(e) => {
              const next = Number(e.target.value);
              setStored(next === COMPACT_AT ? null : next);
            }}
          >
            {COMPACT_AT_CHOICES.map((pct) => (
              <option key={pct} value={String(pct)}>
                {pct === COMPACT_AT
                  ? t("main.settingsUi.defaultSuffix", { text: `${pct}%` })
                  : `${pct}%`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/**
 * The settings switch for the one-line recap on returning to a finished session, and the away bar
 * under it. Both are hints: the answer lands in the Asides ring, which is the box's, so whether to
 * spend the call is the box's question and not this browser's.
 */
function ReturnRecapSwitch() {
  useLocale();
  const [on, setOn] = useHintFlag("recapOn");
  const [stored, setStored] = useHintValue("recapAwayMs");
  const away = recapAwayIn(stored);
  return (
    <>
      <div
        data-omc-recap-switch=""
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontSize: 13,
          marginBottom: on ? 4 : 12,
        }}
      >
        <div>
          <div>{t("main.settingsUi.recapTitle")}</div>
          <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.recapDesc")}</div>
        </div>
        <Switch on={on} onChange={setOn} label={t("main.settingsUi.recapTitle")} />
      </div>
      {/* Only with the feature on: a bar for something that never fires is a question about nothing. */}
      {on && (
        <label
          data-omc-recap-away=""
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            marginBottom: 12,
            paddingLeft: 16,
          }}
        >
          <span style={{ color: T.muted }}>{t("main.settingsUi.awayAtLeast")}</span>
          <select
            style={select}
            aria-label={t("main.settingsUi.awayAria")}
            value={String(away)}
            // The default is stored as absence, so a box that never touched this reads the default
            // even if it moves later.
            onChange={(e) => {
              const next = Number(e.target.value);
              setStored(next === RECAP_AWAY_MS ? null : next);
            }}
          >
            {RECAP_AWAY_CHOICES.map((ms) => (
              <option key={ms} value={String(ms)}>
                {awayLabel(ms)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** Minutes or hours, with the default named so picking it back is one choice rather than a button. */
const awayLabel = (ms: number): string => {
  const minutes = ms / 60_000;
  const text =
    minutes >= 60
      ? t("main.settingsUi.hour", { n: minutes / 60 })
      : t(minutes === 1 ? "main.settingsUi.minuteOne" : "main.settingsUi.minuteOther", {
          n: minutes,
        });
  return ms === RECAP_AWAY_MS ? t("main.settingsUi.defaultSuffix", { text }) : text;
};

/** Box-wide spend warning: a dollar figure that turns the cost pill orange once a session passes it. */
function SpendGuardField() {
  useLocale();
  const [stored, setStored] = useHintValue("spendWarnUsd");
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(numberOr(stored) === undefined ? "" : String(stored));
  }, [stored]);
  const save = () => {
    const v = draft.trim();
    if (v === "") {
      setStored(null);
      return;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) setStored(n);
    else setDraft(numberOr(stored) === undefined ? "" : String(stored));
  };
  return (
    <div
      data-omc-spend-field=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>{t("main.settingsUi.spendTitle")}</div>
        <div style={{ color: T.faint, fontSize: 12 }}>{t("main.settingsUi.spendDesc")}</div>
      </div>
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 13,
        }}
      >
        $
        <input
          type="number"
          min={0}
          step={1}
          inputMode="decimal"
          aria-label={t("main.settingsUi.spendAria")}
          data-omc-spend-input=""
          style={{ ...inputStyle, width: 72 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </label>
    </div>
  );
}

/** The settings switch for terminal sync. Server-held, unlike the starter's client hint: it gates a
 *  watcher the adapter runs, so it reads and writes the plugin's `/terminal-sync` route. */
function TerminalSyncSwitch() {
  useLocale();
  const [on, setOn] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/terminal-sync`)
      .then((r) => readJson<{ enabled: boolean }>(r))
      .then((b) => live && setOn(b.enabled))
      .catch(() => live && setErr(t("main.settingsUi.terminalReadErr")));
    return () => {
      live = false;
    };
  }, []);
  const toggle = async (next: boolean) => {
    setErr("");
    try {
      const b = await readJson<{ enabled: boolean }>(
        await fetch(`${ROUTE}/terminal-sync`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        }),
      );
      setOn(b.enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div
      data-omc-terminal-sync=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      <div>
        <div>
          {t("main.settingsUi.terminalTitle")}{" "}
          <span style={{ color: T.err }}>{t("main.settingsUi.experimental")}</span>
        </div>
        <div style={{ color: T.faint, fontSize: 12 }}>
          {err || t("main.settingsUi.terminalDesc")}
        </div>
      </div>
      <Switch
        on={on ?? false}
        onChange={(next) => void toggle(next)}
        label={t("main.settingsUi.terminalTitle")}
      />
    </div>
  );
}

/** Slot wrapper: reads the live draft through dsh's own input hook before handing the card its props.
 *  The hook comes in as a prop, so the read has to happen in a component dsh renders, not in the
 *  registration callback. */
function StarterSlot({
  sessionId,
  ctx,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  ctx: ClientCtx;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  const draft = useInput?.((state) => state.draft) ?? "";
  const [off] = useHintFlag("starterOff");
  if (off || sessionId === undefined || inputActions === undefined) return null;
  return (
    <StarterCard
      sessionId={sessionId}
      ctx={ctx}
      draft={draft}
      setDraft={(text) => inputActions.setDraft(text)}
    />
  );
}

/** Renderless: writes a draft the panel queued into the composer. The panel has no `setDraft` of its
 *  own, and this slot does, so Review my changes crosses here. */
function DraftRelay({
  sessionId,
  inputActions,
  useInput,
}: {
  sessionId?: string;
  inputActions?: { setDraft: (text: string) => void };
  useInput?: <T>(select: (state: { draft: string }) => T) => T;
}) {
  // Mirrored out for the recap watcher, which is an interval and so cannot call a hook. Cleared on
  // unmount: a composer that is gone has no text in it, and a stale value would mute every recap.
  const draft = useInput?.((state) => state.draft) ?? "";
  useEffect(() => {
    noteDraft(draft);
    return () => noteDraft("");
  }, [draft]);
  useEffect(() => {
    if (sessionId === undefined || inputActions === undefined) return;
    const flush = () => {
      const text = takeDraft(sessionId);
      if (text !== undefined) inputActions.setDraft(text);
    };
    flush(); // queued before this mounted, e.g. the panel closed on the same click
    return subscribeDraft(flush);
  }, [sessionId, inputActions]);
  return null;
}

/**
 * The `/btw` aside bubble: a Claude-orange card docked above the composer, in the same slot and at
 * the same width as dsh's todo and goal panels, that shows each side question and the answer the
 * CLI returns off the transcript. Pending cards read as thinking; each is dismissed on its own. The
 * server keeps only the last few per session, so the list stays short.
 */
const sameNeed = (a: LoginNeed | null, b: LoginNeed | null): boolean =>
  a === b || (a !== null && b !== null && a.host === b.host && a.label === b.label);

/** A bare control in a dock card's header: the copy and close buttons, the update card's close. */
const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "0 2px",
  lineHeight: 1,
  flex: "0 0 auto",
} as const;

/** A dock card's fold toggle: a real button laid out as the header bar it replaced. The resets take
 *  back what a `<button>` brings (border, background, font, centred text), and `minWidth: 0` lets a
 *  long label truncate instead of pushing the close off the card. */
const HEADER_TOGGLE = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: 1,
  minWidth: 0,
  margin: 0,
  background: "none",
  border: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
} as const;

/** How long the update card stays after a success before closing on its own. */
const CLOSE_AFTER_S = 10;

/** Mirrors the server's `ClaudeUpdateCard`: the box a session runs on and the two versions. */
interface ClaudeUpdateCardData {
  host: string;
  label: string;
  installed: string;
  latest: string;
  folded: boolean;
}
/** Compare two update-card data objects by identity or by host, installed and latest versions, so a
 *  re-rendered card matches the last drawn one. */
const sameCard = (a: ClaudeUpdateCardData | null, b: ClaudeUpdateCardData | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.host === b.host &&
    a.installed === b.installed &&
    a.latest === b.latest &&
    a.folded === b.folded);

/** The release's entry on Claude Code's changelog page: its anchors are the version with dots as
 *  hyphens, `#2-1-277`. */
const claudeReleaseNotes = (version: string): string =>
  `https://code.claude.com/docs/en/changelog#${version.replace(/\./g, "-")}`;

/** The loudest plan limit the session's model counts against, rechecked every minute through the
 *  usage route's own one-minute cache, so a model switched mid-session is picked up on the next
 *  read. Undefined while nothing binding is past normal, or when usage cannot be read. */
function useBindingLimit(sessionId: string, ctx: ClientCtx) {
  const [limit, setLimit] = useState<ReturnType<typeof worstLimit>>(undefined);
  useEffect(() => {
    let live = true;
    const read = () =>
      loadUsage(claudeProviderOf(ctx, sessionId)).then(
        (r) =>
          live &&
          setLimit(r.ok ? worstLimit(r.windows, sessionModelOf(ctx, sessionId)) : undefined),
        () => {},
      );
    void read();
    const timer = setInterval(read, 60_000);
    // A model switch changes which limits count, so it rereads at once rather than on the clock;
    // usage itself comes from the route's cache, so this costs no request.
    let off: (() => void) | undefined;
    try {
      off = ctx.modelDirectories.directoryFor(sessionId).store.subscribe(() => void read());
    } catch {
      // Not bound in this tab yet: the clock still covers it.
    }
    return () => {
      live = false;
      clearInterval(timer);
      off?.();
    };
  }, [sessionId, ctx]);
  return limit;
}

/** One request to the steer-edit route, as its validation accepts them. */
type SteerAction =
  | { action: "hold" | "remove" | "sendNow"; ids: string[] }
  | { action: "save"; holdId: string; text: string }
  | { action: "restore" | "drop"; holdId: string };

/** What the steer-edit route answers when it refuses. */
type SteerEditFailure = { reason?: "sent" | "gone" | "error" | "relayed"; error?: string };

/** The line under a row when an edit or removal did not happen, in the reader's language. */
const steerFailureText = (f: SteerEditFailure): string =>
  f.reason === "gone"
    ? t("main.steer.gone")
    : f.reason === "relayed"
      ? t("main.steer.relayedNoSend")
      : f.reason === "error"
        ? t("main.steer.error", { error: f.error ?? t("common.unknownError") })
        : t("main.steer.sent");

/** A chip's size: under a kilobyte in bytes, since the shared formatter rounds those to 0 KB. */
const chipSize = (bytes: number): string => (bytes < 1000 ? `${bytes} B` : size(bytes));

/** The files and images on a waiting or held steer, as small chips in the order the message holds
 *  them: a file by name and size, an image by its name or the word for image. Draws nothing for a
 *  text-only message. */
function SteerAttachments({ items }: { items: SteerAttachmentRow[] | undefined }) {
  useLocale();
  if (!items?.length) return null;
  return (
    <ul
      data-omc-steer-attachments=""
      aria-label={t("main.steer.attachmentsAria")}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        margin: "0 0 2px",
        padding: 0,
        listStyle: "none",
      }}
    >
      {items.map((a, i) => {
        const label = a.name ?? t("main.steer.image");
        // An older dsh's image reference may carry no size; the chip then names it alone.
        const sized = a.bytes > 0;
        return (
          <li
            key={`${label}:${i}`}
            data-omc-steer-attachment={a.kind}
            title={label}
            aria-label={
              sized
                ? t("main.steer.attachmentAria", { name: label, size: chipSize(a.bytes) })
                : label
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              maxWidth: 220,
              padding: "1px 6px",
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              color: T.faint,
              fontSize: 12,
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <IconPaperclipOutlineRegular size={12} />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}
            </span>
            {sized && <span aria-hidden="true">{chipSize(a.bytes)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The card above the composer for typed steers Claude has not read yet. Edit (or Edit all, joining
 *  them one per line, as Claude Code's up arrow does) takes them back from Claude first, so nothing
 *  goes out while the editor is open; Save sends one message with the new text, Cancel or Escape
 *  puts the originals back, Remove drops them. The editor is drawn from the server's hold, not local
 *  state, so a refresh mid-edit brings it back. `refresh` re-polls at once so the list follows. */
function SteerCard({
  steers,
  sessionId,
  refresh,
}: {
  steers: SteerCardData;
  sessionId: string;
  refresh: () => void;
}) {
  useLocale();
  // Typed text per hold. A hold's own text seeds it; a poll never overwrites what someone typed.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  // Send now takes the rows back as a hold while the turn is cut short, then sends them once
  // Claude is idle. This keeps the ids of the holds that already stood when it was pressed; any
  // other hold seen while it runs is Send now's own and is drawn as a row going out, not as an
  // editor. Drawn as an editor, it flashed the edit box for a moment on every Send now.
  const [sendingFrom, setSendingFrom] = useState<ReadonlySet<string> | null>(null);
  const sending = steers.held.filter((h) => sendingFrom !== null && !sendingFrom.has(h.id));
  const editing = steers.held.filter((h) => !sending.includes(h));
  // A process fact from the server: the CLI is inside a dsh tool, which blocks Send now for every
  // row, a stdin one typed before the tool call included.
  const inTool = steers.inTool === true;

  /** Post one action for the row or hold `id`, then re-poll; a refusal leaves its line under it. */
  const act = async (id: string, body: SteerAction) => {
    if ("ids" in body) noteWithdrawn(body.ids);
    setBusy(id);
    setFailed(null);
    if (body.action === "sendNow") setSendingFrom(new Set(steers.held.map((h) => h.id)));
    try {
      const r = await fetch(`${ROUTE}/steer-edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, ...body }),
      });
      // SAFETY: our own JSON route; both answers carry these optional fields
      const reply = (await r.json()) as { ok?: boolean } & SteerEditFailure;
      if (!reply.ok) setFailed({ id, text: steerFailureText(reply) });
    } catch (e) {
      setFailed({
        id,
        text: t("main.steer.error", { error: e instanceof Error ? e.message : String(e) }),
      });
    } finally {
      setBusy(null);
      setSendingFrom(null);
      refresh();
    }
  };

  /** Send a hold's typed text in its place; blank only when the hold keeps a file or image, which
   *  then goes alone. */
  const save = (holdId: string, fallback: string, hasFiles: boolean) => {
    const text = drafts[holdId] ?? fallback;
    if (text.trim() !== "" || hasFiles) void act(holdId, { action: "save", holdId, text });
  };

  const buttonStyle = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 4px",
    color: T.faint,
    fontSize: 12,
  } as const;
  /** The line under a row or hold when its last action was refused. */
  const failure = (id: string) =>
    failed?.id === id ? (
      <div role="alert" style={{ color: T.err, fontSize: 12, marginTop: 2 }}>
        {failed.text}
      </div>
    ) : null;

  return (
    <section
      data-omc-steer-card=""
      aria-label={t("main.steer.title")}
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        <span style={{ flex: 1, color: T.faint, fontSize: 12 }}>
          {t("main.steer.title")} ·{" "}
          {editing.length > 0
            ? t("main.steer.heldHint")
            : inTool
              ? t("main.steer.relayedHint")
              : t("main.steer.hint")}
        </span>
        {steers.waiting.length > 1 && (
          <>
            <button
              type="button"
              data-omc-steer-edit-all=""
              aria-label={t("main.steer.editAllAria")}
              disabled={busy !== null}
              onClick={() =>
                void act("all", { action: "hold", ids: steers.waiting.map((w) => w.id) })
              }
              style={buttonStyle}
            >
              {t("main.steer.editAll")}
            </button>
            {!inTool && (
              <button
                type="button"
                data-omc-steer-send-all=""
                aria-label={t("main.steer.sendAllNowAria")}
                title={t("main.steer.sendNowTitle")}
                disabled={busy !== null}
                onClick={() =>
                  void act("all", { action: "sendNow", ids: steers.waiting.map((w) => w.id) })
                }
                style={buttonStyle}
              >
                {t("main.steer.sendAllNow")}
              </button>
            )}
          </>
        )}
      </div>
      {failure("all")}
      {sending.map((h) => (
        <div key={h.id} data-omc-steer-sending={h.id} style={{ padding: "4px 0" }}>
          <SteerAttachments items={h.attachments} />
          <span
            style={{
              color: T.faint,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {h.text}
          </span>
        </div>
      ))}
      {editing.map((h) => {
        const disabled = busy === h.id;
        const value = drafts[h.id] ?? h.text;
        const hasFiles = Boolean(h.attachments?.length);
        return (
          <div key={h.id} data-omc-steer-hold={h.id} style={{ padding: "4px 0" }}>
            <SteerAttachments items={h.attachments} />
            <textarea
              data-omc-steer-input=""
              aria-label={t("main.steer.inputAria")}
              aria-describedby={hasFiles ? `omc-steer-kept-${h.id}` : undefined}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
              autoFocus
              value={value}
              disabled={disabled}
              rows={Math.min(8, Math.max(2, value.split("\n").length))}
              onChange={(e) => setDrafts((d) => ({ ...d, [h.id]: e.target.value }))}
              onKeyDown={(e) => {
                // dsh's QueueDock keys: Enter saves, Shift+Enter is a newline, Escape backs out.
                if (e.key === "Escape") {
                  e.preventDefault();
                  void act(h.id, { action: "restore", holdId: h.id });
                } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save(h.id, h.text, hasFiles);
                }
              }}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: T.field,
                color: T.text,
                border: `1px solid ${T.border}`,
                borderRadius: 6,
                padding: "4px 6px",
                font: "inherit",
                resize: "vertical",
              }}
            />
            {hasFiles && (
              <div
                id={`omc-steer-kept-${h.id}`}
                data-omc-steer-kept=""
                style={{ color: T.faint, fontSize: 12, marginTop: 2 }}
              >
                {t("main.steer.attachmentsKept")}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(h.id, { action: "drop", holdId: h.id })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              <button
                type="button"
                data-omc-steer-cancel=""
                disabled={disabled}
                onClick={() => void act(h.id, { action: "restore", holdId: h.id })}
                style={buttonStyle}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                data-omc-steer-save=""
                disabled={disabled || (value.trim() === "" && !hasFiles)}
                onClick={() => save(h.id, h.text, hasFiles)}
                style={{ ...buttonStyle, color: T.text }}
              >
                {t("save")}
              </button>
            </div>
            {failure(h.id)}
          </div>
        );
      })}
      {steers.waiting.map((s) => {
        const disabled = busy !== null;
        return (
          <div
            key={s.id}
            data-omc-steer-row={s.id}
            data-omc-steer-relayed={s.relayed ? "" : undefined}
            style={{ padding: "4px 0" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SteerAttachments items={s.attachments} />
                <span
                  style={{
                    color: T.text,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {s.text}
                </span>
              </div>
              <button
                type="button"
                data-omc-steer-edit=""
                aria-label={t("main.steer.editAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "hold", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("edit")}
              </button>
              <button
                type="button"
                data-omc-steer-remove=""
                aria-label={t("main.steer.removeAria")}
                disabled={disabled}
                onClick={() => void act(s.id, { action: "remove", ids: [s.id] })}
                style={buttonStyle}
              >
                {t("common.remove")}
              </button>
              {!inTool && (
                <button
                  type="button"
                  data-omc-steer-send-now=""
                  aria-label={t("main.steer.sendNowAria")}
                  title={t("main.steer.sendNowTitle")}
                  disabled={disabled}
                  onClick={() => void act(s.id, { action: "sendNow", ids: [s.id] })}
                  style={buttonStyle}
                >
                  {t("main.steer.sendNow")}
                </button>
              )}
            </div>
            {failure(s.id)}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The nudge above the composer when a session's context is mostly full: how full, what the next
 * prompt carries, and a Compact button that posts to the plugin's `/compact` route, which sends
 * Claude's own `/compact` as the next prompt the way the bridged `/claude-compact` does. Not
 * through the composer: a draft of `/claude-compact` submitted by script goes to Claude as that
 * literal text, since dsh only turns a typed slash into a command chip (seen 2026-10-22).
 */
function CompactCard({
  percent,
  tokens,
  onCompact,
  onDismiss,
}: {
  percent: number;
  tokens: number;
  onCompact: () => void;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-compact-card=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{ color: percent >= 90 ? T.err : T.warn, flex: "0 0 auto" }}
          aria-hidden="true"
        >
          ●
        </span>
        <span style={{ flex: "1 1 14em", minWidth: 0 }}>
          {t("main.compact.full", { percent: Math.floor(percent), tokens: kTokens(tokens) })}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <button
            type="button"
            data-omc-compact-now=""
            onClick={onCompact}
            style={{
              background: "var(--dsw-alias-bg-elevated, transparent)",
              border: `0.5px solid ${T.border}`,
              borderRadius: 6,
              padding: "2px 8px",
              cursor: "pointer",
              color: T.text,
              fontSize: 12,
            }}
          >
            {t("main.compact.now")}
          </button>
          <button
            type="button"
            aria-label={t("main.compact.dismissAria")}
            title={t("main.compact.dismissAria")}
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 2px",
              color: T.faint,
            }}
          >
            ×
          </button>
        </span>
      </div>
    </div>
  );
}

/** The one-line notice above the composer when the API grades a limit the session's model counts
 *  against as critical. The API grades a window critical before it is full (Fable weekly at 91%,
 *  2026-09-27), so the card says "reached" only at 100% and gives the percentage otherwise.
 *  Dismissing it hides it until that limit resets, box-wide, since the reset is the next time the
 *  notice could say something new. */
function LimitCard({
  label,
  usedPercent,
  resetsAt,
  onDismiss,
}: {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-limit-card=""
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{ color: usedPercent >= 100 ? T.err : T.warn, flex: "0 0 auto" }}
          aria-hidden="true"
        >
          ●
        </span>
        <span style={{ flex: 1 }}>
          {usedPercent >= 100
            ? t("main.limit.reached", { label })
            : t("main.limit.near", { label, percent: Math.floor(usedPercent) })}
          {resetsAt === null ? (
            ""
          ) : (
            <span style={{ color: T.faint }}> · {resetText(resetsAt)}</span>
          )}
        </span>
        <button
          type="button"
          aria-label={t("main.limit.dismissAria")}
          title={t("main.limit.dismissAria")}
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: T.faint,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** The CLI's predicted next prompt as a dock card: Use writes it into the composer (over any
 *  draft there, which is the one case a click gets wrong), Send writes it and sends it the way
 *  Enter does (only on a dsh whose composer offers `submit`, 0.2.1 and later), Dismiss hides this
 *  text in this tab. Same frame as the login card so the stack reads as one set. */
function SuggestionCard({
  text,
  folded,
  onUse,
  onSend,
  onDismiss,
}: {
  text: string;
  /** The person is typing something else: the card fades and collapses, and its buttons stop
   *  taking clicks, until the box is cleared again. Stays mounted so the fade can run both ways. */
  folded: boolean;
  onUse: () => void;
  onSend?: () => void;
  onDismiss: () => void;
}) {
  useLocale();
  return (
    <div
      data-omc-suggestion-card=""
      data-omc-suggestion-folded={folded ? "" : undefined}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      aria-hidden={folded}
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        // The border is split out so its width can fold to nothing too: at 0.5px top and bottom
        // a folded card still drew a hairline across the dock.
        borderStyle: "solid",
        borderColor: "var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderWidth: folded ? 0 : "0.5px",
        borderRadius: "12px 12px 0 0",
        padding: folded ? "0 10px" : "8px 10px",
        fontSize: 13,
        // The fold: height and opacity ease out together; `maxHeight` stands in for height, which
        // CSS cannot animate from auto. 240px is four wrapped lines on a phone with room over; a
        // guess the CLI lets through is one short line, so the cap never shows.
        maxHeight: folded ? 0 : 240,
        opacity: folded ? 0 : 1,
        overflow: "hidden",
        pointerEvents: folded ? "none" : undefined,
        transition:
          "max-height .35s ease, opacity .35s ease, padding .35s ease, border-width .35s ease",
      }}
    >
      {/* Wraps on a phone: the text takes a line of its own under the label once the row is too
          narrow for label, text and buttons together (390 px squeezed it to three characters a
          line, 2026-10-21). */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Spark size={14} />
        <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: "none" }}>
          {t("main.suggestion.label")}
        </span>
        <span
          data-omc-suggestion-text=""
          style={{ flex: "1 1 14em", minWidth: 0, overflowWrap: "break-word" }}
        >
          {text}
        </span>
        {/* One cluster, pushed right: at phone width the text takes the first line and the
            three buttons move to the next together, instead of Use staying up and Send and the
            close dropping alone (owner's phone, 2026-10-21). */}
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {/* Disabled while folded: a card that is out of sight must not take the Tab key either. */}
          <button
            type="button"
            style={btn}
            data-omc-suggestion-use=""
            disabled={folded}
            onClick={onUse}
          >
            {t("main.suggestion.use")}
          </button>
          {onSend && (
            <button
              type="button"
              style={btn}
              data-omc-suggestion-send=""
              disabled={folded}
              onClick={onSend}
            >
              {t("main.suggestion.send")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("main.suggestion.dismissAria")}
            title={t("main.suggestion.dismiss")}
            data-omc-suggestion-dismiss=""
            disabled={folded}
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              padding: "2px 4px",
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      </div>
    </div>
  );
}

/** The card above the composer after a turn failed for want of a login on its box: the same login
 *  the Boxes row runs, here so nobody has to find Settings. It only ever follows a failed turn, so a
 *  box nobody uses never asks. Once the token is stored the server clears the need and the next poll
 *  takes the card down; until then it says what to do next. */
function LoginCard({ need, onDismiss }: { need: LoginNeed; onDismiss: () => void }) {
  useLocale();
  const [done, setDone] = useState(false);
  const { login, setLogin, startLogin, submitLogin } = useLoginFlow(() => setDone(true));
  const where = need.host ? need.label : t("main.boxes.thisBoxLower");
  return (
    <div
      data-omc-login-card={need.host || "this-box"}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      style={{
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        padding: "8px 10px",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Spark size={14} />
        <span style={{ flex: 1 }}>
          {done ? t("main.loginCard.loggedIn") : t("main.loginCard.loggedOut", { where })}
        </span>
        {!done && !login && (
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-login"
            onClick={() => startLogin(need.host)}
          >
            {t("main.boxes.logIn")}
          </button>
        )}
        <button
          type="button"
          aria-label={t("main.loginCard.dismissAria")}
          title={t("main.loginCard.dismiss")}
          onClick={onDismiss}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 2px",
            color: T.faint,
          }}
        >
          ×
        </button>
      </div>
      {login && !done && <LoginSteps login={login} setLogin={setLogin} submit={submitLogin} />}
    </div>
  );
}

/** One run of `claude update` as the GET answers it in the box's log. */
interface UpdateOutcome {
  ok: boolean;
  from: string | null;
  to: string | null;
  note?: string;
}

/** The card above the composer when a newer Claude Code is out for the box this session runs on.
 *  A headless claude never updates itself, so the button runs `claude update` there from dsh. The
 *  POST answers at once and the card follows the run through the GET every 3 s, since a request
 *  held open for the download would be cut by the reverse proxy this box is reached through. Once
 *  clicked the card owns its own life until ×: the dock's poll would otherwise take it down the
 *  moment `installed` moves, before anyone has read what happened. */
function ClaudeUpdateCard({
  update,
  sessionId,
  onAct,
  onGone,
}: {
  update: ClaudeUpdateCardData;
  sessionId: string;
  onAct: () => void;
  onGone: () => void;
}) {
  useLocale();
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "declined" | "failed">("idle");
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const where = update.host ? update.label : t("main.boxes.thisBoxLower");
  const Where = update.host ? update.label : t("main.sessions.thisBox");
  // `host` is the box this card is about, so its Update button never lands on another one: the
  // card is drawn from the picked mount, and the run has to follow the card.
  const url = `${ROUTE}/claude-update?session=${encodeURIComponent(sessionId)}&host=${encodeURIComponent(update.host)}`;
  const fail = (note: string) => {
    setOutcome({ ok: false, from: update.installed, to: null, note });
    setPhase("failed");
  };
  const start = (body: { run: true; auto?: true }) => {
    onAct();
    setPhase("busy");
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => readJson<{ busy: boolean }>(r))
      .catch((e: Error) => fail(e.message));
  };
  const dismiss = () => {
    onAct();
    if (phase === "idle")
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skip: update.latest }),
      }).catch(() => {});
    onGone();
  };
  // Follow the run: the GET until `busy` is false, then the newest log entry is the outcome.
  useEffect(() => {
    if (phase !== "busy") return;
    let live = true;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const s = await readJson<{ busy: boolean; log: UpdateOutcome[] }>(await fetch(url));
        if (!live) return;
        if (s.busy) {
          if (Date.now() - startedAt > 200_000) fail(t("main.update.noAnswer200"));
          return;
        }
        const last = s.log[s.log.length - 1];
        if (!last) return fail(t("main.update.noRun"));
        setOutcome(last);
        setPhase(last.ok ? "done" : last.to !== null && last.note ? "declined" : "failed");
      } catch {
        // a missed poll is retried on the next tick
      }
    };
    const id = setInterval(() => void tick(), 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [phase, url]);
  const text =
    phase === "done"
      ? t("main.update.cardDone", {
          where,
          to: outcome?.to ?? update.latest,
          installed: update.installed,
        })
      : phase === "declined"
        ? t("main.update.cardDeclined", { note: outcome?.note ?? t("main.update.noReason") })
        : phase === "failed"
          ? t("main.update.cardFailed", { note: outcome?.note ?? t("main.update.noAnswerShort") })
          : null;
  const narrow = useNarrow();
  const label =
    phase === "busy"
      ? t("main.update.updating")
      : phase === "done"
        ? t("main.update.updated")
        : phase === "declined"
          ? t("main.update.notUpdated")
          : phase === "failed"
            ? t("main.update.retryShort")
            : t("main.update.update");
  // Folded, the card is its header line, the way a side-question card folds: the label, the
  // chevron and the close. Open, the sentence and the buttons. A fold is recorded on the box for
  // this release, beside the skip: a session switch used to remount the card open (owner,
  // 2026-09-18), and a fold in one tab now reaches the others on the next poll. The close is what
  // records a skip until the next release.
  const [open, setOpen] = useState(!update.folded);
  useEffect(() => setOpen(!update.folded), [update.folded]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fold: next ? null : update.latest }),
    }).catch(() => {});
  };
  // After a success the card closes on its own: a thin accent bar along its bottom edge drains
  // over CLOSE_AFTER_S seconds as one CSS animation, so the close is seen coming without a number
  // ticking. The pointer over the card, or focus inside it, pauses the animation where it is (a
  // paused animation holds its frame; a transition cut short would jump to its end), and the close
  // fires from the animation's own end event, so a pause delays it by exactly the pause. The card
  // then fades for a moment rather than popping out. A decline or a failure stays until it is read
  // and closed.
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => goneRef.current(), 250);
    return () => clearTimeout(id);
  }, [leaving]);
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover and focus only pause the auto-dismiss; every action is a real button inside
    <div
      data-omc-update-card={update.latest}
      data-omc-update-phase={phase}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      // Focus holds the card too, so someone tabbing to its buttons is not raced by the timer.
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
          setHeld(false);
      }}
      style={{
        position: "relative",
        boxSizing: "border-box",
        background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
        border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
        borderRadius: "12px 12px 0 0",
        overflow: "hidden",
        fontSize: 13,
        opacity: leaving ? 0 : 1,
        transition: "opacity .25s ease",
      }}
    >
      {phase === "done" && (
        <div
          data-omc-update-closing={held ? "held" : "running"}
          aria-hidden="true"
          title={held ? t("main.update.held") : t("main.update.closesIn", { n: CLOSE_AFTER_S })}
          onAnimationEnd={() => setLeaving(true)}
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            height: 2,
            background: ACCENT,
            animation: `omc-drain ${CLOSE_AFTER_S}s linear forwards`,
            animationPlayState: held ? "paused" : "running",
          }}
        />
      )}
      {/* The header row holds two siblings, the fold toggle and the close, so neither button sits
          inside the other. The row keeps the old 6 px gap and 8 px right edge; the toggle carries
          the rest of the old padding so the whole bar left of the close is still one click. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 8 }}>
        <button
          type="button"
          aria-expanded={open}
          data-omc-update-toggle=""
          onClick={toggle}
          style={{ ...HEADER_TOGGLE, padding: "6px 0 6px 8px" }}
        >
          <Spark size={12} />
          {/* The label alone: the sentence lives in the body, where a phone shows it whole. */}
          <span style={{ color: ACCENT, fontWeight: 600, fontSize: 12, flex: 1 }}>
            {t("main.update.cardTitle")}
          </span>
          <Chevron open={open} />
        </button>
        <button
          type="button"
          aria-label={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          title={phase === "idle" ? t("main.update.dismissNextRelease") : t("close")}
          onClick={() => dismiss()}
          style={{ ...iconBtn, color: T.muted, fontSize: 12 }}
        >
          ✕
        </button>
      </div>
      {open ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            // Flush with the spark above, not indented under the label as a side question's
            // answer is: the buttons are the body, not a quote.
            padding: "0 8px 8px",
          }}
        >
          {/* On a phone the sentence takes its own line and the buttons the next; wider, one line. */}
          <span
            style={{
              flex: narrow ? "1 1 100%" : 1,
              minWidth: 0,
              color: phase === "failed" ? T.err : phase === "declined" ? T.faint : undefined,
            }}
          >
            {text ?? (
              <>
                {t("main.update.outBefore")}
                <a
                  data-omc-update-notes=""
                  href={claudeReleaseNotes(update.latest)}
                  target="_blank"
                  rel="noreferrer"
                  title={t("main.update.notesTitle")}
                  style={{ color: ACCENT }}
                >
                  {update.latest}
                </a>
                {t("main.update.outAfter", { where: Where, installed: update.installed })}
              </>
            )}
          </span>
          <button
            type="button"
            style={btn}
            data-testid="dsh-oh-my-claude-card-update"
            disabled={phase === "busy" || phase === "done" || phase === "declined"}
            aria-busy={phase === "busy" ? "true" : undefined}
            onClick={() => start({ run: true })}
          >
            {label}
          </button>
          {phase === "idle" && (
            <button
              type="button"
              aria-label={t("main.update.alwaysAria")}
              title={t("main.update.alwaysTitle")}
              onClick={() => start({ run: true, auto: true })}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0 2px",
                color: T.faint,
                textDecoration: "underline",
                fontSize: 12,
              }}
            >
              {t("main.update.always")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

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

/** Render this session's aside items as a collapsible stack, polling `/side-questions` every few
 *  seconds: questions, a login need and a Claude update card, or nothing when the poll is empty. */
function AsideBubble({
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
function SelectionSlot({
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

/** Small chip that warns when the idle watchdog is about to kill the process. */
function IdleChip({ sessionId }: { sessionId: string }) {
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
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- loadHints, applyTheme and writeHints are imports now, so nothing here is captured from apply()
  const reapplyTheme = () =>
    void loadHints().then((hints) => {
      applyTheme(hints);
      // Once per box: carry an old "Links, rules and quotes" off over to the groups split from it.
      // The write fires HINTS_EVENT, which lands back here with the marker set and stops.
      const patch = themeSplitPatch(hints);
      if (patch) writeHints(patch);
    }, console.error);
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
