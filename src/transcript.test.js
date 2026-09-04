// Offline check for the Claude Code transcript → dsh events conversion.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldTranscript, listTranscripts, toSessionEvents, truncateBytes } from "./transcript.js";

const line = (o) => JSON.stringify(o);
const T = "2026-09-03T08:00:00.000Z";
const transcript = [
  line({ type: "summary", summary: "Fix the widget" }),
  line({
    type: "user",
    uuid: "u1",
    timestamp: T,
    message: { role: "user", content: [{ type: "text", text: "fix the widget please" }] },
  }),
  line({
    type: "assistant",
    uuid: "a1",
    timestamp: T,
    message: {
      id: "m1",
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "thinking", thinking: "look first" }],
    },
  }),
  line({
    type: "assistant",
    uuid: "a2",
    timestamp: T,
    message: {
      id: "m1",
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }],
    },
  }),
  line({
    type: "user",
    uuid: "u2",
    timestamp: T,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "contents", is_error: false }],
    },
  }),
  line({
    type: "assistant",
    uuid: "a3",
    timestamp: T,
    message: {
      id: "m2",
      model: "claude-opus-5",
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
    },
  }),
  line({
    type: "user",
    uuid: "s1",
    isSidechain: true,
    timestamp: T,
    message: { role: "user", content: "subagent prompt" },
  }),
  line({
    type: "user",
    uuid: "u3",
    isMeta: true,
    timestamp: T,
    message: { role: "user", content: "<local-command-stdout>x</local-command-stdout>" },
  }),
  line({
    type: "user",
    uuid: "u4",
    timestamp: T,
    message: { role: "user", content: "and now this one, unanswered" },
  }),
  "not json",
].join("\n");

const folded = foldTranscript(transcript);
assert.equal(folded.title, "Fix the widget");
assert.equal(folded.turns.length, 1, "unanswered trailing prompt is dropped");
const [turn] = folded.turns;
assert.equal(turn.steps.length, 2, "one step per Claude message id");
assert.deepEqual(
  turn.steps[0].content.map((b) => b.type),
  ["reasoning", "tool-call"],
);
assert.equal(turn.steps[0].results.get("t1").content[0].text, "contents");
assert.equal(turn.steps[1].content[0].text, "Done.");

const events = toSessionEvents(folded);
assert.deepEqual(
  events.map((e) => e.type),
  [
    "turn/start",
    "step/start",
    "user/message",
    "assistant/message",
    "tool/call",
    "tool/result",
    "step/end",
    "step/start",
    "assistant/message",
    "step/end",
    "turn/end",
    "session/title",
  ],
);
events.forEach((e, i) => assert.equal(e.seq, i, "contiguous seqs"));
const call = events.find((e) => e.type === "tool/call");
assert.equal(call.data.arguments, '{"file_path":"/x"}', "tool/call carries a JSON string");
const result = events.find((e) => e.type === "tool/result");
assert.deepEqual(result.sourceEventSeqs, [call.seq]);
assert.equal(result.data.message.content[0].toolCallId, "t1");
assert.equal(
  events.find((e) => e.type === "assistant/message").data.message.content[1].arguments,
  '{"file_path":"/x"}',
  "message block keeps arguments as a JSON string",
);
for (const e of events)
  if (["user/message", "assistant/message", "tool/result"].includes(e.type))
    assert.equal(e.surfaceOp, "append");
  else assert.equal(e.surfaceOp, undefined);
assert.equal(events.at(-1).data.source.kind, "user", "title pinned");
assert.ok(JSON.stringify(events), "lossless JSON");

// Missing tool result gets an empty synthetic one, so the wire invariant holds.
const orphan = foldTranscript(
  [
    line({ type: "user", uuid: "u1", timestamp: T, message: { role: "user", content: "run it" } }),
    line({
      type: "assistant",
      uuid: "a1",
      timestamp: T,
      message: {
        id: "m1",
        role: "assistant",
        content: [{ type: "tool_use", id: "t9", name: "Bash", input: {} }],
      },
    }),
  ].join("\n"),
);
const orphanEvents = toSessionEvents(orphan);
assert.deepEqual(
  orphanEvents.find((e) => e.type === "tool/result").data.message.content[0].content,
  [],
);
assert.equal(orphan.title, "run it");

assert.equal(truncateBytes("héllo", 3), "hé");

// Listing: uuid files only, sidechain-only and empty files skipped, newest first, excluded ids hidden.
const dir = await mkdtemp(join(tmpdir(), "dsh-llm-claude-"));
const idA = "11111111-1111-4111-8111-111111111111";
const idB = "22222222-2222-4222-8222-222222222222";
const idC = "33333333-3333-4333-8333-333333333333";
await writeFile(join(dir, `${idA}.jsonl`), transcript);
await writeFile(
  join(dir, `${idB}.jsonl`),
  line({ type: "user", isSidechain: true, message: { role: "user", content: "x" } }),
);
await writeFile(
  join(dir, `${idC}.jsonl`),
  line({
    type: "user",
    uuid: "u",
    timestamp: T,
    message: { role: "user", content: "hello there" },
  }),
);
await writeFile(join(dir, "agent-notes.jsonl"), transcript);
const listed = await listTranscripts(dir);
assert.deepEqual(listed.map((s) => s.id).sort(), [idA, idC]);
assert.equal(listed.find((s) => s.id === idA).title, "Fix the widget");
assert.equal(listed.find((s) => s.id === idA).turns, 2, "counts prompts, not tool results");
assert.equal(listed.find((s) => s.id === idC).title, "hello there");
assert.deepEqual(
  (await listTranscripts(dir, new Set([idA]))).map((s) => s.id),
  [idC],
);
assert.deepEqual(await listTranscripts(join(dir, "missing")), []);

// A first prompt with pasted images is one JSON line far past the 256 KB peek window. A byte
// window cut it mid-line and the transcript vanished from the list.
const idD = "44444444-4444-4444-8444-444444444444";
await writeFile(
  join(dir, `${idD}.jsonl`),
  [
    line({ type: "attachment", sessionId: idD }),
    line({
      type: "user",
      uuid: "u",
      timestamp: T,
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", data: "A".repeat(400 * 1024) } },
          { type: "text", text: "what is in this image" },
        ],
      },
    }),
  ].join("\n"),
);
const big = (await listTranscripts(dir)).find((s) => s.id === idD);
assert.ok(big, "long first line still lists");
assert.equal(big.title, "what is in this image");
assert.equal(big.turns, 1);

console.log("transcript ok");
