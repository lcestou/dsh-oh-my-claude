// The single hover tooltip the page shows, for every feature that wants a bubble instead of the
// browser's `title`: one at a time, placed the way dsh's own tooltips are.

/** The one tooltip bubble on screen, if any, with the element it describes. One at a time, as in
 *  dsh: a second hover replaces the first. */
let tipOpen: { bubble: HTMLElement; anchor: HTMLElement } | null = null;
/** Take the open bubble down and drop the anchor's `aria-describedby` to it. */
function hideTip(): void {
  if (!tipOpen) return;
  tipOpen.bubble.remove();
  tipOpen.anchor.removeAttribute("aria-describedby");
  tipOpen = null;
}
/** Show `text` above `anchor` the way dsh's own tooltip does (centred, 8px gap, 12px from any
 *  viewport edge, under it when there is no room above): a fixed `role=tooltip` bubble styled on
 *  dsh's tooltip tokens, linked by `aria-describedby`. Nothing is shown for an empty text. */
function showTip(anchor: HTMLElement, text: string): void {
  hideTip();
  if (text === "") return;
  const bubble = document.createElement("span");
  bubble.setAttribute("data-omc-tip", "");
  bubble.setAttribute("role", "tooltip");
  bubble.id = `omc-tip-${Math.random().toString(36).slice(2, 8)}`;
  const label = document.createElement("span");
  label.textContent = text;
  bubble.append(label);
  bubble.style.visibility = "hidden";
  document.body.append(bubble);
  const edge = 12;
  const gap = 8;
  const r = anchor.getBoundingClientRect();
  const { width, height } = bubble.getBoundingClientRect();
  const above = r.top - gap - height >= edge;
  const x = Math.max(
    edge,
    Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - edge - width),
  );
  bubble.style.left = `${x + width / 2}px`;
  bubble.style.top = `${above ? r.top - gap : r.bottom + gap}px`;
  bubble.setAttribute("data-side", above ? "top" : "bottom");
  bubble.style.visibility = "visible";
  anchor.setAttribute("aria-describedby", bubble.id);
  tipOpen = { bubble, anchor };
}
/** Give an element a dsh-style tooltip in place of the browser's `title`: shown on hover and on
 *  keyboard focus, hidden on leave, blur, click and Escape. `text` is read each time, so a
 *  language switch shows the new wording without re-attaching. */
export function attachTip(anchor: HTMLElement, text: () => string): void {
  const show = () => showTip(anchor, text());
  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("focus", show);
  for (const ev of ["mouseleave", "blur", "click"]) anchor.addEventListener(ev, hideTip);
  anchor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
}
