// Marks, glyphs and the click that folds a native-tool header, plus the sheet of dsh icons the
// headers borrow. The entry keeps one import line for the sheet it mounts and the glyph it reads.
import type { FC } from "react";
import {
  IconAgentPresetOutlineMedium,
  IconApiOutlineRegular,
  IconBrowseOutlineMedium,
  IconChecklistOutlineRegular,
  IconChevronDownOutlineRegular,
  IconCodeOutlineMedium,
  IconEditOutlineMedium,
  IconListPenOutlineMedium,
  IconSearchOutlineMedium,
  IconSkillOutlineMedium,
  IconSparkleMedium,
} from "./icons.js";
import { ensurePanelStyle, whenContextGone } from "./shared.js";
import { onBodyMutation, recordElement } from "./dom.js";

/** Fold a native-tool code block into a one-line disclosure. dsh renders a tool step as a `<p>` whose
 *  text is an icon plus the tool's name (`❯ Bash`, `▤ Read`), set by the translator, followed by
 *  `.md-code-block` fence, both children of `._markdown`. Collapsed, the fence hides; hovering the
 *  header swaps its icon for dsh's chevron, and clicking toggles it. The marker is the leading glyph:
 *  only a header that starts with one of the translator's tool icons folds, so Claude's own prose code
 *  blocks are left alone. Kept in sync with the translator's TOOL_ICON set. */
const TOOL_ICONS = "❯▤✎⌕✳⤓☑⚙☰⌘◆";
/** The invisible word joiner the translator writes after the glyph (`HEADER_MARK` there), stripped
 *  with the glyph when it is there.
 *
 *  It cannot be demanded outright: a dsh process holds the server half of this plugin in memory
 *  until it restarts, while `lib/client.js` reloads into the open tab the moment it is built, so a
 *  client that required the mark unfolded every header the running build was still writing (#234).
 *  So the page says which it is. Until a marked header has been seen, the glyph alone claims a
 *  paragraph, exactly as before; from the first marked one on, the running server writes marks and
 *  a bare glyph is prose \u2014 a pasted `\u276f npm test` keeps its glyph and the block under it stays open.
 *  A header already claimed keeps its fold either way, so the switch never reopens what is on screen. */
const FOLD_MARK = "\u2060";
/** Whether this page has seen the mark, which is what tells the two halves apart. */
let markedHeaders = false;
const HEAD_MARK = "data-omc-tool"; // on the header <p>: "1" collapsed · "open" expanded · "flat" no fence
const LEAD_MARK = "data-omc-lead"; // on the span that replaces the glyph: the sprite key it carries
const SPRITE_MARK = "data-omc-sprite"; // on each hidden sprite: its key

/** The translator's glyph mapped to the dsh icon that stands for the same tool in its own tool cards
 *  (`VARIANT_ICONS` in dsh-client-ui-tool). Reusing dsh's art keeps a Claude tool header and a dsh tool
 *  row visually the same family instead of inventing a second icon set. `chevron` is the disclosure
 *  marker; dsh's tool rows use the same one, unrotated. */
const SPRITES = {
  "❯": IconApiOutlineRegular,
  "▤": IconBrowseOutlineMedium,
  "✎": IconEditOutlineMedium,
  "⌕": IconSearchOutlineMedium,
  "✳": IconCodeOutlineMedium,
  "⤓": IconBrowseOutlineMedium,
  "☑": IconChecklistOutlineRegular,
  "⚙": IconAgentPresetOutlineMedium,
  "☰": IconListPenOutlineMedium,
  "⌘": IconSkillOutlineMedium,
  "◆": IconSparkleMedium,
  chevron: IconChevronDownOutlineRegular,
} satisfies Record<string, FC<{ size?: number }>>;

/** The hidden sprite sheet: one rendered copy of each dsh icon, cloned into the tool headers by the
 *  fold scan. Rendering them as ordinary children of a mounted component is what lets this plugin use
 *  dsh's React icons from plain DOM code, no react-dom import and no portal. The sheet costs
 *  one hidden div per session. */
export function ToolIconSprites() {
  return (
    <span hidden>
      {Object.entries(SPRITES).map(([key, Icon]) => (
        <span key={key} {...{ [SPRITE_MARK]: key }}>
          <Icon size={14} />
        </span>
      ))}
    </span>
  );
}

/** Create or overwrite the tool-fold stylesheet, always rewriting it, so a hot reload's stale rules
 *  never survive in a page that still carries the old bundle. */
const ensureFoldStyle = () => {
  // Reuse the element but always rewrite it. A hot reload drops a new bundle into a page that still
  // carries the previous one's sheet, so returning early here left the old rules in force and the new
  // build's markup styled by them, which looks like the feature half-shipped until the tab is
  // reloaded by hand.
  const existing = document.getElementById("dsh-oh-my-claude-fold");
  const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  el.id = "dsh-oh-my-claude-fold";
  // The header reads as dsh's muted tool text, taking its secondary content size and label colour.
  // It sits flush-left like any prose line. The leading span is a fixed 16px box of both glyphs
  // stacked, so the row never shifts: the tool icon rests and the chevron sits on top
  // cross-fading on hover. This is how dsh draws its own tool rows (`iconIdle`/`chevronHover` in
  // dsh-client-ui-tool), secondary label colour, and the chevron never rotates. Expanding
  // is shown by the fence appearing, not by the marker turning. A `flat` header has no fence under it
  // (`▤ Read \`path\`` is the whole step), so it takes the muted type and the icon but neither the
  // pointer nor the chevron: there is nothing to disclose. The `body` prefix stays out of `lead` on
  // purpose. Pasted into a descendant position it would read as a `body` inside a `p` and match
  // nothing, which is what silently killed the hover swap.
  const head = `body[data-omc-claude] p[${HEAD_MARK}]`;
  const fold = `${head}:not([${HEAD_MARK}="flat"])`;
  const lead = `span[${LEAD_MARK}]`;
  // Metrics copied from dsh's own row rather than approximated: a 16px leading box, a 14px icon inside
  // it, a 6px gap to the title, and both sizes carrying `--dsh-content-font-delta` so the header grows
  // with the user's content font size the way a dsh tool row does. Fixed pixels made ours read a hair
  // small for anyone who raised that setting. Colour comes from the same tokens: tertiary for the
  // icon, secondary for the text and the chevron.
  //
  // Vertical centring is the fiddly part. `vertical-align:middle` centres on the baseline plus half
  // the x-height, which sits about a pixel below the middle of the capitals, so the icon read low next
  // to the title. The box is centred on cap height instead: both glyphs are absolutely positioned, so
  // the box has no in-flow content and its baseline is its own bottom edge, and a length
  // `vertical-align` then places that edge exactly. `cap` is the right unit for it; the `em`
  // approximation above it is the fallback for a browser without `cap` units, where the whole
  // declaration would otherwise be dropped and the icon would sit on the baseline.
  const box = "calc(16px + var(--dsh-content-font-delta,0px))";
  const glyphSize = "calc(14px + var(--dsh-content-font-delta,0px))";
  const half = "8px - var(--dsh-content-font-delta,0px)/2"; // half the leading box, for the baseline offset
  el.textContent = [
    // The hanging indent keeps a wrapped header (a long URL, a long grep pattern) lined up under its
    // own text rather than back under the icon. `user-select` is off for a folding header, where a
    // drag is a mis-click on a control, but stays on for a flat one: `▤ Read \`path\`` is a whole step
    // and the path is the thing worth copying out of it.
    // The line has to clear the leading box: dsh's paragraph line-height is set from a 13px font, and
    // a 16px icon sitting in it puts the glyph into the row above.
    `${head}{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(${box} + 4px);color:var(--dsw-alias-label-secondary);padding-left:calc(${box} + 6px);text-indent:calc(0px - ${box} - 6px);margin-bottom:4px}`,
    // `text-indent` inherits, and dsh renders inline code as an inline-block, a block container, so
    // the hanging indent applies a second time inside the chip and drags the path left over the verb.
    `${head} *{text-indent:0}`,
    `${fold}{cursor:pointer;user-select:none}`,
    `${fold}:focus-visible{outline:1px solid var(--dsw-alias-label-tertiary);outline-offset:2px;border-radius:4px}`,
    `${head} ${lead}{position:relative;display:inline-block;width:${box};height:${box};margin-right:6px;color:var(--dsw-alias-label-tertiary);vertical-align:calc(.36em - ${half});vertical-align:calc(.5cap - ${half})}`,
    `${head} ${lead} svg{width:${glyphSize};height:${glyphSize}}`,
    `${head} ${lead}>[data-omc-part]{position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;transition:opacity .1s}`,
    `${head} ${lead}>[data-omc-part="chevron"]{opacity:0;color:var(--dsw-alias-label-secondary)}`,
    `${fold}:hover ${lead}>[data-omc-part="icon"]{opacity:0}`,
    `${fold}:hover ${lead}>[data-omc-part="chevron"]{opacity:1}`,
    // The dot between the tool's name and its summary is dsh's own: a 2 px square in the caption
    // colour with 8 px either side, and the summary in the tertiary colour, so a row this plugin
    // writes reads like the rows dsh draws for its own tools.
    `${head}>[data-omc-part="sep"]{display:inline-block;width:2px;height:2px;border-radius:1px;background:var(--dsw-alias-label-caption);margin:0 8px;vertical-align:middle}`,
    `${head}>[data-omc-part="summary"]{color:var(--dsw-alias-label-tertiary)}`,
    // A path in a header is dsh's file link, not a code chip: no fill, the row's own type, the
    // summary colour. The chip keeps its look everywhere else in the answer.
    `${head}>code{background:none;border:0;padding:0;font-family:inherit;font-size:inherit;color:var(--dsw-alias-label-tertiary)}`,
    `${head}[${HEAD_MARK}="1"]+.md-code-block{display:none}`,
    // Rows stack the way dsh's own tool rows do: one tight step between rows rather than a
    // paragraph's worth, and an expanded block sits against the header it belongs to. The step has
    // to be the header's own `margin-bottom`: dsh wraps each row in its own markdown container, so
    // two rows are never siblings and a `+` rule between them can never match. That margin
    // collapses through the wrapper and is the whole gap. Zero it and the rows sit flush.
    `${head}+.md-code-block{margin-top:4px;margin-bottom:0}`,
    `${head}+.md-code-block+${head}{margin-top:8px}`,
  ].join("");
  document.head.appendChild(el);
};

/** Build the leading span for a glyph: dsh's tool icon with its chevron stacked on top, both cloned
 *  out of the sprite sheet. Returns null while the sheet has not rendered yet, or when the sheet has
 *  no sprite for the glyph, so the caller can leave the header alone and retry on the next scan. */
const leadFor = (glyph: string): HTMLElement | null => {
  const svg = document.querySelector(`[${SPRITE_MARK}="${glyph}"] svg`);
  const chevron = document.querySelector(`[${SPRITE_MARK}="chevron"] svg`);
  if (svg === null || chevron === null) return null;
  const span = document.createElement("span");
  span.setAttribute(LEAD_MARK, glyph);
  for (const [part, source] of [
    ["icon", svg],
    ["chevron", chevron],
  ] as const) {
    const holder = document.createElement("span");
    holder.setAttribute("data-omc-part", part);
    holder.appendChild(source.cloneNode(true));
    span.appendChild(holder);
  }
  return span;
};

let foldClicksBound = false;
/** One delegated listener pair toggles a header. Bound once per bundle and dropped when this bundle
 *  retires: a flag on documentElement outlives the reload the listeners do not, which left a tab
 *  answering clicks from whichever bundle loaded first and every later one silently unbound. */
const bindFoldClicks = () => {
  if (foldClicksBound) return;
  foldClicksBound = true;
  const stop = new AbortController();
  // On teardown, abort the fold-click listeners, so a retired bundle stops answering header clicks.
  whenContextGone(() => {
    stop.abort();
  });
  const toggle = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    const head = target.closest<HTMLElement>(`p[${HEAD_MARK}]`);
    const state = head?.getAttribute(HEAD_MARK);
    if (head === null || state === "flat" || state === null) return false;
    setFoldState(head, state === "1" ? "open" : "1");
    return true;
  };
  document.addEventListener(
    "click",
    (e) => {
      toggle(e.target);
    },
    { signal: stop.signal },
  );
  // A header is a real control, so it answers the keys a button answers. Space would scroll the
  // transcript otherwise, hence the preventDefault, and only when the header actually took the key.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (toggle(e.target)) e.preventDefault();
    },
    { signal: stop.signal },
  );
};

/** Set a header's fold state and keep the announced state with it: a folding header is a button to a
 *  screen reader, and `aria-expanded` is the only thing that tells one whether the fence below is
 *  showing. A flat header is not a control, so it carries none of it. */
const setFoldState = (head: HTMLElement, state: "1" | "open" | "flat") => {
  head.setAttribute(HEAD_MARK, state);
  if (state === "flat") {
    head.removeAttribute("role");
    head.removeAttribute("tabindex");
    head.removeAttribute("aria-expanded");
    return;
  }
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", state === "open" ? "true" : "false");
};

/** The glyph a header leads with, wherever it currently lives: still in the text, already lifted into
 *  a leading span, or in the `data-omc-icon` attribute an older build left behind. A glyph with the
 *  mark behind it is a header and says so for the rest of the page; a bare one is a header only
 *  while no marked header has been seen, or when this paragraph is one already folding. */
export const glyphOf = (head: HTMLElement): string => {
  const node = head.firstChild;
  if (node?.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? "";
    const at = text.search(/\S/);
    if (at >= 0 && TOOL_ICONS.includes(text.charAt(at))) {
      if (text.startsWith(FOLD_MARK, at + 1)) markedHeaders = true;
      else if (markedHeaders && !head.hasAttribute(HEAD_MARK)) return "";
      return text.charAt(at);
    }
  }
  return (
    head.querySelector(`span[${LEAD_MARK}]`)?.getAttribute(LEAD_MARK) ??
    head.getAttribute("data-omc-icon") ??
    ""
  );
};

/**
 * "Bash · Show the diff" as the translator writes it becomes name, dot and summary, the dot a
 * styled span and the summary its own span, once the glyph has been lifted. Split on every " · "
 * so an MCP tool's "dsh · subagent" keeps a dot inside its name too; the last part is the summary.
 * Repeatable: a converted header has no " · " left in the text node after the lead, so a second
 * pass does nothing, and React's text rewrite restores the plain form for the next pass.
 */
const dotHeader = (head: HTMLElement): void => {
  const node = head.querySelector(`span[${LEAD_MARK}]`)?.nextSibling;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const text = node.nodeValue ?? "";
  if (!text.includes(" · ")) {
    // "Read `path`" and "Write `path`" carry no dot in the text: the path is a code chip right
    // after the name. dsh draws those rows as name, dot, file; the dot goes in before the chip
    // and the chip is flattened to dsh's file-link look by the header's own rule. A converted
    // header has the dot span there instead of the chip, so the pass does nothing twice.
    const next = node.nextSibling;
    if (next instanceof HTMLElement && next.tagName === "CODE" && text.trim() !== "") {
      node.nodeValue = text.trimEnd();
      const sep = document.createElement("span");
      sep.setAttribute("data-omc-part", "sep");
      sep.setAttribute("aria-hidden", "true");
      head.insertBefore(sep, next);
    }
    return;
  }
  const parts = text.split(" · ");
  const frag = document.createDocumentFragment();
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.setAttribute("data-omc-part", "sep");
      sep.setAttribute("aria-hidden", "true");
      frag.appendChild(sep);
    }
    if (i === parts.length - 1) {
      const summary = document.createElement("span");
      summary.setAttribute("data-omc-part", "summary");
      summary.textContent = part;
      frag.appendChild(summary);
    } else frag.appendChild(document.createTextNode(part));
  });
  node.replaceWith(frag);
};

/** Wire tool-step folding: ensure the fold styles, bind the delegated header-click listeners, and
 *  scan existing steps so already-open tool rows can fold. */
export function watchToolFolds() {
  ensureFoldStyle();
  ensurePanelStyle(); // the aside dock shares the panel's hover and focus rules
  bindFoldClicks();
  // Every tool step is a `<p>` that opens with one of the translator's glyphs; only some are followed
  // by a fence (`▤ Read \`path\`` is a whole step on its own). Both get the icon and the muted type;
  // only the ones with a fence fold. Marking is driven off the header rather than the fence for that
  // reason, and the pass is repeatable: a re-render restores the glyph in the text, so the swap has to
  // survive being done twice. A header is left alone while the sprite sheet has not mounted, and the
  // next mutation brings the scan back.
  // Set when a header was left for the sprite sheet: the mutation that mounts the sheet says nothing
  // about the headers waiting on it, so the pass after one is skipped goes wide again.
  let sweepAgain = false;
  const visit = (head: HTMLElement) => {
    const glyph = glyphOf(head);
    // React reuses a `<p>` node across renders: the paragraph that held a tool header one frame
    // can hold prose the next. It rewrites the text (`textContent` on a node with our extra span
    // takes the wipe-and-append path, so the lead span goes with it) but never touches our
    // attributes, leaving a prose line wearing the header type, taking clicks, and hiding the
    // fence under it for good. A paragraph that no longer leads with a glyph gives its marks back.
    if (glyph === "") {
      if (head.hasAttribute(HEAD_MARK)) {
        setFoldState(head, "flat");
        head.removeAttribute(HEAD_MARK);
      }
      return;
    }
    // State first, icon second. The state attribute is what hides the fence, and a header that has
    // to wait for the sprite sheet would otherwise sit unmarked with its whole block on screen.
    // A header folded before its icon lands still opens on click or Enter. `setFoldState` is what
    // gives it the role and the tab stop, so the only thing missing for that frame is the glyph.
    const foldable = head.nextElementSibling?.classList.contains("md-code-block") === true;
    const state = head.getAttribute(HEAD_MARK);
    // A header can start flat and gain its fence a moment later while the step streams in, so the
    // flat state is never sticky: only an already-folding header keeps the state the user set.
    // Written only on a change: this runs on every mutation burst, and an attribute write on a
    // node the fold rules can match invalidates style for all of them.
    if (!foldable) {
      if (state !== "flat") setFoldState(head, "flat");
    } else if (state !== "1" && state !== "open") setFoldState(head, "1");
    const node = head.firstChild;
    if (node?.nodeType === Node.TEXT_NODE && (node.nodeValue ?? "").trimStart().startsWith(glyph)) {
      const span = leadFor(glyph);
      if (span === null) {
        sweepAgain = true;
        return;
      }
      const text = node.nodeValue ?? "";
      head.querySelector(`span[${LEAD_MARK}]`)?.remove();
      head.removeAttribute("data-omc-icon");
      // The glyph goes, and the mark behind it when the writer put one there: the icon replaces
      // both. A header from an older build has no mark and loses only the glyph.
      const from = text.indexOf(glyph) + 1;
      const cut = text.startsWith(FOLD_MARK, from) ? from + FOLD_MARK.length : from;
      node.nodeValue = text.slice(cut).replace(/^ /, "");
      head.insertBefore(span, node);
    } else if (head.querySelector(`span[${LEAD_MARK}]`) === null) {
      // An older build stripped the glyph into the attribute; adopt it from there.
      const span = leadFor(glyph);
      if (span === null) {
        sweepAgain = true;
        return;
      }
      head.removeAttribute("data-omc-icon");
      head.insertBefore(span, head.firstChild);
    }
    dotHeader(head);
  };
  const MARKDOWN_P = '[class*="_markdown"] p';
  // What a burst touched, as headers. A record's target is the node whose children changed,
  // either the paragraph itself when React rewrites its text or the markdown container when a
  // step gains its fence. Its added nodes are whole blocks that may hold headers of their own.
  const headsIn = (records: MutationRecord[]): Set<HTMLElement> => {
    const heads = new Set<HTMLElement>();
    const take = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === "P") {
        if (node.closest('[class*="_markdown"]') !== null) heads.add(node);
        return;
      }
      for (const head of node.querySelectorAll<HTMLElement>(MARKDOWN_P)) heads.add(head);
    };
    for (const rec of records) {
      const el = recordElement(rec);
      if (el) take(el);
      for (const node of rec.addedNodes) take(node);
    }
    return heads;
  };
  const scan = (records?: MutationRecord[]) => {
    // Scoped to the burst by default: dsh fires many bursts a frame and the document-wide query is
    // the one cost here that grows with the transcript, so a long turn used to get stickier as it
    // ran. The wide pass is for the first run and for the burst after a header waited on its icon.
    const wide = records === undefined || sweepAgain;
    sweepAgain = false;
    for (const head of wide ? document.querySelectorAll<HTMLElement>(MARKDOWN_P) : headsIn(records))
      visit(head);
  };
  scan();
  onBodyMutation(scan, true);
}
