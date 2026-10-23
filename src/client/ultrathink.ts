// The ultrathink painter: the CLI's rainbow over a person's own words in the composer and the
// sent messages, via the CSS Highlight API, plus the quote copy it lays out beside dsh's span.
import { quoteSpans, quotedLines, unquote, type QuoteSeg } from "./selection.js";
import {
  guard,
  whenContextGone,
  activeClaudeSession,
  keywordMatches,
  T,
  type ClientCtx,
} from "./shared.js";
import { gated, hasTheme } from "./theme.js";
import { pageIsDark, type Face } from "./dom.js";

/** The CLI's rainbow for the word `ultrathink` (2.1.268, `ZT` over the `rainbow_*` theme entries,
 *  the same seven values in all four themes): each character of the word takes the next colour,
 *  wrapping after violet. Only that one word, `\bultrathink\b` case-insensitive; `ultracode`,
 *  `ultraplan` and `ultrareview` are other features and draw nothing. It is painted in the
 *  composer as it is typed and in the sent message. */
export const RAINBOW: readonly string[] = [
  "rgb(235,95,87)",
  "rgb(245,139,87)",
  "rgb(250,195,95)",
  "rgb(145,200,130)",
  "rgb(130,170,220)",
  "rgb(155,130,200)",
  "rgb(200,130,180)",
];
/** The `rainbow_*_shimmer` entries: what a character shows while the composer's sweep is on it. */
export const RAINBOW_SHIMMER: readonly string[] = [
  "rgb(250,155,147)",
  "rgb(255,185,137)",
  "rgb(255,225,155)",
  "rgb(185,230,180)",
  "rgb(180,205,240)",
  "rgb(195,180,230)",
  "rgb(230,180,210)",
];
/** `ultracode` in the composer takes the CLI's `autoAccept` purple (dark rgb(175,135,255), light
 *  rgb(135,0,255)) with the one `autoAcceptShimmer` for both, under the same sweep. It opts the
 *  turn into the Workflow tool's multi-agent orchestration when workflows are on; the CLI's chat
 *  never colours it, only the composer does. The light value rides a custom property set on the
 *  root, since a highlight rule cannot read the page's theme itself. */
export const ULTRACODE_DARK = "rgb(175,135,255)";
export const ULTRACODE_LIGHT = "rgb(135,0,255)";
export const ULTRACODE_SHIMMER = "rgb(208,180,255)";
export const ULTRACODE_INDEX = RAINBOW.length;
/** The copy of a sent message the plugin lays out with quote blocks, beside dsh's plain span. */
export const QUOTE_COPY = "data-omc-quote-copy";
/** A run of quoted lines inside that copy, drawn with the bar dsh gives a reply's quote. */
export const QUOTE_BLOCK = "data-omc-quote-block";
/** On dsh's own span while its copy stands in for it; the sheet hides it. */
export const QUOTE_SOURCE = "data-omc-quote-source";
export const RAINBOW_CSS =
  RAINBOW.map((c, i) => `::highlight(omc-rainbow-${i}){color:${c}}`).join("") +
  RAINBOW_SHIMMER.map((c, i) => `::highlight(omc-rainbow-s${i}){color:${c}}`).join("") +
  `::highlight(omc-rainbow-${ULTRACODE_INDEX}){color:var(--omc-ultracode,${ULTRACODE_DARK})}` +
  `::highlight(omc-rainbow-s${ULTRACODE_INDEX}){color:${ULTRACODE_SHIMMER}}` +
  // Quoted lines in a person's own words, the way a Markdown quote reads: dimmed, the marker more so
  // in the composer. In a sent message the copy draws the quote block dsh gives a reply's quote
  // (a 2px bar, the accent at half strength, 14px to the text, measured on 2026-09-24).
  `::highlight(omc-quote){color:${T.muted}}::highlight(omc-quote-mark){color:${T.faint}}` +
  `[data-omc-quote-source]{display:none!important}[data-omc-quote-copy]{white-space:pre-wrap}` +
  `[data-omc-quote-copy]>[data-omc-quote-block]{border-left:2px solid ${T.border};padding-left:14px;color:${T.muted};margin:16px 0}` +
  `[data-omc-quote-copy]>[data-omc-quote-block]:first-child{margin-top:0}[data-omc-quote-copy]>[data-omc-quote-block]:last-child{margin-bottom:0}` +
  `${gated("prose", "[data-omc-quote-copy]>[data-omc-quote-block]", false)}{border-left-color:color-mix(in srgb,var(--omc-accent) 50.2%,transparent)}`;
export const ULTRATHINK = /\bultrathink\b/gi;
/** One character of a match: where it sits, which colour it takes, and its index in the
 *  composer's text (the sweep runs over those indices, as the CLI's does over its input string). */
export interface RainbowChar {
  node: Node;
  offset: number;
  colour: number;
  index: number;
}

/** Build a text range over the one character a rainbow match covers, so the highlight spans exactly
 *  that glyph. */
export const rangeOf = (c: RainbowChar): Range => {
  const r = document.createRange();
  r.setStart(c.node, c.offset);
  r.setEnd(c.node, c.offset + 1);
  return r;
};

/** A host's text nodes and the segments `quoteSpans` reads from them, index for index. */
export interface HostText {
  nodes: Node[];
  segs: QuoteSeg[];
}
/** The host's text as the quote scan reads it: each text node, marked where a paragraph or a
 *  `<br>` (the composer's line breaks) opens a new line without a newline character. */
export const segsIn = (host: Element): HostText => {
  const nodes: Node[] = [];
  const segs: QuoteSeg[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let block: Element | null = null;
  let broke = false;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node instanceof HTMLBRElement) broke = true;
    if (node.nodeType !== Node.TEXT_NODE) continue;
    // The plugin's own quote copy is not the person's text; dsh's span beside it is.
    if (node.parentElement?.closest(`[${QUOTE_COPY}]`)) continue;
    const own = node.parentElement?.closest("p, div, li") ?? null;
    segs.push({ text: node.textContent ?? "", newLine: broke || own !== block });
    nodes.push(node);
    block = own;
    broke = false;
  }
  return { nodes, segs };
};

/**
 * Paint `ultrathink` in the CLI's rainbow wherever a person wrote it: the composer and the sent
 * user messages. Done with the CSS Highlight API, ranges over the existing text nodes, so neither
 * dsh's chat (React) nor its composer (Lexical) sees a DOM change; wrapping characters in spans
 * would have been undone by the next render of either, or thrown when it reconciled a node that
 * had moved. Both hosts are found by their own data attributes.
 *
 * The composer also gets the CLI's shimmer (its text input's `glimmerIndex`): a window of three
 * characters, lit in the shimmer shades, that steps one character every 50ms from ten before the
 * first match to ten past the last and wraps. Sent messages never shimmer, as in the CLI.
 */
export function watchUltrathink(ctx: ClientCtx) {
  // A browser without the Highlight API paints nothing; every Chromium since 105 has it.
  if (!("highlights" in CSS) || !("Highlight" in globalThis)) return;
  const registry = CSS.highlights;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colours = RAINBOW.length + 1; // the seven, then ultracode's purple
  const names = Array.from({ length: colours }, (_, i) => `omc-rainbow-${i}`);
  const shimmerNames = Array.from({ length: colours }, (_, i) => `omc-rainbow-s${i}`);
  if (!pageIsDark()) document.documentElement.style.setProperty("--omc-ultracode", ULTRACODE_LIGHT);
  // A message sent mid-turn waits under `data-pending-steering` until the CLI takes it, and only
  // then becomes an input-message anchor; it is a person's words either way, so both are hosts.
  //
  // The anchor key is `${turn}:${kind}${id}`, so the turn number leads and the kind is reached
  // through the colon. Read off a live 0.1.6 page on 2026-09-15: 88 keys, among them
  // `13:input-message9176508b-ece4-4d04-9f5f-427b5de867bc`, `14:assistant-step1:1` and
  // `12:turn-process1`. Substring, not prefix, and the same on 0.1.5. A `^=` form was briefly added
  // here on the belief that 0.1.6 had moved the kind to the front; it matched nothing, because
  // `locationIdentity` in dsh-client-ui-chat builds a different string than this attribute carries.
  const HOSTS =
    '[data-composer-input], [data-pending-steering], [data-chat-anchor-key*=":input-message"]';
  const clear = () => {
    for (const key of [...names, ...shimmerNames]) registry.delete(key);
  };
  // Sent messages that carry a quote, each with the copy drawn for it, rebuilt only when the text
  // changes (every write is a mutation this scan is woken by). Keyed by the element holding the
  // message's parts: its text spans and any chips dsh drew for a `/command` or a file.
  const copies = new Map<HTMLElement, { text: string; copy: HTMLElement }>();
  /**
   * Lay a sent message out with its quotes as quote blocks, the way dsh renders a reply's: dsh draws
   * a person's message as plain-text spans with chips between them, which a highlight can colour
   * but cannot indent, so those parts are hidden and a copy sits in their place. The parts stay in
   * the page untouched; the copy is real text, so selecting and the selection bar read it as they
   * would dsh's. A chip is cloned onto its line, looking the same but not clickable: the click
   * belongs to dsh's own, hidden beside it.
   */
  const drawCopy = (box: HTMLElement, parts: ChildNode[], text: string, face: () => Face) => {
    const had = copies.get(box);
    if (had !== undefined && had.text === text && had.copy.isConnected) {
      // The marks can go without the text changing: a hot reload's outgoing bundle clearing its own
      // copy took them off this one's parts, and dsh's text showed under the copy. Put them back.
      for (const part of parts)
        if (part instanceof Element && !part.hasAttribute(QUOTE_SOURCE))
          part.setAttribute(QUOTE_SOURCE, "1");
      return;
    }
    had?.copy.remove();
    // The message as lines of pieces: text as fresh text nodes, a chip as its clone, in order.
    let line: Node[] = [];
    const lines = [line];
    for (const part of parts) {
      if (part instanceof HTMLSpanElement && part.childElementCount === 0) {
        (part.textContent ?? "").split("\n").forEach((piece, i) => {
          if (i > 0) {
            line = [];
            lines.push(line);
          }
          if (piece !== "") line.push(document.createTextNode(piece));
        });
      } else line.push(part.cloneNode(true));
    }
    const quoted = quotedLines(lines.map((l) => l.map((x) => x.textContent ?? "").join("")));
    const copy = document.createElement("div");
    copy.setAttribute(QUOTE_COPY, "1");
    // The spans' own type, read once per copy: the copy inherits the bubble's, not the span's. Not
    // the colour: a colour read here is frozen, and a switch to light mode left the text white on a
    // light bubble. The bubble's own colour is the span's, in either theme, so the copy inherits it.
    Object.assign(copy.style, face());
    // One row per line, an empty line holding its height with a `<br>`: a block ending in a line
    // break drops that last empty line.
    // A quote block carries its own 16px gap above and below, as a rendered quote does. The one
    // empty line that normally separates it from the text is that gap, so "text, quote" and "text,
    // blank line, quote" read the same; every empty line past that one shows, as it does in a plain
    // message, so extra returns still add space. Between two quotes the margins meet as one gap, and
    // one empty line goes to it the same way.
    const blank = (i: number) => (lines[i] ?? []).every((n) => (n.textContent ?? "").trim() === "");
    const gap = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (!blank(i) || quoted[i] === true) continue;
      let end = i;
      while (end + 1 < lines.length && blank(end + 1) && quoted[end + 1] !== true) end++;
      if (quoted[end + 1] === true) gap.add(end);
      else if (quoted[i - 1] === true) gap.add(i);
      i = end;
    }
    let block: HTMLElement | undefined;
    let blockQuoted = false;
    for (const [i, pieces] of lines.entries()) {
      const q = quoted[i] === true;
      // An empty line inside a quote stays; one at a quote's edge (a bare `>`) is the gap's too.
      if (gap.has(i)) continue;
      if (blank(i) && q && (quoted[i - 1] !== true || quoted[i + 1] !== true)) continue;
      if (block === undefined || q !== blockQuoted) {
        block = document.createElement("div");
        if (q) block.setAttribute(QUOTE_BLOCK, "1");
        copy.append(block);
        blockQuoted = q;
      }
      const lineEl = document.createElement("div");
      for (const [j, piece] of pieces.entries()) {
        if (q && j === 0 && piece instanceof Text) piece.data = unquote(piece.data);
        lineEl.append(piece);
      }
      if ((lineEl.textContent ?? "") === "" && lineEl.childElementCount === 0)
        lineEl.append(document.createElement("br"));
      block.append(lineEl);
    }
    for (const part of parts) if (part instanceof Element) part.setAttribute(QUOTE_SOURCE, "1");
    parts[0]?.before(copy);
    copies.set(box, { text, copy });
  };
  /** Remove this bundle's copy, and put dsh's parts back unless another copy still stands in for
   *  them: on a hot reload the incoming bundle may have drawn its own before this one is torn down. */
  const dropCopy = (box: HTMLElement) => {
    copies.get(box)?.copy.remove();
    copies.delete(box);
    if (box.querySelector(`:scope > [${QUOTE_COPY}]`) !== null) return;
    for (const part of box.querySelectorAll(`:scope > [${QUOTE_SOURCE}]`))
      part.removeAttribute(QUOTE_SOURCE);
  };
  /** Quotes read as quotes: dimmed with their `>` fainter still in the composer, where the person is
   *  typing, and laid out as quote blocks in a sent message (see `drawCopy`). Not part of the
   *  rainbow's look switch: it is how a quote reads, not the Claude colour. */
  const paintQuotes = () => {
    const text: Range[] = [];
    const mark: Range[] = [];
    const seen = new Set<HTMLElement>();
    // Every sent message shares one face: read it once per pass, before this pass writes a copy, so
    // a session opening on many quoted messages recalculates style once rather than once each.
    let shared: Face | undefined;
    const faceFrom = (span: Element) => (): Face => {
      if (shared === undefined) {
        const { fontSize, fontWeight, fontFamily, lineHeight } = getComputedStyle(span);
        shared = { fontSize, fontWeight, fontFamily, lineHeight };
      }
      return shared;
    };
    for (const host of document.querySelectorAll<HTMLElement>(HOSTS)) {
      const composer = host.hasAttribute("data-composer-input");
      // Every keystroke runs this pass over every sent message. One without a `>` has no quote and
      // no copy (a copy's hidden source still holds its `>`), so it costs one text read, not a walk.
      if (!composer && !(host.textContent ?? "").includes(">")) continue;
      const { nodes, segs } = segsIn(host);
      const spans = quoteSpans(segs);
      if (composer) {
        for (const span of spans) {
          const node = nodes[span.seg];
          if (node === undefined) continue;
          const r = document.createRange();
          r.setStart(node, span.start);
          r.setEnd(node, span.end);
          (span.mark ? mark : text).push(r);
        }
        continue;
      }
      // A sent message's words sit in one element as spans and chips, the first text in the host;
      // the clock and the actions after it are dsh's, in another. A bare text node among the parts
      // could not be hidden, so a message shaped like that is left as dsh draws it.
      const box = nodes[0]?.parentElement?.parentElement;
      if (!box) continue;
      const parts = [...box.childNodes].filter(
        (n) => !(n instanceof Element && n.hasAttribute(QUOTE_COPY)),
      );
      if (parts.some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""))
        continue;
      const whole = parts.map((n) => n.textContent ?? "").join("");
      if (!quotedLines(whole.split("\n")).includes(true)) continue;
      seen.add(box);
      const span = parts.find((n) => n instanceof HTMLSpanElement);
      if (span instanceof Element) drawCopy(box, parts, whole, faceFrom(span));
    }
    for (const src of copies.keys()) if (!seen.has(src)) dropCopy(src);
    // Below the rainbow, so `ultrathink` inside a quote keeps its colours.
    for (const [key, ranges] of [
      ["omc-quote", text],
      ["omc-quote-mark", mark],
    ] as const) {
      if (ranges.length === 0) registry.delete(key);
      else {
        const h = new Highlight(...ranges);
        h.priority = -1;
        registry.set(key, h);
      }
    }
  };

  const charsIn = (host: Element, isComposer: boolean): RainbowChar[] => {
    const out: RainbowChar[] = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let base = 0;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      if (text.includes("ltrathink") || text.includes("LTRATHINK"))
        for (const m of text.matchAll(ULTRATHINK))
          for (let i = 0; i < m[0].length; i++)
            out.push({
              node,
              offset: m.index + i,
              colour: i % RAINBOW.length,
              index: base + m.index + i,
            });
      if (isComposer && (text.includes("ltracode") || text.includes("LTRACODE")))
        for (const m of keywordMatches(text, "ultracode"))
          for (let i = m.start; i < m.end; i++)
            out.push({ node, offset: i, colour: ULTRACODE_INDEX, index: base + i });
      base += text.length;
    }
    return out;
  };
  // The composer's characters, kept for the sweep; the sweep's window and length come from them.
  let composer: RainbowChar[] = [];
  let sweepStart = 0;
  let cycle = 1;
  let tick = 0;
  let sweep: ReturnType<typeof setInterval> | undefined;
  const paintSweep = () => {
    const at = sweepStart + (tick % cycle);
    const lit: RainbowChar[][] = names.map(() => []);
    for (const c of composer) if (Math.abs(c.index - at) <= 1) lit[c.colour]!.push(c);
    shimmerNames.forEach((key, i) => {
      const cs = lit[i]!;
      if (cs.length === 0) registry.delete(key);
      else {
        const h = new Highlight(...cs.map(rangeOf));
        h.priority = 1; // over the base colour of the same character
        registry.set(key, h);
      }
    });
  };
  const stopSweep = () => {
    if (sweep !== undefined) clearInterval(sweep);
    sweep = undefined;
    for (const key of shimmerNames) registry.delete(key);
  };
  const scan = () => {
    if (document.hidden) {
      stopSweep();
      return;
    }
    if (activeClaudeSession(ctx) === undefined) {
      stopSweep();
      clear();
      registry.delete("omc-quote");
      registry.delete("omc-quote-mark");
      for (const src of copies.keys()) dropCopy(src);
      return;
    }
    paintQuotes();
    if (!hasTheme("rainbow")) {
      stopSweep();
      clear();
      return;
    }
    const buckets: RainbowChar[][] = names.map(() => []);
    composer = [];
    for (const host of document.querySelectorAll<HTMLElement>(HOSTS)) {
      const isComposer = host.hasAttribute("data-composer-input");
      const cs = charsIn(host, isComposer);
      if (isComposer) composer.push(...cs);
      for (const c of cs) buckets[c.colour]!.push(c);
    }
    names.forEach((key, i) => {
      const cs = buckets[i]!;
      if (cs.length === 0) registry.delete(key);
      else registry.set(key, new Highlight(...cs.map(rangeOf)));
    });
    if (composer.length === 0 || reduced) {
      stopSweep();
      return;
    }
    const first = Math.min(...composer.map((c) => c.index));
    const last = Math.max(...composer.map((c) => c.index)) + 1;
    sweepStart = first - 10;
    cycle = last - first + 20;
    if (sweep === undefined) {
      tick = 0;
      sweep = setInterval(() => {
        tick++;
        guard(paintSweep)();
      }, 50);
    }
    paintSweep();
  };
  // The composer changes on every keystroke and the chat on every message; both are observed
  // rather than polled, with the pass folded to one per frame. The observer has to sit on the
  // body (dsh remounts the chat and the composer), but a streaming reply mutates the document
  // many times a second, so only a change inside a host, or one that adds a host, asks for a
  // pass; the rest is dropped before any walking happens.
  let queued = false;
  const request = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      guard(scan)();
    });
  };
  const touchesHost = (records: MutationRecord[]): boolean => {
    for (const r of records) {
      // A quote copy this pass adds is not a change to answer. A removed one is: a hot reload's
      // outgoing bundle takes its copy away, and this pass has to redraw and re-mark. The pass
      // writes only when a message's text changed, so answering its own removals ends there.
      const added = [...r.addedNodes];
      if (
        r.removedNodes.length === 0 &&
        added.length > 0 &&
        added.every((n) => n instanceof Element && n.hasAttribute(QUOTE_COPY))
      )
        continue;
      const el = r.target instanceof Element ? r.target : r.target.parentElement;
      if (el?.closest(HOSTS)) return true;
      for (const n of r.addedNodes)
        if (n instanceof Element && (n.matches(HOSTS) || n.querySelector(HOSTS))) return true;
    }
    return false;
  };
  const obs = new MutationObserver((records) => {
    if (touchesHost(records)) request();
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", request, true);
  document.addEventListener("visibilitychange", request);
  request();
  // On teardown, disconnect the sweep observer and listeners and stop the shimmer, so an unmounted
  // ultrathink sweep makes no more queries.
  whenContextGone(() => {
    obs.disconnect();
    document.removeEventListener("input", request, true);
    document.removeEventListener("visibilitychange", request);
    stopSweep();
    clear();
    for (const src of copies.keys()) dropCopy(src);
  });
}
