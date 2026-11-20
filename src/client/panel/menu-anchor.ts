// Keeps a portalled dsh Menu on its trigger while the chat streams.
//
// dsh's portalled Menu is `position: fixed` and placed with CSS anchor positioning against the
// trigger. The trigger sits in the composer, which is `position: sticky` inside the chat scroller.
// When the transcript grows and the chat follows it to the bottom, Chrome shifts the menu by the
// scroll delta as if the anchor had scrolled away, though the sticky composer stayed put, and the
// shift never resets: the open menu walks up the screen one streamed line at a time (2026-11-20,
// measured: menu top + scroller scrollTop held constant while the trigger never moved). A plain
// scroll with no growth does not do it, and dsh's own permission menu drifts the same way.
// Re-resolving the anchor on each scroll puts the menu back before the frame paints.
import { useEffect, type RefObject } from "react";

/** The inline-style surface the two helpers below touch; a real element satisfies it. */
export type StyledBox = {
  getAttribute(name: string): string | null;
  style: Pick<CSSStyleDeclaration, "getPropertyValue" | "setProperty">;
  getBoundingClientRect(): { top: number };
};

/**
 * The open menu among `candidates` that dsh anchored to `anchorName`, read from the inline
 * `position-anchor` dsh sets on a portalled menu. Undefined for an empty name or no match, so a
 * menu of some other control is never touched.
 */
export function menuFor<E extends StyledBox>(
  anchorName: string,
  candidates: Iterable<E>,
): E | undefined {
  if (anchorName === "" || anchorName === "none") return undefined;
  for (const el of candidates) {
    if (
      el.getAttribute("role") === "menu" &&
      el.style.getPropertyValue("position-anchor").trim() === anchorName
    ) {
      return el;
    }
  }
  return undefined;
}

/**
 * Drop the menu's anchor, force a layout, and put the same anchor back, which makes Chrome
 * resolve the position afresh and forget the scroll shift it carried. A menu with no inline
 * anchor is left alone. The value written back is the one read, so React's inline style and the
 * DOM never disagree.
 */
export function reanchor(menu: StyledBox): void {
  const name = menu.style.getPropertyValue("position-anchor");
  if (name === "") return;
  menu.style.setProperty("position-anchor", "none");
  void menu.getBoundingClientRect();
  menu.style.setProperty("position-anchor", name);
}

/** The `anchor-name` dsh put on the trigger or the nearest wrapper above it; empty when none. */
function anchorNameOf(el: Element | null): string {
  for (let e = el; e !== null; e = e.parentElement) {
    const name = getComputedStyle(e).getPropertyValue("anchor-name").trim();
    if (name !== "" && name !== "none") return name;
  }
  return "";
}

/**
 * While `open`, re-resolve the portalled menu anchored at `trigger` on every scroll anywhere in
 * the page (scroll events do not bubble, hence the capture listener on window). The scroll event
 * runs before the frame paints, so the corrected position is the one drawn.
 */
export function useStickyAnchorFix(open: boolean, trigger: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      const menus = document.querySelectorAll<HTMLElement>("body > [role='menu']");
      const menu = menuFor(anchorNameOf(trigger.current), menus);
      if (menu) reanchor(menu);
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [open, trigger]);
}
