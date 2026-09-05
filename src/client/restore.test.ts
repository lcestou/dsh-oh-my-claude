import { strict as assert } from "node:assert";
import { type SessionData, isOwnedActive } from "./index.js";

const sess = (id: string, over: Partial<SessionData> = {}): SessionData => ({
  id,
  modifiedAt: 1_000_000,
  turns: 0,
  bytes: 0,
  ...over,
});

// Fresh Claude transcript — not owned by dsh.
{
  const s = sess("c1");
  assert.equal(isOwnedActive(s), false, "no dsh → not owned");
}

// Owned and active (id set, not archived).
{
  const s = sess("c2", { dsh: { id: "dsh-abc", archived: false } });
  assert.equal(isOwnedActive(s), true, "owned and not archived");
}

// Owned but archived — should be skipped from restore list.
{
  const s = sess("c3", { dsh: { id: "dsh-def", archived: true } });
  assert.equal(isOwnedActive(s), false, "archived → not owned active");
}

// No id field but dsh object present — not owned.
{
  const s = sess("c4", { dsh: { archived: false } });
  assert.equal(isOwnedActive(s), false, "missing id → not owned");
}

// Full pipeline: filter + cap.
{
  const transcripts: SessionData[] = [
    sess("a"), // fresh
    sess("b", { dsh: { id: "x", archived: false } }), // owned active
    sess("c"), // fresh
    sess("d", { dsh: { id: "y", archived: true } }), // archived
    sess("e"), // fresh
  ];
  const owned = transcripts.filter(isOwnedActive);
  const rest = transcripts.filter((s) => !isOwnedActive(s)).slice(0, 8);
  assert.equal(owned.length, 1, "only one owned active");
  assert.equal(owned[0]?.id, "b");
  assert.equal(rest.length, 4, "four non-owned transcripts (including archived)");
  assert.deepEqual(
    rest.map((s) => s.id),
    ["a", "c", "d", "e"],
  );
}

// Cap at 8 rows.
{
  const many = Array.from({ length: 12 }, (_, i) => sess(`s${i}`));
  const rest = many.filter((s) => !isOwnedActive(s)).slice(0, 8);
  assert.equal(rest.length, 8, "capped at 8");
}

console.log("restore: ok");
