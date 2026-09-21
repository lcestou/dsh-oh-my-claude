import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export const ROUTE = "/dsh-oh-my-claude";
/** "m*****@gmail.com": first letter, stars, then the domain. Every surface that shows the login
 *  masks it. The panel and the diagnostics rows get screen-shared. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf("@");
  if (at < 1) return email;
  return `${email[0]}${"*".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
};
/** A hints-store value as a number, or undefined for a flag or a missing key. */
export const numberOr = (v: boolean | number | undefined): number | undefined =>
  typeof v === "number" ? v : undefined;
/** Format a turn's cost in USD with two decimals. */
export const fmtCost = (usd: number): string => `$${usd.toFixed(2)}`;
/** Format duration ms into a human string: "34s" or "1m 35s". */
export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return `${m}m`;
  return `${m}m ${sec}s`;
};
/** Cache share = cacheRead / (input + cacheRead + cacheWrite), clamped to [0,1]. */
export const cacheShare = ({
  input,
  cacheRead,
  cacheWrite,
}: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number => {
  const denom = input + cacheRead + cacheWrite;
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, cacheRead / denom));
};

/** A past time as `min ago` under an hour, `h ago` under a day and a calendar date after that,
 *  reading future times as now. */
export const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

const KEYWORD_PAIRS = new Map<string, string>([
  ["`", "`"],
  ['"', '"'],
  ["<", ">"],
  ["{", "}"],
  ["[", "]"],
  ["(", ")"],
  ["'", "'"],
]);
/** A letter, digit or underscore. A closing quote followed by one is an apostrophe inside a
 *  word, so the quoted span stays open. */
const wordy = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
/** The CLI's keyword matcher (`SOt`) for a composer keyword such as `ultracode`: no match when the
 *  text is a slash command, inside quotes, backticks, brackets or a tag, glued to a path or flag
 *  character, or followed by a dotted member. A keyword typed as an example is not a trigger, so
 *  it is not painted. */
export const keywordMatches = (text: string, word: string): { start: number; end: number }[] => {
  const out: { start: number; end: number }[] = [];
  if (!new RegExp(word, "i").test(text) || text.startsWith("/")) return out;
  const spans: { start: number; end: number }[] = [];
  let open: string | null = null;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (open) {
      if (open === "[" && ch === "[") {
        at = i;
        continue;
      }
      if (ch !== KEYWORD_PAIRS.get(open)) continue;
      if (open === "'" && wordy(text[i + 1])) continue;
      spans.push({ start: at, end: i + 1 });
      open = null;
    } else if (
      (ch === "<" && i + 1 < text.length && /[a-zA-Z/]/.test(text[i + 1]!)) ||
      (ch === "'" && !wordy(text[i - 1])) ||
      (ch !== "<" && ch !== "'" && KEYWORD_PAIRS.has(ch))
    ) {
      open = ch;
      at = i;
    }
  }
  for (const m of text.matchAll(new RegExp(`\\b${word}\\b`, "gi"))) {
    const start = m.index;
    const end = start + m[0].length;
    if (spans.some((sp) => start >= sp.start && start < sp.end)) continue;
    const before = text[start - 1];
    const after = text[end];
    if (before === "/" || before === "\\" || before === "-") continue;
    if (after === "/" || after === "\\" || after === "-" || after === "?") continue;
    if (after === "." && wordy(text[end + 1])) continue;
    out.push({ start, end });
  }
  return out;
};

// dsh's design tokens (`--dsw-alias-*`) with plain fallbacks for any other host theme.
export const T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))",
  /** The shade dsh's composer buttons take under the pointer. */
  hoverSolid: "var(--dsw-alias-interactive-bg-hover-solid, rgba(128,128,128,.2))",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)",
};

/** Claude's brand orange (the CLI theme table): the one accent this plugin adds. */
export const CLAUDE_ORANGE = "#D97757";
/** The same pair as the page paints them: the accent custom properties applyTheme writes, with
 *  today's values as the fallback, for inline styles that must follow the Claude look switch. */
export const ACCENT = "var(--omc-accent, #D97757)";
export const SHIMMER = "var(--omc-shimmer, #F59575)";
/** The accent as the panel and its trigger see it: `--omc-accent-panel` where ensurePanelStyle
 *  sets it (the panel group switch can point that at dsh's brand colour), the page accent elsewhere. */
export const PANEL_ACCENT = "var(--omc-accent-panel, var(--omc-accent, #D97757))";
/** Claude's own spinner glyph, used as the mark beside anything Claude-owned in dsh's chrome. */
export const CLAUDE_MARK = "✻";

export const h3: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
export const meta: CSSProperties = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
/** One voice for a failure inside a tab: small, the error colour, wrapping, never a raw red line. */
export const errText: CSSProperties = {
  color: T.err,
  fontSize: 12,
  padding: "2px 0",
  whiteSpace: "normal",
  wordBreak: "break-word",
};
/** One voice for "Loading…" and empty states: the meta colour, flush with the panel's inset. */
export const stateText: CSSProperties = { ...meta, padding: "2px 0", whiteSpace: "normal" };
/**
 * The panel's one horizontal inset, applied once by the tab body and the tab strip: every row,
 * card, search field and heading lines up on it instead of carrying its own side padding. 10 px
 * inside the panel's 4 px padding is where dsh's slash menu starts its rows and group labels, and
 * the plugin panel stands in that menu's place.
 */
export const PANEL_INSET = 10;
/** A section label inside a tab: dsh's menu group label (12 px, weight 500, the secondary label
 *  colour, 6 px above), so every tab titles its sections the same way. */
export const sectionHead: CSSProperties = {
  display: "block",
  margin: 0,
  padding: "8px 0 2px",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
  color: T.muted,
  whiteSpace: "normal",
};
/** What belongs to the row or fold above it, set in behind a thin rule: the Settings look for the
 *  update options, shared so a nested group reads the same wherever it opens. */
export const nested: CSSProperties = { paddingLeft: 12, borderLeft: `1px solid ${T.border}` };

/** Markers on the panel and the dock, so a check or a style can find them without a class name. */
export const PANEL_ATTR = "data-omc-panel";
export const DOCK_ATTR = "data-omc-dock";
/**
 * The panel's own surface: dsh's layer colour warmed with a few percent of Claude's orange, so the
 * panel reads as Claude's and stands off the dark chrome instead of vanishing into it. The edge
 * carries more of the hue than the fill (a tint the eye reads as a border, not as a coloured box)
 * and the shadow gains a faint warm ring so the float reads on both themes. `color-mix` keeps every
 * value derived from the theme token rather than a picked hex, so light and dark both hold.
 */
export const panelSurface: CSSProperties = {
  background: `color-mix(in srgb, ${PANEL_ACCENT} 7%, ${T.card})`,
  border: `1px solid color-mix(in srgb, ${PANEL_ACCENT} 34%, ${T.border})`,
  boxShadow: `0 10px 28px rgba(0,0,0,.26), 0 0 0 1px color-mix(in srgb, ${PANEL_ACCENT} 10%, transparent)`,
};
/** A tab in the strip under the body: text only, the accent as a 2px rule on the open one. */
export const tabStyle = (selected: boolean): CSSProperties => ({
  padding: "6px 10px 5px",
  cursor: "pointer",
  border: "none",
  borderBottom: `2px solid ${selected ? PANEL_ACCENT : "transparent"}`,
  borderRadius: "0 0 8px 8px",
  background: "transparent",
  color: selected ? T.text : T.muted,
  fontSize: 13,
  fontWeight: selected ? 600 : 400,
  whiteSpace: "nowrap",
  marginBottom: -1,
  // The bold width is reserved by a hidden bold copy of the label (ensurePanelStyle's ::after
  // rule reads data-omc-label), so selecting a tab never nudges its neighbours; the visible
  // label sits centred in that box.
  textAlign: "center",
});

const PANEL_STYLE_ID = "dsh-oh-my-claude-panel";
/**
 * The one stylesheet for everything interactive the plugin draws in the panel and the aside dock.
 * Inline styles cannot say `:hover`, `:focus-visible` or `:active`, and a hover written as React
 * state per button does not scale past the few that had it. Every control under the two scopes
 * answers the pointer the same way: an orange wash over whatever it is filled with (so a primary
 * button warms and a ghost one lights), the edge takes the hue, and keyboard focus gets the same
 * ring. Rewritten on every call, as the fold sheet is, so a hot reload never leaves old rules.
 */
export function ensurePanelStyle(): void {
  const existing = document.getElementById(PANEL_STYLE_ID);
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = PANEL_STYLE_ID;
  const scope = `[${PANEL_ATTR}], [${DOCK_ATTR}]`;
  const controls = `:is(button, select, input, textarea, summary, [role="tab"])`;
  // `!important` throughout: every control carries its base look as an inline style (the shared
  // `btn`, `select` and `tabStyle` objects), and an inline `background` shorthand outranks any
  // sheet rule and resets `background-image` besides. The sheet owns only the transient states.
  const inScope = (sel: string) => `[${PANEL_ATTR}] ${sel}, [${DOCK_ATTR}] ${sel}`;
  el.textContent = [
    // The panel's accent follows the page's `--omc-accent` (set by applyTheme; today's orange
    // when unset) unless the panel group is off, when the next rule hands it dsh's brand colour.
    `${scope} {`,
    `  --omc-accent-panel: var(--omc-accent, ${CLAUDE_ORANGE});`,
    `  --omc-wash: color-mix(in srgb, var(--omc-accent-panel) 10%, transparent);`,
    `  --omc-wash-strong: color-mix(in srgb, var(--omc-accent-panel) 18%, transparent);`,
    `  --omc-edge: color-mix(in srgb, var(--omc-accent-panel) 45%, ${T.border});`,
    `  --omc-ring: color-mix(in srgb, var(--omc-accent-panel) 70%, transparent);`,
    `}`,
    `body[data-omc-theme]:not([data-omc-theme~="panel"]) :is([${PANEL_ATTR}], [${DOCK_ATTR}]) { --omc-accent-panel: ${T.brand}; }`,
    `body[data-omc-theme]:not([data-omc-theme~="panel"]) button[aria-label="Oh My Claude"] { --omc-accent-panel: ${T.brand}; }`,
    `${inScope(controls)} { transition: background-color .15s ease, background-image .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, opacity .15s ease; }`,
    // The wash is a background-image so it lays over any fill: transparent ghost, brand primary,
    // the field colour. One rule, every button.
    `${inScope("button:not(:disabled):hover")} { background-image: linear-gradient(var(--omc-wash), var(--omc-wash)) !important; border-color: var(--omc-edge) !important; }`,
    `${inScope("button:not(:disabled):active")} { background-image: linear-gradient(var(--omc-wash-strong), var(--omc-wash-strong)) !important; }`,
    `${inScope("button:disabled")} { opacity: .5 !important; cursor: not-allowed !important; }`,
    `${inScope(":is(select, input, textarea):not(:disabled):hover")} { border-color: var(--omc-edge) !important; }`,
    `${inScope('[role="tab"]:not([aria-selected="true"]):hover')} { background-image: linear-gradient(var(--omc-wash), var(--omc-wash)) !important; color: ${T.text} !important; }`,
    `${inScope("summary")} { cursor: pointer; border-radius: 6px; }`,
    `${inScope("summary::marker")} { color: var(--omc-accent-panel); }`,
    `${inScope("summary:hover")} { background-image: linear-gradient(var(--omc-wash), var(--omc-wash)) !important; color: ${T.text} !important; }`,
    `${inScope(`${controls}:focus-visible`)} { outline: 2px solid var(--omc-ring); outline-offset: 2px; }`,
    `${inScope('[role="tab"]:focus-visible')} { outline-offset: -2px; }`,
    // A zero-height bold twin of the label under the real one: the tab is as wide as its bold
    // form from the start, so the strip does not shift when the weight changes.
    `${inScope('[role="tab"]::after')} { content: attr(data-omc-label); display: block; height: 0; overflow: hidden; visibility: hidden; font-weight: 600; }`,
    // The trigger in the composer: dsh's own hover shade, as on the buttons beside it.
    `button[aria-label="Oh My Claude"]:hover { background: ${T.hoverSolid} !important; }`,
    // dsh gives every element corner-shape: superellipse(1.5) where the browser knows the
    // property; its round buttons opt out, and so must this one or the 999 px radius squares off.
    `button[aria-label="Oh My Claude"] { corner-shape: round; }`,
    `button[aria-label="Oh My Claude"]:focus-visible { outline: 2px solid color-mix(in srgb, var(--omc-accent) 70%, transparent); outline-offset: 2px; }`,
    `@media (prefers-reduced-motion: reduce) { ${inScope(controls)} { transition: none; } }`,
  ].join("\n");
  if (!existing) document.head.appendChild(el);
}
export const row: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  // 12, not 9: a 38 px button 9 px from the hairline above and below reads as touching it.
  padding: "12px 0",
  borderTop: `1px solid ${T.border}`,
};
/** dsh's own settings-card buttons (ui-settings-plugins, 2026-09-13): the secondary is a hairline
 *  box in the secondary label colour that firms up under the pointer; the primary is the primary
 *  label colour filled, text in the layer colour. Hover, disabled and focus live in one CSS rule
 *  under the settings section and the panel, since inline styles cannot carry states. */
export const btn: CSSProperties = {
  appearance: "none",
  font: "inherit",
  padding: "5px 14px",
  cursor: "pointer",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.muted,
  fontSize: 13,
  lineHeight: 1.5,
  whiteSpace: "nowrap",
};
export const btnPrimary: CSSProperties = {
  ...btn,
  background: "var(--dsw-alias-label-primary, #eee)",
  color: "var(--dsw-alias-bg-layer-3, #111)",
  border: "1px solid transparent",
};
/** The states those two need, plus the fields', as one stylesheet rule set under `scope`. */
export const controlStatesCss = (scope: string): string =>
  `${scope} button:not([role="switch"]):not([aria-expanded]):disabled{opacity:.4;cursor:default}` +
  `${scope} button:not([role="switch"]):not([aria-expanded]):not(:disabled):hover{color:var(--dsw-alias-label-primary,inherit);border-color:var(--dsw-alias-label-dimmed,rgba(128,128,128,.5))}` +
  `${scope} button:not([role="switch"]):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:1px}` +
  `${scope} input:not([type="checkbox"]):not([type="file"]):focus-visible,${scope} select:focus-visible,${scope} textarea:focus-visible{border-color:var(--dsw-alias-brand-primary,#3b82f6);outline:none}` +
  `${scope} input:disabled,${scope} select:disabled{color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.7));cursor:default}`;
/** Shared capsule styling for a labelled chip: a small rounded pill whose border and text take
 *  `color`, reused for the status stamps the plugin puts on rows. */
export const pill = (color: string): CSSProperties => ({
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.2,
  color,
  border: `1px solid ${color}`,
  opacity: 0.9,
  whiteSpace: "nowrap",
  // A badge is the wrong thing to squeeze when a flex row runs out of width: it holds two words
  // and squashing it hides them. The text beside it gives way instead.
  flex: "0 0 auto",
});
/** dsh's settings field (ui-settings-plugins `input`, ui-settings-models `selectInput`): a hairline
 *  box on the layer colour, 32px tall, the brand colour on focus, and a drawn chevron on a select. */
export const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  appearance: "none",
  font: "inherit",
  height: 32,
  padding: "0 12px",
  borderRadius: 8,
  border: "0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,.3))",
  background: "var(--dsw-alias-bg-layer-3, transparent)",
  color: T.text,
  fontSize: 13,
  lineHeight: 1.5,
  minWidth: 0,
  flex: 1,
};
export const select: CSSProperties = {
  ...inputStyle,
  flex: "0 1 auto",
  maxWidth: 260,
  cursor: "pointer",
  paddingRight: 32,
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
  backgroundPosition: "right 12px center",
  backgroundRepeat: "no-repeat",
  backgroundSize: "12px 12px",
};
export const code: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontFamily: T.mono,
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 2,
  whiteSpace: "pre",
};
/** A word of code inside a sentence: sits on the text line, no block padding or full width. */
export const codeInline: CSSProperties = {
  fontFamily: T.mono,
  fontSize: "0.9em",
  padding: "1px 5px",
  borderRadius: 5,
  border: `1px solid ${T.border}`,
  background: T.field,
  whiteSpace: "nowrap",
};

/** Decode a reply from this plugin's own routes; a non-2xx status throws its `error` text. */
export const readJson = async <T>(r: Response): Promise<T> => {
  // SAFETY: the body comes from this plugin's own routes; the caller names the route's reply shape
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};

export interface SessionData {
  id: string;
  title?: string;
  cwd?: string;
  modifiedAt: number;
  turns: number;
  turnsPartial?: boolean;
  bytes: number;
  dsh?: { archived?: boolean; id?: string };
  /** Brought in through Import: it lives in the plugin's state dir, not Claude's `projects/`. */
  imported?: boolean;
}

/**
 * Whether a transcript row answers a typed search: every whitespace-separated word must appear in
 * its title, id or workspace path, case-insensitively, in any order. An empty query matches all.
 */
export const matchesQuery = (
  s: { id: string; title?: string; cwd?: string },
  query: string,
): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${s.title ?? ""} ${s.id} ${s.cwd ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
};

/** A transcript already tracked by a live (not archived) dsh session: it is in the sidebar, skip it. */
export const isOwnedActive = (s: { dsh?: { id?: string; archived?: boolean } }): boolean =>
  !!s.dsh?.id && !s.dsh.archived;

/** Open a transcript row on this box: unarchive/open a dsh session, or import a terminal one. */
async function openHere(
  ctx: ClientCtx,
  s: { dsh?: { id?: string; archived?: boolean }; id: string; cwd?: string },
  cwd: string,
) {
  const known = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  const id = s.dsh?.id ?? s.id;
  const existed = Boolean(known()[id]);
  // Always through the route, even for a session dsh already has ("Show"): the route is what puts
  // the session on its workspace's list, and one opened before that step existed is nowhere in
  // the sidebar until it runs again. Idempotent on the server.
  await readJson(
    await fetch(`${ROUTE}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, id: s.id }),
    }),
  );
  // A session dsh owns but has not loaded (persisted, then a restart) is as unknown to the store as
  // a raw transcript: `open` on it is a no-op, so adopt it through create like the transcript case.
  if (s.dsh?.archived || !existed) {
    if (!s.dsh?.archived) {
      const ws = (ctx.workspaces.list.getSnapshot()?.items ?? []).find((w) => w.path === cwd);
      await ctx.sessions.create(
        ws ? { sessionId: id, workspaceId: ws.workspaceId } : { sessionId: id },
      );
    }
    // Unarchiving/importing lands server-side; the client's session store learns of the session
    // through its own subscription a beat later. Opening an id the store does not know yet is a
    // no-op. The restored session would never come to the foreground on its own, so
    // wait briefly for it.
    for (let i = 0; i < 40 && !known()[id]; i++) await new Promise((r) => setTimeout(r, 50));
    // If it never appeared (server-side open/import error), `open` below is a no-op and the row just
    // does nothing; leave a breadcrumb so a stuck restore is diagnosable rather than silent.
    if (!known()[id])
      console.warn(`[oh-my-claude] session ${id} did not appear after open; not opened`);
  }
  openSession(ctx, id);
}
export { openHere };

/**
 * Bring a session to the foreground, across both shapes dsh has had for it.
 *
 * `ctx.sessions.open` up to 0.1.5; 0.1.6-alpha.2 moved navigation onto `uiWorkspace.openSession`
 * and dropped it from the Session Controller. `uiWorkspace` is read through `ctx.get` rather than
 * named in `inject`: a cordis inject for a service the host does not provide leaves the whole
 * plugin waiting for a dependency that never arrives, which would break every 0.1.5 install.
 *
 * Both paths stay until 0.1.5 is no longer supported; dropping that support means deleting the
 * `ctx.sessions.open` branch, its type field, and this paragraph.
 */
export function openSession(ctx: ClientCtx, id: string): void {
  if (ctx.sessions.open) {
    ctx.sessions.open(id);
    return;
  }
  const uiWorkspace = ctx.get?.<{ openSession?: (target: string) => void }>("uiWorkspace");
  if (uiWorkspace?.openSession) {
    uiWorkspace.openSession(id);
    return;
  }
  console.warn(`[oh-my-claude] no session navigation on this dsh; cannot open ${id}`);
}

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line,
 * and one compact line into the ring's hover tooltip.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: a `[role=dialog]` whose parent holds a `button[aria-haspopup=dialog]` with the ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */
export const isRingRoot = (el: HTMLElement | null) =>
  !!el?.querySelector(':scope > button[aria-haspopup="dialog"] circle + circle');

/**
 * The mount a session runs on (`claude-code`, `claude-code-nova`, …), else undefined.
 *
 * This is the one session→box primitive every box-aware read keys off. dsh's model directory holds
 * the session's selection from the moment the session exists. The picker writes it with no turn
 * needed, so a brand-new tab on a box's model already resolves to that box, which the spawn-time
 * `targetHost` cannot do. `SessionHeader` carries no provider and a remote cwd can equal a local
 * one, so this is also the only way to tell a box session from a local one.
 */
const claudeMount = (provider: string | undefined): string | undefined =>
  provider?.startsWith("claude-code") === true ? provider : undefined;
/** The Claude mount for a session, open or not: read the live model directory first and the list
 *  projection after, so a sidebar session this tab never opened still resolves, undefined for a
 *  non-Claude session. */
export const claudeProviderOf = (ctx: ClientCtx, id: string): string | undefined => {
  try {
    const live = claudeMount(
      ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider,
    );
    if (live !== undefined) return live;
  } catch {
    // `directoryFor` needs a scope and a binding, and dsh only holds those for a session this tab
    // has opened. A session running in the sidebar and never clicked throws here, which used to
    // read as "not a Claude session" and left its row painted in dsh's blue until it was opened.
  }
  // The cold summary answers for the rest: dsh keeps the last and next model selection in the list
  // projection so a session can be described without being activated.
  const sel = ctx.sessions.list.getSnapshot()?.byId[id]?.projectionValues?.modelSelection;
  return claudeMount(sel?.next?.provider) ?? claudeMount(sel?.lastUsed?.provider);
};

/**
 * The `?provider=…` a request has to carry to be about the session's own box rather than this PC.
 * A GET that omits it lists the wrong machine; a POST that omits it *changes* the wrong machine,
 * so the mutating routes name the box too. Empty for a session on this PC, which is the default.
 */
export const boxQuery = (ctx: ClientCtx, id: string): string => {
  const provider = claudeProviderOf(ctx, id);
  return provider === undefined ? "" : `?provider=${encodeURIComponent(provider)}`;
};

/** The same box, for a URL that already carries a query string. */
export const boxParam = (ctx: ClientCtx, id: string): string => boxQuery(ctx, id).replace("?", "&");

/** Whether a session, open or not, runs on one of this plugin's mounts (`claude-code*`). */
export const isClaudeSession = (ctx: ClientCtx, id: string): boolean =>
  claudeProviderOf(ctx, id) !== undefined;

/**
 * dsh disposes a plugin's context when it loads a new bundle, but this module's timers and body
 * observer belong to the old bundle and keep running: every read of a disposed context throws
 * `cannot get required service "sessions" in inactive context`, once a second, forever, and one
 * more loop joins the flood with each reload. The first such throw retires this bundle instead.
 * the reads answer undefined and the loops that registered here stop.
 */
let gone = false;
const goneWatchers = new Set<() => void>();
/** Run `fn` once the context this bundle holds is disposed; immediately if it already is. */
export const whenContextGone = (fn: () => void): void => {
  if (gone) fn();
  else goneWatchers.add(fn);
};
/** Mark this bundle disposed and run the watchers registered through `whenContextGone` once, so
 *  loops bound to the dead context stop reading it. */
const retire = (): void => {
  gone = true;
  for (const fn of goneWatchers) fn();
  goneWatchers.clear();
};
/**
 * Wrap a loop body, whether an interval tick or a registered scan, so the first
 * disposed-context throw retires this bundle instead of reaching the console. Any
 * read of any service throws once the context is gone, so the catch belongs at the
 * loop's edge rather than at each read: guarding one read only moves the flood to the
 * next line. A throw that is not the context dying is rethrown.
 */
export const guard = <A extends unknown[]>(fn: (...args: A) => void): ((...args: A) => void) => {
  return (...args) => {
    if (gone) return;
    try {
      fn(...args);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("inactive context")) throw e;
      retire();
    }
  };
};
/**
 * The session the main view is showing, across both shapes dsh has had for it.
 *
 * Up to 0.1.5 the list snapshot carried `current`. 0.1.6-alpha.2 removed it, "navigation belongs
 * to view owners", and the main view instead retains its session through the Session Controller,
 * which shows up on the row as `retainedBy.mainView`. Exactly one row carries it, so the scan is
 * over a handful of sessions and runs only when `current` is absent.
 *
 * Both reads stay until 0.1.5 is no longer supported; dropping that support means deleting the
 * `current` line, its type field, and this paragraph.
 */
export const openSessionId = (ctx: ClientCtx): string | undefined => {
  if (gone) return undefined;
  try {
    const snap = ctx.sessions.list.getSnapshot();
    if (snap?.current) return snap.current;
    for (const [id, summary] of Object.entries(snap?.byId ?? {})) {
      if ((summary.retainedBy?.mainView ?? 0) > 0) return id;
    }
    return undefined;
  } catch {
    retire();
    return undefined;
  }
};

/** The open session's provider when it is one of this plugin's mounts (`claude-code*`), else undefined. */
export const activeClaudeSession = (ctx: ClientCtx): string | undefined => {
  const id = openSessionId(ctx);
  if (!id) return undefined;
  return isClaudeSession(ctx, id) ? id : undefined;
};

/**
 * `activeClaudeSession(ctx) === sessionId`, as a render that follows the model picker.
 *
 * A component that reads `activeClaudeSession` during render only learns of a model switch when
 * something else re-renders the slot, which on a fresh session is the first keystroke in the
 * composer (owner, 2026-09-16: the ✻ button stayed away after picking a Claude model until typing
 * began). The picker writes the session's model directory store and dsh's list store, so the
 * render subscribes to both; either one changing re-reads the answer.
 */
export function useActiveClaude(ctx: ClientCtx, sessionId: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const offs: Array<() => void> = [];
      try {
        offs.push(ctx.modelDirectories.directoryFor(sessionId).store.subscribe(fn));
      } catch {
        // Unbound in this tab (see claudeProviderOf); the list store below still carries the
        // cold selection, which is all the read can see for such a session anyway.
      }
      try {
        const off = ctx.sessions.list.subscribe?.(fn);
        if (off) offs.push(off);
      } catch {
        // A disposed context: the read side retires the bundle on its own.
      }
      return () => {
        for (const off of offs) off();
      };
    },
    [ctx, sessionId],
  );
  return useSyncExternalStore(subscribe, () => activeClaudeSession(ctx) === sessionId);
}
/** The open Claude session's own provider id (e.g. `claude-code` or `claude-code-prod`), else undefined. */
export const activeClaudeProvider = (ctx: ClientCtx): string | undefined => {
  const id = openSessionId(ctx);
  return id ? claudeProviderOf(ctx, id) : undefined;
};

/** A single-quoted shell word: `'` inside becomes `'\''`. */
const shq = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;

/** `cd '<cwd>' && claude --resume <id>`, wrapped in `ssh <host> "…"` for a session on an ssh box. */
export const resumeCommand = (id: string, cwd: string | undefined, host?: string): string => {
  const local = cwd ? `cd ${shq(cwd)} && claude --resume ${id}` : `claude --resume ${id}`;
  return host ? `ssh ${host} ${JSON.stringify(local)}` : local;
};

/** Fetch a file and save it through a temporary anchor; the object URL is revoked after 30 s. */
export async function saveBlob(url: string, filename: string): Promise<void> {
  const reply = await fetch(url);
  if (!reply.ok) throw new Error(`${filename}: ${reply.status}`);
  const href = URL.createObjectURL(await reply.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

interface RestoreButtonProps {
  sessionId: string;
  ctx: ClientCtx;
}
export type { RestoreButtonProps };

/** Body of one Oh My Claude tab: plain flow inside the host panel, which owns position and size. */
export const bodyFlow: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };

/** Close an open popover on an outside click or Escape. */
export function useDismiss(
  open: boolean,
  close: () => void,
  root: { current: HTMLElement | null },
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, root]);
}

/** Return true when the viewport is narrow enough to need fixed positioning for panels. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

type DshSlots = {
  inject: (slot: string, factory: () => ReactNode) => void;
  register: (
    spec: {
      name: string;
      id?: string;
      order?: number;
      label?: string;
      inject?: () => Record<string, never>;
    },
    // `sessionId` on session-scoped slots; `close` on `settings.section` (dsh-client-ui-settings-general
    // passes it so a section can dismiss the settings panel, e.g. after opening a restored session).
    // `inputActions` is the composer's own action face, handed to every entry of the session-scoped
    // composer slots (`conversation.input.dock` among them): `setDraft` writes the composer without
    // sending, which is what a prompt starter needs.
    Component: (props: {
      sessionId?: string;
      close?: () => void;
      inputActions?: { setDraft: (text: string) => void; submit?: () => void };
      // The composer's published state, read through dsh's snapshot-selector hook; `draft` is the
      // text in the box right now.
      useInput?: <T>(select: (state: { draft: string }) => T) => T;
    }) => ReactNode,
  ) => void;
};
/** One directory row as dsh's listing reports it (dsh-host-directory-picker `DirectoryEntry`). */
export interface DirEntry {
  name: string;
  /** Absolute path on the box the level came from; a client never joins segments itself. */
  path: string;
  /** Dot-prefixed on POSIX; the dialog owns whether to show it. */
  hidden: boolean;
}

/**
 * dsh-client-ui-workspace's directory UI service, which is what its own Select Workspace Directory
 * dialog lists through. Reached with `ctx.get`, not `inject`.
 */
export interface UiWorkspaceFace {
  listDirectory: (
    path?: string,
    signal?: AbortSignal,
  ) => Promise<{
    path: string;
    home: string;
    /** Root-to-level ancestry, every crumb a jump target. */
    crumbs: DirEntry[];
    entries: DirEntry[];
    truncated?: boolean;
  }>;
  createDirectory: (path: string, name: string) => Promise<string>;
}

/** dsh's locale registry, read so a replaced dialog keeps dsh's own copy in dsh's language. */
export interface LocaleFace {
  bind: (ns: string) => (key: string) => string;
}

/** The dsh client services this panel uses, the ones `inject` names. */
export interface ClientCtx {
  slots: DshSlots;
  sessions: {
    // `cwd`, `blank`, `running`, `completed` and `displayTitle` come from SessionSummary
    // (dsh-api-session-controller); the snapshot stores one per live session keyed by sessionId.
    // `completed` is dsh's own "finished while not selected and not yet opened" bit.
    list: {
      // A `SnapshotStore` (dsh-client-store): `subscribe` is what `useSyncExternalStore` needs
      // for a render to follow the store instead of waiting for dsh to re-render the slot.
      subscribe?: (fn: () => void) => () => void;
      getSnapshot: () => {
        byId: Record<
          string,
          {
            id: string;
            cwd?: string;
            blank?: boolean;
            running?: boolean;
            completed?: boolean;
            displayTitle?: string;
            // Positive local reference counts per source (`SessionRetainInfo.retainedBy`). dsh
            // 0.1.6-alpha.2 retains the session the main view shows under the `mainView` source,
            // which is how the open session is read since the list snapshot stopped carrying
            // `current`. Absent on 0.1.5, where `current` answers instead.
            retainedBy?: Record<string, number>;
            // The cold-summary hints dsh persists so a session can be described without being
            // activated. `projectList` (dsh-api-session-controller) flattens the summary's
            // projection block onto the row as `projectionValues`, keyed the same way
            // `projections.faceOf(key)` is. The model selection is in there, which is the only
            // provider a session that has never been opened in this tab can offer.
            projectionValues?: {
              modelSelection?: {
                lastUsed?: { provider?: string } | null;
                next?: { provider?: string } | null;
              };
            };
          }
        >;
        phase?: string;
        // dsh 0.1.5 and earlier: the selected session. Gone in 0.1.6-alpha.2, where the doc on
        // `ISessions.list` reads "navigation belongs to view owners". See `openSessionId`.
        current?: string;
      };
    };
    // dsh 0.1.5 and earlier. 0.1.6-alpha.2 moved navigation to `uiWorkspace.openSession`; see
    // `openSession` below, which prefers whichever of the two this host has.
    open?: (id: string) => void;
    create: (opts: { sessionId: string; workspaceId?: string }) => Promise<void>;
    // When present, the host can forward dsh-style commands to a session's underlying CLI.
    binding?: (id: string) => {
      session?: {
        command: (line: string) => Promise<{
          ok: boolean;
          value?: { matched?: boolean };
          error?: { code?: string; message?: string };
        }>;
      };
    };
  };
  workspaces: {
    list: {
      getSnapshot: () => { items: Array<{ path: string; workspaceId: string }> };
      /** dsh's own sidebar reconciles on this; the Boxes card refetches its rows on it. */
      subscribe: (fn: () => void) => () => void;
    };
    /** Adopt an existing directory as a workspace, which is what dsh's own picker calls. */
    create: (input: { path: string }) => Promise<{ workspaceId: string }>;
  };
  /**
   * cordis's own service lookup, which answers undefined for a service this plugin does not name in
   * `inject`. Reading such a service off the context directly throws ("cannot get property without
   * inject"), so this is the only way to treat one as optional: a dsh missing it keeps its own Add
   * workspace button and the plugin stays out of the way.
   */
  get?: <T>(name: string) => T | undefined;
  // From dsh-client-ui-model-selection (`ModelDirectoryResolver`, registered as `modelDirectories`).
  modelDirectories: {
    directoryFor: (sessionId: string) => {
      store: {
        subscribe: (fn: () => void) => () => void;
        getSnapshot: () => {
          current: { provider: string; model: string } | null;
          groups?: readonly { id: string; models: readonly { id: string }[] }[];
        };
      };
      // Bind a resumed session to a provider/model (dsh-client-ui-model-selection ModelDirectory).
      load?: () => Promise<{
        groups: readonly { id: string; models: readonly { id: string }[] }[];
      }>;
      select?: (sel: { provider: string; model: string }) => Promise<void>;
    };
  };
}

/** The three Skills-tab buckets a skill falls into. */
type SkillGroups<T> = { user: T[]; project: T[]; plugin: T[] };

/** Split skills into the three Skills-tab sections: `user`, `project`, and everything else (a
 *  `plugin:<name>` scope) under `plugin`. */
export function groupSkillsByScope<T extends { scope: string }>(
  rows: readonly T[],
): SkillGroups<T> {
  const out: SkillGroups<T> = { user: [], project: [], plugin: [] };
  for (const item of rows) {
    if (item.scope === "user") out.user.push(item);
    else if (item.scope === "project") out.project.push(item);
    else out.plugin.push(item);
  }
  return out;
}

/** The Skill-costs fetch state: idle before the fold opens, then loading, then the CLI's report
 *  (maybe user-skills-only), its own decline text, or a wrapped failure. */
export type SkillState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "report"; text: string; partial: boolean }
  | { kind: "declined"; text: string }
  | { kind: "error"; text: string };

/** Map a /skill-doctor reply to a SkillState: an ok report (maybe partial), the CLI's own decline
 *  text shown verbatim, or a wrapped failure. */
export function skillStateFromReply(reply: {
  ok?: boolean;
  report?: string;
  declined?: boolean;
  error?: string;
  partial?: boolean;
}): SkillState {
  if (reply.ok && reply.report !== undefined)
    return { kind: "report", text: reply.report, partial: reply.partial === true };
  if (reply.declined) return { kind: "declined", text: reply.error ?? "" };
  return { kind: "error", text: reply.error ?? "unknown error" };
}

/** One driver in a usage breakdown: the CLI's name for it and its share of the window. */
export interface UsageDriver {
  name: string;
  pct: number;
}
export interface UsageDriverGroup {
  label: string;
  drivers: UsageDriver[];
}
export interface UsageBreakdownWindow {
  label: string;
  requests: number;
  sessions: number;
  groups: UsageDriverGroup[];
  /** The CLI's own sentences about how the work was shaped, verbatim ("83% of your usage was at
   *  >150k context"). Claude Code calls these independent characteristics rather than a
   *  breakdown, so they do not add to 100 and are never summed or sorted with the groups. */
  behaviours: string[];
}
export type UsageBreakdownReply =
  | {
      ok: true;
      fetchedAt: number;
      windows: UsageBreakdownWindow[];
      host?: string;
      email?: string | null;
    }
  | { ok: false; error: string; host?: string; email?: string | null };

// Per provider: a second account is a second answer. The breakdown is a spawn on the box, so this
// 60 s memo keeps a popover reopen from re-running `claude -p /usage`.
//
// No `force=1` here, unlike loadUsage. On the route, `force` shortens the server cache from five
// minutes to thirty seconds, which is right for the plan windows (one HTTP call to Anthropic) and
// wrong for this one: the breakdown spawns `claude -p "/usage"` on the box, measured at 3.6 s on
// 2026-09-20. With force on, every reopen past this memo's minute paid that spawn again, and a
// second tab paid it whenever it was first to ask. Without it the server answers from its
// five-minute cache and the figures, which cover a 24 h and a 7 d window, lose nothing.
const breakdownCache = new Map<string, { at: number; reply: UsageBreakdownReply }>();
/** The usage breakdown for a provider, remembered in this tab for a minute. `force` skips that and
 *  asks the box to read again, which spawns `claude -p "/usage"` there. */
export const loadBreakdown = async (
  provider?: string,
  force = false,
): Promise<UsageBreakdownReply> => {
  const key = provider ?? "";
  const hit = breakdownCache.get(key);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.reply;
  // `force` is the Refresh button and nothing else. An ordinary open answers from whatever the
  // box already has, however old, because reading this figure spawns a `claude -p "/usage"` and
  // the wait is what makes the section feel broken.
  const q = force ? "force=1" : "";
  const url = provider
    ? `${ROUTE}/usage/breakdown?${q}${q ? "&" : ""}provider=${encodeURIComponent(provider)}`
    : `${ROUTE}/usage/breakdown${q ? `?${q}` : ""}`;
  const reply = await readJson<UsageBreakdownReply>(await fetch(url));
  breakdownCache.set(key, { at: Date.now(), reply });
  return reply;
};
/** The six columns /skill-doctor prints, in order. A parse that does not find all six on one line
 *  returns null and the caller keeps showing the raw report, so a CLI table change degrades to the
 *  text we already show rather than to garbage. */
export const SKILL_COST_HEADERS = ["skill", "source", "context", "7d tokens", "uses", "last used"];

export interface SkillCostRow {
  skill: string;
  source: string;
  context: string;
  tokens: string;
  uses: string;
  lastUsed: string;
}

/** Parse the /skill-doctor report into one row per skill, or null when its header row is not the
 *  six known columns. Rows are the indented lines under the header, and the first blank line ends
 *  the table: the legend below it is indented two spaces as well, so indentation alone cannot tell
 *  a row from legend prose. Measured on a live 184-line report, 2.1.278, 2026-09-20: rows are lines
 *  4 to 176, line 177 is blank, lines 178 to 180 are the indented legend, 181 is blank, 182 to 184
 *  are the flush-left summary. Column bounds come from the header's own token positions, and the
 *  CLI pads that header to the widest cell, so a long skill name shifts the header with it. */
export function parseSkillCosts(text: string): SkillCostRow[] | null {
  const lines = text.split("\n");
  const hi = lines.findIndex((l) => SKILL_COST_HEADERS.every((h) => l.includes(h)));
  if (hi === -1) return null;
  const header = lines[hi];
  if (typeof header !== "string") return null;
  const starts = SKILL_COST_HEADERS.map((h) => header.indexOf(h));
  if (starts.some((s) => s === -1)) return null;
  // Columns must start in order; a start at or before the previous one means the header no longer
  // names all six columns in order, so the parse keeps the raw report instead of slicing garbage.
  let prev = -1;
  for (const s of starts) {
    if (s <= prev) return null;
    prev = s;
  }
  const rows: SkillCostRow[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const l = lines[i];
    if (typeof l !== "string") break;
    if (l.trim() === "") break; // the first blank line after the header ends the table
    if (!l.startsWith("  ")) break; // the summary is flush-left
    const cell = (n: number): string => {
      const end = n + 1 < starts.length ? starts[n + 1] : undefined;
      return l.slice(starts[n], end).trim();
    };
    if (cell(0) === "") continue;
    rows.push({
      skill: cell(0),
      source: cell(1),
      context: cell(2),
      tokens: cell(3),
      uses: cell(4),
      lastUsed: cell(5),
    });
  }
  return rows;
}

/** The numeric size of one cost cell, for sorting. Anything the CLI has not shown reads as 0, which
 *  is a wrong order and never a wrong value; the raw report stays one fold away. */
function magnitude(cell: string): number {
  const v = cell.trim();
  if (v === "" || v === "-") return 0;
  if (v === "never") return Number.POSITIVE_INFINITY;
  if (v === "today") return 0;
  const days = /^(\d+) days?$/.exec(v);
  if (days !== null) return Number(days[1]);
  const uses = /^([\d.]+)×$/.exec(v);
  if (uses !== null) return Number(uses[1]);
  const num = /^[~<\s]*([\d.]+)([km]?)$/.exec(v);
  if (num === null) return 0;
  const base = Number(num[1]);
  return num[2] === "k" ? base * 1e3 : num[2] === "m" ? base * 1e6 : base;
}

/** Order rows for the cost table. Text cells sort by the magnitude they name, so 188.5m beats
 *  54.3m, which a string sort gets backwards. */
export function sortSkillCosts(
  rows: SkillCostRow[],
  col: "skill" | "source" | "context" | "tokens" | "uses" | "lastUsed",
  dir: "asc" | "desc",
): SkillCostRow[] {
  const key = (r: SkillCostRow): string =>
    col === "skill"
      ? r.skill
      : col === "source"
        ? r.source
        : col === "context"
          ? r.context
          : col === "tokens"
            ? r.tokens
            : col === "uses"
              ? r.uses
              : r.lastUsed;
  const sign = dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    if (col === "skill") return sign * a.skill.localeCompare(b.skill);
    if (col === "source") return sign * a.source.localeCompare(b.source);
    // Two `never` cells are both +Infinity and their difference is NaN, which is not a comparator
    // answer any sort is required to honour. Read equal magnitudes as a tie and let the sort's own
    // stability keep the report's order.
    const gap = magnitude(key(a)) - magnitude(key(b));
    return Number.isNaN(gap) ? 0 : sign * gap;
  });
}
