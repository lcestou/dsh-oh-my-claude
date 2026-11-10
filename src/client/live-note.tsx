// An off-screen live region for outcome lines that appear after a request (Saved, Check now).
// A line React inserts only once it has text is not reliably read out: most screen readers announce
// changes inside a live region that was already in the page, not a region that arrives with its
// text. This one is always mounted, so a change to `text` is announced while the visible line
// stays as it was drawn.

/**
 * A 1 px clipped `aria-live="polite"` region that repeats `text` for screen readers. Deliberately
 * no `role="status"`: the turn-status writer claims every `[role="status"][aria-live="polite"]`
 * element on the page and paints the running turn's spinner into it. Absolutely positioned, so a
 * flex or grid parent gives it no gap and the layout around it does not move. An empty `text`
 * announces nothing.
 */
export function LiveNote({ text }: { text: string }) {
  return (
    <span
      data-omc-live-note=""
      aria-live="polite"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
