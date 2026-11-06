// The ultrathink painter: the CLI's rainbow over a person's own words in the composer and the
// sent messages, via the CSS Highlight API, plus the dimming of quoted lines in the composer.
import { quoteSpans, type QuoteSeg } from "./selection.js";
import {
  guard,
  whenContextGone,
  activeClaudeSession,
  keywordMatches,
  T,
  type ClientCtx,
} from "./shared.js";
import { hasTheme } from "./theme.js";
import { pageIsDark } from "./dom.js";

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
export const RAINBOW_CSS =
  RAINBOW.map((c, i) => `::highlight(omc-rainbow-${i}){color:${c}}`).join("") +
  RAINBOW_SHIMMER.map((c, i) => `::highlight(omc-rainbow-s${i}){color:${c}}`).join("") +
  `::highlight(omc-rainbow-${ULTRACODE_INDEX}){color:var(--omc-ultracode,${ULTRACODE_DARK})}` +
  `::highlight(omc-rainbow-s${ULTRACODE_INDEX}){color:${ULTRACODE_SHIMMER}}` +
  // Quoted lines in the composer, the way a Markdown quote reads: dimmed, the marker more so.
  `::highlight(omc-quote){color:${T.muted}}::highlight(omc-quote-mark){color:${T.faint}}`;
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
/** The host's text as dsh's composer projection reads it: each child a paragraph, joined by one
 *  newline, a `<br>` inside one a newline (not the one Lexical adds itself), a chip
 *  (`contenteditable="false"`) one opaque character, and an empty line an empty segment. */
export const segsIn = (host: Element): HostText => {
  const nodes: Node[] = [];
  const segs: QuoteSeg[] = [];
  let line = "";
  let lineHasSeg = false;
  let lineStart: Node = host;
  const push = (node: Node, text: string) => {
    segs.push({ text, newLine: !lineHasSeg });
    nodes.push(node);
    line += text;
    lineHasSeg = true;
  };
  const endLine = () => {
    if (!lineHasSeg) push(lineStart, "");
    line = "";
    lineHasSeg = false;
  };
  for (const [i, para] of [...host.children].entries()) {
    if (i > 0) endLine();
    lineStart = para;
    const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const chip = node.parentElement?.closest('[contenteditable="false"]');
      if (chip && para.contains(chip)) continue;
      if (node instanceof Element && node.getAttribute("contenteditable") === "false") {
        // Before any `>` the chip is U+FFFC, so the line no longer opens with one and is never
        // painted. After a `>` it is empty: a quote line is painted end to end, and the chip must
        // not be. A block holding nothing but a chip then reads blank, where dsh's would not.
        push(node, /^ {0,3}>/.test(line) ? "" : "\uFFFC");
        continue;
      }
      if (node instanceof HTMLBRElement && !node.hasAttribute("data-lexical-managed-linebreak")) {
        endLine();
        lineStart = node;
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE) push(node, node.textContent ?? "");
    }
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
  /** Quotes in the composer read as quotes while the person types: dimmed, the `>` fainter still. A
   *  sent message's quotes are dsh's own quote chips (0.2.2). Not part of the rainbow's look
   *  switch: it is how a quote reads, not the Claude colour. */
  const paintQuotes = () => {
    const text: Range[] = [];
    const mark: Range[] = [];
    for (const host of document.querySelectorAll<HTMLElement>("[data-composer-input]")) {
      const { nodes, segs } = segsIn(host);
      for (const span of quoteSpans(segs)) {
        const node = nodes[span.seg];
        if (node === undefined) continue;
        const r = document.createRange();
        r.setStart(node, span.start);
        r.setEnd(node, span.end);
        (span.mark ? mark : text).push(r);
      }
    }
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
  });
}
