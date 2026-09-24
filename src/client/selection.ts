// Reading a chat selection and turning it into a Markdown quote. The DOM half reads dsh's renderer
// attributes, which are not a documented contract: re-check `data-chat-flow-kind` on a dsh upgrade.

/** Longest passage the bar keeps. The server caps the same field at the same length (sessions.ts). */
export const QUOTE_MAX = 4000;

/** A dsh chat node. Every flow item carries its kind (input-message, assistant-step, tool-call …). */
const CHAT_NODE = "[data-chat-flow-kind]";
/** Places where selected text is someone's own typing, not the conversation. */
const EDITABLE = "[data-composer-input], input, textarea, [contenteditable=''], [contenteditable='true']";

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
  el !== null && root.contains(el) && el.closest(CHAT_NODE) !== null && el.closest(EDITABLE) === null;

/** Cut a passage to QUOTE_MAX characters; `trimmed` says whether anything was cut. */
export const clampQuote = (text: string): { text: string; trimmed: boolean } =>
  text.length <= QUOTE_MAX ? { text, trimmed: false } : { text: text.slice(0, QUOTE_MAX), trimmed: true };

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
