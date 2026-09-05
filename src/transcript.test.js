// Offline check for the Claude Code transcript → dsh events conversion.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldTranscript, listTranscripts, toSessionEvents, truncateBytes } from "./transcript.js";
import {
  authFromStatus,
  dshSessionsFor,
  parseSettingsText,
  probeBox,
  validateBoxes,
} from "./sessions.js";

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

// dsh sessions of a workspace map both their own id and their Claude transcript id; archived flag
// rides along; other workspaces are ignored.
{
  const headers = [
    { id: "d1", cwd: "/w" },
    { id: "d2", cwd: "/w" },
    { id: "d3", cwd: "/other" },
  ];
  const map = dshSessionsFor(headers, "/w", (id) => `c-${id}`, new Set(["d2"]));
  assert.deepEqual(map.get("c-d1"), { id: "d1", archived: false });
  assert.deepEqual(map.get("d2"), { id: "d2", archived: true });
  assert.equal(map.get("c-d2"), map.get("d2"));
  assert.equal(map.has("c-d3"), false);
}

// settings.json editor accepts one JSON object and nothing else.
assert.deepEqual(parseSettingsText('{"model":"x"}'), { value: { model: "x" } });
assert.ok(/Unexpected|JSON/.test(parseSettingsText("{oops").error));
assert.equal(parseSettingsText("[1]").error, "settings.json must be a JSON object");
assert.equal(parseSettingsText("null").error, "settings.json must be a JSON object");
assert.equal(parseSettingsText(42).error, "text must be a string");

// `claude auth status` is JSON on current CLIs; older ones print prose. Both must not throw.
assert.deepEqual(
  authFromStatus(
    '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b","projectsDirectory":"/p"}',
  ),
  { loggedIn: true, authMethod: "claude.ai", email: "a@b", projectsDirectory: "/p" },
);
assert.equal(authFromStatus('{"loggedIn":false}').loggedIn, false);
assert.equal(authFromStatus("Not logged in").loggedIn, false);
assert.equal(authFromStatus("Logged in as x").loggedIn, true);

// boxes: names, absolute http(s) urls, optional token, no duplicates, trailing slash dropped.
assert.deepEqual(validateBoxes([{ name: "nas", url: "https://dsh.example/", token: "t" }]), {
  boxes: [{ name: "nas", url: "https://dsh.example", token: "t" }],
});
assert.ok(validateBoxes([{ name: "", url: "http://x" }]).error);
assert.ok(validateBoxes([{ name: "a", url: "dsh.example" }]).error);
assert.ok(validateBoxes([{ name: "a", url: "ftp://x" }]).error);
assert.ok(
  validateBoxes([
    { name: "a", url: "http://x" },
    { name: "b", url: "http://x/" },
  ]).error,
);
assert.ok(validateBoxes("nope").error);

// probeBox: token login sets the cookie, a proxy redirect to /?token= is followed once, 401 is
// reported as a login problem, a dead host as its error text. Fake fetch, no network.
{
  const calls = [];
  const res = (status, headers = {}, body = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
  const fakeFetch = async (u, init) => {
    calls.push([u, init?.headers?.cookie ?? ""]);
    if (u === "http://box/?token=T") return res(303, { "set-cookie": "dsh-auth-x=1; Path=/" });
    if (u === "http://box/dsh-llm-claude/status")
      return init?.headers?.cookie === "dsh-auth-x=1" ? res(200, {}, { host: "box" }) : res(401);
    if (u === "http://proxy/dsh-llm-claude/status" && !init?.headers?.cookie)
      return res(302, { location: "/?token=P" });
    if (u === "http://proxy/?token=P") return res(303, { "set-cookie": "dsh-auth-p=1" });
    if (u === "http://proxy/dsh-llm-claude/status") return res(200, {}, { host: "proxy" });
    throw new Error("ECONNREFUSED");
  };
  assert.deepEqual(await probeBox({ url: "http://box", token: "T" }, fakeFetch), {
    ok: true,
    status: { host: "box" },
  });
  assert.deepEqual(await probeBox({ url: "http://proxy" }, fakeFetch), {
    ok: true,
    status: { host: "proxy" },
  });
  assert.equal((await probeBox({ url: "http://box" }, fakeFetch)).ok, false);
  assert.match((await probeBox({ url: "http://box" }, fakeFetch)).error, /token/);
  assert.match((await probeBox({ url: "http://dead" }, fakeFetch)).error, /ECONNREFUSED/);
}

console.log("transcript ok");
