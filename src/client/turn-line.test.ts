// Offline self-check: bun src/client/turn-line.test.ts. The header line's teardown on a bundle
// replace must leave dsh's process group unmarked, or the next bundle refuses to wire it: a mark
// written at reload kept the next bundle from wiring the still-running turn for the rest of it
// (owner, 2026-09-23).
import { strict as assert } from "node:assert";

// `spinner.test.ts` imports the same module statically with no DOM global set, and `stopTurnLine`
// reads none.
import { stopTurnLine } from "./index.js";

/** A group button and a line inside it, with only what `stopTurnLine` reads and writes. */
function fixture() {
  const marks: Record<string, string> = {};
  const group = { setAttribute: (name: string, value: string) => void (marks[name] = value) };
  let removed = 0;
  const line = {
    hasAttribute: (name: string) => name === "data-omc-turn-line",
    closest: () => group,
    remove: () => void removed++,
  };
  // SAFETY: the fake carries the four members the function touches.
  return { line: line as unknown as HTMLElement, marks, removedCount: () => removed };
}

// The turn ended: the group is marked before the line goes, so no scan wires it again.
{
  const f = fixture();
  stopTurnLine(f.line);
  assert.equal(f.marks["data-omc-turn-done"], "1");
  assert.equal(f.removedCount(), 1);
}

// The bundle is being replaced: the line goes, the group stays unmarked for the next bundle.
{
  const f = fixture();
  stopTurnLine(f.line, false);
  assert.equal(f.marks["data-omc-turn-done"], undefined);
  assert.equal(f.removedCount(), 1);
}

// The dock's line (`wireTurnStatus` on the span above the composer): a real line with no group
// button above it. It goes either way, and there is nothing to mark.
{
  let removed = 0;
  const line = {
    hasAttribute: (name: string) => name === "data-omc-turn-line",
    closest: () => null,
    remove: () => void removed++,
  };
  // SAFETY: the fake carries the members the function touches.
  stopTurnLine(line as unknown as HTMLElement, true);
  stopTurnLine(line as unknown as HTMLElement, false);
  assert.equal(removed, 2);
}

// Not a line at all (the 0.1.6 status row, the dock span's parent): nothing happens either way.
{
  let touched = 0;
  const row = {
    hasAttribute: () => false,
    closest: () => void touched++,
    remove: () => void touched++,
  };
  // SAFETY: the fake carries the members the function touches.
  stopTurnLine(row as unknown as HTMLElement, false);
  assert.equal(touched, 0);
}

console.log("turn-line: ok");
