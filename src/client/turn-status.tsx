// The turn-status line: the spinner frames, the verb and word painters, the closing clock and
// the dock strip they draw into. The entry keeps one import line for what it still uses.
import { activeLocale, onLocaleSwitch, t } from "./i18n.js";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ROUTE,
  T,
  readJson,
  guard,
  isClaudeSession,
  activeClaudeSession,
  whenContextGone,
  fmtDuration,
  controlStatesCss,
  type ClientCtx,
} from "./shared.js";
import { hexToRgb, gated, hasTheme } from "./theme.js";
import type { LiveMode } from "../translator.js";
import { openStream, pollEvery, subscribe, type LiveTurnBody } from "./events.js";
import { useHintFlag } from "./hints.js";
import { changedElements, onBodyMutation, pageIsDark, type Face } from "./dom.js";
import { isObj, SettingsFile } from "./boxes.js";
import {
  DEFAULT_VERBS,
  ZH_VERBS,
  spinnerFrameAt,
  bracketOpen,
  pickVerb,
  mergeVerbs,
} from "./verbs.js";
import {
  CLOSING_VERBS,
  ZH_CLOSING_VERBS,
  closingVerb,
  clockText,
  isStopped,
  tookDuration,
} from "./closing.js";
import { COST_DIALOG_CSS } from "./cost.js";
import { RAINBOW_CSS } from "./ultrathink.js";

/** Default frames, played out and back on the CLI's eased 2 s cosine (see spinnerFrameAt). */
const DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✻"] as const;

type SpinnerVerbSetting = { mode: "append" | "replace"; verbs: string[] };
let spinnerSettings:
  | Promise<{ setting?: SpinnerVerbSetting; frameSet: typeof DEFAULT_FRAMES }>
  | undefined;
/** Fetch Claude Code's settings.json text and extract spinnerVerbs if present. The setting comes
 *  back unmerged: the defaults it adds to depend on the language when the row is drawn, not when
 *  the page loaded. */
const loadSpinnerSettings = async (): Promise<{
  setting?: SpinnerVerbSetting;
  frameSet: typeof DEFAULT_FRAMES;
}> => {
  try {
    const body = await readJson<SettingsFile>(await fetch(`${ROUTE}/settings`));
    const parsed = JSON.parse(body.text);
    if (!isObj(parsed)) return { frameSet: [...DEFAULT_FRAMES] };
    const sv = parsed.spinnerVerbs;
    // SAFETY: spinnerVerbs comes from parsed JSON (a JsonObject); the cast is to read its known keys.
    if (!isObj(sv) || !Array.isArray((sv as { verbs?: unknown }).verbs))
      return { frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode is a string key on the JsonObject; we validate the value below.
    const mode = (sv as { mode?: string }).mode;
    if (mode !== "append" && mode !== "replace") return { frameSet: [...DEFAULT_FRAMES] };
    // SAFETY: mode and verbs have been validated above; the cast narrows to the expected shape.
    return { setting: sv as SpinnerVerbSetting, frameSet: [...DEFAULT_FRAMES] };
  } catch {
    return { frameSet: [...DEFAULT_FRAMES] };
  }
};

/** The page's accent as channels for the spinner's mixing, or `fallback` when none is set yet. */
const accentRgb = (fallback: Rgb): Rgb => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--omc-accent").trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? hexToRgb(v) : fallback;
};

/** Inject (or re-inject after a hot reload) the Claude-orange rule; idempotent by id. Reuses the
 *  element but always rewrites it: a hot reload lands a new bundle in a page still carrying the last
 *  one's sheet, and returning early here left the old rules in force until a hand reload. */
const ensureTurnStatusStyle = () => {
  const found = document.getElementById("dsh-oh-my-claude-turn-status");
  const styleEl = found instanceof HTMLStyleElement ? found : document.createElement("style");
  styleEl.id = "dsh-oh-my-claude-turn-status";
  // The frames differ in advance width in a proportional font; a fixed cell keeps the verb still.
  // The glyph sits at the cell's start, not its middle, which is what the terminal does for free:
  // there every frame is one monospace cell, so the wide asterisks all land on the same left edge
  // and only the narrow `·` reads as movement. Centring here made the whole animation breathe out
  // of both sides instead.
  // `body[data-omc-claude]` is set while the open session is a Claude mount, so the row is orange
  // from its first paint; the watcher then swaps the text and adds the spinner a frame later.
  //
  // The last two rules recolour the conversation's selected view tab (Chat / Trajectory), which dsh
  // paints from its blue `--dsw-alias-state-business-primary`. The label and its underline draw
  // from the same token but as `color` and `background`, so both are overridden. Gated on the same
  // body attribute, so a session that switches off a Claude mount hands the tab straight back to
  // dsh's blue on the next paint. ponytail: `[role=tablist] > [role=tab]` catches any dsh view-tab
  // switcher; if a non-conversation one should stay blue, narrow it the day one appears.
  //
  // Then what the markdown draws in a colour of its own inside a Claude session. Two in dsh's
  // blue: a link, with its underline at a lighter weight and the shimmer on hover, and a task
  // checkbox, whose tick is the platform accent. Two in a flat grey: a blockquote's left bar
  // (`--dsw-alias-label-caption`) and a rule's hairline (`--dsw-alias-border-l2`). All are accents
  // rather than text, so they take the orange. The bar is at half strength, the rule at a third,
  // since it runs the whole width and a solid orange band across a message reads as a warning.
  // Code highlighting keeps its own palette: those colours mean token kinds, not the brand. Swept
  // 2026-09-09 with a computed-style pass over the conversation column: nothing else is blue there.
  // Missed by that sweep because it only exists while a run is open: a workflow-run card's member
  // row is a button in `--dsw-alias-link` blue while its child session is still running (dsh's
  // ui-workflow-run package, `memberButton`); once the member finishes it becomes a plain grey row.
  // The data attributes are dsh's own, the hashed class name is not.
  // The running glyph dsh draws (its `StateDot` at `state="ongoing"`: a matrix of chasing squares
  // up to 0.1.6, a ring with a spinning arc from 0.1.7). Two rules, both under the row switch:
  // the ones inside the open conversation (the job-list dot in the session header, the subagent
  // switcher's dropdown, plans, schedules) take the orange while the open session is a Claude
  // mount, and a sidebar row's takes it while that row carries `data-omc-claude`, the mark the
  // row-action slot paints on a running Claude session's own row. The first rule stops at the
  // sidebar rows on purpose: it used to reach every row, so a DeepSeek session running in the
  // sidebar went orange whenever a Claude session was open. The colour comes from
  // `--dsh-state-ongoing`, a custom property dsh sets in the glyph's own class up to 0.1.6, so a
  // value inherited from `body` loses to it and the override has to land on the same element;
  // 0.1.7 dropped that property and strokes the glyph with `currentColor`, so each rule sets
  // `color` as well and one of the two takes on whichever dsh is installed. The rules select on
  // dsh's own attribute rather than its hashed class name, and an attribute plus an ancestor
  // outweighs the single class dsh sets it with, so no `!important` is needed. On a dsh without
  // the row-action slot the sidebar rows are tinted by the spinner scan instead (title match).
  // The working line's sweep is the CLI's glimmer by mode (2.1.280): left to right in 1.5 s while
  // the request is out, right to left in 6 s while a block streams (its 50 ms and 200 ms per cell
  // over a ten-letter verb plus the twenty-cell run-out), and during a tool call the whole verb
  // breathes between the accent and the shimmer on a 2 s round trip instead, drawn by sliding a
  // three-stop gradient two hundred times wider than the line so the visible slice is one colour.
  // A ramp's flat `--omc-row-bg` set inline wins over the pulse's; since the tints snap off when a
  // tool starts, the pulse begins at once.
  // The stats row under the composer (`data-composer-stats`) is padded to the composer's side
  // clearance, which leaves its pills 653px in a 717px column. dsh's two fill that; ours as a
  // third clips all three to an ellipsis by a few pixels. The pills are centred, so the padding
  // does no aligning; take it down to the row's rounded corners and the three fit.
  styleEl.textContent = `${gated("row", '[role="status"][aria-live="polite"]:not([class*="visuallyHidden"])')},${gated("row", "[data-dsh-oh-my-claude-turn]", false)}{background-image:var(--omc-row-bg,linear-gradient(90deg,var(--omc-accent) 0%,var(--omc-accent) 40%,var(--omc-shimmer) 50%,var(--omc-accent) 60%,var(--omc-accent) 100%))}@keyframes omc-word{from{-webkit-text-fill-color:var(--omc-word-lo)}to{-webkit-text-fill-color:var(--omc-word-hi)}}[data-omc-turn-word]{animation:omc-word 1s ease-in-out 3s infinite alternate}@media (prefers-reduced-motion:reduce){[data-omc-turn-word]{animation:none}}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:start;flex:none}[data-dsh-oh-my-claude-turn]{max-width:100%;min-width:0}[data-omc-turn-detail]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button[data-turn-process]:has([data-omc-turn-line])>span:not([data-omc-turn-line]),[data-chat-running]:has([data-omc-turn-line])>span:not([data-omc-turn-line]):not([role]):not([aria-hidden]){display:none}[data-omc-turn-closing]{display:none}${gated("row", "[data-omc-turn-closing]", false)}{display:inline}${gated("row", "button[data-turn-process]:has([data-omc-turn-closing])>span:not([data-omc-turn-closing])", false)}{display:none}[data-omc-turn-line]{background-clip:text;-webkit-background-clip:text;color:transparent;-webkit-text-fill-color:transparent;background-size:200% 100%;animation:omc-verb-sheen 1.5s linear infinite;max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-flex;align-items:center;gap:2px}@keyframes omc-verb-sheen{from{background-position:200% 0}to{background-position:-200% 0}}[data-omc-turn-line][data-omc-mode="responding"],[data-omc-turn-line][data-omc-mode="thinking"]{animation-duration:6s;animation-direction:reverse}[data-omc-turn-line][data-omc-mode="tool-use"]{--omc-row-bg:linear-gradient(90deg,var(--omc-accent) 0%,var(--omc-shimmer) 50%,var(--omc-accent) 100%);background-size:20000% 100%;animation:omc-verb-pulse 1s ease-in-out infinite alternate}@keyframes omc-verb-pulse{from{background-position:0% 0}to{background-position:50% 0}}@media (prefers-reduced-motion:reduce){[data-omc-turn-line],[data-omc-turn-line][data-omc-mode]{animation:none}}button[data-turn-process]:has([data-omc-turn-line]){min-width:0;max-width:100%}${gated("panel", "[data-omc-login-card] button:hover", false)},${gated("panel", "[data-omc-update-card] button:not(:disabled):hover", false)}{color:var(--omc-accent)!important;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))!important}${gated("panel", "[data-omc-login-card] button:focus-visible", false)},${gated("panel", "[data-omc-update-card] button:focus-visible", false)}{color:var(--omc-accent)!important;border-color:var(--omc-accent)!important}${controlStatesCss("[data-omc-settings]")}${controlStatesCss('[role="dialog"][aria-label="Oh My Claude"]')}${/* !important: the buttons carry their border inline (`btn`), which beats any sheet rule. */ ""}${/* Hover is dsh's row look: the background tints and the text takes the accent; the border stays put. It used to go accent too, and in dark mode a faint hairline turning orange read as a border appearing under the pointer on every tab (owner, 2026-09-23). The accent border is the keyboard focus ring only. */ ""}${gated("panel", '[data-omc-settings] button:not([role="switch"]):not([aria-expanded]):not(:disabled):hover', false)},${gated("panel", '[role="dialog"][aria-label="Oh My Claude"] button:not([role="switch"]):not([aria-expanded]):not(:disabled):hover', false)}{color:var(--omc-accent)!important;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))!important}${gated("panel", '[data-omc-settings] button:not([role="switch"]):not([aria-expanded]):focus-visible', false)},${gated("panel", '[role="dialog"][aria-label="Oh My Claude"] button:not([role="switch"]):not([aria-expanded]):focus-visible', false)}{color:var(--omc-accent)!important;border-color:var(--omc-accent)!important}[data-omc-card]:hover{border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.5))}[data-omc-card]>button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:-2px}[data-omc-card]>button:hover{background:none}@keyframes omc-sheen{from{background-position:200% 0}to{background-position:-200% 0}}[data-omc-skeleton]{border-radius:6px;background:linear-gradient(90deg,${T.border} 30%,${T.hover} 50%,${T.border} 70%);background-size:200% 100%;animation:omc-sheen 1.4s linear infinite}@keyframes omc-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes omc-drain{from{width:100%}to{width:0}}[data-omc-arrived]{animation:omc-rise .18s ease-out}@media (prefers-reduced-motion:reduce){[data-omc-skeleton],[data-omc-arrived]{animation:none}}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]')}{color:var(--omc-accent)}${gated("prose", '[role="tablist"]>[role="tab"][aria-selected="true"]::after')}{background:var(--omc-accent)}${gated("prose", '[class*="_markdown"] blockquote')}{border-left-color:color-mix(in srgb,var(--omc-accent) 50.2%,transparent)}${gated("prose", '[class*="_markdown"] hr')}{background:color-mix(in srgb,var(--omc-accent) 34.9%,transparent)}${gated("prose", '[class*="_markdown"] a')}{color:var(--omc-accent);text-decoration-color:color-mix(in srgb,var(--omc-accent) 40%,transparent)}${gated("prose", '[class*="_markdown"] a:hover')}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${/* A file path in Claude's answer is dsh's file-mention button (opens the file in the sidebar), drawn in the same link blue as a link and with no hook of its own, so its module class is matched by suffix like the rules above. */ ""}${gated("prose", 'button[class*="_fileMention"]')}{color:var(--omc-accent)}${gated("prose", 'button[class*="_fileMention"]:hover')},${gated("prose", 'button[class*="_fileMention"]:focus')}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${gated("prose", 'button[class*="_fileMention"]:focus-visible')}{box-shadow:0 0 0 2px var(--omc-accent)}${gated("prose", '[class*="_markdown"] input[type="checkbox"]')}{accent-color:var(--omc-accent)}${/* The chips dsh draws in a sent bubble for a skill it knows (`/ic-logos`) and for a file mention: its business blue and its link blue. Selected by dsh's own `data-ref-chip` hook, which names the kind, not by the hashed class. */ ""}${gated("prose", "[data-ref-chip]")}{color:var(--omc-accent)}${gated("prose", "[data-ref-chip]:hover")},${gated("prose", "[data-ref-chip]:focus")}{color:var(--omc-shimmer);text-decoration-color:var(--omc-shimmer)}${gated("prose", "[data-ref-chip]:focus-visible")}{box-shadow:0 0 0 2px var(--omc-accent)}${/* A slash command typed in the composer: dsh's editor colours that text run with an inline `color: var(--dsw-alias-state-business-primary)`, its blue, and no hook of its own, so the inline token is the match. Inline, hence !important. Its other form, a command node the editor draws itself, carries dsh's `_reference _textRef` classes instead; the module suffix is matched. On dsh 0.2.1-rc.2 the command is a decorator chip under dsh's own `data-composer-command` hook, coloured on its `_chip` span (`.yAWgPa_chip{color:var(--dsw-alias-state-business-primary)}`), so that span is matched through the hook (owner saw blue commands, 2026-10-21). */ ""}${gated("composer", '[data-composer-input] [data-lexical-text][style*="business-primary"]')},${gated("composer", '[data-composer-input] [class*="_textRef"]')},${gated("composer", '[data-composer-input] [data-composer-command] [class*="_chip"]')}{color:var(--omc-accent)!important}${/* The composer's own chips (`@` file mention, session reference) draw the same blue from a hashed class and tint it on hover; dsh's `data-composer-chip` hook holds the chip as its only child. */ ""}${gated("composer", "[data-composer-input] [data-composer-chip]>span")}{color:var(--omc-accent)}${gated("composer", "[data-composer-input] [data-composer-chip]>span:hover")}{background:color-mix(in srgb,var(--omc-accent) 14%,transparent)}${/* The composer's text cursor: dsh sets `caret-color` to its business blue on the editor itself. */ ""}${gated("composer", "[data-composer-input]")}{caret-color:var(--omc-accent)}${gated("prose", "[data-workflow-run] button[data-member-status] [data-member-label]")}{color:var(--omc-accent)}${/* The icon tile on dsh's changed-files card is dsh's link blue; `data-changed-files` is dsh's own hook, and the class is matched by its module suffix since the prefix is generated per build. */ ""}${gated("prose", '[data-changed-files] [class*="_tile"]')}{background:var(--omc-accent)}body[data-omc-panel-open] [data-width-handle]{pointer-events:none}body[data-omc-panel-open] [class*="_toBottomSlot"],body:has([data-omc-cost-dialog]) [class*="_toBottomSlot"]{opacity:0;pointer-events:none;transition:opacity .1s}${/* dsh's Back-to-bottom button sits `--dsh-composer-height` above the page bottom, and that height is the composer stack's, our strip included; while the strip is mounted its height (published on body by the strip) comes back off, so the button stays where it was. dsh's module suffix, as the rule above. */ ""}body:has([data-omc-dock-status]) [class*="_toBottomSlot"]{bottom:calc(var(--dsh-composer-height,152px) + 16px - var(--omc-dock-height,0px) - var(--dsh-composer-stack-gap,6px))}${/* Held there, the button lands on the strip's row at its right end, so the strip's column leaves the button's footprint free while the button is drawn and the line's ellipsis takes the cut instead of a collision (owner, 2026-09-23). */ ""}body:has([class*="_toBottomSlot"] button) [data-omc-dock-status]>div{padding-right:44px}@keyframes omc-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--omc-accent) 55%,transparent)}100%{box-shadow:0 0 0 12px transparent}}${gated("panel", 'button[aria-label="Oh My Claude"][data-omc-pulse]', false)}{animation:omc-pulse 1.1s ease-out 3}@media (prefers-reduced-motion:reduce){button[aria-label="Oh My Claude"][data-omc-pulse]{animation:none}}${gated("prose", "[data-presented-files-row] button")}{color:var(--omc-accent)}${gated("prose", "[data-presented-files-row] button:hover")}{color:var(--omc-shimmer)}body[data-omc-claude] [data-composer-stats]{padding-left:8px;padding-right:8px}${gated("prose", '[class*="_optionLine"]>[class*="_badge"]')}{background:color-mix(in srgb,var(--omc-accent) 16%,transparent);color:var(--omc-accent)}[data-omc-cost-over]{color:var(--omc-accent)}${gated("row", 'svg[data-state="ongoing"]:not([role="treeitem"] *)')},${gated("row", '[role="treeitem"][data-omc-claude] svg[data-state="ongoing"]', false)}{--dsh-state-ongoing:var(--omc-accent);color:var(--omc-accent)}${/* Claude's model names in the composer's picker (trigger, the menu's current value, each option row). Since dsh 0.2.1-alpha.5 every name sits in a span carrying `data-provider-id`, dsh's documented hook for styling the label without taking its single-occupant slot, which dsh's own badge plugin holds from 0.2.1-rc.1. Its own group, so it can be turned off alone, and ungated by session, because the picker lists Claude rows in every session. */ ""}${gated("models", '[data-provider-id^="claude-code"]', false)}{color:var(--omc-accent)}${/* The suggestion card at phone width: two rows, the label and the buttons on the first and the guess on its own line under them (owner, 2026-10-21). On the card's own width, not the viewport's, so a narrow desktop column gets the same. */ ""}[data-omc-suggestion-card]{container-type:inline-size}@container (max-width:480px){[data-omc-suggestion-card] [data-omc-suggestion-text]{order:9;flex:1 1 100%}[data-omc-suggestion-card] [data-omc-suggestion-use],[data-omc-suggestion-card] [data-omc-suggestion-send]{padding:4px 8px!important}}${RAINBOW_CSS}${COST_DIALOG_CSS}`;
  document.head.appendChild(styleEl);
};

/** One verb per running turn: the row remounts on every tool step and dsh rewrites its text, so a
 *  fresh pick each time reads as flicker. Keyed by session; forgotten after a short absence. */
const turnVerbs = new Map<string, { verb: string; seen: number }>();
const VERB_MEMORY_MS = 4000;
/** A token count the way the CLI's status line writes one: `1.2k` past a thousand, plain below. */
const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Picks a verb for a running turn, reusing the session's previous one within a short window. */
const verbFor = (sessionId: string, verbs: string[]): string => {
  const now = Date.now();
  // Every session that ever ran a turn in this tab left an entry behind. They are small, but the
  // map is only ever read for a turn that is running right now, so the stale ones are pure growth.
  for (const [id, seen] of turnVerbs) if (now - seen.seen >= VERB_MEMORY_MS) turnVerbs.delete(id);
  const kept = turnVerbs.get(sessionId);
  const verb = kept && now - kept.seen < VERB_MEMORY_MS ? kept.verb : pickVerb(verbs, Math.random);
  turnVerbs.set(sessionId, { verb, seen: now });
  return verb;
};

/** On dsh's status element once this bundle has wired it; read before the wiring path allocates. */
const TURN_MARK = "data-dsh-oh-my-claude-turn";
/** The bracket this bundle appends to a status row. Marked so a later bundle can clear the one its
 *  predecessor left: a hot reload re-runs the wiring over a row already on screen, and without this
 *  every rebuild added another bracket to it. */
const DETAIL_MARK = "data-omc-turn-detail";
/** How long thinking runs before the row says so differently. The CLI switches to "still thinking"
 *  and warms the colour once it has been at it a while; neither the wording nor the colour is ever
 *  put on the wire, so the rule is kept here. */
/** The CLI's own wording ladder for a thinking burst (2.1.280, `Oo()` in its spinner), by how long
 *  the burst has run; it warms the colour from the first step. Same marks here so the row reads
 *  the way a terminal user already knows it. */
/** Returns the CLI wording for a thinking burst of the given length, defaulting to "thinking". The
 *  thresholds mirror the CLI's `gr()` ladder (2.1.268); the words are read from the dictionary at
 *  call time so a language switch reaches them, not baked into a module-load constant. */
const thinkingWord = (ms: number): string =>
  ms >= 45_000
    ? t("main.turn.thinkingDeep")
    : ms >= 30_000
      ? t("main.turn.thinkingSomeMore")
      : ms >= 20_000
        ? t("main.turn.thinkingMore")
        : ms >= 10_000
          ? t("main.turn.thinkingStill")
          : t("main.turn.thinking");

type Rgb = readonly [number, number, number];
/** The CLI's spinner colours (2.1.280 themes, `B` dark and `v` light). `claude` is the same in both;
 *  the warning shade differs, so the row picks by the page's background. The shimmer is not here:
 *  it is the `--omc-shimmer` pair from theme.ts, since the sweep is drawn by the sheet. The stall
 *  red is a constant in the spinner code, not a theme entry. The grey pair is the bracket word's
 *  idle pulse. */
const SPINNER_DARK = {
  claude: [215, 119, 87],
  warning: [255, 193, 7],
} as const;
const SPINNER_LIGHT = {
  claude: [215, 119, 87],
  warning: [150, 108, 30],
} as const;
const STALL_RED: Rgb = [171, 43, 63];
const WORD_GREY_LO: Rgb = [153, 153, 153];
const WORD_GREY_HI: Rgb = [185, 185, 185];
/** `n` held inside 0 to 1. */
const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);
/** Blends two RGB colours by f (0 is a, 1 is b) and rounds each channel. */
const mixRgb = (a: Rgb, b: Rgb, f: number): Rgb => [
  Math.round(a[0] + (b[0] - a[0]) * f),
  Math.round(a[1] + (b[1] - a[1]) * f),
  Math.round(a[2] + (b[2] - a[2]) * f),
];
/** Serialises an RGB triple as an `rgb(r, g, b)` string. */
const cssRgb = (c: Rgb): string => `rgb(${c[0]},${c[1]},${c[2]})`;
/** The CLI's ramps: nothing for the first 10s, then linear to full over the next 10s. */
const rampAfter10s = (ms: number): number => clamp01((ms - 10_000) / 10_000);
/** One 50ms step of the CLI's count easing, in characters (tokens × 4): small gaps close by 3,
 *  middling ones by 15%, large ones by 50, and a gap past 2000 snaps. */
const easeChars = (shown: number, target: number): number => {
  const gap = target - shown;
  if (gap === 0) return shown;
  const abs = Math.abs(gap);
  if (abs > 2000) return target;
  const step = abs < 70 ? 3 : abs < 200 ? Math.max(8, Math.ceil(abs * 0.15)) : 50;
  return gap > 0 ? Math.min(shown + step, target) : Math.max(shown - step, target);
};
/** No-op frame callback, used where a beat changes nothing and so writes nothing. */
const noBeat = (): void => undefined;
/** What a turn's status could be drawn in: the status row itself up to dsh 0.1.6, and from 0.2 the
 *  running row dsh draws under the turn's content. 0.1.7's process-group button is left out, since
 *  0.2 draws that button only once the turn closes. */
const TURN_ROW_SELECTOR = '[role="status"][aria-live="polite"], [data-chat-running]';

/**
 * The element that shows this turn's status to the eye, or undefined when the candidate shows
 * nothing.
 *
 * Up to dsh 0.1.6 that was the `role="status"` row itself. dsh 0.1.7 moved the sentence into the
 * button heading the turn's process group ("Deep diving for 12s") and left the status row for
 * screen readers, clipped to a single pixel: the plugin kept painting the row, so its verb, spinner
 * and figures went out to assistive tech and nobody could see them (owner, 2026-09-22).
 *
 * dsh 0.2 draws the group's button only once the turn closes; the live sentence ("Deep diving for
 * 12s", with a whale icon) sits in a `data-chat-running` row under the turn, and the line goes there.
 *
 * A finished group is left alone. dsh drops `data-open` from the button once the turn ends and its
 * label becomes "Took 12s", which is a record of the turn, not a status, and not the plugin's to
 * overwrite.
 */
const turnStatusRow = (found: HTMLElement): HTMLElement | undefined => {
  if (found.matches("button[data-turn-process], [data-chat-running]")) {
    // Folded or not: `data-open` is the chevron, and a live group folds on its own. Whether the
    // turn runs is the caller's question (list store plus newest group), asked before this.
    // A group whose turn ended is marked done at teardown, and the scanner runs on every frame:
    // without the mark every teardown was followed by a fresh line with a fresh verb, which is
    // what read as "the verb keeps going" (owner, 2026-09-22, twice).
    if (found.hasAttribute("data-omc-turn-done")) return undefined;
    // dsh's visible sentence: on 0.2's running row that is the icon and text beside a screen-reader
    // announcer (`role`) and a divider (`aria-hidden`), both of which stay.
    const label = found.querySelector<HTMLElement>(
      ":scope > span:not([data-omc-turn-line]):not([role]):not([aria-hidden])",
    );
    if (label === null) return undefined;
    const already = found.querySelector<HTMLElement>(":scope > [data-omc-turn-line]");
    if (already !== null) return already;
    const line = document.createElement("span");
    line.setAttribute("data-omc-turn-line", "1");
    // dsh's sentence is a sibling, not an ancestor, so none of its own type styles are inherited
    // here: the line would take the button's instead and read at a different size from the one it
    // replaces. Copied from the node on screen rather than assumed, the way the bracket takes the
    // clock's face.
    const face = getComputedStyle(label.querySelector("[data-shimmer]") ?? label);
    line.style.fontSize = face.fontSize;
    line.style.fontWeight = face.fontWeight;
    line.style.fontFamily = face.fontFamily;
    line.style.lineHeight = face.lineHeight;
    line.style.letterSpacing = face.letterSpacing;
    // A text node the verb is written into: `wireTurnStatus` takes the first one with text in it,
    // so the seed cannot be blank. It is replaced before the next frame.
    line.append(document.createTextNode("…"));
    found.append(line);
    return line;
  }
  if (found.getAttribute("role") !== "status" || found.getAttribute("aria-live") !== "polite")
    return undefined;
  // Clipped to a pixel for screen readers on 0.1.7; a row with a real box is 0.1.6 or earlier and
  // is the one to paint. The class name answers first, since it costs nothing; the measurement,
  // which forces layout, is only for a row the class does not settle.
  if (found.className.includes("visuallyHidden")) return undefined;
  return found.getBoundingClientRect().height > 2 ? found : undefined;
};

/** Give a 0.1.7 process group its own sentence back: removing the plugin's line is enough, because
 *  the rule that hides dsh's own only applies while that line is in the button. Called when the
 *  turn ends and when the bundle is disposed, and safe to call twice. `ended` marks the group so
 *  no later scan wires it again; a bundle being replaced passes false, since its turn is still
 *  running and the next bundle has to find a group that wants wiring. Marking it there took the
 *  header line down for the rest of every turn a rebuild landed in (owner, 2026-09-23). */
export const stopTurnLine = (el: HTMLElement, ended = true): void => {
  if (!el.hasAttribute("data-omc-turn-line")) return;
  // Mark the group before removing the line, so the scan the removal itself triggers finds a
  // group that is done rather than one that wants wiring.
  if (ended) el.closest("button[data-turn-process]")?.setAttribute("data-omc-turn-done", "1");
  el.remove();
};

/** Wire one turn-status element for a claude-code session: verb, ping-pong spinner and orange
 *  gradient. */
const wireTurnStatus = (
  el: HTMLElement,
  sessionId: string,
  verbs: string[],
  frames: readonly string[],
  /** dsh's own word on whether the session is running, read fresh on every beat. */
  isRunning: () => boolean = () => true,
) => {
  ensureTurnStatusStyle();
  if (el.hasAttribute(TURN_MARK)) return;
  el.setAttribute(TURN_MARK, "1");

  // Build the leading spinner span.
  const spinner = document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  el.prepend(spinner);

  // Find the original text node (first child before the clock span).
  const textNode = Array.from(el.childNodes).find(
    (n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim().length,
  );

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The figure and colour beat, assigned once the row's state exists below. */
  let onTick: () => void = noBeat;
  /** When the spinner started, for the CLI's eased ping-pong. */
  const spinStart = Date.now();

  const tick = () => {
    const kept = turnVerbs.get(sessionId);
    if (kept) kept.seen = Date.now(); // still running: keep this verb for the next remount
    if (reduced) {
      spinner.textContent = "✻";
      return;
    }
    // SAFETY: spinnerFrameAt answers an index in [0, frames.length).
    spinner.textContent = frames[spinnerFrameAt(Date.now() - spinStart, frames.length)]!;
  };
  const stop = () => {
    clearInterval(interval);
    clearInterval(pollTimer);
    offLive();
    obs.disconnect();
  };
  const interval = setInterval(
    () => {
      // The beat doubles as the teardown check: React unmounts this row by removing an
      // ancestor, so watching for `el` itself in a removal record missed it and left one
      // whole-document observer plus one interval alive per row dsh ever drew.
      if (!el.isConnected) {
        stop();
        return;
      }
      // The turn's end is `endedPerDsh` below, on the poll. It used to be read here from the
      // group's `data-open`, which is dsh's fold state (the chevron), not whether the turn runs:
      // dsh folds a live group on its own, the line came down mid-turn, the group was marked done
      // and dsh's "Deep diving 12s" stayed up for the rest of it (owner, 2026-09-23).
      // Nothing to paint for a tab nobody is looking at; the teardown checks above still run.
      if (document.hidden) return;
      tick();
      onTick();
    },
    // A reduced-motion spinner is one glyph that never changes, so its beat is the teardown check
    // and nothing else; 1s notices an unmounted row soon enough at an eighth of the wakeups.
    reduced ? 1000 : 120,
  );
  // The row can outlive the bundle that wired it, since a rebuild disposes the context while the
  // turn is still running. A connected row never trips the check above, so each reload left
  // one more beat animating the same spinner. The wired mark and the spinner go back with it: both
  // live on dsh's element, which outlives this bundle, and a row still wearing the mark is one the
  // next bundle refuses to wire.
  // Tear down this row: stop the spinner beat and poll, remove the wired mark and spinner, so a
  // row that outlives its bundle leaves nothing animating.
  whenContextGone(() => {
    stop();
    el.removeAttribute(TURN_MARK);
    spinner.remove();
    // The turn is still running; the next bundle's first scan wires a fresh line onto this group.
    stopTurnLine(el, false);
  });
  tick();

  // Pick a fresh verb once per element instance.
  const verb = verbFor(sessionId, verbs);
  // The row reads `Marinating… · ↓ 1.2k · thinking` once the turn has figures, the way the CLI's own
  // status line does; dsh's clock beside it is left alone. The figures come from the plugin's
  // live-turn route, polled once a second while this row is up: the browser never sees the CLI
  // stream, so the adapter keeps the running count and this asks for it.
  const verbLabel = `${verb}…`;
  if (textNode) textNode.nodeValue = verbLabel;
  // Everything after the verb sits in one quiet bracket, the way the CLI's status line writes it.
  for (const stale of Array.from(el.querySelectorAll(`[${DETAIL_MARK}]`))) stale.remove();
  const detailSpan = document.createElement("span");
  detailSpan.setAttribute(DETAIL_MARK, "1");
  // Important, because the row's own rule paints the whole status line in the brand colour and a
  // plain inline colour loses to it: the bracket came out orange with the verb.
  // Out of the row's painted gradient, then into a plain grey. The row is coloured by clipping a
  // background to its text, so the glyphs take that gradient and ignore any `color` set on them:
  // setting the colour alone, even important, left the bracket orange alongside the verb.
  detailSpan.style.setProperty("background-image", "none", "important");
  detailSpan.style.setProperty("background-clip", "border-box", "important");
  detailSpan.style.setProperty("-webkit-background-clip", "border-box", "important");
  detailSpan.style.setProperty("color", T.faint, "important");
  // The one that actually decides it: with the background clipped to the text, the glyphs are filled
  // from that background and `color` is ignored, so the fill colour is what has to be set.
  detailSpan.style.setProperty("-webkit-text-fill-color", T.faint, "important");
  // The clock's face from the first paint: dsh adds its clock node a moment after the row, and
  // the copy below only lands once it exists, so the bracket opened at the row's 16px medium and
  // shrank a beat later (owner, 2026-09-13). The clock measures 14px regular against the row's
  // 16px, hence the ratio; the copy still takes over the moment the node is there.
  detailSpan.style.fontSize = "0.875em";
  detailSpan.style.fontWeight = "400";
  el.append(detailSpan);
  /** dsh's own elapsed-time node. Found, not hidden: the time belongs inside the bracket, but hiding
   *  it as a side effect of looking meant one failed read left the row showing no time at all. */
  const clockNode = (): HTMLElement | undefined => {
    for (const child of Array.from(el.children)) {
      if (child === spinner || child === detailSpan) continue;
      const text = (child.textContent ?? "").trim();
      if (/^\d+\s*[hms]/.test(text) && child instanceof HTMLElement) return child;
    }
    return undefined;
  };
  // The figures the route last reported, and when, so the beat can carry them forward between
  // polls: the burst and stall ages grow with the clock, the count eases toward its target.
  let polledAt = 0;
  let targetChars = 0;
  let thinkingMs = -1;
  let idleMs = -1;
  let tool = false;
  /** The CLI's mode, which picks the sweep's direction and speed; `requesting` until a body says
   *  otherwise, which is the CLI's own state at a turn's start. */
  let mode: LiveMode = "requesting";
  let thoughtMs = -1;
  let thoughtAgoMs = -1;
  let effort = "";
  let relayName = "";
  let relayMs = -1;
  /** How long the turn has run, per the last poll. Only read where dsh draws no clock of its own
   *  (0.1.7 and later); -1 until the first answer. */
  let elapsedMs = -1;
  // What is on screen: the eased count in characters (the CLI eases its response length, and
  // shows it over four) and the two colour ramps, each chased 10% per 50ms like the CLI does.
  let shownChars = 0;
  let thinkIntensity = 0;
  let stallIntensity = 0;
  let lastBeat = Date.now();
  const palette = pageIsDark() ? SPINNER_DARK : SPINNER_LIGHT;
  // The sheet's sweep reads `--omc-shimmer`, the CLI's light value; on a dark page the line takes
  // the CLI's dark one. Set on the line so prose links keep theirs. Chosen once per row like the
  // palette: a theme flipped mid-turn shows on the next row.
  if (palette === SPINNER_DARK) el.style.setProperty("--omc-shimmer", "var(--omc-shimmer-dark)");
  // Read once per wired row: `accentRgb` is a getComputedStyle on the root, which forces a style
  // recalc, and the beat below paints eight times a second. The accent only moves when the Claude
  // look switch flips, and the next turn's row reads the new one.
  const claude = accentRgb(palette.claude);
  /** What the bracket last showed, so a beat that changes nothing writes nothing. */
  let painted = "";
  /** Whether the bracket has taken the clock's measured face yet (the guess above until then). */
  let clockFaceCopied = false;
  const wordNode = document.createElement("span");
  wordNode.setAttribute("data-omc-turn-word", "1");
  const paint = () => {
    const now = Date.now();
    const since = polledAt > 0 ? now - polledAt : 0;
    const burst = thinkingMs >= 0 ? thinkingMs + since : -1;
    const idle = idleMs >= 0 ? idleMs + since : -1;
    // The CLI holds both ramps at zero while a tool runs, and the stall ramp while thinking: a
    // running tool is silence by design, and thinking has its own ramp.
    const thinkTarget = burst >= 0 && !tool ? rampAfter10s(burst) : 0;
    const stallTarget = burst < 0 && !tool && idle >= 0 ? rampAfter10s(idle) : 0;
    if (reduced) {
      thinkIntensity = thinkTarget;
      stallIntensity = stallTarget;
      shownChars = targetChars;
    } else {
      const steps = Math.floor((now - lastBeat) / 50);
      if (steps > 0) {
        for (let i = 0; i < steps; i++) {
          // The CLI chases a tint up 10 % a tick and drops it to zero the moment its state ends
          // (`et.current=0` when the mode leaves thinking or a tool starts, `M.current=0` on the
          // next token): a fade-out would show a colour for a state that is over.
          thinkIntensity =
            thinkTarget === 0 ? 0 : thinkIntensity + (thinkTarget - thinkIntensity) * 0.1;
          stallIntensity =
            stallTarget === 0 ? 0 : stallIntensity + (stallTarget - stallIntensity) * 0.1;
          shownChars = easeChars(shownChars, targetChars);
        }
        lastBeat += steps * 50;
      }
    }
    // Snap to the target once within a hair of it, so the memo key settles.
    if (Math.abs(thinkTarget - thinkIntensity) < 0.01) thinkIntensity = thinkTarget;
    if (Math.abs(stallTarget - stallIntensity) < 0.01) stallIntensity = stallTarget;
    const ti = thinkIntensity;
    const si = stallIntensity;
    const parts: string[] = [];
    const clock = clockNode();
    // The bracket wears dsh's own clock face, read off its node rather than assumed: the row's
    // verb is 16px medium and the clock dsh set beside it 14px regular (measured 2026-09-12),
    // and a bracket at the verb's size read heavier than the verb it follows.
    if (clock && !clockFaceCopied) {
      clockFaceCopied = true;
      const face = getComputedStyle(clock);
      detailSpan.style.fontSize = face.fontSize;
      detailSpan.style.fontWeight = face.fontWeight;
    }
    // dsh 0.1.6 and earlier draw a clock node beside the row and this reads it. 0.1.7 writes the
    // elapsed time into the same sentence as its own verb ("Deep diving for 12s"), which the verb
    // above replaces, so there is no node to read and the figure comes from the turn record.
    const polled = elapsedMs >= 0 ? elapsedMs + since : -1;
    const time = (clock?.textContent ?? "").trim() || (polled >= 0 ? fmtDuration(polled) : "");
    // The CLI draws no bracket until the turn has tokens, a thinking word, a tool wait or 16 s on
    // the clock, so a short answer never grows one. `polled` is the body's elapsed time aged by the
    // beat, which every body carries on every dsh; on 0.1.6 dsh's own clock node stays beside the
    // verb until the gate opens.
    const open = bracketOpen({
      elapsedMs: polled,
      tokens: Math.round(shownChars / 4),
      thinking: burst >= 0 || thoughtAgoMs >= 0,
      relay: relayName !== "" && relayMs >= 0,
    });
    if (time && open) parts.push(time);
    // dsh's copy goes quiet only while ours is showing the same figure. Hiding it unconditionally is
    // what left the row reading just the verb when the read came back empty.
    if (clock) clock.style.display = time && open ? "none" : "";
    const shownTokens = Math.round(shownChars / 4);
    if (shownTokens > 0) parts.push(t("main.turn.tokens", { n: shortCount(shownTokens) }));
    // The CLI's gated `running tool for Ns`, with the dsh tool's name in place of "tool": the step
    // is closed while dsh runs it, so this is the one figure that moves during the wait.
    if (relayName && relayMs >= 0)
      parts.push(
        t("main.turn.runningFor", { name: relayName, n: Math.round((relayMs + since) / 1000) }),
      );
    // The CLI names the effort after the word when one was asked for, and once a burst closes
    // it says "thought for Ns" for two seconds, never sooner than two seconds after the burst
    // began.
    let word = "";
    if (burst >= 0)
      word = `${thinkingWord(burst)}${effort ? t("main.turn.withEffort", { effort }) : ""}`;
    else if (thoughtAgoMs >= 0) {
      const closedFor = thoughtAgoMs + since;
      const showAt = Math.max(0, 2000 - thoughtMs);
      if (closedFor >= showAt && closedFor < showAt + 2000)
        word = t("main.turn.thoughtFor", { n: Math.max(1, Math.round(thoughtMs / 1000)) });
    }
    const thinking = burst >= 0;
    // The CLI's colours. Verb and spinner: Claude orange, toward the warning shade by the thinking
    // ramp, toward its stall red by the stall ramp; the spinner goes bold past half. The word:
    // a slow grey pulse, itself pulled toward the warning shade by the thinking ramp. Time, count
    // and the brackets stay dim. Once either ramp is above zero the verb is one flat colour, no
    // shimmer: the CLI's glimmer only draws when neither ramp is up.
    // Both tints snap to zero when their state ends and the stall wins when both would draw, as
    // in the CLI.
    const tint =
      si > 0
        ? mixRgb(claude, STALL_RED, si)
        : ti > 0
          ? mixRgb(claude, palette.warning, ti)
          : undefined;
    const lo = cssRgb(mixRgb(WORD_GREY_LO, palette.warning, ti));
    const hi = cssRgb(mixRgb(WORD_GREY_HI, palette.warning, ti));
    const key = `${parts.join("\0")}\0${word}\0${cssRgb(claude)}\0${tint ? cssRgb(tint) : ""}\0${lo}\0${hi}\0${ti >= 0.5}\0${mode}`;
    if (key === painted) return;
    painted = key;
    // The sheet reads the mode off the line: direction and speed of the sweep, or the tool-use pulse.
    if (el.getAttribute("data-omc-mode") !== mode) el.setAttribute("data-omc-mode", mode);
    if (tint)
      el.style.setProperty(
        "--omc-row-bg",
        `linear-gradient(90deg,${cssRgb(tint)},${cssRgb(tint)})`,
      );
    else el.style.removeProperty("--omc-row-bg");
    spinner.style.fontWeight = ti >= 0.5 ? "bold" : "";
    if (word) {
      detailSpan.textContent = "";
      detailSpan.append(`\u00A0(${parts.join(" · ")}${parts.length > 0 ? " · " : ""}`);
      wordNode.textContent = word;
      if (thinking) {
        // The grey pulse, pulled toward the warning shade by the ramp.
        wordNode.setAttribute("data-omc-turn-word", "1");
        wordNode.style.setProperty("--omc-word-lo", lo);
        wordNode.style.setProperty("--omc-word-hi", hi);
        wordNode.style.setProperty("-webkit-text-fill-color", lo, "important");
      } else {
        // "thought for Ns": the warning shade while the ramp is still fading, dim after.
        wordNode.removeAttribute("data-omc-turn-word");
        const c = ti > 0 ? cssRgb(palette.warning) : T.faint;
        wordNode.style.setProperty("-webkit-text-fill-color", c, "important");
      }
      detailSpan.append(wordNode, ")");
      return;
    }
    // A non-breaking space, written as its escape so a rewrite cannot quietly turn it into an
    // ordinary one: at the edge of the element an ordinary space collapses away, which ran the
    // bracket straight into the verb.
    detailSpan.textContent = parts.length > 0 ? `\u00A0(${parts.join(" · ")})` : "";
  };
  /**
   * The two end signals dsh owns, read once a second here rather than on the 120 ms beat: the
   * session summary's `running`, which drops the moment a turn ends however it ended and in any
   * language, and whether this group is still the newest in the conversation, since Send now
   * cuts a turn and starts the next under the same session, where `running` alone would keep the
   * old line up. The newest-group read walks the document, which is why it is not on the beat.
   * Nothing else decides the end: the plugin's own turn record clears and remakes at tool
   * boundaries (it took the line down at 7 s of a 29 s turn), and a "sentence stopped ticking"
   * backstop would cut the line under a turn parked on an approval prompt (review, 2026-09-22).
   */
  const endedPerDsh = (): boolean => {
    const group = el.closest("button[data-turn-process]");
    if (group === null) return false;
    if (!isRunning()) return true;
    const groups = document.querySelectorAll("button[data-turn-process]");
    return groups[groups.length - 1] !== group;
  };
  /** Take one body, from the stream or from the fallback read, into the row's figures. True when
   *  it carried a running turn; false for the empty body. The ages come from the adapter, which
   *  saw the block open and the last frame land; a tab that opens mid-think would otherwise start
   *  its own clocks late. An empty body is not an ending: the adapter registers the turn on its
   *  first frame and clears and remakes the record at tool boundaries, so the figures simply
   *  pause. The end of the turn is read off dsh in `endedPerDsh`; dsh keeps `data-open` on a
   *  failed group, which is why the button's own state cannot be the only signal (a turn that
   *  failed left the line saying "Incubating…" under dsh's "Failed", owner, 2026-09-22). */
  const applyBody = (b: LiveTurnBody): boolean => {
    if (b.elapsedMs === undefined) return false; // the empty body: keep the figures as they are
    targetChars = (b.tokens ?? 0) * 4;
    thinkingMs = b.thinkingMs ?? -1;
    idleMs = b.idleMs ?? -1;
    tool = b.tool === true;
    if (b.mode !== undefined) mode = b.mode;
    thoughtMs = b.thoughtMs ?? -1;
    thoughtAgoMs = b.thoughtAgoMs ?? -1;
    effort = b.effort ?? "";
    relayName = b.relayName ?? "";
    relayMs = b.relayMs ?? -1;
    elapsedMs = b.elapsedMs ?? -1;
    polledAt = Date.now();
    return b.elapsedMs !== undefined;
  };
  let lastRead = 0;
  const poll = async () => {
    if (!el.isConnected) return;
    if (endedPerDsh()) {
      stop();
      stopTurnLine(el);
      return;
    }
    // A hidden tab paints nothing, so its read would be a round trip for no one; the next beat
    // after it is shown again catches up.
    if (document.hidden) return;
    // The figures arrive on the event stream; this read is the fallback and runs every 30 s while
    // the stream is up, once a second when it is not.
    if (Date.now() - lastRead < pollEvery(true, 1000, 1000)) return;
    lastRead = Date.now();
    try {
      const r = await fetch(`${ROUTE}/live-turn?session=${encodeURIComponent(sessionId)}`);
      const b = await readJson<LiveTurnBody>(r);
      if (!applyBody(b)) return;
    } catch {
      // the row keeps its verb; the bracket is decoration
    }
    paint();
  };
  const offLive = subscribe("live-turn", (session, data) => {
    if (session !== sessionId || !el.isConnected) return;
    if (applyBody(data)) paint();
  });
  const pollTimer = setInterval(() => void poll(), 1000);
  onTick = paint;
  void poll();
  paint();

  // Re-apply when dsh resets the verb's text node. Observed on that node alone: watching the whole
  // row with subtree fired the callback on every clock tick and on every write of ours, and the
  // handler only ever looked at this one node anyway.
  const obs = new MutationObserver(() => {
    if (textNode && textNode.nodeValue !== verbLabel) textNode.nodeValue = verbLabel;
  });
  if (textNode) obs.observe(textNode, { characterData: true });
};

/**
 * While the strip is on the page, its height rides on `<body>` as `--omc-dock-height`, so the
 * sheet can hold dsh's Back-to-bottom button where it sat before the strip: dsh anchors that
 * button `--dsh-composer-height` above the page bottom and measures that height off the composer
 * stack, strip included, so the button rose by the strip's height every time the strip appeared
 * (owner, 2026-09-23). A callback ref: set on mount, cleared on unmount, resized with the strip.
 */
const publishDockHeight = (el: HTMLDivElement | null): void => {
  if (dockHeightWatch) {
    dockHeightWatch.disconnect();
    dockHeightWatch = undefined;
  }
  if (el === null) {
    document.body.style.removeProperty("--omc-dock-height");
    return;
  }
  const write = () => document.body.style.setProperty("--omc-dock-height", `${el.offsetHeight}px`);
  write();
  dockHeightWatch = new ResizeObserver(write);
  dockHeightWatch.observe(el);
};
/** The observer behind `publishDockHeight`; one strip at a time. */
let dockHeightWatch: ResizeObserver | undefined;

/** The nearest ancestor that scrolls vertically, which clips `el` on top of the viewport; null when
 *  none does and the viewport is the only clip. */
const scrollerOf = (el: HTMLElement): HTMLElement | null => {
  for (let up = el.parentElement; up !== null; up = up.parentElement)
    if (/auto|scroll/.test(getComputedStyle(up).overflowY)) return up;
  return null;
};

/** Whether any of `el` shows inside both the viewport and its scroller. A zero-height box (folded,
 *  `display: none`) counts as off screen, as it did for the IntersectionObserver this replaced. */
const onScreen = (el: HTMLElement, box: HTMLElement | null): boolean => {
  const r = el.getBoundingClientRect();
  if (r.height === 0 || r.bottom <= 0 || r.top >= window.innerHeight) return false;
  if (box === null) return true;
  const c = box.getBoundingClientRect();
  return r.bottom > c.top && r.top < c.bottom;
};

/** How long a starting turn waits for dsh to draw its header before the dock line takes its place. */
const DOCK_HEADER_GRACE_MS = 1000;

/**
 * The turn's working line a second time, above the composer, in dsh's `conversation.input.dock`.
 * dsh 0.1.7 keeps the line in the turn's header, which a long run of tool cards scrolls away, and
 * on a long turn the header is not drawn at all: dsh builds it from the turn's start event, which
 * sits above the "Load earlier" fold until that is clicked (the tail slot has the same blind spot,
 * so the dock it is; measured 2026-09-23 on a nine-turn session: no header, no status row, no tail
 * node in a fresh tab). dsh also took down the status bar older builds kept at the bottom. This is
 * the same line, wired by `wireTurnStatus` the way the header's is (spinner, verb, figures), so the
 * verb is the one the header picked (kept per session) and the bracket comes from the same route.
 * Shown while the header's line is off screen or not drawn, and hidden while the header line is on
 * screen so the two never show at once, under the Claude look's row switch. On dsh 0.2 the
 * "header" is the running row under the turn, drawn from the start, so the dock shows once that
 * row is scrolled away. On by default; the `dockStatusOff` hint turns it off for someone who wants
 * only the line in the conversation.
 * ponytail: with the header on the page too, both lines poll the live-turn route once a second; the
 * server-push pass replaces both polls with one subscription.
 */
export function DockStatus({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const [off] = useHintFlag("dockStatusOff");
  const [running, setRunning] = useState(false);
  const [headerAway, setHeaderAway] = useState(false);
  const line = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const read = () =>
      setRunning(
        ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running === true &&
          isClaudeSession(ctx, sessionId),
      );
    read();
    return ctx.sessions.list.subscribe?.(read);
  }, [ctx, sessionId]);
  // The running turn's header verb line, when dsh drew the header: read on every animation frame,
  // so the dock hides while the header is on screen and shows once it scrolls off or was never
  // drawn. A frame read, not an IntersectionObserver: the observer reports a frame after the paint
  // that moved the header, so each time the header came back on screen both lines showed for a
  // frame or two before the dock left. A phone's short column scrolls the header away far more
  // often, so that is where it showed (owner, 2026-09-25). Read in the frame, before the paint,
  // and committed with `flushSync`, the dock leaves in the same frame the header arrives. The read
  // costs about 5 µs a frame on a 3,700-node page (measured 2026-09-25); the header is looked up
  // only when missing or dropped, React renders only on a change, and a hidden tab gets no frames.
  useEffect(() => {
    // Nothing to decide while the line is switched off, so no frame loop runs.
    if (!running || off) return;
    const startedAt = Date.now();
    let header: HTMLElement | null = null;
    let box: HTMLElement | null = null;
    let away = false;
    let frame = 0;
    const check = () => {
      frame = requestAnimationFrame(check);
      // The header's own verb line: the plugin wires it only on the running turn's newest header,
      // never on a completed turn (those are marked done) and never on dsh's 1px hidden announcer.
      // So this is the running turn's header when dsh drew it. Watching the process button instead
      // pointed at a completed turn on a long run, whose header sits below the running one, and
      // hid the dock at the wrong scroll position (owner, 2026-09-23). Looked up again once dsh's
      // virtual list drops the node; on a long turn dsh draws no running header until "Load
      // earlier", so none is found and the dock is the only place the verb shows.
      // On dsh 0.2 the header is the running row under the turn's content, so the dock shows only
      // once that row is scrolled out of view.
      if (header === null || !header.isConnected) {
        header = document.querySelector<HTMLElement>(
          "button[data-turn-process] [data-omc-turn-line], [data-chat-running] [data-omc-turn-line]",
        );
        box = header === null ? null : scrollerOf(header);
      }
      // Right after a send dsh has not drawn the new turn's header yet, and reading that as "never
      // drawn" flashed the line before the header turned up on screen (owner, 2026-09-24). Only a
      // header still missing after the grace counts as not drawn.
      const next =
        header === null ? Date.now() - startedAt >= DOCK_HEADER_GRACE_MS : !onScreen(header, box);
      if (next === away) return;
      away = next;
      flushSync(() => setHeaderAway(next));
    };
    frame = requestAnimationFrame(check);
    // A turn that ended with its header scrolled away left `headerAway` true, and resetting it
    // when the next turn started came one render late: the first render of the new turn drew the
    // dock beside the new header. Reset as the turn ends instead, so the next one starts hidden.
    return () => {
      cancelAnimationFrame(frame);
      setHeaderAway(false);
    };
  }, [running, off]);
  const shown = running && hasTheme("row") && !off && headerAway;
  useEffect(() => {
    if (!shown) return;
    const el = line.current;
    if (el === null) return;
    spinnerSettings ??= loadSpinnerSettings();
    let live = true;
    void spinnerSettings.then((settings) => {
      if (!live || !el.isConnected) return;
      const defaults = activeLocale().startsWith("zh") ? ZH_VERBS : DEFAULT_VERBS;
      wireTurnStatus(
        el,
        sessionId,
        mergeVerbs(defaults, settings.setting),
        settings.frameSet,
        () => ctx.sessions.list.getSnapshot()?.byId[sessionId]?.running === true,
      );
    }, console.error);
    // The beat inside `wireTurnStatus` stops on its own once the span leaves the document, which
    // React does when `shown` flips; the mark is cleared so a re-show wires a fresh line.
    return () => {
      live = false;
      el.removeAttribute(TURN_MARK);
    };
  }, [shown, sessionId, ctx]);
  if (!shown) return null;
  // Hidden from assistive tech: dsh's own status row already announces the turn, and this repeats it.
  return (
    <div
      ref={publishDockHeight}
      data-omc-dock-status=""
      data-omc-arrived=""
      aria-hidden="true"
      style={{
        // A short, gentle fade: chat scrolls behind the line, so the page colour holds solid under
        // the verb and dissolves to transparent over ~14px above it, enough to keep the last chat
        // row from touching the verb without opening a gap. No drop shadow: the gradient alone
        // reads as the line floating, and a shadow on top drew a second, harder edge; a tall fade
        // opened too big a gap (owner, 2026-09-23). The colour is dsh's base layer, which fills the
        // composer area, so it holds in either theme. The strip fades in with `data-omc-arrived`.
        padding: "14px 0 4px",
        background:
          "linear-gradient(to top, var(--dsw-alias-bg-base, transparent) 0%, var(--dsw-alias-bg-base, transparent) 55%, transparent 100%)",
      }}
    >
      {/* The chat column and the composer share a centre line, so the same max-width centred with
          auto margins lands this line's left edge on the chat text's, instead of the full composer
          width. `--dsh-chat-content-width` is dsh's own column width (748px is its default). On a
          narrow page dsh drops the column to the page minus 32px and gives the text a 16px gutter
          inside it, so the text sits 32px in from this strip's edge; the `min` follows it there
          (measured 2026-09-23: the header's line at strip edge + 32 at 390 and 600 px, at the
          column's edge at 900 and 1400 px, where the token is the smaller term). */}
      {/* Border-box so the 44px the Back-to-bottom rule adds on the right comes out of this width
          rather than widening the line: content-box grew it by 44px and the auto margins moved the
          left edge 22px left of the chat text whenever the button showed (measured 2026-09-24: 32px
          to 10px at 390, the same 22px at 1400). */}
      <div
        style={{
          boxSizing: "border-box",
          maxWidth: "min(calc(100% - 64px), var(--dsh-chat-content-width, 748px))",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        {/* The seed text is replaced by the verb before the next frame; the line's font is dsh's
            secondary size, the one the header's label uses. */}
        <span
          ref={line}
          data-omc-turn-line="1"
          style={{ fontSize: "var(--dsh-content-font-size-secondary, 13px)", lineHeight: "24px" }}
        >
          …
        </span>
      </div>
    </div>
  );
}

/** Keep one event stream open for the Claude session on screen, reopening when it changes. Reads
 *  the open session the way the status row does (`activeClaudeSession`; undefined for a llama
 *  session or none open, which opens a stream for the tab-wide kinds only). Once a second whether
 *  or not the store can be subscribed to: the beat also reopens a source the server-reload gap
 *  closed for good, which no store change announces. */
export function watchEventStream(ctx: ClientCtx) {
  const sync = () => openStream(activeClaudeSession(ctx) ?? null);
  sync();
  const beat = setInterval(guard(sync), 1000);
  whenContextGone(() => clearInterval(beat));
}

/** On a finished turn's process-group button once it carries the closing line with its time, so the
 *  per-frame pass skips it; one still waiting for its tail's clock stays unmarked and is retried. */
const CLOSED_MARK = "data-omc-turn-closed";
/** The closing line the plugin writes into a finished turn's header. */
const CLOSING_MARK = "data-omc-turn-closing";

/**
 * Writes the CLI's closing line (`✻ Crunched for 38s · done 3:33 AM`) into a finished turn's
 * process-group button, over dsh's own "Completed in 38s" ("Took 38s" before 0.2.0-rc.2), which
 * the sheet hides while the line is there. Finished is dsh's label reading its
 * `message.turnProcess.took` template (see `tookDuration`), not the chevron: a running group
 * reads "Deep diving for 12s" and is left alone, as is one still carrying the running line. A
 * stopped turn (dsh's `Stopped`) gets the CLI's interrupt line instead; a failed one keeps dsh's
 * word. The time is the clock dsh prints in the turn's tail. Only the newest group can still gain
 * one, so an older group is marked closed on its first paint with or without it, and the per-frame
 * pass stops visiting it. Writes only when the text changes, since every write is a mutation the
 * observer brings straight back here.
 */
const paintClosing = (
  group: HTMLElement,
  sessionId: string,
  newest: boolean,
  faceOf: (label: HTMLElement) => Face,
): void => {
  if (group.querySelector(":scope > [data-omc-turn-line]") !== null) return;
  const label = group.querySelector<HTMLElement>(`:scope > span:not([${CLOSING_MARK}])`);
  if (label === null) return;
  const stopped = isStopped(label.textContent ?? "");
  const duration = tookDuration(label.textContent ?? "") ?? "";
  if (!stopped && duration === "") return;
  const turn = group.getAttribute("data-turn-process") ?? "";
  const scope = group.closest("[data-conversation-scroll]") ?? document;
  const tail = scope.querySelector(`[data-turn-tail="${CSS.escape(turn)}"] [data-clock="end"]`);
  // The clock is the tail's last leaf span that ends in `HH:MM`; the usage button sits beside it.
  const clock = [...(tail?.querySelectorAll("span") ?? [])]
    .toReversed()
    .find((el) => el.childElementCount === 0 && /\d:\d{2}$/.test(el.textContent ?? ""));
  const zh = activeLocale().startsWith("zh");
  const verb = closingVerb(`${sessionId}:${turn}`, zh ? ZH_CLOSING_VERBS : CLOSING_VERBS);
  // A stopped turn reads the CLI's own interrupt line, which has no glyph, verb or time.
  const text = stopped
    ? t("main.turn.interrupted")
    : clock === undefined
      ? t("main.turn.closing", { verb, duration })
      : t("main.turn.closingDone", {
          verb,
          duration,
          time: clockText(clock.textContent ?? "", zh),
        });
  let line = group.querySelector<HTMLElement>(`:scope > [${CLOSING_MARK}]`);
  if (line === null) {
    line = document.createElement("span");
    line.setAttribute(CLOSING_MARK, "1");
    // Copied from dsh's label, as the running line does: a sibling inherits the button's type, not
    // the label's, and would read at a different size from the text it replaces.
    const face = faceOf(label);
    line.style.fontSize = face.fontSize;
    line.style.fontWeight = face.fontWeight;
    line.style.fontFamily = face.fontFamily;
    line.style.lineHeight = face.lineHeight;
    line.style.color = T.faint;
    if (!stopped) {
      // The running line's spinner cell (1.3em, glyph at its start) and its 2px gap, so the text
      // starts where the verb did: 20px after the glyph at dsh's 14px, measured on both lines.
      const glyph = document.createElement("span");
      glyph.setAttribute("aria-hidden", "true");
      glyph.style.display = "inline-block";
      glyph.style.width = "1.3em";
      glyph.style.marginRight = "2px";
      glyph.textContent = "✻";
      line.append(glyph);
    }
    line.append(document.createTextNode(text));
    // In the label's place, not at the end: a group with content puts dsh's chevron after its label,
    // and an appended line sat after the chevron, which pushed the glyph off the left edge.
    label.after(line);
  } else if (line.lastChild?.nodeValue !== text && line.lastChild !== null) {
    line.lastChild.nodeValue = text;
  }
  if (stopped || clock !== undefined || !newest) group.setAttribute(CLOSED_MARK, "1");
};

/** Wire a running turn's status: attach dsh's [role=status][aria-live=polite] element to this
 *  session, keep the body marked to the active Claude session, and tear both down on unmount. */
export function watchTurnStatus(ctx: ClientCtx) {
  ensureTurnStatusStyle(); // a hot reload keeps the old module's sheet (no data-plugin on it) and its marked elements
  // Keep a body flag in step with the open session so the first-paint colour rule applies before
  // the observer runs (the flash of dsh's blue the owner saw on first load).
  // Written only when it changes: this runs every second, and an attribute write invalidates the
  // style of everything the rule can match whether or not the value moved.
  const markBody = () => {
    const want = activeClaudeSession(ctx) ? "1" : null;
    if (document.body.getAttribute("data-omc-claude") === want) return;
    if (want === null) document.body.removeAttribute("data-omc-claude");
    else document.body.setAttribute("data-omc-claude", want);
  };
  markBody();
  const beat = setInterval(guard(markBody), 1000);
  whenContextGone(() => clearInterval(beat));
  /** The newest process group on the page, read once per scan pass rather than once per
   *  candidate: a streaming turn dirties the page many times a frame, and each candidate group
   *  asking for itself made the scan quadratic in the length of the conversation. */
  let newestGroup: Element | null = null;
  const attach = (found: HTMLElement) => {
    // A row already wired, or a group already marked done, needs no further look and no layout.
    if (found.hasAttribute(TURN_MARK) || found.hasAttribute("data-omc-turn-done")) return;
    // dsh 0.2 draws a process group only once its turn closes and runs the live one in its own
    // row, so a group is never the running turn. The 0.1.7 checks this replaced (session still
    // running, newest group only) left a gap: the session list's flag and the one that takes the
    // running row down are two stores, and a group drawn between the two would have taken the
    // verb over its "Took 12s".
    if (found.matches("button[data-turn-process]")) return;
    const el = turnStatusRow(found);
    if (el === undefined) return;
    // The wired mark is read here rather than inside `wireTurnStatus`: everything below allocates a
    // promise, and this runs for every status element on every dirty frame of a running turn.
    if (el.hasAttribute(TURN_MARK)) return;
    const activeId = activeClaudeSession(ctx);
    if (!activeId) return;
    if (!hasTheme("row")) return; // the Claude look's status row is off: dsh's own text stays
    spinnerSettings ??= loadSpinnerSettings(); // once per page load
    // The settings load once and resolve for good, so this is a microtask after the first frame.
    // The await used to be unhandled, so a throw inside `wireTurnStatus` became a rejection
    // `guard` never saw: the spinner simply never appeared, with nothing on the console to say why.
    void spinnerSettings.then((settings) => {
      if (!el.isConnected) return;
      const defaults = activeLocale().startsWith("zh") ? ZH_VERBS : DEFAULT_VERBS;
      wireTurnStatus(
        el,
        activeId,
        mergeVerbs(defaults, settings.setting),
        settings.frameSet,
        () => ctx.sessions.list.getSnapshot()?.byId[activeId]?.running === true,
      );
    }, console.error);
  };
  /** One document walk per mutation batch, shared by every scan in it. */
  const refreshNewest = () => {
    const groups = document.querySelectorAll("button[data-turn-process]");
    newestGroup = groups[groups.length - 1] ?? null;
  };
  const scan = (root: HTMLElement) => {
    attach(root);
    for (const el of root.querySelectorAll<HTMLElement>(TURN_ROW_SELECTOR)) attach(el);
  };
  // Once per dirty frame, and the cheapest check comes first: on a session that is not a Claude
  // mount there is nothing to attach, so bail before the querySelectorAll. attach is idempotent
  // (the status row carries a data-attr once wired), so re-scanning the body each frame is safe.
  // Finished turns keep a closing line. A whole-page pass rather than the changed nodes: dsh flips a
  // group's label to "Took 12s" as a text change inside it and mounts the tail with the clock as a
  // sibling, and neither reaches the group through the scan above. Closed groups drop out of the
  // selector, so a long conversation costs one query and the few unfinished groups.
  // Painted whatever the Claude look says: the sheet shows the line and hides dsh's label only
  // while the row group is on, so switching the look off gives dsh's "Took 12s" back at once.
  const closeFinished = () => {
    const sid = activeClaudeSession(ctx);
    if (!sid) return;
    // Every label shares one face: read it once per pass, before this pass writes anything, so a
    // page opening on fifty finished turns recalculates style once rather than once per turn.
    let face: Face | undefined;
    const faceOf = (label: HTMLElement): Face => {
      if (face === undefined) {
        const { fontSize, fontWeight, fontFamily, lineHeight } = getComputedStyle(label);
        face = { fontSize, fontWeight, fontFamily, lineHeight };
      }
      return face;
    };
    for (const group of document.querySelectorAll<HTMLElement>(
      `button[data-turn-process]:not([${CLOSED_MARK}])`,
    ))
      paintClosing(group, sid, group === newestGroup, faceOf);
  };
  onBodyMutation((records) => {
    if (!activeClaudeSession(ctx)) return;
    refreshNewest();
    closeFinished();
    if (records === undefined) return scan(document.body);
    for (const node of changedElements(records)) scan(node);
  });
  refreshNewest();
  closeFinished();
  scan(document.body);
  // Closed lines are written once, in the language of the moment; a switch reopens them so the
  // next pass rewrites each in the new one (verb list, template and clock form all change).
  whenContextGone(
    onLocaleSwitch(() => {
      for (const group of document.querySelectorAll(`[${CLOSED_MARK}]`))
        group.removeAttribute(CLOSED_MARK);
      closeFinished();
    }),
  );
}

/** The mark the slot paints on a running Claude session's row, so the scan reads a per-row flag
 *  instead of matching each dot to a session by title. Reuses the value the body carries
 *  (`data-omc-claude`), so one flag names both the open session and its running rows. */
const ROW_MARK = "data-omc-claude";

/** displayTitles of the sessions that are both running and on a Claude mount this instant: the
 *  scan's title-match fallback on a dsh without the row-action slot. */
export const claudeRunningTitles = (ctx: ClientCtx): Set<string> => {
  const set = new Set<string>();
  const snap = ctx.sessions.list.getSnapshot();
  if (!snap) return set;
  for (const [id, s] of Object.entries(snap.byId))
    if (s.running && s.displayTitle && isClaudeSession(ctx, id)) set.add(s.displayTitle.trim());
  return set;
};
/**
 * The row-action occupant dsh mounts at the end of every session row (hidden until hover, mounted
 * at rest): it draws nothing and marks its own row with `data-omc-claude` while the session is
 * running on a Claude mount. The row is its nearest treeitem, found from the element it renders,
 * so the mark follows the session id dsh handed the slot and never a title. Re-read on every list
 * change (running flips, model switches), cleared on unmount and when the session stops qualifying.
 */
export function RowMark({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const treeRow = ref.current?.closest('[role="treeitem"]');
    if (!treeRow) return;
    const refresh = () => {
      const s = ctx.sessions.list.getSnapshot()?.byId[sessionId];
      const want = s?.running === true && isClaudeSession(ctx, sessionId);
      if (want) treeRow.setAttribute(ROW_MARK, "1");
      else treeRow.removeAttribute(ROW_MARK);
    };
    refresh();
    const off = ctx.sessions.list.subscribe?.(refresh);
    return () => {
      off?.();
      treeRow.removeAttribute(ROW_MARK);
    };
  }, [sessionId, ctx]);
  return <span ref={ref} hidden data-omc-row-mark={sessionId} />;
}
