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

const line = (o: any) => JSON.stringify(o);
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
// SAFETY: we just asserted turns.length === 1 so turn is defined
assert.ok(turn);
assert.equal(turn.steps.length, 2, "one step per Claude message id");
// SAFETY: steps[0] and its content are guaranteed by the transcript shape
const step0 = turn.steps[0];
assert.ok(step0);
assert.deepEqual(
  step0.content.map((b) => b.type),
  ["reasoning", "tool-call"],
);
// SAFETY: results has an entry for "t1" from the transcript data
const t1Result = step0.results.get("t1");
assert.ok(t1Result);
// SAFETY: content[0] is a text block from the transcript
const firstContent = t1Result.content[0];
assert.ok(firstContent && "text" in firstContent);
assert.equal(firstContent.text, "contents");
// SAFETY: steps[1] exists and has text content
const step1 = turn.steps[1];
assert.ok(step1);
const step1Content = step1.content[0];
assert.ok(step1Content && "text" in step1Content);
assert.equal(step1Content.text, "Done.");

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
// SAFETY: transcript contains exactly one tool/call event
const call = events.find((e) => e.type === "tool/call");
assert.ok(call);
assert.equal(call.data.arguments, '{"file_path":"/x"}', "tool/call carries a JSON string");
// SAFETY: transcript contains exactly one tool/result event
const result = events.find((e) => e.type === "tool/result");
assert.ok(result);
assert.deepEqual(result.sourceEventSeqs, [call.seq]);
// SAFETY: result data has the expected message shape
const resultMsg = result.data.message as { content: Array<{ toolCallId?: string }> };
// SAFETY: content[0] exists for this transcript
const firstResultContent = resultMsg.content[0];
assert.ok(firstResultContent);
assert.equal(firstResultContent.toolCallId, "t1");
// SAFETY: transcript contains an assistant/message with two content blocks
const assistantMsg = events.find((e) => e.type === "assistant/message");
assert.ok(assistantMsg);
const assistantData = assistantMsg.data.message as { content: Array<{ arguments?: string }> };
// SAFETY: content[1] exists for this transcript
const secondContent = assistantData.content[1];
assert.ok(secondContent);
assert.equal(
  secondContent.arguments,
  '{"file_path":"/x"}',
  "message block keeps arguments as a JSON string",
);
for (const e of events)
  if (["user/message", "assistant/message", "tool/result"].includes(e.type))
    assert.equal(e.surfaceOp, "append");
  else assert.equal(e.surfaceOp, undefined);
// SAFETY: last event is a session/title with source.kind === "user"
const lastEvent = events.at(-1);
assert.ok(lastEvent);
const lastData = lastEvent.data as { source?: { kind?: string } };
assert.equal(lastData.source?.kind, "user", "title pinned");
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
// SAFETY: orphan transcript produces exactly one tool/result event with empty content
const orphanResult = orphanEvents.find((e) => e.type === "tool/result");
assert.ok(orphanResult);
const orphanContent = (orphanResult.data.message as { content: Array<{ content?: unknown }> })
  .content[0];
assert.ok(orphanContent);
assert.deepEqual(orphanContent.content, []);
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
    cwd: "/proj/c",
    message: { role: "user", content: "hello there" },
  }),
);
await writeFile(join(dir, "agent-notes.jsonl"), transcript);
const listed = await listTranscripts(dir);
assert.deepEqual(listed.map((s) => s.id).toSorted(), [idA, idC]);
// SAFETY: listed contains entries for both idA and idC
const entryA = listed.find((s) => s.id === idA);
assert.ok(entryA);
assert.equal(entryA.title, "Fix the widget");
assert.equal(entryA.turns, 2, "counts prompts, not tool results");
assert.equal(entryA.cwd, undefined);
const entryC = listed.find((s) => s.id === idC);
assert.ok(entryC);
assert.equal(entryC.title, "hello there");
assert.equal(entryC.cwd, "/proj/c", "cwd read off the records");
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
  assert.equal(dshSessionsFor(headers, null, (id) => `c-${id}`).has("c-d3"), true, "null = all");
}

// settings.json editor accepts one JSON object and nothing else.
assert.deepEqual(parseSettingsText('{"model":"x"}'), { value: { model: "x" } });
// SAFETY: parseSettingsText returns an error string for invalid JSON
const oopsResult = parseSettingsText("{oops");
assert.ok(oopsResult.error && /Unexpected|JSON/.test(oopsResult.error));
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
  // SAFETY: partial fake for tests
  const calls: [string, string][] = [];
  const res = (
    status: number,
    headers: Record<string, string> = {},
    body: Record<string, unknown> = {},
  ) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
  // SAFETY: partial fake for tests
  const fakeFetch = async (u: string, init?: { headers?: Record<string, string> }) => {
    calls.push([u, init?.headers?.cookie ?? ""]);
    if (u === "http://box/?token=T") return res(303, { "set-cookie": "dsh-auth-x=1; Path=/" });
    if (u === "http://box/dsh-llm-claude/status")
      return init?.headers?.cookie === "dsh-auth-x=1" ? res(200, {}, { host: "box" }) : res(401);
    if (u === "http://box/") return { ...res(200), text: async () => "<html>plain dsh</html>" };
    if (u === "http://proxy/dsh-llm-claude/status" && !init?.headers?.cookie) return res(401);
    if (u === "http://proxy/")
      return {
        ...res(200),
        text: async () => '<meta http-equiv="refresh" content="0;url=/?token=P"><script>',
      };
    if (u === "http://proxy/?token=P") return res(303, { "set-cookie": "dsh-auth-p=1" });
    if (u === "http://proxy/dsh-llm-claude/status") return res(200, {}, { host: "proxy" });
    throw new Error("ECONNREFUSED");
  };
  // SAFETY: partial fake for tests; Box requires name but probeBox only uses url/token
  // SAFETY: cast to fetch signature for test double
  const boxResult = await probeBox(
    { name: "box", url: "http://box", token: "T" },
    fakeFetch as unknown as typeof fetch,
  );
  assert.equal(boxResult.ok, true);
  assert.equal(
    (boxResult as { ok: true; status: { host: string; name?: string } }).status.host,
    "box",
  );

  const proxyResult = await probeBox(
    { name: "proxy", url: "http://proxy" },
    fakeFetch as unknown as typeof fetch,
  );
  assert.equal(proxyResult.ok, true);
  assert.equal(
    (proxyResult as { ok: true; status: { host: string; name?: string } }).status.host,
    "proxy",
  );

  const boxFail = await probeBox(
    { name: "box", url: "http://box" },
    fakeFetch as unknown as typeof fetch,
  );
  assert.equal(boxFail.ok, false);
  assert.match((boxFail as { ok: false; error: string }).error, /token/);

  const deadResult = await probeBox(
    { name: "dead", url: "http://dead" },
    fakeFetch as unknown as typeof fetch,
  );
  assert.match((deadResult as { ok: false; error: string }).error, /ECONNREFUSED/);
}

console.log("transcript ok");
