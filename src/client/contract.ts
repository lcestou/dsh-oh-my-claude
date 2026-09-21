// What this plugin assumes about dsh, in one list, checked against the live page.
//
// Every dsh upgrade that has broken this plugin broke it the same way: the thing kept its name and
// changed its shape. `sessionController.resolveAgent` went from answering an Agent to answering
// `{ agent } | { error }`. The access-shield menu moved from under its trigger to a portal on
// `document.body`. A chat anchor key went from `:input-message` to `${kind}:${turn}:${step}`. In
// every case nothing threw and nothing logged: a selector matched zero nodes, or a wrapper was
// used as the thing it wraps, and the feature quietly stopped. One of them was found days later by
// grepping a log for a line that had stopped appearing.
//
// The fix for each was small. The cost was the time to notice. So this module does not try to make
// the couplings unbreakable, which is not in our gift; it makes a break loud. Each assumption is a
// probe that answers found or missing, and the Diagnostics tab shows the tally.
//
// Two rules for a probe, both learned from those breaks:
//   - It must run only where the thing it looks for can exist. A probe for chat markup on a page
//     with no conversation open counts zero and would cry wolf; `needs` states that.
//   - A count of zero is the failure being tested for. Never assert a shape a guess invented:
//     every selector below is one this plugin already depends on somewhere.
//   - It must be structural, not content-dependent. `[data-ref-chip]` is a hook this plugin really
//     uses and it was in this list until the first live run, where it read as missing simply
//     because the open conversation mentioned no skill and no file. A probe that depends on what
//     someone happened to type reports a breakage that is not one, and a check nobody trusts is
//     worse than no check. Measured on an open idle conversation, 2026-09-21: markdown 242 nodes,
//     ring 29, composer input 1, turn status 1, chips 0.

/** Where a probe is meaningful. A probe outside its context is skipped, not failed. */
export type ContractScope = "always" | "conversation";

export interface ContractProbe {
  /** Stable id, so a report can be compared between versions. */
  id: string;
  /** What breaks when this goes missing, in the owner's terms. */
  breaks: string;
  scope: ContractScope;
  /** How fragile it is: a generated class name is a hash dsh may rebuild, an ARIA role is not. */
  kind: "class" | "role" | "data";
  /** The selector this plugin already uses. */
  selector: string;
  /**
   * What a green answer is worth.
   *
   * `exact` means the selector picks out the very node the feature needs, so a count above zero
   * really is the hook still being there. `presence` means the selector is generic enough to match
   * other nodes too, so it catches the hook disappearing from the page and cannot catch it moving
   * to a node we no longer reach. That is the weaker half, and it is the half every past break
   * fell into, so a `presence` probe is a floor and not a guarantee. Prefer `exact`: use whatever
   * selector the feature itself uses, not a looser one that happens to match it.
   */
  detects: "exact" | "presence";
}

/** Every DOM assumption this plugin makes about dsh's own markup. */
export const DSH_CONTRACT: readonly ContractProbe[] = [
  {
    id: "markdown-body",
    breaks: "Claude-orange links, rules, quotes and checkboxes in messages",
    scope: "conversation",
    kind: "class",
    selector: '[class*="_markdown"]',
    detects: "exact",
  },
  {
    id: "composer-input",
    breaks: "the rainbow keyword paint in the composer",
    scope: "always",
    kind: "data",
    selector: "[data-composer-input]",
    detects: "exact",
  },
  {
    id: "ring-button",
    breaks: "plan usage in the context ring and its tooltip",
    scope: "always",
    kind: "role",
    // The ring's own arc, not merely a button that opens a dialog. Measured side by side on a
    // live page, 2026-09-21: the loose form matches 28 nodes and this one matches 1, so the loose
    // form would have reported the hook found while the ring had moved out from under us. This is
    // the selector the reader itself uses (`ARC` in index.tsx).
    selector: 'button[aria-haspopup="dialog"] circle + circle',
    detects: "exact",
  },
  {
    id: "turn-status",
    breaks: "the status row under a running turn",
    scope: "conversation",
    kind: "role",
    // dsh gives its turn-status element no hook of its own, so this is the pair the watcher looks
    // for and nothing narrows it further. Any polite status region on the page satisfies it, which
    // is why this one is `presence`: it catches the element going away, not the row moving to an
    // element we no longer style.
    selector: '[role="status"][aria-live="polite"]',
    detects: "presence",
  },
] as const;

export interface ContractResult {
  id: string;
  breaks: string;
  kind: ContractProbe["kind"];
  /** How many nodes the selector found. Zero with `skipped` false is the failure. */
  count: number;
  /** True when the page is not in a state where this could exist, so zero means nothing. */
  skipped: boolean;
}

/**
 * Run every probe against a document.
 *
 * The conversation-scoped probes calibrate each other rather than trusting a flag from outside.
 * Whether a conversation is on screen cannot be asked of the panel: the nearest thing it knows is
 * which session is open, and a session that is open with no messages yet renders none of this
 * markup, so every probe would read as missing on a brand-new session. Nor can one probe vouch for
 * the rest, which would be circular.
 *
 * So the group is its own control. If every conversation probe finds nothing, there is no
 * conversation content on screen and they are all skipped. If any one of them finds something,
 * the page is rendering a conversation and a zero beside it is a real miss. That is only wrong in
 * the case where dsh moves all of them in one release, which reads as "nothing to check" rather
 * than as a false alarm, and is the safe way to be wrong.
 */
export function checkContract(
  doc: Pick<Document, "querySelectorAll">,
  probes: readonly ContractProbe[] = DSH_CONTRACT,
): ContractResult[] {
  const counted = probes.map((probe) => ({
    probe,
    count: doc.querySelectorAll(probe.selector).length,
  }));
  const anyConversation = counted.some((c) => c.probe.scope === "conversation" && c.count > 0);
  return counted.map(({ probe, count }) => ({
    id: probe.id,
    breaks: probe.breaks,
    kind: probe.kind,
    count,
    skipped: probe.scope === "conversation" && !anyConversation,
  }));
}

/** The ones that should have been found and were not. */
export const contractMisses = (results: readonly ContractResult[]): ContractResult[] =>
  results.filter((r) => !r.skipped && r.count === 0);

/** One line for the panel: `dsh hooks: 5 of 5`, or the count that is missing. */
export function contractSummary(results: readonly ContractResult[]): string {
  const checked = results.filter((r) => !r.skipped);
  const missing = contractMisses(results);
  const skipped = results.length - checked.length;
  const tail = skipped > 0 ? `, ${skipped} not on screen` : "";
  if (checked.length === 0) return "dsh hooks: nothing to check on this screen";
  return missing.length === 0
    ? `dsh hooks: ${checked.length} of ${checked.length} found${tail}`
    : `dsh hooks: ${missing.length} of ${checked.length} missing${tail}`;
}
