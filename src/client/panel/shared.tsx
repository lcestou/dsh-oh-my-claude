// Helpers the panel tab files share: the motion and fit hooks, the hints store, the fold styles and its
// button, and the session, workspace, and path labels. This file imports no tab file.
import { useEffect, useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";
import { btn, sectionHead, nested, readJson, ROUTE } from "../shared.js";
import { t, useLocale } from "../i18n.js";

/**
 * How long the panel fades and the Add form collapses. Short enough to stay out of the way of a
 * second click, and zero for a reader who asked the platform for no motion.
 */
export const easeMs = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 140;

/** Space the panel keeps from the edge of whatever clips it, the gap dsh's own menus leave. */
const FIT_MARGIN = 8;

/**
 * The panel's max height: `cap`, or the room between its bottom and the top of the nearest
 * ancestor that clips it, whichever is less. dsh's `useAnchoredMaxHeight` measures to the top of
 * the window instead, and dsh's conversation scroller starts 40 px down, under its top strip. On a
 * blank session in a short window the composer sits mid-screen, so the panel reached the window's
 * top and its first 36 px, the Restore search among them, were cut off. Remeasured on open, on
 * resize and on any scroll.
 */
export function useFitAbove(
  ref: { current: HTMLElement | null },
  cap: number,
  open: boolean,
): number {
  const [maxHeight, setMaxHeight] = useState(cap);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const fit = () => {
      let top = 0;
      for (let a = el.parentElement; a; a = a.parentElement) {
        const c = getComputedStyle(a);
        if (c.overflowX !== "visible" || c.overflowY !== "visible")
          top = Math.max(top, a.getBoundingClientRect().top);
      }
      // max-height sizes the content box, so the panel's own padding and border come off too.
      const own = getComputedStyle(el);
      const frame =
        parseFloat(own.paddingTop) +
        parseFloat(own.paddingBottom) +
        parseFloat(own.borderTopWidth) +
        parseFloat(own.borderBottomWidth);
      const room = el.getBoundingClientRect().bottom - top - FIT_MARGIN - frame;
      setMaxHeight(Math.min(cap, Math.max(0, room)));
    };
    // The scroll listener is on the capture phase of the window, so it fires for every scroll of
    // every scroller, including the conversation following a streaming turn; each fit reads
    // layout up the whole ancestor chain. One fit per frame is all a screen can show.
    let queued = 0;
    const fitSoon = () => {
      if (queued !== 0) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        fit();
      });
    };
    fit();
    window.addEventListener("resize", fitSoon);
    window.addEventListener("scroll", fitSoon, true);
    return () => {
      if (queued !== 0) cancelAnimationFrame(queued);
      window.removeEventListener("resize", fitSoon);
      window.removeEventListener("scroll", fitSoon, true);
    };
  }, [ref, cap, open]);
  return maxHeight;
}

/**
 * Ease the panel between heights instead of snapping. Its height is whatever the open tab's body
 * needs (capped by the viewport), so it changes on a tab switch and again when a body's data lands;
 * CSS cannot transition a height it never sets. A ResizeObserver reports each settled height and a
 * one-shot animation runs from the previous one to it, tabs at the bottom staying put while the
 * body above them grows or shrinks. Frames of a running animation are resizes too and are skipped.
 */
export function useHeightEase(ref: { current: HTMLElement | null }, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let last = el.getBoundingClientRect().height;
    let anim: Animation | undefined;
    const ro = new ResizeObserver(() => {
      if (anim?.playState === "running") return;
      const next = el.getBoundingClientRect().height;
      if (Math.abs(next - last) < 1) return;
      const from = last;
      last = next;
      if (easeMs() === 0) return;
      anim = el.animate([{ height: `${from}px` }, { height: `${next}px` }], {
        duration: easeMs() * 1.5,
        easing: "ease",
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      anim?.cancel();
    };
  }, [ref, active]);
}

/** A session's display name. The server answers an empty string, not undefined, for a transcript
 *  it could not title, so this tests for emptiness rather than absence; the fallback is the first
 *  eight characters of the id, enough to tell sessions apart on one screen. */
export const sessionLabel = (s: { title?: string; id: string }): string =>
  s.title?.trim() ? s.title : t("panel.session.untitled", { id: s.id.slice(0, 8) });

/** The last path segment, which is the name a workspace shows in the sidebar; a Windows path
 *  splits on its backslashes. */
export const workspaceName = (cwd: string): string =>
  cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;

/**
 * One-time hints, kept on the box under the plugin's state (`GET`/`POST /hints`) so a hint shown
 * once stays shown across browsers, plugin updates and dsh updates. Read once per page; a failed
 * read answers nothing, so no hint fires on a box that cannot remember it fired.
 */
let hintsCache: Promise<Record<string, boolean | number> | null> | undefined;
/** Returns the cached `GET /hints` answer, fetched once and kept; resolves null on a failed
 *  read, so a box that cannot remember is treated as no hints rather than an error. */
export const readHints = (): Promise<Record<string, boolean | number> | null> =>
  (hintsCache ??= fetch(`${ROUTE}/hints`)
    .then((r) => readJson<Record<string, boolean | number>>(r))
    .catch(() => null));
/** Record a numbered hint (a dismissal that names what it dismissed) the way `markHint` records a
 *  flag: the box remembers it, and this tab's cache sees it without a refetch. */
export const markHintValue = (key: string, value: number): void => {
  hintsCache = (hintsCache ?? Promise.resolve(null)).then((h) => ({ ...h, [key]: value }));
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {});
};
/** Mark a hint seen: POST it to the box, and add it to this tab's cached hints so the next read here
 *  sees it without a refetch. It is added, not swapped in: replacing the cache with the one key
 *  used to drop every other hint the tab had read, so a second mark brought the first one back. A
 *  failed POST is ignored. */
export const markHint = (key: string): void => {
  hintsCache = (hintsCache ?? Promise.resolve(null)).then((h) => ({ ...h, [key]: true }));
  void fetch(`${ROUTE}/hints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: true }),
  }).catch(() => {});
};

/** A path as the row shows it: relative to the workspace, or under `~`, whichever applies. A
 *  Windows path under the workspace is cut the same way and keeps its own separators. */
export const shortPath = (path: string, cwd: string): string =>
  path.startsWith(`${cwd}/`) || path.startsWith(`${cwd}\\`)
    ? `./${path.slice(cwd.length + 1)}`
    : path.replace(/^\/home\/[^/]+\//, "~/");

/** The body of an open fold: in behind the Settings rule, the line set under the marker. */
export const FOLD_BODY: CSSProperties = { ...nested, marginLeft: 3 };
/** A fold's own title: the section label, kept a list item so the browser still draws its marker. */
export const FOLD_HEAD: CSSProperties = { ...sectionHead, display: "list-item", cursor: "pointer" };

/**
 * The fold both readout lists share: eight rows, a button past that, and back to eight. Returns how
 * many to show, whether that is all of them, and the button to draw when there is more than a fold.
 */
export function useFold(total: number) {
  useLocale();
  const [shown, setShown] = useState(8);
  const allShown = shown >= total;
  const button =
    total > 8 ? (
      <button
        type="button"
        style={{ ...btn, fontSize: 12, margin: "2px 0" }}
        onClick={() => setShown(allShown ? 8 : total)}
      >
        {allShown ? t("panel.fold.showFewer") : t("panel.fold.showAll", { total })}
      </button>
    ) : null;
  return { shown, allShown, button };
}
