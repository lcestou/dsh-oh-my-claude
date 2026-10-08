import assert from "node:assert/strict";
import { costStatesOf } from "./process.js";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPAIR_MARKER, repairStoredTurns, repairTurns, type StoredTurn } from "./turn-repair.js";

/** A stored record; `totals` adds the session totals a newer record carries. */
const turn = (costUsd: number, apiMs: number, durationMs: number, totals?: [number, number]) => {
  const record: StoredTurn = { costUsd, apiMs, durationMs };
  if (totals) {
    record.costTotal = totals[0];
    record.apiTotal = totals[1];
  }
  return record;
};
const exit = (costUsd: number, apiMs: number) => ({ costUsd, apiMs });
const costs = (r: { turns: Array<{ costUsd: number }> }) =>
  r.turns.map((t) => +t.costUsd.toFixed(2));

// The session this was found on, 2026-10-07: two turns stored with the session's total, each the
// first after a process relaunch. The transcript's exit rows say where the session stood.
{
  const stored = [
    turn(0.73, 89_128, 152_580),
    turn(0.07, 5_289, 6_358),
    turn(580.71, 27_510_313, 1_570_019),
    turn(593.17, 28_112_098, 963_376),
  ];
  const exits = [exit(330.54, 15_002_317), exit(569.46, 26_371_690), exit(580.71, 27_510_313)];
  const r = repairTurns(stored, exits);
  assert.equal(r.repaired, 2);
  assert.deepEqual(costs(r), [0.73, 0.07, 11.25, 12.46]);
  assert.equal(r.turns[2]?.apiMs, 27_510_313 - 26_371_690);
  assert.equal(stored[2]?.costUsd, 580.71, "the input is not changed");
}
// A handle attached to a process that kept running: no exit row lies between, and the total the
// earlier records add up to is the base.
{
  const r = repairTurns(
    [turn(10, 500_000, 400_000), turn(2, 60_000, 90_000), turn(15, 700_000, 100_000)],
    [],
  );
  // The first is a total with nothing before it and stays; 10 + 2 is where the session stood. What
  // is left of the third, 3 over 140 s of API time, is still longer than its 100 s, so it is cut
  // to the turn's length at that rate.
  assert.deepEqual(costs(r), [10, 2, 2.14]);
  assert.equal(r.turns[2]?.apiMs, 100_000);
  assert.equal(r.repaired, 1);
}
// Nothing smaller is known before it and it is the session's first record: left alone, the total
// and the turn are the same figure.
assert.deepEqual(costs(repairTurns([turn(40, 900_000, 100_000)], [exit(40, 900_000)])), [40]);
// The same record when the ring has dropped what came before it, or further down the list: cut to
// the turn's length at the figure's own rate, 40 over 900 s for a 100 s turn.
assert.deepEqual(costs(repairTurns([turn(40, 900_000, 100_000)], [], false)), [4.44]);
assert.deepEqual(
  costs(repairTurns([turn(1, 50_000, 60_000), turn(40, 900_000, 100_000)], [])),
  [1, 4.44],
);
// A record that kept its totals but was stored at them, by a handle attached too early: its own
// share is what it adds to the record before it, and its totals stay as they were.
{
  const r = repairTurns(
    [turn(593.17, 28_112_098, 963_376), turn(601.91, 28_900_000, 1_096_000, [601.91, 28_900_000])],
    [exit(580.71, 27_510_313)],
    false,
  );
  assert.deepEqual(costs(r), [12.46, 8.74]);
  assert.equal(r.turns[1]?.costTotal, 601.91);
}
// A record that kept its own totals and its own cost is never touched, and gives the base for
// what follows.
{
  const r = repairTurns(
    [turn(1, 50_000, 60_000, [100, 5_000_000]), turn(104, 5_300_000, 400_000)],
    [],
  );
  assert.deepEqual(costs(r), [1, 4]);
}
// API time within the turn's own length is an ordinary turn, whatever it cost.
assert.equal(repairTurns([turn(5, 100_000, 90_000), turn(900, 80_000, 90_000)], []).repaired, 0);
// An exit row above the stored figure, or with more API time than it, is not a base.
assert.deepEqual(
  costs(repairTurns([turn(50, 900_000, 100_000)], [exit(60, 100), exit(10, 950_000)])),
  [50],
);
// No repaired record costs more than it was stored at.
{
  const stored = [
    turn(3, 1_000, 2_000),
    turn(700, 9_000_000, 60_000),
    turn(705, 9_050_000, 40_000),
  ];
  const r = repairTurns(stored, [exit(2, 500), exit(650, 8_000_000)], false);
  for (const [i, t] of r.turns.entries()) assert.ok(t.costUsd <= stored[i]!.costUsd);
}
assert.deepEqual(repairTurns([], []), { turns: [], repaired: 0 });

// Every exit row of a transcript, in order; a torn one is skipped.
const row = (cost: number, api: number) =>
  JSON.stringify({ type: "cost-state", totalCostUSD: cost, totalAPIDuration: api });
assert.deepEqual(
  costStatesOf(
    [row(1, 2), '{"type":"user"}', row(3, 4), '{"type":"cost-state","totalCostUSD":9'].join("\n"),
  ),
  [exit(1, 2), exit(3, 4)],
);
assert.deepEqual(costStatesOf(""), []);

// The pass over a state directory: one session repaired from its transcript's exit rows, one left
// alone, one that belongs to another mount not touched; a copy kept, a marker written, and a
// second pass that does nothing.
{
  const stateDir = await mkdtemp(join(tmpdir(), "omc-repair-state-"));
  const claudeHome = await mkdtemp(join(tmpdir(), "omc-repair-home-"));
  await mkdir(join(claudeHome, "projects", "-w"), { recursive: true });
  await writeFile(
    join(claudeHome, "projects", "-w", "claude-a.jsonl"),
    [row(330.54, 15_002_317), row(569.46, 26_371_690), ""].join("\n"),
  );
  const stored = {
    a: [turn(0.73, 89_128, 152_580), turn(580.71, 27_510_313, 1_570_019)],
    b: [turn(2, 40_000, 60_000)],
    other: [turn(900, 9_000_000, 1_000)],
  };
  await writeFile(join(stateDir, "turns.json"), JSON.stringify(stored));
  const buffer = new Map<string, StoredTurn[]>(Object.entries(structuredClone(stored)));
  const saved: string[] = [];
  const host = {
    stateDir,
    claudeHome,
    buffer,
    ids: new Set(["a", "b"]),
    ring: 50,
    claudeIdOf: (id: string) => `claude-${id}`,
    save: async (id: string) => void saved.push(id),
  };
  const report = await repairStoredTurns(host);
  assert.equal(report?.repaired, 1);
  assert.equal(report?.sessions, 1);
  assert.deepEqual(saved, ["a"], "only the changed session is saved");
  assert.equal(buffer.get("a")?.[1]?.costUsd.toFixed(2), "11.25");
  assert.equal(buffer.get("b")?.[0]?.costUsd, 2);
  assert.equal(
    buffer.get("other")?.[0]?.costUsd,
    900,
    "another mount's session is not this pass's",
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(stateDir, "turns.json.before-repair"), "utf8")),
    stored,
    "the figures as they were",
  );
  assert.equal(JSON.parse(await readFile(REPAIR_MARKER(stateDir), "utf8")).repaired, 1);
  assert.equal(await repairStoredTurns(host), undefined, "a second pass finds the marker");
  // Nothing to repair still leaves a marker, and no copy.
  const clean = await mkdtemp(join(tmpdir(), "omc-repair-clean-"));
  const none = await repairStoredTurns({ ...host, stateDir: clean, ids: new Set(["b"]) });
  assert.deepEqual([none?.repaired, none?.sessions], [0, 0]);
  await assert.rejects(readFile(join(clean, "turns.json.before-repair"), "utf8"));
  assert.equal(JSON.parse(await readFile(REPAIR_MARKER(clean), "utf8")).repaired, 0);
}
