import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";

export const ROUTE = "/dsh-oh-my-claude";
/** "m*****@gmail.com": first letter, stars, then the domain. Every surface that shows the login
 *  masks it — the panel and the diagnostics rows get screen-shared. */
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

export const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};

/** The CLI's keyword matcher (`SOt`) for a composer keyword such as `ultracode`: no match when the
 *  text is a slash command, inside quotes, backticks, brackets or a tag, glued to a path or flag
 *  character, or followed by a dotted member. A keyword typed as an example is not a trigger, so
 *  it is not painted. */
const KEYWORD_PAIRS = new Map<string, string>([
  ["`", "`"],
  ['"', '"'],
  ["<", ">"],
  ["{", "}"],
  ["[", "]"],
  ["(", ")"],
  ["'", "'"],
]);
const wordy = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
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

/** Claude's brand orange and its shimmer stop (the CLI theme table): the one accent this plugin adds. */
export const CLAUDE_ORANGE = "#D97757";
export const CLAUDE_SHIMMER = "#F59575";
/** Claude's own spinner glyph, used as the mark beside anything Claude-owned in dsh's chrome. */
export const CLAUDE_MARK = "✻";

export const h3: CSSProperties = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
export const meta: CSSProperties = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
/** One voice for a failure inside a tab: small, the error colour, wrapping, never a raw red line. */
export const errText: CSSProperties = {
  color: T.err,
  fontSize: 12,
  padding: "2px 4px",
  whiteSpace: "normal",
  wordBreak: "break-word",
};
/** One voice for "Loading…" and empty states: the meta colour, the same inset as a row. */
export const stateText: CSSProperties = { ...meta, padding: "2px 4px", whiteSpace: "normal" };

/**
 * The panel's own surface: dsh's layer colour warmed with a few percent of Claude's orange, so the
 * panel reads as Claude's and stands off the dark chrome instead of vanishing into it. The edge
 * carries more of the hue than the fill (a tint the eye reads as a border, not as a coloured box)
 * and the shadow gains a faint warm ring so the float reads on both themes. `color-mix` keeps every
 * value derived from the theme token rather than a picked hex, so light and dark both hold.
 */
export const PANEL_ATTR = "data-omc-panel";
export const DOCK_ATTR = "data-omc-dock";
export const panelSurface: CSSProperties = {
  background: `color-mix(in srgb, ${CLAUDE_ORANGE} 7%, ${T.card})`,
  border: `1px solid color-mix(in srgb, ${CLAUDE_ORANGE} 34%, ${T.border})`,
  boxShadow: `0 10px 28px rgba(0,0,0,.26), 0 0 0 1px color-mix(in srgb, ${CLAUDE_ORANGE} 10%, transparent)`,
};
/** A tab in the strip under the body: text only, the accent as a 2px rule on the open one. */
export const tabStyle = (selected: boolean): CSSProperties => ({
  padding: "6px 10px 5px",
  cursor: "pointer",
  border: "none",
  borderBottom: `2px solid ${selected ? CLAUDE_ORANGE : "transparent"}`,
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
    `${scope} {`,
    `  --omc-accent: ${CLAUDE_ORANGE};`,
    `  --omc-wash: color-mix(in srgb, var(--omc-accent) 10%, transparent);`,
    `  --omc-wash-strong: color-mix(in srgb, var(--omc-accent) 18%, transparent);`,
    `  --omc-edge: color-mix(in srgb, var(--omc-accent) 45%, ${T.border});`,
    `  --omc-ring: color-mix(in srgb, var(--omc-accent) 70%, transparent);`,
    `}`,
    `${inScope(controls)} { transition: background-color .15s ease, background-image .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, opacity .15s ease; }`,
    // The wash is a background-image so it lays over any fill: transparent ghost, brand primary,
    // the field colour. One rule, every button.
    `${inScope("button:not(:disabled):hover")} { background-image: linear-gradient(var(--omc-wash), var(--omc-wash)) !important; border-color: var(--omc-edge) !important; }`,
    `${inScope("button:not(:disabled):active")} { background-image: linear-gradient(var(--omc-wash-strong), var(--omc-wash-strong)) !important; }`,
    `${inScope("button:disabled")} { opacity: .5 !important; cursor: not-allowed !important; }`,
    `${inScope(":is(select, input, textarea):not(:disabled):hover")} { border-color: var(--omc-edge) !important; }`,
    `${inScope('[role="tab"]:not([aria-selected="true"]):hover')} { background-image: linear-gradient(var(--omc-wash), var(--omc-wash)) !important; color: ${T.text} !important; }`,
    `${inScope("summary")} { cursor: pointer; border-radius: 6px; }`,
    `${inScope("summary::marker")} { color: var(--omc-accent); }`,
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
    `button[aria-label="Oh My Claude"]:focus-visible { outline: 2px solid color-mix(in srgb, ${CLAUDE_ORANGE} 70%, transparent); outline-offset: 2px; }`,
    `@media (prefers-reduced-motion: reduce) { ${inScope(controls)} { transition: none; } }`,
  ].join("\n");
  if (!existing) document.head.appendChild(el);
}
export const row: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "9px 0",
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
    // no-op — the restored session would never come to the foreground — so wait briefly for it.
    for (let i = 0; i < 40 && !known()[id]; i++) await new Promise((r) => setTimeout(r, 50));
    // If it never appeared (server-side open/import error), `open` below is a no-op and the row just
    // does nothing; leave a breadcrumb so a stuck restore is diagnosable rather than silent.
    if (!known()[id])
      console.warn(`[oh-my-claude] session ${id} did not appear after open; not opened`);
  }
  ctx.sessions.open(id);
}
export { openHere };

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
 * the session's selection from the moment the session exists — the picker writes it, no turn is
 * needed — so a brand-new tab on a box's model already resolves to that box, which the spawn-time
 * `targetHost` cannot do. `SessionHeader` carries no provider and a remote cwd can equal a local
 * one, so this is also the only way to tell a box session from a local one.
 */
const claudeMount = (provider: string | undefined): string | undefined =>
  provider?.startsWith("claude-code") === true ? provider : undefined;
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
 * more loop joins the flood with each reload. The first such throw retires this bundle instead —
 * the reads answer undefined and the loops that registered here stop.
 */
let gone = false;
const goneWatchers = new Set<() => void>();
/** Run `fn` once the context this bundle holds is disposed; immediately if it already is. */
export const whenContextGone = (fn: () => void): void => {
  if (gone) fn();
  else goneWatchers.add(fn);
};
const retire = (): void => {
  gone = true;
  for (const fn of goneWatchers) fn();
  goneWatchers.clear();
};
/**
 * Wrap a loop body — an interval tick, a registered scan — so the first disposed-context throw
 * retires this bundle instead of reaching the console. Any read of any service throws once the
 * context is gone, so the catch belongs at the loop's edge rather than at each read: guarding one
 * read only moves the flood to the next line. A throw that is not the context dying is rethrown.
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
const openSessionId = (ctx: ClientCtx): string | undefined => {
  if (gone) return undefined;
  try {
    return ctx.sessions.list.getSnapshot()?.current;
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
/** The open Claude session's own provider id (e.g. `claude-code` or `claude-code-prod`), else undefined. */
export const activeClaudeProvider = (ctx: ClientCtx): string | undefined => {
  const id = openSessionId(ctx);
  return id ? claudeProviderOf(ctx, id) : undefined;
};

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
        current?: string;
      };
    };
    open: (id: string) => void;
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
    list: { getSnapshot: () => { items: Array<{ path: string; workspaceId: string }> } };
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
