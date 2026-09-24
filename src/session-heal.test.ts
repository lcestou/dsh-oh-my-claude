// Offline self-check: bun src/session-heal.test.ts. A fake dsh: a persistence whose read-open
// refuses a log with an open tool call the way dsh 0.1.7 does, and a catalog whose restore does
// the same; real files under DSH_OMC_STATE_DIR.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR, loadSessionRepairs } from "./state.js";
import { frame, readLog, type Catalog, type Row } from "./session-repair.js";
import {
  healLog,
  probeLoad,
  rawLogPath,
  repairsSummary,
  sweepRefusedLogs,
  type HealHost,
} from "./session-heal.js";
import { writeFileSync } from "node:fs";

const dir = join(STATE_DIR, "heal-test");
mkdirSync(dir, { recursive: true });

/** A row with seq, time and data, the shape the repair reads. */
const ev = (seq: number, type: string, data: Row["data"], extra: Partial<Row> = {}): Row => ({
  type,
  seq,
  time: seq,
  data,
  ...extra,
});
/** A v4 log: a system head, then a turn stopped with a native call open (no tool/result). */
const stoppedRows = (): Row[] => [
  ev(
    0,
    "system/message",
    {
      turn: 1,
      step: 1,
      message: { id: "sys", role: "system", content: [], source: { kind: "system-prompt" } },
    },
    { surfaceOp: "append" },
  ),
  ev(1, "turn/start", { turn: 1 }),
  ev(2, "step/start", { turn: 1, step: 1 }),
  ev(
    3,
    "assistant/message",
    {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        id: "m",
        source: { kind: "model", provider: "p", model: "m" },
        content: [{ type: "tool-call", id: "open", name: "bash" }],
      },
    },
    { surfaceOp: "append", sourceEventSeqs: [] },
  ),
  ev(4, "tool/call", { turn: 1, step: 1, callId: "open", name: "bash", arguments: "{}" }),
  ev(5, "step/end", { turn: 1, step: 1 }),
  ev(6, "turn/end", { turn: 1, reason: "aborted" }),
];
/** dsh 0.1.7's rule, as both the fake load and the fake catalog apply it. */
const refusalOf = (rows: readonly Row[]): string | undefined => {
  const open = new Set<string>();
  for (const r of rows) {
    if (r.type === "tool/call" && typeof r.data?.callId === "string") open.add(r.data.callId);
    const answered = r.data?.message?.toolCallId ?? r.data?.message?.source?.callId;
    if (r.type === "tool/result" && typeof answered === "string") open.delete(answered);
    if (r.type === "step/end" && open.size > 0) return "step/end leaves unresolved tool call";
  }
  return undefined;
};
/** Write a log file as two frames, header then rows. */
const writeFixture = (file: string, rows: Row[]) => {
  const header = { type: "session", version: 4, id: "s1", cwd: "/w" };
  writeFileSync(
    file,
    Buffer.concat([
      frame(JSON.stringify(header) + "\n"),
      frame(rows.map((r) => JSON.stringify(r)).join("\n") + "\n"),
    ]),
  );
};
const catalog: Catalog = {
  currentVersion: 4,
  createRestore() {
    const rows: Row[] = [];
    return {
      decodeRow(row: Row) {
        rows.push(row);
      },
      finish() {
        const why = refusalOf(rows);
        if (why) throw new Error(why);
      },
    };
  },
};
/** A host over one directory of logs named `<id>.zstd`; `open` reads the file and applies the
 *  rule, `opens` counts the calls, `alwaysRefuse` makes every open fail (the rollback case). */
function hostFor(opts: { alwaysRefuse?: boolean } = {}) {
  const opens: string[] = [];
  const logs: string[] = [];
  const host: HealHost = {
    persistence: {
      list: async () => logs.map((id) => ({ header: { id, cwd: "/w" } })),
      open: async (id) => {
        opens.push(id);
        const file = join(dir, `${id}.zstd`);
        if (!existsSync(file)) {
          const e = new Error("no such session");
          e.name = "SessionPersistenceNotFoundError";
          throw e;
        }
        const { rows } = readLog(file);
        const why = opts.alwaysRefuse ? "still refused after the rewrite" : refusalOf(rows);
        if (why) throw new Error(why);
        return { read: async () => ({ events: rows }), close: async () => {} };
      },
      locate: (meta) => ({ kind: "jsonl", path: join(dir, `${meta.id}.zstd`) }),
    },
    catalog: async () => catalog,
    stateDir: dir,
    log: () => {},
  };
  return { host, opens, logs };
}

// A known refusal: the log is rewritten with a .bak beside it, the closing result is in, and the
// record says healed.
{
  const { host } = hostFor();
  const file = join(dir, "s1.zstd");
  writeFixture(file, stoppedRows());
  assert.equal(await probeLoad(host, "s1"), "step/end leaves unresolved tool call");
  const record = await healLog(host, "s1", file, "step/end leaves unresolved tool call");
  assert.equal(record.verdict, "healed");
  assert.deepEqual(record.did, { droppedCalls: 0, addedHead: false, closedCalls: 1 });
  assert.equal(existsSync(record.bak ?? ""), true, "a .bak sits beside the log");
  assert.equal(
    readLog(file).rows.some((r) => r.type === "tool/result"),
    true,
    "the closing result is in the rewritten log",
  );
  assert.equal(await probeLoad(host, "s1"), undefined, "and dsh loads it now");
  assert.equal((await loadSessionRepairs(dir)).logs.s1?.verdict, "healed");
}

// A log that loads but whose first surface row is not the system head: the probe says headless,
// and the heal adds the head.
{
  const { host } = hostFor();
  const file = join(dir, "s1.zstd");
  writeFixture(
    file,
    stoppedRows()
      .slice(1)
      .concat([
        ev(
          7,
          "tool/result",
          {
            turn: 1,
            step: 1,
            message: {
              toolCallId: "open",
              source: { kind: "tool", callId: "open" },
              content: [],
              role: "tool",
              id: "r",
            },
          },
          { surfaceOp: "append", sourceEventSeqs: [4] },
        ),
      ])
      .map((r, i) => ({ ...r, seq: i, time: i })),
  );
  // Put the result before step/end so the rule is happy and only the head is missing.
  const rows = readLog(file).rows;
  const result = rows.find((r) => r.type === "tool/result")!;
  const ordered = rows.filter((r) => r.type !== "tool/result");
  ordered.splice(
    ordered.findIndex((r) => r.type === "step/end"),
    0,
    result,
  );
  writeFixture(
    file,
    ordered.map((r, i) => ({ ...r, seq: i, time: i })),
  );
  assert.equal(await probeLoad(host, "s1"), "headless");
  const record = await healLog(host, "s1", file, "headless");
  assert.equal(record.verdict, "healed");
  assert.equal(record.did?.addedHead, true);
  assert.equal(await probeLoad(host, "s1"), undefined);
}

// A refusal the repair has nothing for: the record says unknown and the file is untouched.
{
  const { host } = hostFor();
  const file = join(dir, "s1.zstd");
  writeFixture(file, stoppedRows());
  const before = readFileSync(file);
  const record = await healLog(
    host,
    "s1",
    file,
    "V3 catalog migration requires explicit historical child facts",
  );
  // The repair closes the open call regardless of the reason text, so this is a heal; the
  // unknown case is a log with nothing to repair:
  assert.equal(record.verdict, "healed");
  const again = await healLog(host, "s1", file, "some new refusal dsh grew");
  assert.equal(again.verdict, "unknown");
  assert.match(again.reason ?? "", /nothing to repair/);
  assert.notDeepEqual(before, readFileSync(file), "the first heal rewrote it");
  const after = readFileSync(file);
  assert.deepEqual(after, readFileSync(file), "the unknown verdict wrote nothing");
}

// The second proof fails: the .bak goes back and the record says rolled back.
{
  const { host } = hostFor({ alwaysRefuse: true });
  const file = join(dir, "s1.zstd");
  writeFixture(file, stoppedRows());
  const before = readFileSync(file);
  const record = await healLog(host, "s1", file, "step/end leaves unresolved tool call");
  assert.equal(record.verdict, "rolled-back");
  assert.match(record.reason ?? "", /still refused/);
  assert.deepEqual(readFileSync(file), before, "the original is back, byte for byte");
}

// The path dsh names in a refusal.
assert.equal(
  rawLogPath(
    "wake session-bbc4e917: resume failed: step/end leaves unresolved tool call x (raw log: /home/u/.dsh/sessions/--w--/session-bbc4e917/session.v4.jsonl.zstd)",
  ),
  "/home/u/.dsh/sessions/--w--/session-bbc4e917/session.v4.jsonl.zstd",
);
assert.equal(rawLogPath("no path here"), undefined);

// The sweep: a refused log is healed, a log whose stat matches its record is not opened again,
// and a listed session whose located file does not exist gets no record.
{
  // A fresh id: the blocks above left s1 a record whose stat can match a rewrite made in the
  // same millisecond, which is exactly the skip the second sweep below asserts.
  const { host, opens, logs } = hostFor();
  logs.push("s3", "gone");
  writeFixture(join(dir, "s3.zstd"), stoppedRows());
  const first = await sweepRefusedLogs(host);
  assert.deepEqual(first, { healed: 1, unknown: 0, rolledBack: 0 });
  const file = await loadSessionRepairs(dir);
  assert.equal(file.logs.s3?.verdict, "healed");
  assert.equal("gone" in file.logs, false, "an older generation gets no record");
  assert.ok(file.lastSweepAt > 0);
  const openedBefore = opens.length;
  const second = await sweepRefusedLogs(host);
  assert.deepEqual(second, { healed: 0, unknown: 0, rolledBack: 0 });
  assert.equal(opens.length, openedBefore, "an unchanged log is not opened again");
  // A log still refused is probed again on the next sweep whatever its stat says: a later
  // plugin may mend what this one could not.
  const { saveSessionRepairs } = await import("./state.js");
  const stuck = await loadSessionRepairs(dir);
  stuck.logs.s3 = { ...stuck.logs.s3!, verdict: "rolled-back", reason: "still refused" };
  await saveSessionRepairs(dir, stuck);
  const openedBeforeRetry = opens.length;
  await sweepRefusedLogs(host);
  assert.equal(opens.length, openedBeforeRetry + 1, "a rolled-back log is probed again");
  assert.equal((await loadSessionRepairs(dir)).logs.s3?.verdict, "fine", "and it loads now");
  const summary = repairsSummary(file, 0);
  assert.equal(summary.healed, 1);
  assert.equal(repairsSummary(file, Date.now() + 1).healed, 0, "seen entries do not count");
}

console.log("session-heal: ok");
