// Browser half: Settings → "Oh My Claude". A branded header, then two cards: Sessions (one
// transcript list across this box and every saved box. Filter by box, workspace, origin; open
// here or jump to the box) and Boxes (this box as the first row, plus the ssh and linked-dsh
// machines you add, each probed for claude version and login). Built into lib/client.js by
// `bun run build`.
import { installLocale, t, useLocale } from "./i18n.js";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  type ClientCtx,
  type DirectoryFlowOwnerProps,
  openHere,
  whenContextGone,
  guard,
  retire,
  revive,
  DOCK_CARD,
} from "./shared.js";
import { themeSplitPatch, hasTheme } from "./theme.js";
import { PluginUpdateBadge } from "./update-pill.js";
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
import { AddWorkflow, AddWorkspaceFlow, BOXES_EVENT } from "./picker.js";

import { compactThreshold, runDraft, SHELL_LANGS } from "./nudge.js";
import { worstLimit } from "./limits.js";
import {
  noteWithdrawn,
  type RestoreWatch,
  startWatch,
  stepRestore,
  withdrawnSince,
} from "./steer-restore.js";
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
  StarterCard,
  StarterSwitch,
  SuggestionSwitch,
  TerminalSyncSwitch,
  ThemeSwitch,
  ToolRowsSwitch,
  UpdateNoticeSwitch,
  WorkspaceModelMemory,
  WorkspaceModelSwitch,
} from "./settings-card.js";

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
