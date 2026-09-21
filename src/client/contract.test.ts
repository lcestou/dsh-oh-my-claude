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
  const r = checkContract(docOf({ "#a": 1, "#b": 3 }), true, probes);
  assert.deepEqual(contractMisses(r), []);
  assert.equal(contractSummary(r), "dsh hooks: 2 of 2 found");
}

// A selector that finds nothing is the failure this exists to catch.
{
  const r = checkContract(docOf({ "#a": 1 }), true, probes);
  assert.deepEqual(
    contractMisses(r).map((m) => m.id),
    ["chat-one"],
  );
  assert.equal(contractSummary(r), "dsh hooks: 1 of 2 missing");
}

// Off a conversation, the chat probe is skipped rather than reported. An empty page answers zero
// for every selector, so counting it would report a breakage on every screen that has no chat.
{
  const r = checkContract(docOf({ "#a": 1 }), false, probes);
  assert.deepEqual(contractMisses(r), [], "a skipped probe is never a miss");
  assert.equal(r.find((x) => x.id === "chat-one")?.skipped, true);
  assert.equal(contractSummary(r), "dsh hooks: 1 of 1 found, 1 not on screen");
}

// A screen where nothing can be checked says so rather than claiming everything is well.
{
  const r = checkContract(docOf({}), false, [probes[1]!]);
  assert.equal(contractSummary(r), "dsh hooks: nothing to check on this screen");
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
