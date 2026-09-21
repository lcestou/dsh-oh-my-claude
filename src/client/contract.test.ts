// Offline self-check: bun src/client/contract.test.ts. No DOM, no server.
import assert from "node:assert/strict";
import {
  checkContract,
  contractMisses,
  contractSummary,
  DSH_CONTRACT,
  type ContractProbe,
} from "./contract.js";

/** A stand-in document: every selector answers the count this map gives it. */
const docOf = (counts: Record<string, number>) => ({
  querySelectorAll: (sel: string) =>
    ({ length: counts[sel] ?? 0 }) as unknown as NodeListOf<Element>,
});

const probes: ContractProbe[] = [
  {
    id: "always-one",
    breaks: "a",
    scope: "always",
    kind: "role",
    selector: "#a",
    detects: "exact",
  },
  {
    id: "chat-one",
    breaks: "b",
    scope: "conversation",
    kind: "class",
    selector: "#b",
    detects: "exact",
  },
];

// Everything present: nothing missing, and the summary counts only what it checked.
{
  const r = checkContract(docOf({ "#a": 1, "#b": 3 }), probes);
  assert.deepEqual(contractMisses(r), []);
  assert.equal(contractSummary(r), "dsh hooks: 2 of 2 found");
}

// A conversation probe that finds nothing while another finds plenty is the failure this exists
// to catch: the page is rendering a conversation, so a zero is a real miss and not an empty page.
{
  const two = [
    ...probes,
    {
      id: "chat-two",
      breaks: "c",
      scope: "conversation",
      kind: "class",
      selector: "#c",
      detects: "exact",
    } as ContractProbe,
  ];
  const r = checkContract(docOf({ "#a": 1, "#c": 9 }), two);
  assert.deepEqual(
    contractMisses(r).map((m) => m.id),
    ["chat-one"],
  );
  assert.equal(contractSummary(r), "dsh hooks: 1 of 3 missing");
}

// No conversation content at all: the conversation probes calibrate each other and all skip,
// rather than every one of them reporting a breakage on a screen that simply has no chat on it.
{
  const r = checkContract(docOf({ "#a": 1 }), probes);
  assert.deepEqual(contractMisses(r), [], "a skipped probe is never a miss");
  assert.equal(r.find((x) => x.id === "chat-one")?.skipped, true);
  assert.equal(contractSummary(r), "dsh hooks: 1 of 1 found, 1 not on screen");
}

// The ring is conversation-scoped, so on a blank session it calibrates with the other conversation
// probes: none of them finds anything, so they all skip and the ring is not reported missing even
// though its selector matched zero nodes. The composer is still present on a blank session (that is
// how the first message is typed), so it is the one always-scoped probe that is actually found and
// the only thing keeping the tally from being empty. Selectors are looked up from the shipped list,
// not retyped.
{
  const composer = DSH_CONTRACT.find((p) => p.id === "composer-input")!;
  const blank = Object.fromEntries(DSH_CONTRACT.map((p) => [p.selector, 0]));
  blank[composer.selector] = 1;
  const r = checkContract(docOf(blank), DSH_CONTRACT);
  assert.equal(
    r.find((x) => x.id === "ring-button")?.skipped,
    true,
    "the ring skips on a blank session, it does not fail",
  );
  assert.deepEqual(
    contractMisses(r),
    [],
    "no conversation probe finds anything, so there is no miss to report",
  );
}

// With a conversation on screen the ring is checked, so a zero beside it is a real miss. The markdown
// and turn-status probes find something, the always-scoped composer finds something, and only the
// ring finds nothing: it is the sole miss, exactly as a live break would read.
{
  const md = DSH_CONTRACT.find((p) => p.id === "markdown-body")!;
  const turn = DSH_CONTRACT.find((p) => p.id === "turn-status")!;
  const composer = DSH_CONTRACT.find((p) => p.id === "composer-input")!;
  const ring = DSH_CONTRACT.find((p) => p.id === "ring-button")!;
  const r = checkContract(
    docOf({ [md.selector]: 1, [turn.selector]: 1, [composer.selector]: 1, [ring.selector]: 0 }),
    DSH_CONTRACT,
  );
  assert.deepEqual(
    contractMisses(r).map((m) => m.id),
    ["ring-button"],
    "with a conversation on screen the ring is checked and a zero is a real miss",
  );
}

// A screen where nothing can be checked says so rather than claiming everything is well.
{
  const r = checkContract(docOf({}), [probes[1]!]);
  assert.equal(contractSummary(r), "dsh hooks: nothing to check on this screen");
}

// An always-scoped probe is never calibrated away: it is missing whatever else the page holds.
{
  const r = checkContract(docOf({ "#b": 4 }), probes);
  assert.deepEqual(
    contractMisses(r).map((m) => m.id),
    ["always-one"],
  );
}

// The shipped list: every entry is distinct, and every selector is one the plugin really uses.
{
  const ids = DSH_CONTRACT.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique so a report can be diffed");
  for (const p of DSH_CONTRACT) {
    assert.ok(p.selector.length > 0, `${p.id} has a selector`);
    assert.ok(p.breaks.length > 0, `${p.id} says what breaks`);
  }
}

// A loose selector cannot tell the right node from any node, which is how every past dsh break
// went: the thing kept its name and moved. Every probe that claims `exact` must therefore use the
// selector its feature uses, and the ring is the one that was wrong: `button[aria-haspopup]`
// matched 28 nodes on a live page against 1 for the arc.
{
  const ring = DSH_CONTRACT.find((p) => p.id === "ring-button");
  assert.ok(ring, "the ring probe is in the list");
  assert.ok(
    ring.selector.includes("circle"),
    "the ring probe names the arc, not merely a button that opens a dialog",
  );
  for (const probe of DSH_CONTRACT)
    assert.ok(
      probe.detects === "exact" || probe.detects === "presence",
      `${probe.id} says what a green answer is worth`,
    );
}

console.log("contract ok");
