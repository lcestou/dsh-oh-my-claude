// Node-kind checks by `nodeType` and tag name. Unlike `instanceof`, they also hold for nodes from
// another frame's realm, and they are the one place the client narrows an event target or a
// mutation record's node to the element type it then reads.

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** True for any DOM node; false for `null`, `undefined` and for event targets that are not nodes (`window`). */
export const isNode = (target: EventTarget | null | undefined): target is Node =>
  target !== null && target !== undefined && "nodeType" in target;

/** True for an element of any namespace (HTML, SVG, MathML); false for text, comments, `null`. */
export const isElement = (target: EventTarget | null | undefined): target is Element =>
  isNode(target) && target.nodeType === Node.ELEMENT_NODE;

/** True for an element in the XHTML namespace, which is what every `HTMLElement` is; an SVG
 *  `<path>` inside the page is an element but not one of these. */
export const isHTMLElement = (target: EventTarget | null | undefined): target is HTMLElement =>
  isElement(target) && target.namespaceURI === XHTML_NS;

/** True for an HTML `<style>` element; a `<style>` inside an inline SVG is not one. */
export const isStyleElement = (
  target: EventTarget | null | undefined,
): target is HTMLStyleElement => isHTMLElement(target) && target.tagName === "STYLE";

/** True for an HTML `<br>` element. */
export const isBRElement = (target: EventTarget | null | undefined): target is HTMLBRElement =>
  isHTMLElement(target) && target.tagName === "BR";
