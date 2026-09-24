// Offline self-check: bun src/session-repair.test.ts. The repair's own fixture, the one the dev
// tool carried, plus the refusal words and the zstd round trip under DSH_OMC_STATE_DIR.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STATE_DIR } from "./state.js";
import {
  frame,
  knownRefusal,
  readLog,
  repair,
  restoreBak,
  writeLog,
  type Block,
  type Data,
  type Row,
} from "./session-repair.js";

/** Build an event row with a seq, time and data for the self-check, the shape dsh's migration chain
 *  expects.
 */
const ev = (seq: number, type: string, data: Data, extra: Partial<Row> = {}): Row => ({
  type,
  seq,
  time: seq,
  data,
  ...extra,
});
/** Build an assistant message row for the self-check, tagged as a model with placeholder provider
 *  and model.
 */
const msg = (id: string, content: Block[]) => ({
  role: "assistant",
  id,
  source: { kind: "model", provider: "p", model: "m" },
  content,
});

/** Assert the repair drops exactly the orphaned call, its result and the prune that shadowed them,
 *  and keeps the seq slots contiguous.
 */

{
  const rows: Row[] = [
    ev(0, "turn/start", { turn: 1 }),
    ev(1, "step/start", { turn: 1, step: 1 }),
    ev(2, "assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: { type: "block-start", index: 0, blockType: "text" },
    }),
    ev(3, "tool/call", { turn: 1, step: 1, callId: "orphan", name: "bash", arguments: "{}" }),
    ev(
      4,
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: { source: { kind: "tool", callId: "orphan" }, content: [], role: "user", id: "r" },
      },
      { surfaceOp: "append", sourceEventSeqs: [3] },
    ),
    {
      type: "text-chunks",
      seq0: 5,
      time0: 5,
      data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ["a", "b"] },
    },
    ev(7, "assistant/chunk", {
      turn: 1,
      step: 1,
      chunk: { type: "block-end", index: 0, block: { type: "text", text: "ab" } },
    }),
    ev(
      8,
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: msg("m1", [
          { type: "text", text: "ab" },
          { type: "tool-call", id: "adv", name: "x", arguments: "{}" },
        ]),
      },
      { surfaceOp: "append", sourceEventSeqs: [[2, 7]] },
    ),
    ev(9, "tool/call", { turn: 1, step: 1, callId: "adv", name: "x", arguments: "{}" }),
    ev(10, "compaction/prune", {
      shadowedRange: { start: 3, end: 4 },
      shadowedSeqs: [3, 4],
      shadowedTokenCount: 1,
    }),
    ev(
      11,
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: { source: { kind: "tool", callId: "adv" }, content: [], role: "user", id: "r2" },
      },
      { surfaceOp: "append", sourceEventSeqs: [9] },
    ),
    ev(12, "step/end", { turn: 1, step: 1 }),
    ev(13, "turn/end", { turn: 1, reason: "done" }),
    // A second turn stopped by the user with a native call open: no tool/result before step/end.
    ev(14, "turn/start", { turn: 2 }),
    ev(15, "step/start", { turn: 2, step: 1 }),
    ev(
      16,
      "assistant/message",
      { turn: 2, step: 1, message: msg("m2", [{ type: "tool-call", id: "open", name: "bash" }]) },
      { surfaceOp: "append", sourceEventSeqs: [] },
    ),
    ev(17, "tool/call", { turn: 2, step: 1, callId: "open", name: "bash", arguments: "{}" }),
    ev(18, "step/end", { turn: 2, step: 1 }),
    ev(19, "turn/end", { turn: 2, reason: "aborted" }),
  ];
  const { rows: out, droppedCalls, addedHead, closedCalls } = repair(structuredClone(rows));
  assert.equal(droppedCalls, 1, "one unadvertised call dropped");
  assert.equal(closedCalls, 1, "one call still open at its step/end got a placeholder result");
  assert.equal(addedHead, true, "the first surface row was not a system/message");
  assert.deepEqual(
    out.map((e) => e.type),
    [
      "turn/start",
      "step/start",
      "assistant/chunk",
      "text-chunks",
      "assistant/chunk",
      "system/message",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
      "turn/start",
      "step/start",
      "assistant/message",
      "tool/call",
      "tool/result",
      "step/end",
      "turn/end",
    ],
    "orphan call, its result and the prune that shadowed only them are gone; the head sits ahead of the first surface row; the open call is closed before its step/end",
  );
  // seq slots stay contiguous: 0,1,2 then the packed run owns 3-4, then 5..
  assert.deepEqual(
    out.filter((e) => e.seq !== undefined).map((e) => e.seq),
    [0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  );
  const closing = out[15]!;
  assert.equal(closing.data?.message?.toolCallId, "open", "the placeholder answers the open call");
  assert.deepEqual(closing.sourceEventSeqs, [15], "and cites the call's renumbered seq");
  assert.equal(out[3]?.seq0, 3);
  assert.deepEqual(out[5]?.data, {
    turn: 1,
    step: 1,
    message: {
      id: "restored:system",
      role: "system",
      content: [{ type: "text", text: out[5]?.data?.message?.content?.[0]?.text }],
      source: { kind: "system-prompt" },
    },
  });
  assert.deepEqual(
    out[6]?.sourceEventSeqs,
    [[2, 5]],
    "message range follows the surviving chunk seqs",
  );
  assert.deepEqual(out[8]?.sourceEventSeqs, [8], "advertised call's result still cites its call");
  // A log whose first surface row already is a system/message is left alone.
  const headed = repair(structuredClone(out));
  assert.equal(headed.addedHead, false);
  assert.equal(headed.closedCalls, 0, "a closed call is not closed twice");
  assert.equal(headed.rows.length, out.length);
  // The placeholder text is pinned as a literal, not the constant, so a drift in the adapter's
  // own placeholder shows here.
  assert.equal(
    closing.data?.message?.content?.[0]?.text,
    "(still running when dsh took over this step; the output shows in the next step)",
  );
}

// The refusal words the repair mends, and one it must leave alone.
{
  for (const s of [
    "tool/call x does not match one advertised tool call",
    "tool/call y has no advertised tool lifecycle",
    "system/message requires a protected first surface head",
    "step/end leaves unresolved tool call z",
    "headless",
  ])
    assert.equal(knownRefusal(s), true, s);
  assert.equal(
    knownRefusal("V3 catalog migration requires explicit historical child facts"),
    false,
  );
  assert.equal(knownRefusal(""), false);
}

// The zstd round trip: three frames in, header and rows out; the write copies the original to a
// `.bak` beside it and the log path is never absent.
{
  const dir = join(STATE_DIR, "session-repair-test");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "session.v4.jsonl.zstd");
  const header = { type: "session", version: 4, id: "s" };
  const rows: Row[] = [ev(0, "turn/start", { turn: 1 }), ev(1, "turn/end", { turn: 1 })];
  writeFileSync(
    file,
    Buffer.concat([
      frame(JSON.stringify(header) + "\n"),
      frame(JSON.stringify(rows[0]) + "\n"),
      frame(JSON.stringify(rows[1]) + "\n"),
    ]),
  );
  const read = readLog(file);
  assert.deepEqual(read.header, header);
  assert.deepEqual(read.rows, rows);
  const bak = writeLog(file, read.header, read.rows.slice(0, 1));
  assert.equal(existsSync(file), true);
  assert.equal(existsSync(bak), true);
  assert.equal(readLog(file).rows.length, 1);
  restoreBak(file, bak);
  assert.equal(readLog(file).rows.length, 2, "the backup goes back over the log");
  restoreBak(file, join(dir, "missing.bak"));
  assert.equal(readdirSync(dir).length, 2);
}

console.log("session-repair: ok");
