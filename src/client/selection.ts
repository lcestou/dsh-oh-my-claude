// Reading a chat selection and turning it into a Markdown quote. The DOM half reads dsh's renderer
// attributes, which are not a documented contract: re-check `data-chat-flow-kind` on a dsh upgrade.

/** Longest passage the bar keeps. The server caps the same field at the same length (sessions.ts). */
export const QUOTE_MAX = 4000;

/** A dsh chat node. Every flow item carries its kind (input-message, assistant-step, tool-call …). */
const CHAT_NODE = "[data-chat-flow-kind]";
/** Places where selected text is someone's own typing, not the conversation. */
const EDITABLE =
  "[data-composer-input], input, textarea, [contenteditable=''], [contenteditable='true']";

/** The element a selection end sits in: the node itself, or a text node's parent. */
const elementOf = (n: Node | null): Element | null =>
  n === null ? null : n instanceof Element ? n : n.parentElement;

/**
 * The selected conversation text under `root`, trimmed, or null when the selection is empty, shorter
 * than two characters, starts outside a chat node or inside something editable, or ends there with
 * text past the boundary. Reads the range's start and end in document order, not anchor and focus,
 * so a backwards drag reads the same as a forwards one.
 */
export function chatSelection(sel: Selection | null, root: Element): string | null {
  if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!inChat(elementOf(range.startContainer), root)) return null;
  // A triple-click ends the range at offset 0 of the next block, which for the newest reply's last
  // paragraph is the composer seat. That boundary adds no text, so it does not disqualify.
  if (!inChat(elementOf(range.endContainer), root) && range.endOffset !== 0) return null;
  const text = sel.toString().trim();
  return text.length >= 2 ? text : null;
}

/** Whether an element is conversation text under `root`: in a chat node and not in anything editable. */
const inChat = (el: Element | null, root: Element): boolean =>
  el !== null &&
  root.contains(el) &&
  el.closest(CHAT_NODE) !== null &&
  el.closest(EDITABLE) === null;

/** Cut a passage to QUOTE_MAX characters; `trimmed` says whether anything was cut. */
export const clampQuote = (text: string): { text: string; trimmed: boolean } =>
  text.length <= QUOTE_MAX
    ? { text, trimmed: false }
    : { text: text.slice(0, QUOTE_MAX), trimmed: true };

/**
 * A Markdown blockquote of `text` followed by an empty line, ready to type under. Blank lines become a
 * bare `>` so the quote stays one block; `\r\n` is normalised first.
 */
export const quoteMarkdown = (text: string): string =>
  `${text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n")}\n\n`;

/** One-line preview of a passage for the bar's header: whitespace runs collapsed to one space. */
export const previewOf = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The `POST /side-questions` body for a selection: the typed question trimmed (blank means explain)
 *  and the passage. Never sets `withDiff` or `recap`, which belong to the Changes tab and the recap. */
export const askBody = (session: string, question: string, quote: string) => ({
  session,
  question: question.trim(),
  quote,
});

/** One run of text the quote scan reads: a text node's content, and whether it opens a new line
 *  without a newline character (a new paragraph or a `<br>` in the composer). */
export interface QuoteSeg {
  text: string;
  newLine: boolean;
}
/** A stretch to paint inside one segment: the `>` marker, or the quoted text after it. */
export interface QuoteSpan {
  seg: number;
  start: number;
  end: number;
  mark: boolean;
}

/**
 * The quoted lines in a run of text, by Markdown's own rule as far as it matters here: a line that
 * opens (after up to three spaces) with `> `, or is a bare `>`, is a quote; `>` anywhere else in a
 * line is not, and nothing between ``` or ~~~ fences is, since `> npm test` there is a prompt. A
 * hand-typed `>5 items` stays plain, which Markdown would call a quote: the cost of reading `>`
 * followed by a space as the sign, the way the Quote button writes it. A line may run across
 * segments; the decision is taken where it starts and carried to its end.
 */
export function quoteSpans(segs: readonly QuoteSeg[]): QuoteSpan[] {
  const out: QuoteSpan[] = [];
  let atStart = true;
  let quoting = false;
  let fenced = false;
  segs.forEach((seg, i) => {
    if (seg.newLine) {
      atStart = true;
      quoting = false;
    }
    const t = seg.text;
    let pos = 0;
    // A segment that ends on a newline leaves the next one at the start of a line.
    while (!(atStart && pos === t.length)) {
      const nl = t.indexOf("\n", pos);
      const end = nl === -1 ? t.length : nl;
      if (atStart) {
        const line = t.slice(pos, end);
        const quote = /^( {0,3})>(?: |$)/.exec(line);
        if (/^ {0,3}(?:```|~~~)/.test(line)) {
          fenced = !fenced;
          quoting = false;
        } else if (fenced || quote === null) {
          quoting = false;
        } else {
          quoting = true;
          const at = pos + (quote[1]?.length ?? 0);
          out.push({ seg: i, start: at, end: at + 1, mark: true });
          if (at + 1 < end) out.push({ seg: i, start: at + 1, end, mark: false });
        }
      } else if (quoting && end > pos) {
        out.push({ seg: i, start: pos, end, mark: false });
      }
      if (nl === -1) {
        atStart = false;
        break;
      }
      pos = nl + 1;
      atStart = true;
    }
  });
  return out;
}

/** One block of a message as the quote copy lays it out: a run of quoted lines (their `>` markers
 *  taken off) or a run of plain ones, as typed. */
export interface QuoteBlock {
  quote: boolean;
  text: string;
}

/**
 * A message split into quote and plain blocks, by `quoteSpans`' rule: a line opening with `> ` (or a
 * bare `>`) is quoted, fenced code never is. The marker and the one space after it come off a quoted
 * line; everything else is kept byte for byte, blank lines included.
 */
export function quoteBlocks(text: string): QuoteBlock[] {
  const lines = text.split("\n");
  const starts = new Set(
    quoteSpans([{ text, newLine: true }])
      .filter((s) => s.mark)
      .map((s) => s.start),
  );
  const out: QuoteBlock[] = [];
  let at = 0;
  for (const line of lines) {
    const lead = /^ {0,3}/.exec(line)?.[0].length ?? 0;
    const quote = starts.has(at + lead);
    const body = quote ? line.slice(lead + 1).replace(/^ /, "") : line;
    const last = out.at(-1);
    if (last !== undefined && last.quote === quote) last.text += `\n${body}`;
    else out.push({ quote, text: body });
    at += line.length + 1;
  }
  return out;
}
