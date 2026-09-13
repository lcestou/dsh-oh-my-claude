/**
 * Claude's own spark, the mark beside anything Claude-owned in dsh's chrome.
 *
 * One path in a 100×100 box, straight from claude.ai, drawn in whatever colour it is handed. It
 * stands where the `✻` glyph used to: the glyph is a spinner frame doing duty as a logo, and it
 * renders in whatever the user's emoji font decides. A path renders the same everywhere. The colour
 * is a CSS `fill`, never the attribute: `var()` does not resolve in an SVG presentation attribute,
 * and the default follows the page's `--omc-accent`.
 *
 * Two spellings of one mark, because the panel injects into both trees: `Spark` for dsh's React
 * tree, `sparkNode` for the nodes this plugin builds by hand and appends into dsh's own DOM.
 */
import { ACCENT } from "./shared.js";

const PATH =
  "m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z";

/** The mark inside dsh's React tree. `size` is the box the glyph it replaced occupied. */
export function Spark({
  size = 14,
  color = ACCENT,
}: {
  size?: number;
  color?: string;
}): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      // A row lays these out beside text: `block` drops the baseline gap an inline SVG leaves, and
      // the flex basis keeps a long label from squeezing the mark.
      style={{ display: "block", flex: "0 0 auto", fill: color }}
    >
      <path d={PATH} />
    </svg>
  );
}

/** The same mark for the rows this plugin builds by hand and appends into dsh's own DOM. */
export function sparkNode(size = 14, color = ACCENT): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = `display:block;flex:0 0 auto;fill:${color}`;
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", PATH);
  svg.appendChild(path);
  return svg;
}
