// Readers and renderers for the plan usage and context breakdowns. The entry keeps one
// import line for what it still uses; the helpers it calls through stay at their owners.
import { t, onLocaleSwitch, type OmcKey } from "./i18n.js";
import {
  ROUTE,
  readJson,
  T,
  ACCENT,
  SHIMMER,
  activeClaudeSession,
  activeClaudeProvider,
  whenContextGone,
  isRingRoot,
  maskEmail,
  type ClientCtx,
} from "./shared.js";
import { type LimitLevel, worstLimit } from "./limits.js";
import { paceOf, WINDOW_MS } from "./pace.js";
import { sparkNode } from "./spark.js";
import { HINTS_EVENT, loadHints } from "./hints.js";
import { onBodyMutation, changedElements } from "./dom.js";
/** The model a session has picked in dsh's selector, or undefined when dsh has not bound the
 *  session yet (its model directory throws until then). */
export const sessionModelOf = (ctx: ClientCtx, sessionId: string): string | undefined => {
  try {
    return ctx.modelDirectories.directoryFor(sessionId).store.getSnapshot().current?.model;
  } catch {
    return undefined;
  }
};

export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  severity?: string;
  model?: string;
  kind?: "session" | "weekly";
}
export interface UsageCredits {
  enabled: boolean;
  capped: boolean;
  used?: string;
  limit?: string;
  canPurchase: boolean;
  note?: string;
}
export type UsageReply =
  | {
      ok: true;
      fetchedAt: number;
      windows: UsageWindow[];
      credits?: UsageCredits;
      host?: string;
      email?: string | null;
    }
  | { ok: false; error: string; windows?: undefined; host?: string; email?: string | null };
/** "m*****@example.com on <host>" or whichever half is known; the usage is this box's login. */
export const whose = (r: UsageReply): string => {
  const email = r.email ? maskEmail(r.email) : "";
  const host = r.host ?? "";
  if (email && host) return t("main.usage.whoOn", { email, host });
  return email || host;
};

/** A clock time, with the weekday once it is a day or more away: a weekly window at twice its
 *  pace caps two days out, and a bare "8:40 PM" read as tonight (seen 2026-10-22). */
const capClock = (at: number): string => {
  const format: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (at - Date.now() >= 86_400_000) format.weekday = "short";
  return new Date(at).toLocaleString(undefined, format);
};
/** "in 2 h 10 min" inside a day, else weekday and time. */
export const resetText = (at: number | null): string => {
  if (at === null) return "";
  const ms = at - Date.now();
  if (ms <= 0) return t("main.usage.resetsNow");
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return h ? t("main.usage.resetsInH", { h, m }) : t("main.usage.resetsInM", { m });
  }
  return t("main.usage.resetsAt", {
    when: new Date(at).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
  });
};

// Per provider: two plugin instances are two accounts, so two answers.
export const usageCache = new Map<string, { at: number; reply: UsageReply }>();
/** Fetches a provider's usage, cached 60 s, so a repeat call returns the cached value. */
export const loadUsage = async (provider?: string): Promise<UsageReply> => {
  const key = provider ?? "";
  const hit = usageCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.reply;
  const url = provider
    ? `${ROUTE}/usage?force=1&provider=${encodeURIComponent(provider)}`
    : `${ROUTE}/usage?force=1`;
  const reply = await readJson<UsageReply>(await fetch(url));
  usageCache.set(key, { at: Date.now(), reply });
  return reply;
};

export type ContextReply =
  | {
      ok: true;
      categories: Array<{
        name: string;
        tokens: number;
        deferred: boolean;
        kind?: "used" | "free" | "buffer" | "deferred";
      }>;
      totalTokens: number;
      maxTokens: number;
      percentage: number;
      model?: string;
      assumedBehind?: string;
      followsNext?: true;
    }
  | { ok: false; error: string };
// The breakdown is re-read whenever dsh re-renders the meter's dialog, which is on every repaint of
// the percentage while a turn runs. The promise is cached, not its answer, so the frames that arrive
// before the first one lands share it instead of each opening a request of their own.
export const contextCache = new Map<string, { at: number; reply: Promise<ContextReply> }>();
/** Fetches a session's context breakdown, cached 10 s, returning an error when the fetch fails. */
export const loadContext = (sessionId: string): Promise<ContextReply> => {
  const hit = contextCache.get(sessionId);
  if (hit && Date.now() - hit.at < 10_000) return hit.reply;
  const reply = (async (): Promise<ContextReply> => {
    try {
      const r = await fetch(`${ROUTE}/context?session=${encodeURIComponent(sessionId)}`);
      // SAFETY: the body is our own JSON route; both shapes carry `ok`
      return (await r.json()) as ContextReply;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  contextCache.set(sessionId, { at: Date.now(), reply });
  return reply;
};
/** Formats a token count the way the CLI does: `1.2M`, `12.3k` or plain. */
export const kTokens = (n: number) =>
  n >= 1_000_000
    ? `${Number((n / 1_000_000).toFixed(1))}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : String(n);
/**
 * Rows worth a line: the ones whose tokens are the conversation. The CLI's `kind` is the authority.
 * It says so in the field's own description, "classify on this, never on the English name". And
 * it is what keeps the free space and the compaction buffer out, neither of which is content and
 * neither of which is counted in `totalTokens` either. The name test is the fallback for a CLI too
 * old to send `kind`; it misses the buffer rows, which is what this whole readout used to do.
 */
export const isUsedRow = (c: { name: string; deferred: boolean; kind?: string }): boolean =>
  c.kind !== undefined
    ? c.kind === "used"
    : !c.deferred && c.name !== "Free space" && !/buffer$/i.test(c.name);
/**
 * A colour per breakdown row, by position. dsh's own meter paints three bands and names them in a
 * legend; this keeps that shape over the CLI's categories, which are more numerous and vary with
 * what a session loaded. Position rather than name because the names are the CLI's to change, and a
 * swatch that drifts one hue is a smaller wrong than a classification that reads the name and is
 * believed, the same reason `isUsedRow` asks `kind` instead. The order opens on the neutral grey,
 * purple and blue dsh itself uses, so the block still reads as part of its meter.
 */
const SEGMENT_COLORS = [
  "#8b8f98",
  "#a855f7",
  "#3b82f6",
  "#14b8a6",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#6366f1",
];

/** The CLI's context category names, which it sends in English only. A name not listed here (one a
 *  newer CLI adds) shows as sent rather than disappearing. */
const CATEGORY_KEYS = new Map<string, OmcKey>([
  ["System prompt", "main.usage.catSystemPrompt"],
  ["System tools", "main.usage.catSystemTools"],
  ["MCP tools", "main.usage.catMcpTools"],
  ["Custom agents", "main.usage.catCustomAgents"],
  ["Memory files", "main.usage.catMemoryFiles"],
  ["Skills", "main.usage.catSkills"],
  ["Messages", "main.usage.catMessages"],
]);
/** A context category's name in the reader's language, or the CLI's own name when it is new. */
const categoryName = (cliName: string): string => {
  const key = CATEGORY_KEYS.get(cliName);
  return key ? t(key) : cliName;
};

/** The meter's own readout, over the CLI's categories: a filled bar and one legend row each. */
function renderContext(el: HTMLElement, reply: ContextReply) {
  el.replaceChildren();
  if (!reply.ok) {
    el.textContent = t("main.usage.contextBreakdownErr", { error: reply.error });
    return;
  }
  const rows = reply.categories.filter((c) => c.tokens > 0 && isUsedRow(c));
  const head = document.createElement("div");
  head.style.cssText = `display:flex;justify-content:space-between;gap:12px;color:${T.text}`;
  const headLabel = document.createElement("span");
  headLabel.textContent = t("main.usage.contextUsed", { pct: Math.round(reply.percentage) });
  // The model whose window that percentage is against, so a session that switched models says so
  // rather than leaving the reader to assume the one they picked first.
  if (reply.model) {
    const on = document.createElement("span");
    on.style.color = T.faint;
    on.textContent = ` · ${reply.model}`;
    headLabel.append(on);
  }
  const headValue = document.createElement("span");
  headValue.style.cssText = `font-variant-numeric:tabular-nums;color:${T.faint};white-space:nowrap`;
  headValue.textContent = `${kTokens(reply.totalTokens)} / ${kTokens(reply.maxTokens)}`;
  head.append(headLabel, headValue);
  // The CLI's window is a guess here, and it says so: name the switch rather than show a second
  // figure the CLI does not act on.
  const note = reply.assumedBehind ? document.createElement("div") : null;
  if (note) {
    note.setAttribute("data-omc-context-assumed", "");
    note.setAttribute("role", "note");
    note.style.cssText = `font-size:12px;color:${T.faint};margin-top:4px`;
    note.textContent = reply.followsNext
      ? t("main.usage.assumedNow", { max: kTokens(reply.maxTokens) })
      : t("main.usage.assumedBehind", {
          max: kTokens(reply.maxTokens),
          host: reply.assumedBehind ?? "",
        });
  }
  // The bar spans the whole window, so the empty tail is the room left. Segments are sized against
  // `maxTokens` rather than against each other, which is what makes the filled part read as the
  // percentage above it.
  const bar = document.createElement("div");
  bar.style.cssText = `display:flex;gap:1px;height:6px;margin:6px 0;border-radius:3px;overflow:hidden;background:${T.border}`;
  bar.setAttribute("role", "img");
  bar.setAttribute(
    "aria-label",
    t("main.usage.contextBarLabel", {
      pct: Math.round(reply.percentage),
      rows: rows.map((c) => `${categoryName(c.name)} ${kTokens(c.tokens)}`).join(", "),
    }),
  );
  const legend = document.createElement("div");
  rows.forEach((c, i) => {
    const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
    const seg = document.createElement("div");
    // A row worth a fraction of a percent still earns a sliver, so the legend never names a colour
    // the bar does not show.
    seg.style.cssText = `flex:0 0 auto;width:${Math.max((c.tokens / Math.max(reply.maxTokens, 1)) * 100, 0.4)}%;background:${color}`;
    bar.append(seg);
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px";
    const label = document.createElement("span");
    label.style.cssText = "display:flex;align-items:center;gap:6px;min-width:0";
    const dot = document.createElement("span");
    dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:2px;background:${color}`;
    const rowName = document.createElement("span");
    rowName.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    rowName.textContent = categoryName(c.name);
    label.append(dot, rowName);
    const val = document.createElement("span");
    val.style.cssText = "font-variant-numeric:tabular-nums;white-space:nowrap";
    val.textContent = kTokens(c.tokens);
    line.append(label, val);
    legend.append(line);
  });
  el.append(head, ...(note ? [note] : []), bar, legend);
}

/** Builds a link that opens in a new tab (noreferrer noopener) styled in the brand colour. */
const extLink = (text: string, href: string): HTMLAnchorElement => {
  const a = document.createElement("a");
  a.textContent = text;
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.color = T.brand;
  return a;
};

/** The disclaimer is Claude's markdown, at most one `[text](url)`: the link becomes an anchor and
 *  the rest stays text. A href the payload writes is followed only when it is an https URL. */
const appendNote = (el: HTMLElement, note: string) => {
  const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(note);
  const [whole, text, href] = m ?? [];
  if (!m || !whole || !text || !href) {
    el.append(note);
    return;
  }
  el.append(note.slice(0, m.index));
  el.append(href.startsWith("https://") ? extLink(text, href) : text);
  el.append(note.slice(m.index + whole.length));
};

/** Anthropic's credits sentence in the reader's language when it is the wording this was written
 *  against. Other wording shows as the API sent it: a guessed translation of new text would be the
 *  plugin's account of credits, not Anthropic's. The link inside keeps its address either way. */
const creditsNote = (note: string): string =>
  note
    .replace("Usage credits cover you when you hit your plan limits.", t("main.usage.creditsNote"))
    .replace("[Learn more](", `[${t("main.usage.learnMore")}](`);

/**
 * Credits sit under the plan windows in the same grammar, but with no bar and no reset: they are a
 * balance, not a window, and a percent here would imply a clock they do not have. The caption is
 * the API's own sentence about them, so the panel never invents its own account of what they cover.
 */
function creditsRow(c: UsageCredits): HTMLElement {
  const creditsLine = document.createElement("div");
  creditsLine.style.cssText =
    "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
  const label = document.createElement("span");
  label.textContent = t("main.usage.extraUsage");
  label.style.cssText = `color:${T.text};font-weight:500`;
  const capped = c.enabled && c.capped;
  const amount = c.used ? ` · ${c.used}${c.limit ? ` / ${c.limit}` : ""}` : "";
  const value = document.createElement("span");
  value.textContent = `${capped ? t("main.usage.limitReached") : c.enabled ? t("main.usage.on") : t("main.usage.off")}${amount}`;
  value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${capped ? T.err : T.text}`;
  creditsLine.append(label, value);
  // No caption at all when the API neither explains credits nor lets this account buy them.
  if (c.note || c.canPurchase) {
    const caption = document.createElement("span");
    caption.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    if (c.note) appendNote(caption, creditsNote(c.note));
    if (c.canPurchase) {
      if (c.note) caption.append(" ");
      caption.append(extLink(t("main.usage.buyCredits"), "https://claude.ai/settings/usage"));
    }
    creditsLine.append(caption);
  }
  return creditsLine;
}

/** A window's name in the reader's language: the plugin's word for the two plan windows and a
 *  model's weekly one, and the API's own kind name for a window this code has not met. */
export const windowLabel = (w: UsageWindow): string =>
  w.kind === "session"
    ? t("main.usage.window5h")
    : w.kind === "weekly"
      ? t("main.usage.windowWeekly")
      : w.model
        ? t("main.usage.windowModelWeekly", { model: w.model })
        : w.label;

/** Fill a block with the usage rows, styled like the meter's own legend rows, or with the error
 *  text when the reply is not ok. */
function renderUsage(block: HTMLElement, reply: UsageReply) {
  block.replaceChildren();
  if (!reply.ok) {
    const p = document.createElement("div");
    p.textContent = t("main.usage.usageErr", { error: reply.error });
    p.style.color = T.faint;
    block.append(p);
    return;
  }
  for (const w of reply.windows) {
    // Label and reset on the left, percent on the right, a thin bar under both: the same shape
    // dsh draws for the context meter below, so the two sections read as one panel.
    const pct = Math.max(0, Math.min(100, w.usedPercent));
    const tone = pct >= 90 ? T.err : pct >= 70 ? T.warn : ACCENT;
    const usageRow = document.createElement("div");
    usageRow.style.cssText =
      "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
    const label = document.createElement("span");
    label.textContent = windowLabel(w);
    label.style.cssText = `color:${T.text};font-weight:500`;
    const value = document.createElement("span");
    value.textContent = `${Math.round(pct)}%`;
    value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${tone}`;
    const bar = document.createElement("div");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute(
      "aria-label",
      t("main.usage.barLabel", { label: windowLabel(w), pct: Math.round(pct) }),
    );
    bar.style.cssText = `grid-column:1 / -1;height:4px;border-radius:2px;background:${T.border};overflow:hidden`;
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${pct}%;border-radius:2px;background:linear-gradient(90deg,${tone},${pct >= 70 ? tone : SHIMMER})`;
    bar.append(fill);
    const when = document.createElement("span");
    when.textContent = resetText(w.resetsAt);
    when.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    usageRow.append(label, value, bar, when);
    // At this rate: where the window ends up, or when the cap lands, from the share of the window
    // already gone. Only the two plan windows have a known length; a model-scoped or unmet kind
    // shows its reset alone.
    // A model-scoped window ("Fable weekly") is a weekly window too.
    const kind = w.kind ?? (w.model ? "weekly" : undefined);
    const pace = kind ? paceOf(pct, w.resetsAt, WINDOW_MS[kind]) : undefined;
    if (pace) {
      const paceLine = document.createElement("span");
      paceLine.setAttribute("data-omc-usage-pace", pace.kind);
      paceLine.textContent =
        pace.kind === "cap"
          ? t("main.usage.paceCap", { when: capClock(pace.at) })
          : t("main.usage.paceEnds", { percent: pace.percent });
      paceLine.style.cssText = `grid-column:1 / -1;color:${pace.kind === "cap" ? T.warn : T.faint};font-size:11px;line-height:16px`;
      usageRow.append(paceLine);
    }
    block.append(usageRow);
  }
  if (reply.windows.length === 0) {
    const p = document.createElement("div");
    p.textContent = t("main.usage.noLimits");
    p.style.color = T.faint;
    block.append(p);
  }
  // Last, whether or not any window was reported: a user with no limits still plans around credits.
  if (reply.credits) block.append(creditsRow(reply.credits));
}

/**
 * Put the plan usage inside dsh's context-meter popover, above the "N% of context used" line,
 * and one compact line into the ring's hover tooltip.
 * The meter (dsh-client-ui-conversation ContextMeter) has no slot, so this watches the DOM for
 * its dialog: a `[role=dialog]` whose parent holds a `button[aria-haspopup=dialog]` with the ring.
 * ponytail: DOM hook on a structural selector; swap for a slot the day the meter grows one.
 */

/**
 * Hide the meter's own context readout, leaving this plugin's block in its place.
 *
 * Selected structurally, every child of the host that is not ours, because dsh's class names are
 * generated and change under us on any upgrade, and there is nothing else in either host to keep:
 * the ring's popover and its hover bubble are both the context readout and nothing more. Re-applied
 * on each attach, since React rebuilds these children whenever it re-renders. Elements are hidden
 * rather than removed, so a dsh that later puts something else here is one line from being let back
 * through; a bare text node has no style to set, so it goes, and the next re-render restores it.
 *
 * The `hidden` attribute alone does not do it. It works through the user agent's `[hidden]{display:
 * none}`, which any class rule of dsh's outranks. Its own header carries `display:flex`, so the
 * row stayed on screen wearing `hidden=""`. The inline `!important` is what actually wins, and the
 * attribute stays for the accessibility tree.
 */
function hideNativeContext(host: HTMLElement, ours: HTMLElement) {
  for (const node of Array.from(host.childNodes)) {
    if (node === ours) continue;
    if (node instanceof HTMLElement) {
      node.hidden = true;
      node.style.setProperty("display", "none", "important");
    } else node.remove();
  }
}

/** Injects the plugin's usage block into a Claude row, re-hiding it when dsh puts its own back. */
export function watchContextMeter(ctx: ClientCtx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  // The mark goes on the node we inject, never on dsh's node: React owns these children and drops
  // ours whenever it re-renders the panel, and a mark on the host would say "done" forever while
  // the row it names is gone.
  // Our block, if this host already has one. A host that has it is done, except for the hiding,
  // which is about dsh's children rather than ours: React rebuilds those on every repaint of the
  // percentage, so a readout hidden a moment ago can be back beside a block that never left.
  const HID = "data-dsh-oh-my-claude-replaced";
  const ours = (host: HTMLElement) => host.querySelector<HTMLElement>(`:scope > [${MARK}]`);
  const rehide = (host: HTMLElement, block: HTMLElement) => {
    if (block.hasAttribute(HID)) hideNativeContext(host, block);
  };
  const attach = (panel: HTMLElement) => {
    const already = ours(panel);
    if (already) return rehide(panel, already);
    // Only sessions on a Claude mount: a local-model session's meter stays dsh's own.
    if (!activeClaudeSession(ctx)) return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
    block.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:10px;padding-bottom:8px;font-size:13px;line-height:20px`;
    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:6px;color:${T.text};font-weight:600`;
    const mark = sparkNode(13);
    const titleText = document.createElement("span");
    titleText.textContent = t("main.usage.title");
    title.append(mark, titleText);
    // Account and box on their own caption line: the email plus host wrapped the title before.
    // Flush left, not indented under the spark: it names the whole section, not the title's icon.
    const caption = document.createElement("div");
    caption.style.cssText = `color:${T.faint};font-size:11px;line-height:16px;margin:-2px 0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    const rows = document.createElement("div");
    rows.textContent = t("loading");
    rows.style.color = T.faint;
    // Below the plan bars: the CLI's own context breakdown for this session (item 30), one row
    // per category that holds tokens, deferred tool schemas folded out since they are not in context.
    const breakdown = document.createElement("div");
    breakdown.style.cssText = `margin-top:6px;padding-top:6px;border-top:1px solid ${T.border};color:${T.faint};font-size:12px;line-height:18px`;
    breakdown.textContent = t("main.usage.contextBreakdownLoading");
    // Between the plan bars and the context breakdown: what drives the plan limits (this pass).
    block.append(title, caption, rows, breakdown);
    panel.prepend(block);
    const sid = activeClaudeSession(ctx);
    const provider = activeClaudeProvider(ctx);
    if (sid)
      loadContext(sid).then((reply) => {
        renderContext(breakdown, reply);
        // dsh's own readout of the same window sits below this block and measures a different
        // thing: its count of the session surface it holds, which has never seen the system prompt,
        // the tool schemas or the files the CLI read, and keeps counting turns the CLI compacted
        // away. Two bars disagreeing by tens of thousands of tokens is worse than one, so the
        // CLI's own answer replaces it, and only when there is an answer, so a session with no
        // live process still gets dsh's estimate rather than nothing.
        if (!reply.ok) return;
        block.setAttribute(HID, "1");
        hideNativeContext(panel, block);
        // The rule under this block divided it from dsh's readout. With that readout gone it is the
        // last thing in the dialog, and a rule under the last thing is a line to nowhere.
        block.style.borderBottom = "none";
        block.style.paddingBottom = "0";
        block.style.marginBottom = "0";
      });
    loadUsage(provider).then(
      (reply) => {
        const who = whose(reply);
        if (who) {
          caption.textContent = who;
          caption.title = who;
        } else caption.remove();
        renderUsage(rows, reply);
      },
      (e: Error) => renderUsage(rows, { ok: false, error: e.message }),
    );
  };
  // The hover tooltip can sit between the button and the dialog at insertion time, so the
  // dialog is matched through its parent rather than as the button's next sibling.
  // The hover bubble (`role=tooltip`, a sibling of the ring button) gets one compact line on top.
  const bubble = (tip: HTMLElement) => {
    const already = ours(tip);
    if (already) return rehide(tip, already);
    if (!activeClaudeSession(ctx)) return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
    // Bounded, and allowed to wrap. The line this fills reads "Claude 5-hour 13% · weekly 68% ·
    // weekly (fable) 100% (hostname)", around 430 px of text, and dsh sizes the bubble to its
    // content: on a phone that pushed the whole tooltip past the edge of the screen. The cap is
    // ours alone, on the block this plugin prepends, so dsh's own tooltip content is untouched.
    block.style.cssText = "max-width:min(80vw,420px);white-space:normal;overflow-wrap:anywhere";
    const line = document.createElement("div");
    // The mark is a drawing, not a letter, so the row centres on it rather than sitting it on a
    // baseline it does not have. `flex-start` because a wrapped line is taller than the mark.
    line.style.cssText = "display:flex;gap:6px;align-items:flex-start";
    const mark = sparkNode(12, SHIMMER);
    mark.style.flex = "0 0 auto";
    const text = document.createElement("span");
    text.textContent = t("main.usage.titleLoading");
    line.append(mark, text);
    // The context sentence dsh's bubble carries, over the CLI's own count rather than dsh's, for
    // the same reason the dialog's breakdown replaces its readout: the two measure different
    // things and the CLI's is the one auto-compact fires on.
    const ctxLine = document.createElement("div");
    ctxLine.style.cssText = `color:${T.faint};margin-left:18px`;
    block.append(line, ctxLine);
    tip.prepend(block);
    loadUsage(activeClaudeProvider(ctx)).then(
      (reply) => {
        const who = reply.host ? ` (${reply.host})` : "";
        if (!reply.ok) {
          text.textContent = t("main.usage.usageErr", { error: reply.error });
          return;
        }
        const windows = reply.windows
          .map((w) => `${windowLabel(w).toLowerCase()} ${Math.round(w.usedPercent)}%`)
          .join(" · ");
        text.textContent = windows
          ? t("main.usage.bubbleWindows", { windows, who })
          : t("main.usage.bubbleNoLimits", { who });
      },
      (e: Error) => {
        text.textContent = t("main.usage.usageErr", { error: e.message });
      },
    );
    const sid = activeClaudeSession(ctx);
    if (sid)
      loadContext(sid).then((reply) => {
        if (!reply.ok) {
          ctxLine.remove();
          return;
        }
        ctxLine.textContent = t("main.usage.contextUsedTokens", {
          pct: Math.round(reply.percentage),
          used: kTokens(reply.totalTokens),
          max: kTokens(reply.maxTokens),
        });
        block.setAttribute(HID, "1");
        hideNativeContext(tip, block);
      });
  };
  // The ring's filled arc, its geometry, the occupancy last read for it, and when that was asked for.
  const ARC = ':scope > button[aria-haspopup="dialog"] circle + circle';
  let arc: SVGCircleElement | undefined;
  let arcLength = 0;
  let ringSession: string | undefined;
  let ringPercent: number | undefined;
  let ringAsked = 0;
  // The plan limit the ring is tinted for, and when usage and the switches were last read for it.
  let ringLevel: LimitLevel | undefined;
  let ringLimitAsked = 0;
  let ringModel: string | undefined;
  // Flipping a warning switch rereads at the next paint rather than a minute later.
  window.addEventListener(HINTS_EVENT, () => {
    ringLimitAsked = 0;
  });
  /**
   * Fill the ring from the CLI's own occupancy.
   *
   * dsh draws the arc from `contextPressure`, which is the prompt side of the last usage sample,
   * input plus both cache counters, over the window, plus whatever its own surface grew by since.
   * The server reports a step's last API call as that sample (see `stepUsage` in the translator),
   * so dsh's figure is close; until 2026-09-29 it summed every call and pinned the arc at 100% on a
   * session a third full. The CLI's own count is still the better one: it is what auto-compact
   * fires on, and it is what this plugin's popover and bubble show, so the arc is rewritten with it
   * whenever the session's process answers. When it does not (no live process, such as after a
   * dsh-web restart until the next turn), dsh's figure stands.
   *
   * The circle is found the same structural way `isRingRoot` finds it, and its radius is read from
   * the element rather than assumed, so a ring dsh redraws at another size still gets a correct arc.
   *
   * This runs once per mutation burst, so past the first paint it is two string compares and no DOM
   * query: the circle and its circumference are held from the scan that found them, and a ring that
   * went away is an element that is no longer connected.
   */
  const paintRing = () => {
    if (arc?.isConnected !== true) return;
    const sid = activeClaudeSession(ctx);
    if (sid === undefined) return;
    if (sid !== ringSession) {
      ringSession = sid;
      ringPercent = undefined;
      ringAsked = 0;
      ringLevel = undefined;
      ringLimitAsked = 0;
    }
    // A reached or near plan limit tints the arc, on a slower clock than the fill: usage is cached
    // for a minute by the route. A model switch rereads at once from that cache, since it changes
    // which limits count; picking a model redraws dsh's picker, so a paint follows it.
    const model = sessionModelOf(ctx, sid);
    if (model !== ringModel) {
      ringModel = model;
      ringLimitAsked = 0;
    }
    if (Date.now() - ringLimitAsked > 60_000) {
      ringLimitAsked = Date.now();
      void Promise.all([loadHints(), loadUsage(activeClaudeProvider(ctx))]).then(
        ([hints, usage]) => {
          const off = hints.limitWarningsOff === true || hints.limitRingOff === true;
          ringLevel =
            off || !usage.ok
              ? undefined
              : worstLimit(usage.windows, sessionModelOf(ctx, sid))?.level;
          paintRing();
        },
      );
    }
    const stroke = ringLevel === "critical" ? T.err : ringLevel === "warning" ? T.warn : "";
    if (arc.style.stroke !== stroke) arc.style.stroke = stroke;
    // dsh repaints the arc by rewriting an attribute, which the body observer does not watch, and a
    // ring already pinned at 100% stops changing altogether, so neither dsh's repaints nor ours can
    // be the thing that keeps this current. It is re-asked on a clock instead, off the same
    // ten-second cache the popover reads.
    if (Date.now() - ringAsked > 5_000) {
      ringAsked = Date.now();
      void loadContext(sid).then((reply) => {
        if (!reply.ok) return;
        ringPercent = Math.min(100, Math.max(0, reply.percentage));
        paintRing();
      });
    }
    if (ringPercent === undefined) return;
    const dash = `${(arcLength * ringPercent) / 100} ${arcLength}`;
    if (arc.getAttribute("stroke-dasharray") !== dash) arc.setAttribute("stroke-dasharray", dash);
    // The button's label is the same reading spoken aloud, so it moves with the arc.
    const label = t("main.ring.used", { pct: Math.round(ringPercent) });
    const button = arc.closest("button");
    if (button?.getAttribute("aria-label") !== label) button?.setAttribute("aria-label", label);
    // dsh also writes its own number as text inside the button, from the same pressure figure
    // that pins the arc at 100%. On a phone that text sits beside the ring, so it read 100% next
    // to an arc at 58% (owner, 2026-09-18). Same rewrite; a span whose text is not a bare
    // percentage is not dsh's number and is left alone.
    const pct = `${Math.round(ringPercent)}%`;
    for (const span of button?.querySelectorAll("span") ?? [])
      if (/^\d{1,3}%$/.test(span.textContent ?? "") && span.textContent !== pct)
        span.textContent = pct;
  };
  /**
   * The meter's open panel when dsh renders it away from the ring.
   *
   * Up to dsh 0.1.5 the panel was a sibling of the ring button, which is what `isRingRoot` tests.
   * 0.1.6-alpha.2 portals it to `<body>` instead, so that test can never match and the usage block
   * stopped appearing. The panel is claimed here by the ring's own button: it is open
   * (`aria-expanded`), and dsh labels the panel with the same phrase as the button minus the
   * percentage, so the button's label contains the panel's. That pair travels with dsh's
   * translations, unlike the generated class names on either node.
   *
   * The sibling path above stays until 0.1.5 is no longer supported; dropping that support means
   * deleting the two `isRingRoot` dialog lines and this call's companion comment, not this one.
   */
  const portalPanel = (): HTMLElement | null => {
    const trigger = arc?.closest("button");
    if (!trigger || trigger.getAttribute("aria-expanded") !== "true") return null;
    const label = trigger.getAttribute("aria-label");
    if (!label) return null;
    for (const panel of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
      if (panel.contains(trigger)) continue; // the ring sits inside no panel of its own
      const own = panel.getAttribute("aria-label");
      if (own && own !== label && label.includes(own)) return panel;
    }
    return null;
  };
  const scan = (root: ParentNode) => {
    // Looked for only until it is found. The ring outlives every burst that follows, and this query
    // would otherwise run over each of them for an element already in hand.
    if (arc?.isConnected !== true) {
      arc = undefined;
      for (const el of root.querySelectorAll<HTMLElement>('button[aria-haspopup="dialog"]')) {
        const host = el.parentElement;
        const found = host && isRingRoot(host) ? host.querySelector<SVGCircleElement>(ARC) : null;
        const radius = Number(found?.getAttribute("r"));
        if (!found || !Number.isFinite(radius) || radius <= 0) continue;
        arc = found;
        arcLength = 2 * Math.PI * radius;
        break;
      }
    }
    for (const el of root.querySelectorAll<HTMLElement>('[role="dialog"]'))
      if (isRingRoot(el.parentElement)) attach(el);
    for (const el of root.querySelectorAll<HTMLElement>('[role="tooltip"]'))
      if (isRingRoot(el.parentElement)) bubble(el);
    // A re-render adds nodes inside the dialog, not the dialog itself, so climb to it as well.
    if (root instanceof Element) {
      const dialog = root.closest<HTMLElement>('[role="dialog"]');
      if (dialog && isRingRoot(dialog.parentElement)) attach(dialog);
      const tip = root.closest<HTMLElement>('[role="tooltip"]');
      if (tip && isRingRoot(tip.parentElement)) bubble(tip);
    }
    const portal = portalPanel();
    if (portal) attach(portal);
  };
  // Scoped to the burst: the ring's dialog and tooltip are rare nodes, and the body-wide pair of
  // attribute queries this used to run every dirty frame cost 0.4 ms on a 30k-node conversation,
  // paid on every frame of every streaming turn to find, almost always, nothing.
  // The per-frame scan: re-check changed elements and repaint the ring.
  onBodyMutation((records) => {
    if (records === undefined) scan(document.body);
    else for (const node of changedElements(records)) scan(node);
    paintRing();
  });
  scan(document.body);
  paintRing();
  // The usage block and the ring's tooltip line are built by hand, so a language switch does not
  // reach them. Drop them and scan again: an open panel gets a fresh block in the new language at
  // once, and the ring's label follows on the next repaint.
  whenContextGone(
    onLocaleSwitch(() => {
      for (const el of document.querySelectorAll(`[${MARK}]`)) el.remove();
      scan(document.body);
      paintRing();
    }),
  );
}
