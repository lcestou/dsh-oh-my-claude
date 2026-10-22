// The cost line in dsh's footer stats row from the browser's side: the pill, the dialog behind it,
// and the turn-record readers that fill it. The entry splices this file's CSS constant into its sheet.
import { t, useLocale } from "./i18n.js";
import type { CSSProperties } from "react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  ROUTE,
  fmtCost,
  fmtDuration,
  cacheShare,
  T,
  readJson,
  ACCENT,
  CLAUDE_MARK,
  activeClaudeSession,
  type ClientCtx,
  openSessionId,
  numberOr,
} from "./shared.js";
import { pollEvery, subscribe, type TurnRecord, type TurnsReply } from "./events.js";
import { paintSpeed, tokensPerSecond } from "./speed.js";
import { Spark, sparkNode } from "./spark.js";
import { useHintValue, useHintFlag } from "./hints.js";
import { onBodyMutation } from "./dom.js";

/** Cached tokens for the readout: `999`, `12.3K`, `2.1M`, and nothing at all for none. */
export const formatCacheRead = (tokens: number): string => {
  if (tokens <= 0) return "";
  if (tokens < 1000) return String(Math.round(tokens));
  const scaled = tokens < 1_000_000 ? tokens / 1000 : tokens / 1_000_000;
  const unit = tokens < 1_000_000 ? "K" : "M";
  return `${scaled.toFixed(1).replace(/\.0$/, "")}${unit}`;
};

/** `, 840ms to first token` for the tooltip; nothing when the turn was not measured. */
const fmtTtft = (ms?: number): string => {
  if (ms === undefined || ms <= 0) return "";
  const shown = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  return t("main.cost.ttft", { shown });
};

/** `$18.21 · $0.42 last`: the session total and the newest turn. The Claude mark goes in front of
 *  it by whoever draws it: the spark SVG in the pill, the glyph in a text row.
 *
 *  The cached-token count used to close the line, which made this the longest pill in dsh's row,
 *  and dsh's own neighbouring pill already reports the session's tokens and cache hit rate. The
 *  dialog behind the pill still breaks the cache reads and writes out in full. */
const costText = (total: number, last: number) =>
  t("main.cost.pill", { total: fmtCost(total), last: fmtCost(last) });

/** A token count for the dialog: `0` rather than the readout's blank for none. */
const fmtTokens = (n: number): string => formatCacheRead(n) || "0";

/**
 * The rows of the cost dialog, label and value, from the session's turn records.
 * ponytail: the token rows are the result frame's `usage`, which is the main agent loop only.
 * a Task subagent's tokens are not in them, while the cost above them covers the whole pipeline.
 * The frame's `modelUsage` has the pipeline totals per model; read those instead the day the gap
 * between the money and the tokens beside it matters.
 */
export const costDetails = (turns: TurnRecord[]): [string, string][] => {
  const sum = (pick: (r: TurnRecord) => number) => turns.reduce((s, r) => s + pick(r), 0);
  const last = turns[turns.length - 1];
  const totals = {
    input: sum((r) => r.input),
    cacheRead: sum((r) => r.cacheRead),
    cacheWrite: sum((r) => r.cacheWrite),
  };
  const rows: [string, string][] = [
    [t("main.cost.lastTurn"), fmtCost(last?.costUsd ?? 0)],
    [t("main.cost.turns"), String(turns.length)],
    [t("main.cost.wallTime"), fmtDuration(sum((r) => r.durationMs))],
    [t("main.cost.apiTime"), fmtDuration(sum((r) => r.apiMs))],
    [t("main.cost.input"), fmtTokens(totals.input)],
    [t("main.cost.cacheRead"), fmtTokens(totals.cacheRead)],
  ];
  if (totals.cacheWrite > 0) rows.push([t("main.cost.cacheWrite"), fmtTokens(totals.cacheWrite)]);
  rows.push([t("main.cost.output"), fmtTokens(sum((r) => r.output))]);
  if (totals.input + totals.cacheRead + totals.cacheWrite > 0)
    rows.push([t("main.cost.cacheHit"), `${Math.round(cacheShare(totals) * 100)}%`]);
  if (last?.ttftMs !== undefined && last.ttftMs > 0)
    rows.push([
      t("main.cost.firstToken"),
      last.ttftMs < 1000 ? `${Math.round(last.ttftMs)}ms` : `${(last.ttftMs / 1000).toFixed(1)}s`,
    ]);
  return rows;
};

/** dsh's `stat-dialog.module.css` (ui-chat), rule for rule, on this plugin's own hooks: the hashed
 *  class names change with every dsh build, the design tokens do not.
 *
 *  The cap is 320px rather than dsh's own so the API-rate footnote wraps instead of setting the
 *  width: at 440 it was the widest line in the dialog and made this panel half again as wide as
 *  the stats dialog beside it (440 against 300, measured on dsh 0.1.6-alpha.2). */
export const COST_DIALOG_CSS =
  "[data-omc-cost-dialog]{z-index:1100;box-sizing:border-box;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(300px,100vw - 24px);max-width:min(320px,100vw - 24px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;position:fixed}" +
  "[data-omc-cost-title]{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}" +
  "[data-omc-cost-title-label]{align-items:center;gap:6px;min-width:0;display:inline-flex}" +
  "[data-omc-cost-title-label] svg{flex:none;width:14px;height:14px}" +
  "[data-omc-cost-title-value]{font-variant-numeric:tabular-nums}" +
  "[data-omc-cost-rule]{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}" +
  "[data-omc-cost-details]{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}" +
  "[data-omc-cost-details] dt,[data-omc-cost-details] dd{min-width:0;margin:0}" +
  "[data-omc-cost-details] dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}" +
  // dsh's tooltip look (its bubble class is hashed, so the rules are copied onto our own hook,
  // on the same tokens): fixed, above the anchor, centred by the transform.
  "[data-omc-tip]{display:inline-flex;align-items:center;position:fixed;z-index:1100;width:max-content;max-width:50vw;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-static-neutral-bluish-00);font-size:13px;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none;transform:translate(-50%,-100%)}" +
  "[data-omc-tip][data-side=bottom]{transform:translate(-50%)}" +
  "[data-omc-cost-guard]{margin-top:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px}" +
  "[data-omc-cost-guard] label{display:inline-flex;align-items:center;gap:4px}" +
  "[data-omc-cost-guard] input{width:64px;font:inherit;color:inherit;background:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.1));border:0;border-radius:6px;padding:2px 6px}" +
  "[data-omc-cost-guard] button{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;cursor:pointer}" +
  "[data-omc-cost-note]{flex-basis:100%;margin:4px 0 0;color:var(--dsw-alias-label-tertiary)}";

/** dsh's unplaced-portal style: mounted so it can be measured, invisible until it has coordinates. */
const MEASURE_STYLE: CSSProperties = { visibility: "hidden", left: 0, top: 0 };

let statusOnce: Promise<boolean> | undefined;

/** The hashed half of a CSS-module class changes with every dsh build, the suffix does not. */
const MODULE_ROOT = /(?:^|\s)[\w-]*_root(?:\s|$)/;
/** dsh's `StatsLine` separator: a direct child of the row, `aria-hidden`, and a literal bar. */
const STATS_SEP = ':scope > span[aria-hidden="true"][class$="_sep"]';
/** The readout's own wrapper in dsh's row, so a later hook can clear an earlier one's node. */
const COST_SLOT = "data-omc-cost-slot";
/** `localStorage["omc-debug"] === "1"`, read once at load: the check used to run on every frame
 *  the cost hook fired, which is every dirty frame of a streaming turn while the row is lost. */
const COST_DEBUG = (() => {
  try {
    return localStorage.getItem("omc-debug") === "1";
  } catch {
    return false;
  }
})();
/** One of dsh's stats pills as the row holds it: an anchor span wrapping a popover button. The
 *  plugin's own composer button has the same shape, a span around a dialog trigger, so while no
 *  stats row is on screen (a session switched back to from a subagent, before its row draws) the
 *  cost pill was hooked in beside it, took its grey class and stayed there until a refresh. */
const STATS_PILL = ':scope > span > button[aria-haspopup="dialog"]:not([data-omc-panel-trigger])';
/** dsh 0.1.7's compact stats draw each stat as a bare `span` pill in the row, with no anchor span
 *  around it and no button; its detailed stats keep the anchor-and-button pair `STATS_PILL` finds.
 *  Its own class is what the cost pill copies there, and the plugin's own node is excluded by the
 *  slot attribute it carries. dsh 0.2.1 puts the anchor span back around that bare pill and marks
 *  the anchor `data-composer-stat`, which is the second half of the list. */
const STATS_PILL_SPAN =
  ':scope > span[class*="pill" i]:not([data-omc-cost-slot]), :scope > span[data-composer-stat] > span[class*="pill" i]';
/** One of dsh 0.2.1's stats pills. From that version there is no row element of dsh's own: each
 *  pill is registered into the composer dock's slot, so the row is whatever holds the marked
 *  anchors. Without this the Compact pills, which carry no button, went unseen and the dock around
 *  them answered as the row because the context meter in it has the anchor-and-button shape. */
const STATS_ANCHOR = ":scope > span[data-composer-stat]";

/**
 * dsh's own stats row, the div the cost line is appended to. dsh builds it in `StatsLine` as a
 * `_root` div of `<span>` groups joined by `_sep` bars, which is the handle used here: the groups
 * themselves come from the `stats.counts` message and read differently in another locale. The
 * English text stays as a last resort for a row that has one group and therefore no bar yet.
 */
export const isStatsRow = (el: HTMLElement): boolean => {
  if (!el.isConnected || el.children.length < 1) return false;
  // dsh 0.1.5 draws the row as pills and marks it (`StatsPills`, ui-chat); the shape checks below
  // are for the earlier row of groups with a bar between them.
  if (el.hasAttribute("data-composer-stats")) return true;
  if (el.querySelector(STATS_ANCHOR)) return true;
  // dsh 0.1.6-alpha.2 draws the same pills and dropped the marker, so the row is recognised by the
  // shape instead: anchor spans holding one popover pill each. Asked for as direct children, which
  // is what keeps the footer that wraps the row from matching too. Appending into that footer is
  // how the readout ended up outside the row, as loose text behind a bar.
  if (el.querySelector(STATS_PILL)) return true;
  // The class comes before the text, and the text is only read for a div that has it. Both old and
  // new dsh draw the row as a `_root` module div, and `textContent` on a div that is not one builds
  // the whole subtree's text: over every div in a long conversation that alone was 20 ms a call.
  if (el.children.length < 2 || !MODULE_ROOT.test(el.className)) return false;
  // Three other dsh components draw an empty `_sep` span inside a row; only this one is a bar.
  if (el.querySelector(STATS_SEP)?.textContent === "|") return true;
  return /\d+ turns · \d+ steps/.test(el.textContent ?? "");
};

/** Cost readout in dsh's footer stats row: only when the open session is a Claude mount. */
export function CostLine({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  // What the poll compares against without listing `turns` as a dependency of its effect.
  const turnsRef = useRef<TurnRecord[]>([]);
  turnsRef.current = turns;
  const visibleRef = useRef(true);

  useEffect(() => {
    // No `activeClaudeSession` gate here. It reads the session's provider binding, which is briefly
    // undefined during a restart or a rebind; an effect that ran in that window returned before
    // installing the interval, with `[ctx, sessionId]` stable, never ran again. So the cost never
    // appeared for that tab until it was reloaded. This is the same fault the `/btw` card had (#210).
    // The route is per-session and the render below decides whether to draw, so polling unconditionally
    // costs one request per ten seconds and removes the dead window.
    let alive = true;
    const fetchTurns = async () => {
      try {
        const r = await fetch(`${ROUTE}/turns?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok) return;
        // SAFETY: the body is our own JSON route; the union type names both shapes the caller checks
        const body = (await r.json()) as TurnsReply | { error: string };
        if ("error" in body) return;
        // An empty answer is "no records to hand out right now", not "this session cost nothing":
        // the route reads an in-memory map that is empty for a moment after dsh restarts, and
        // zeroing the total took the cost off the row under the pointer. Only records replace records.
        const next = body.turns ?? [];
        if (alive && (next.length > 0 || turnsRef.current.length === 0)) setTurns(next);
      } catch {
        // network error: keep previous turns
      }
    };
    fetchTurns();
    // A new record arrives on the event stream when a turn ends; the read is the fallback: every
    // 30 s while the stream is up, every 10 s when it is not. The same rule as the read: only
    // records replace records, so an empty list never zeroes the row.
    const offTurns = subscribe("turns", (session, data) => {
      if (session !== sessionId || !alive) return;
      const next = data.turns ?? [];
      if (next.length > 0 || turnsRef.current.length === 0) setTurns(next);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (visibleRef.current) fetchTurns();
      timer = setTimeout(tick, pollEvery(false, 10_000, 10_000));
    };
    timer = setTimeout(tick, 10_000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current) fetchTurns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      offTurns();
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);

  const [boxLine] = useHintValue("spendWarnUsd");
  const [sessionLine, setSessionLine] = useHintValue(
    `spendWarnUsd${sessionId.replaceAll("-", "")}`,
  );
  const line = numberOr(sessionLine) ?? numberOr(boxLine);
  // The footer pill is on unless the box turned it off, so an absent key still shows it. Only the
  // readout goes: the turn records behind it are collected either way, and the figure is back the
  // moment the switch returns.
  const [costOff] = useHintFlag("costOff");

  // dsh's current session blinks: a child session takes the slot for a moment, and a model
  // directory mid-rebind answers no provider at all. A blank answer used to read as "not mine" and
  // took the cost off the row under the pointer, so only another session's id gives it up.
  // Derived during render, committed after it: React throws renders away, and one that never
  // reached the screen used to latch this ref anyway. So a render for another session could leave
  // the cost of this one on the row.
  const mineRef = useRef(false);
  const current = openSessionId(ctx);
  const mine =
    activeClaudeSession(ctx) === sessionId
      ? true
      : current && current !== sessionId
        ? false
        : mineRef.current;
  useLayoutEffect(() => {
    mineRef.current = mine;
  });
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const last = turns[turns.length - 1];
  const text = mine && !costOff && total > 0 && last ? costText(total, last.costUsd) : "";
  // Past the line the pill turns orange and the tooltip leads with the fact; every wording says
  // API-rate, since a subscription login is not billed by this figure.
  const over = mine && total > 0 && line !== undefined && total >= line;
  const base =
    mine && total > 0 && last
      ? t(turns.length === 1 ? "main.cost.tooltipOne" : "main.cost.tooltipOther", {
          total: fmtCost(total),
          last: fmtCost(last.costUsd),
          n: turns.length,
          ttft: fmtTtft(last.ttftMs),
        })
      : "";
  const title =
    over && line !== undefined ? t("main.cost.tooltipOver", { line: fmtCost(line), base }) : base;
  const [subscription, setSubscription] = useState(false);
  useEffect(() => {
    let live = true;
    statusOnce ??= fetch(`${ROUTE}/status`)
      .then((r) => readJson<{ authMethod?: string | null }>(r))
      .then((s) => s.authMethod === "claude.ai")
      .catch(() => false);
    void statusOnce.then((v) => live && setSubscription(v));
    return () => {
      live = false;
    };
  }, []);
  const [guardDraft, setGuardDraft] = useState("");
  useEffect(() => {
    setGuardDraft(numberOr(sessionLine) === undefined ? "" : String(sessionLine));
  }, [sessionLine]);
  const saveGuard = () => {
    const v = guardDraft.trim();
    if (v === "") {
      setSessionLine(null);
      return;
    }
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) setSessionLine(n);
    else setGuardDraft(numberOr(sessionLine) === undefined ? "" : String(sessionLine));
  };
  // The pill's dialog, the same seat dsh's own pills use (`useStatDialog`, ui-chat): the injected
  // anchor span is the trigger root, the panel is fixed-positioned above it by dsh's own hook and
  // closes on an outside pointer or Escape. No portal: the panel is rendered here, beside the slot
  // span, and `position: fixed` puts it where the coordinates say regardless.
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  const pillRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pos = useAnchoredPosition({
    open,
    anchorRef: pillRef,
    panelRef,
    side: "top",
    gap: 8,
    margin: 12,
  });
  useDismissOnOutsidePointer(pillRef, open, setOpen, panelRef);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  // A cost that left the row takes its dialog with it.
  useEffect(() => {
    if (!text) setOpen(false);
  }, [text]);
  // dsh's stats row is one div of groups; a slot entry can only be its sibling and lands on its
  // own line. Append into that div instead, the way the context meter hooks its popover.
  // ponytail: the row is found by its shape, not by a slot dsh offers; swap for a slot the day
  // dsh's stats line grows one.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [hooked, setHooked] = useState(false);
  // What the injected nodes say, held in a ref: a new cost arriving mid-hover used to tear the
  // whole hook down and build it again, which is the blink the row was reported to have. The
  // nodes now stay where they are and only their text is rewritten.
  // Same reason as `mineRef`: these feed nodes injected into dsh's own row, and `tryHook` writes
  // `textRef.current` straight onto the screen. Written in a layout effect, so what lands there
  // comes from a render React committed. Layout effects run before the passive effect below, so
  // the sync still sees the new text.
  const textRef = useRef(text);
  const titleRef = useRef(title);
  const overRef = useRef(false);
  overRef.current = over;
  useLayoutEffect(() => {
    textRef.current = text;
    titleRef.current = title;
    openRef.current = open;
  });
  const syncRef = useRef<() => void>(() => {});
  useEffect(() => syncRef.current(), [text, title, open]);
  useEffect(() => {
    let inline: HTMLSpanElement | undefined;
    let body: HTMLSpanElement | undefined;
    let trigger: HTMLButtonElement | undefined; // the pill itself, in the pill row only
    let pad = ` ${CLAUDE_MARK} `; // between the bar and the text, with the mark; nothing in a pill
    let lastRow: HTMLElement | undefined;
    let lastHost: HTMLElement | undefined; // the footer the row hangs in; it outlives the row
    // The row appears with the first settled step and is one of dsh's own divs anywhere in the
    // document; look for it until found (one conversation is on screen at a time).
    // `inline?.isConnected`, not `inline`: dsh re-renders this row on every step and React drops
    // the span we appended. Holding the detached node as proof it is hooked left the cost gone for
    // good. The row has to be hooked again each time it loses ours.
    // `localStorage.setItem("omc-debug", "1")` prints every hook, drop and repaint to the console;
    // the row lives in someone else's DOM, so this is the only way to watch what removed it.
    const debug = (...args: unknown[]) => {
      try {
        if (COST_DEBUG) console.debug("[oh-my-claude cost]", ...args);
      } catch {
        // a browser that refuses localStorage simply has no debug output
      }
    };
    const paintOver = () => {
      const target = trigger ?? inline;
      if (target) {
        if (overRef.current) target.setAttribute("data-omc-cost-over", "");
        else target.removeAttribute("data-omc-cost-over");
      }
    };

    const tryHook = () => {
      if (!anchorRef.current?.isConnected) return;
      if (inline?.isConnected) {
        // Already in the row: rewrite what it says instead of building it again. Only what
        // changed: the observer above reports every childList mutation, and a `textContent` write
        // replaces the text node even when the string is the same, so an unconditional write here
        // called this back on every frame, 35 mutations a second under an idle pill, measured
        // 2026-09-10, for nothing.
        if (trigger) {
          const expanded = String(openRef.current);
          if (trigger.getAttribute("aria-label") !== titleRef.current)
            trigger.setAttribute("aria-label", titleRef.current);
          if (trigger.getAttribute("aria-expanded") !== expanded)
            trigger.setAttribute("aria-expanded", expanded);
          paintOver();
        } else if (inline.title !== titleRef.current) {
          inline.title = titleRef.current;
          paintOver();
        }
        const wanted = `${pad}${textRef.current}`;
        if (body && body.textContent !== wanted) body.textContent = wanted;
        // The cost reads last in the row, after dsh's own stats. dsh rebuilds those children
        // whenever their shape changes — switching Performance and usage between Compact and
        // Detailed is one such rebuild — and the new ones land after this node, which left the
        // cost reading first (owner, 2026-09-22). Moving it back is one append, and it only runs
        // on the frame a rebuild happened.
        const host = inline.parentElement;
        if (host && inline.nextElementSibling !== null) host.append(inline);
        // The same rebuild can change the class the pill borrows, so it is re-copied when dsh's
        // own pill no longer matches.
        const live = host?.querySelector(STATS_PILL) ?? host?.querySelector(STATS_PILL_SPAN);
        if (live && trigger && live.className !== trigger.className) {
          trigger.className = live.className;
          inline.className =
            live.parentElement === host ? "" : (live.parentElement?.className ?? "");
        }
        return;
      }
      if (inline) debug("row dropped our span; hooking again");
      // Three tries, cheapest first. The row dsh re-rendered is usually the same element with new
      // children, so the one it was last found in is tried first. When dsh replaces the element,
      // which it does on a settled step, and that is exactly when this runs, the footer it hangs
      // in is still the same node, so the second try searches that instead of the document. Only a
      // conversation that was never hooked, or a footer that went away, pays for the full walk.
      // dsh 0.1.5 marks the row, so ask for it by name first: one indexed attribute query against
      // a conversation where the `div` walk below is thousands of nodes.
      const rowIn = (root: ParentNode) => {
        const marked = [...root.querySelectorAll<HTMLDivElement>("div[data-composer-stats]")].at(
          -1,
        );
        if (marked?.isConnected) return marked;
        // dsh 0.2.1 marks each pill instead of the row; the row is the last marked pill's parent.
        const anchored = [...root.querySelectorAll<HTMLElement>("span[data-composer-stat]")].at(-1);
        if (anchored?.parentElement) return anchored.parentElement;
        const divs = [...root.querySelectorAll<HTMLDivElement>("div")];
        // A div holding dsh's own pills is the row itself; the containers around it can pass the
        // looser shape test, and appending into one of those is how the readout ended up beside
        // the row rather than in it. The looser test still answers for a dsh that draws no pills.
        return (
          divs.filter((div) => div.querySelector(STATS_PILL)).at(-1) ??
          divs.filter(isStatsRow).at(-1)
        );
      };
      // The anchor is rendered into the composer dock's slot, and the stats row is a child of that
      // same dock, so the dock is searched before the whole document: the document walk ran on
      // every dirty frame of a streaming turn for as long as the row was lost.
      const dock = anchorRef.current?.parentElement?.parentElement ?? undefined;
      const statsRow =
        lastRow && isStatsRow(lastRow)
          ? lastRow
          : ((lastHost?.isConnected === true ? rowIn(lastHost) : undefined) ??
            (dock ? rowIn(dock) : undefined) ??
            rowIn(document));
      lastRow = statsRow;
      lastHost = statsRow?.parentElement ?? lastHost;
      if (!statsRow) {
        debug("no stats row on screen");
        return;
      }
      inline = document.createElement("span");
      // Named so a hook can clear what an earlier one left. `drop` only ever knew the node in
      // hand, so a readout appended into a row dsh then replaced, or into a container that read
      // as the row before the pills arrived, stayed in the page, out of sight, for the tab's life.
      inline.setAttribute(COST_SLOT, "");
      for (const stale of document.querySelectorAll(`[${COST_SLOT}]`)) stale.remove();
      inline.style.whiteSpace = "nowrap";
      body = document.createElement("span");
      // The pill row: an anchor span holding a pill (button or span) whose first span is the
      // label. Ours borrows the three class names from dsh's first pill, so it takes the same
      // padding, radius and colour whatever the module hash is in this build. It is a button, as
      // dsh's are: the hover rule is `button._pill:hover`, a span never lights up, and a phone has
      // no hover at all. The tap opens the dialog, which is where the detail lives.
      // 0.1.5 marks the row and its first pill is the first grandchild; 0.1.6-alpha.2 drops the
      // marker but draws the same anchor-and-pill pair, so an unmarked row is asked for the pill
      // by shape. Copying its classes is also what gives the readout dsh's own phone behaviour:
      // the label carries `overflow:hidden;text-overflow:ellipsis` under a button capped at the
      // row's width, so it shortens as the row narrows and ends as the icon alone.
      const proto = statsRow.querySelector(STATS_PILL);
      // 0.1.7's pill is the span itself, so there is no anchor class to copy and the pill class
      // goes on the trigger. Reading `firstElementChild.firstElementChild` as the prototype, which
      // is what ran before, picked up that pill's icon instead and dressed the cost readout in an
      // `svg` class: a bordered box with the mark above the figure (owner, 2026-09-22).
      const protoSpan = proto === null ? statsRow.querySelector(STATS_PILL_SPAN) : null;
      if (proto?.parentElement || protoSpan) {
        pad = "";
        // A bare 0.1.7 pill sits in the row itself and has no anchor to copy; 0.2.1's has one.
        const anchor = (proto ?? protoSpan)?.parentElement;
        inline.className = anchor && anchor !== statsRow ? anchor.className : "";
        trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = (proto ?? protoSpan)?.className ?? "";
        trigger.setAttribute("data-omc-cost-pill", "");
        trigger.setAttribute("aria-haspopup", "dialog");
        trigger.setAttribute("aria-expanded", String(openRef.current));
        trigger.setAttribute("aria-label", titleRef.current);
        paintOver();
        trigger.addEventListener("click", () => setOpen((was) => !was));
        body.className = (proto ?? protoSpan)?.querySelector("span")?.className ?? "";
        body.textContent = textRef.current;
        // dsh's pills lead with a 14px icon in the pill's own text colour; ours is Claude's spark.
        trigger.append(sparkNode(14, "currentColor"), body);
        inline.append(trigger);
        pillRef.current = inline;
      } else {
        pad = ` ${CLAUDE_MARK} `;
        inline.title = titleRef.current;
        paintOver();
        const sep = document.createElement("span");
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "|";
        body.textContent = `${pad}${textRef.current}`;
        inline.append(" ", sep, body);
      }
      statsRow.append(inline);
      debug("hooked the stats row", { text: textRef.current });
      setHooked(true);
    };

    const drop = () => {
      // Nothing was ever put on screen: the first turn of a session runs this on every frame with
      // no cost to show yet. `lastRow` is what says a hook once succeeded, so a span dsh has since
      // dropped still clears the hooked flag.
      if (inline === undefined && lastRow === undefined) return;
      inline?.remove();
      inline = undefined;
      body = undefined;
      trigger = undefined;
      pillRef.current = null;
      lastRow = undefined; // a fresh hook looks the row up again rather than trusting an old pane
      setHooked(false);
    };

    // One pass per frame however many mutations dsh made: the observer watches the whole body, and
    // a streaming turn changes it many times a frame.
    let queued = false;
    const sync = () => {
      queued = false;
      // dsh rewrites its own reading whenever its figure changes, so ours goes over it each pass.
      paintSpeed(tokensPerSecond(turnsRef.current));
      if (!textRef.current) {
        if (inline) debug("no cost to show; dropping the row");
        drop();
        return;
      }
      tryHook();
    };
    syncRef.current = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    };
    // The one shared body observer, not a second one of its own: every observer on `document.body`
    // is handed its own copy of each mutation record, and a streaming turn makes hundreds a second.
    // The shared one already coalesces to one pass per frame, which is what `sync` wanted.
    const off = onBodyMutation(() => syncRef.current());
    sync();
    // Fallback for a change no mutation reports at all (a row moved by CSS, a bubble reused).
    const timer = setInterval(sync, 1000);
    return () => {
      clearInterval(timer);
      off();
      syncRef.current = () => {};
      drop();
    };
  }, []);
  if (!text) return <span ref={anchorRef} hidden />;
  return (
    <>
      <span ref={anchorRef} style={hooked ? { display: "none" } : undefined}>
        {(() => {
          const overAttr: Record<string, string> = {};
          if (over) overAttr["data-omc-cost-over"] = "";
          return (
            <span
              title={title}
              style={{
                display: "inline",
                fontSize: 14,
                color: over ? ACCENT : T.faint,
                whiteSpace: "nowrap",
              }}
              {...overAttr}
            >
              <span aria-hidden="true">|</span> {CLAUDE_MARK} {text}
            </span>
          );
        })()}
      </span>
      {open && (
        <div
          ref={panelRef}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal popover; <dialog> hides unless open and brings its own box
          role="dialog"
          aria-label={t("main.cost.dialogLabel")}
          data-omc-cost-dialog=""
          style={pos ?? MEASURE_STYLE}
        >
          <div data-omc-cost-title="">
            <span data-omc-cost-title-label="">
              <Spark size={14} />
              {t("main.cost.dialogLabel")}
            </span>
            <span data-omc-cost-title-value="">{fmtCost(total)}</span>
          </div>
          <div data-omc-cost-rule="" aria-hidden="true" />
          <dl data-omc-cost-details="">
            {costDetails(turns).map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
          <div data-omc-cost-guard="">
            <label>
              {t("main.cost.warnAt")}
              <input
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                aria-label={t("main.cost.warnAria")}
                data-omc-cost-guard-input=""
                value={guardDraft}
                placeholder={
                  numberOr(boxLine) === undefined ? t("main.cost.offPlaceholder") : String(boxLine)
                }
                onChange={(e) => setGuardDraft(e.target.value)}
                onBlur={saveGuard}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveGuard();
                }}
              />
            </label>
            {numberOr(sessionLine) !== undefined && (
              <button
                type="button"
                data-omc-cost-guard-clear=""
                onClick={() => setSessionLine(null)}
              >
                {t("main.cost.clear")}
              </button>
            )}
            {subscription && <p data-omc-cost-note="">{t("main.cost.subscriptionNote")}</p>}
          </div>
        </div>
      )}
    </>
  );
}
