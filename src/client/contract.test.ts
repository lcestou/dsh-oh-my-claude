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
  { id: "always-one", breaks: "a", scope: "always", kind: "role", selector: "#a" },
  { id: "chat-one", breaks: "b", scope: "conversation", kind: "class", selector: "#b" },
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
    { id: "chat-two", breaks: "c", scope: "conversation", kind: "class", selector: "#c" } as const,
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

console.log("contract ok");
