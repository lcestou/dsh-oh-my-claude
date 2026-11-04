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
/** Take the bubble down when it belongs to `anchor`. For an anchor about to be removed: a node
 *  taken out of the page never sees `mouseleave`, so its bubble stayed on screen until the next
 *  tooltip anywhere replaced it. */
export function hideTipFor(anchor: HTMLElement): void {
  pendingFor.get(anchor)?.();
  if (tipOpen?.anchor === anchor) hideTip();
}

/** Each anchor's pending hover timer, so `hideTipFor` can cancel one before it fires: a pill
 *  removed inside the hover delay otherwise showed its bubble on a node no longer in the page. */
const pendingFor = new WeakMap<HTMLElement, () => void>();

/** Rewrite the open bubble's text when it belongs to `anchor`, so a figure that changes under the
 *  pointer (the cost pill mid-turn) is not shown stale until the pointer leaves and comes back. */
export function refreshTip(anchor: HTMLElement, text: string): void {
  if (tipOpen?.anchor !== anchor) return;
  if (text === "") return hideTip();
  const label = tipOpen.bubble.firstElementChild;
  if (label && label.textContent !== text) label.textContent = text;
}

/** Give an element a dsh-style tooltip in place of the browser's `title`, timed the way dsh's own
 *  Tooltip is: a real mouse hover shows it after `delayMs` (dsh's stat pills wait 200 ms), keyboard
 *  focus shows it at once, and a touch never does. A tap used to fire hover and focus, so on a
 *  phone the bubble sat on top of the dialog the tap had just opened. Hidden on leave, blur, click
 *  and Escape. `text` is read each time, so a language switch shows the new wording. */
export function attachTip(
  anchor: HTMLElement,
  text: () => string,
  opts: { delayMs?: number } = {},
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  pendingFor.set(anchor, cancel);
  const hide = () => {
    cancel();
    hideTipFor(anchor);
  };
  anchor.addEventListener("pointerenter", (e) => {
    // dsh's rule: no bubble for touch, nor for a "mouse" on a device that cannot hover.
    if (e.pointerType !== "mouse" || !window.matchMedia("(any-hover: hover)").matches) return;
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      showTip(anchor, text());
    }, opts.delayMs ?? 0);
  });
  anchor.addEventListener("focus", () => {
    // Only keyboard focus: a click or a tap focuses the button too, and that is not a request.
    if (anchor.matches(":focus-visible")) showTip(anchor, text());
  });
  for (const ev of ["pointerleave", "blur", "click"]) anchor.addEventListener(ev, hide);
  anchor.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}
