// The page's shared mutation scheduler: features register a scan here instead of each running its
// own observer. Kept out of the entry so its module-level `let`s live where they are written.
import { whenContextGone, guard } from "./shared.js";

/**
 * One shared `document.body` observer for every feature that reacts to nodes dsh adds. dsh appends
 * a message chunk many times a second during a turn, so a per-feature observer that ran a
 * `querySelectorAll` per mutation multiplied that load by the feature count and janked mobile
 * (Firefox worst). Here any mutation burst just marks the frame dirty; on the next animation frame
 * each registered scan runs once against `document.body`. The feature selectors are rare attributes
 * ([role=dialog/tooltip/status]), so one body-wide scan per frame is far cheaper than scanning each
 * of the hundreds of nodes a streaming turn appends. Scans do their own scoping and idempotency.
 */
/** A registered scan. Sync scans are handed the burst's records so they can look at what changed
 *  instead of the whole document; a scan called with none does a full pass. */
type FrameScan = (records?: MutationRecord[]) => void;
const frameScans = new Set<FrameScan>();
/**
 * Scans that have to land before the browser paints. A frame scan is fine for anything that only
 * adds to what dsh drew, but the tool fold *hides* a block dsh already laid out, and a frame late
 * is a frame the full code block is on screen. Those run inside the observer callback instead,
 * which is a microtask checkpoint: still before paint, still batched per mutation burst.
 */
const syncScans = new Set<FrameScan>();
let bodyObserver: MutationObserver | undefined;
let scanQueued = false;
/** The bursts since the last frame, so a frame scan can look at what changed instead of the body. */
let pending: MutationRecord[] = [];
/**
 * A hidden tab gets no animation frames, so a turn that streams into a background tab piles records
 * up with nothing draining them. Past this many the burst is dropped and the next frame goes wide,
 * which is what a scan does on its first run anyway.
 */
const PENDING_CAP = 4000;
let pendingOverflow = false;
/** Run every frame scan once with the records gathered this frame, or with none after an
 *  overflow, which a scan reads as "look at the whole body". */
const flushScans = () => {
  scanQueued = false;
  const records = pendingOverflow ? undefined : pending;
  pending = [];
  pendingOverflow = false;
  for (const scan of frameScans) scan(records);
};
/** Subscribes the given MutationObserver to document.body for added and removed nodes and for text
 *  rewritten in place. The last one matters: React updates a paragraph whose only child is text by
 *  setting that text node's value, so a `<p>` reused from prose into a tool header changed without a
 *  single childList record, and the header stayed bare until a reload swept the page. */
const observeBody = (observer: MutationObserver) => {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
};
/** The element a record is about: its target, or for a text edit the element holding the text. */
export const recordElement = (rec: MutationRecord): HTMLElement | null =>
  rec.target instanceof HTMLElement
    ? rec.target
    : rec.target.parentElement instanceof HTMLElement
      ? rec.target.parentElement
      : null;
/**
 * The elements a burst touched: each record's target plus whatever it added. A scan handed these
 * covers the same ground as one over `document.body`, because dsh only ever draws through the DOM.
 * The cost follows what changed rather than how long the conversation is.
 */
export const changedElements = (records: MutationRecord[]): Set<HTMLElement> => {
  const nodes = new Set<HTMLElement>();
  for (const rec of records) {
    const el = recordElement(rec);
    if (el) nodes.add(el);
    for (const node of rec.addedNodes) if (node instanceof HTMLElement) nodes.add(node);
  }
  return nodes;
};

/** Register a scan; the returned function removes it again (a React effect's cleanup needs that). */
export const onBodyMutation = (scan: FrameScan, sync = false): (() => void) => {
  const set = sync ? syncScans : frameScans;
  const wrapped = guard(scan);
  set.add(wrapped);
  const off = () => set.delete(wrapped);
  if (bodyObserver) return off;
  // The new bundle registers its own scans; this one's would run on top of them against a context
  // that no longer answers.
  // When the bundle is replaced, disconnect the observer and clear the scan sets.
  whenContextGone(() => {
    bodyObserver?.disconnect();
    bodyObserver = undefined;
    frameScans.clear();
    syncScans.clear();
  });
  bodyObserver = new MutationObserver((records) => {
    // The records are the point: a sync scan that walks only what changed costs the same on a long
    // transcript as on a short one. So the observer stays attached across the pass.
    // Detaching to avoid being called back by our own writes threw the records away, and a scan
    // with no records has nothing to scope itself to. The writes do call this back once more;
    // did its work finds nothing to do and the second pass ends there.
    for (const run of syncScans) run(records);
    if (frameScans.size === 0) return;
    if (pending.length + records.length > PENDING_CAP) {
      pendingOverflow = true;
      pending = [];
    } else if (!pendingOverflow) for (const rec of records) pending.push(rec);
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(flushScans);
  });
  observeBody(bodyObserver);
  return off;
};

/** Dark page or light, from the body's own background: dsh keeps its theme in CSS variables and
 *  exposes no flag, and the luminance of what is actually painted is what the eye compares to. */
export const pageIsDark = (): boolean => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m) return true;
  return (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000 < 128;
};
/** The type a closing line copies off dsh's label, so it reads at the size of the text it replaces. */
export type Face = { fontSize: string; fontWeight: string; fontFamily: string; lineHeight: string };
