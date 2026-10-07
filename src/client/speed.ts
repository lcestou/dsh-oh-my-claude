// dsh's "tok/s" for a Claude session, replaced with a figure from the plugin's own turn records.
//
// dsh divides a step's output tokens by the time from the step's first streamed token to its
// settled message. A dsh step is one model call. A Claude step is every call the CLI made before
// it stopped, with its tools run in between, and the plugin's own tool rows close dsh's timer
// before the message that carries the token count arrives. Replaying dsh's fold over eight days of
// this box's logs (2026-10-07): 1,758 of 2,790 Claude steps counted nothing, and 334 of the 745
// that did read above 150 tok/s, one of them 812 tokens over 0.3 s of a 17 s step. The CLI reports
// the time it spent waiting on the API for each turn, so output over that is the honest figure.

/** The part of a turn record the speed is read from. */
interface SpeedTurn {
  output: number;
  apiMs: number;
  durationMs: number;
}

/** dsh's speed reading wherever it is written: "86 tok/s", "9.4 tok/s". The unit is the same in
 *  dsh's English and Chinese. */
const SPEED = /\d+(?:\.\d+)? tok\/s/;

/** Where dsh writes the reading: the activity pill in the composer dock, and the rows of the
 *  dialog it opens, which is portaled to the body. */
const SPEED_ROOTS = '[data-composer-stat="activity"], [data-session-stats-details]';

/**
 * Output tokens per second of API time over a session's turns, or undefined when no turn can say.
 * A turn whose API time is zero or longer than the turn itself is left out: before 2026-10-07 the
 * first turn after a process relaunch stored the session's whole API time as its own, and a turn
 * that ran subagents in parallel adds their API time to tokens it does not count.
 */
export const tokensPerSecond = (turns: readonly SpeedTurn[]): number | undefined => {
  let tokens = 0;
  let ms = 0;
  for (const t of turns) {
    if (!(t.apiMs > 0) || !(t.output > 0) || t.apiMs > t.durationMs) continue;
    tokens += t.output;
    ms += t.apiMs;
  }
  return ms > 0 ? tokens / (ms / 1000) : undefined;
};

/** The number as dsh prints one: whole at ten and above, one decimal below. */
const shown = (tps: number): string =>
  tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10);

/** `text` with dsh's speed reading replaced by `tps`, or unchanged when it holds none. */
export const withSpeed = (text: string, tps: number): string =>
  text.replace(SPEED, `${shown(tps)} tok/s`);

/**
 * Write `tps` over dsh's speed reading on the page: the pill's label, its `aria-label`, and the
 * dialog row. Text nodes are edited in place so React keeps the nodes it made; dsh rewrites them
 * when its own figure changes, so this runs again on every pass of the caller's sync. Does nothing
 * for an undefined `tps` or a page that shows no reading (dsh hides it until it has one).
 */
export function paintSpeed(tps: number | undefined, root: ParentNode = document): void {
  if (tps === undefined) return;
  for (const el of root.querySelectorAll(SPEED_ROOTS)) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = withSpeed(node.nodeValue ?? "", tps);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const labelled of el.querySelectorAll("[aria-label]")) {
      const label = labelled.getAttribute("aria-label") ?? "";
      const next = withSpeed(label, tps);
      if (next !== label) labelled.setAttribute("aria-label", next);
    }
  }
}
