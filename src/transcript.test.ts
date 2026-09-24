// Offline check for the Claude Code transcript → dsh events conversion.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverText } from "./locale.js";
import {
  attachSubagents,
  foldTranscript,
  lastModelOf,
  listTranscripts,
  settingsEvents,
  subagentText,
  subagentsDir,
  toMarkdown,
  toSessionEvents,
  truncateBytes,
} from "./transcript.js";
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
assert.equal(folded.permissionMode, undefined, "rows without the field leave it unset");
// The CLI stamps each prompt row with the mode it ran under; the last one is the session's.
assert.equal(
  foldTranscript(
    [
      line({
        type: "user",
        uuid: "p1",
        timestamp: T,
        permissionMode: "default",
        message: { role: "user", content: "a" },
      }),
      line({
        type: "assistant",
        uuid: "r1",
        timestamp: T,
        message: { id: "m9", model: "x", content: [{ type: "text", text: "ok" }] },
      }),
      line({
        type: "user",
        uuid: "p2",
        timestamp: T,
        permissionMode: "bypassPermissions",
        message: { role: "user", content: "b" },
      }),
      line({
        type: "user",
        uuid: "p3",
        timestamp: T,
        isSidechain: true,
        permissionMode: "plan",
        message: { role: "user", content: "c" },
      }),
    ].join("\n"),
  ).permissionMode,
  "bypassPermissions",
  "last main-line prompt wins; a sidechain row does not count",
);
assert.equal(folded.turns.length, 1, "unanswered trailing prompt is dropped");
// SAFETY: turns.length is 1 so turns[0] is defined
const firstText = folded.turns[0]!.content[0]!.text;
const md = toMarkdown(folded);
assert.ok(md.startsWith("# "));
assert.ok(md.includes("\n## You\n"));
assert.ok(md.includes("\n## Claude\n"));
assert.ok(md.includes(firstText));
assert.equal(md.split("## You").length - 1, folded.turns.length);
assert.ok(md.endsWith("\n") && !md.endsWith("\n\n"));
assert.equal(
  toMarkdown({
    turns: [],
    title: undefined,
    createdAt: 0,
    agents: new Map(),
    permissionMode: undefined,
  }),
  "# Claude Code session\n\n_1970-01-01T00:00:00.000Z_\n",
);
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
    "system/message",
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
// The system head is the log's first surface event, once, in turn 1 step 1: dsh's loader refuses a
// log whose first system/message follows another surface event, and dsh's own loop appends one on
// the first live turn. Its source is what each log version's validation requires.
const head = events[2];
assert.ok(head);
const firstPrompt = events[3];
assert.ok(firstPrompt);
assert.deepEqual(head.surfaceOp, "append");
assert.deepEqual(head.data, {
  turn: 1,
  step: 1,
  message: {
    id: `${(firstPrompt.data as { id: string }).id}:system`,
    role: "system",
    content: [{ type: "text", text: serverText("seededSystemPrompt") }],
    source: { kind: "plugin", plugin: "claude-code" },
  },
});
assert.equal(events.filter((e) => e.type === "system/message").length, 1, "one head only");
const v4Head = toSessionEvents(folded, 4)[2];
assert.ok(v4Head);
// SAFETY: the v4 seed has the same shape; index 2 is the head asserted above
assert.deepEqual((v4Head.data.message as { source: unknown }).source, { kind: "system-prompt" });
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
// dsh 0.1.5's seed validator: turn, step and a stream array on every settled assistant message.
for (const e of events)
  if (e.type === "assistant/message")
    assert.ok(
      typeof e.data.turn === "number" &&
        typeof e.data.step === "number" &&
        Array.isArray(e.data.stream),
      "assistant/message carries settlement fields",
    );
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
  if (["system/message", "user/message", "assistant/message", "tool/result"].includes(e.type))
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
// SAFETY: orphan transcript produces exactly one tool/result event, seeded as the error below
const orphanResult = orphanEvents.find((e) => e.type === "tool/result");
assert.ok(orphanResult);
const orphanContent = (
  orphanResult.data.message as {
    content: Array<{ content?: Array<{ text?: string }>; isError?: boolean }>;
  }
).content[0];
assert.ok(orphanContent);
// A call the session died inside resumes as an error, not as a tool that returned nothing: the
// empty success seeded here before erased the one fact the file still had.
assert.equal(orphanContent.isError, true);
assert.match(orphanContent.content?.[0]?.text ?? "", /session ended here/);
assert.equal(orphan.title, "run it");

// Claude's PascalCase tool name is mapped to the name dsh's presenter table is keyed by, so a
// resumed Bash call draws the same row it draws live.
const orphanCall = orphanEvents.find((e) => e.type === "tool/call");
assert.equal(orphanCall?.data.name, "bash");

assert.equal(truncateBytes("héllo", 3), "hé");
// The cut lands between characters whatever the budget: a two-byte é, a four-byte emoji, and a
// budget of zero. Byte-exact budgets keep the character that fits exactly.
assert.equal(truncateBytes("héllo", 2), "h");
assert.equal(truncateBytes("🎉ok", 3), "");
assert.equal(truncateBytes("🎉ok", 4), "🎉");
assert.equal(truncateBytes("🎉ok", 5), "🎉o");
assert.equal(truncateBytes("hello", 0), "");
assert.equal(truncateBytes("hello", 5), "hello", "a text that fits is returned whole");

// Listing: uuid files only, sidechain-only and empty files skipped, newest first, excluded ids hidden.
const dir = await mkdtemp(join(tmpdir(), "dsh-oh-my-claude-"));
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
    if (u === "http://box/dsh-oh-my-claude/status")
      return init?.headers?.cookie === "dsh-auth-x=1" ? res(200, {}, { host: "box" }) : res(401);
    if (u === "http://box/") return { ...res(200), text: async () => "<html>plain dsh</html>" };
    if (u === "http://proxy/dsh-oh-my-claude/status" && !init?.headers?.cookie) return res(401);
    if (u === "http://proxy/")
      return {
        ...res(200),
        text: async () => '<meta http-equiv="refresh" content="0;url=/?token=P"><script>',
      };
    if (u === "http://proxy/?token=P") return res(303, { "set-cookie": "dsh-auth-p=1" });
    if (u === "http://proxy/dsh-oh-my-claude/status") return res(200, {}, { host: "proxy" });
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

// Subagents: a Task result names the subagent that answered it, and that subagent's own text lives
// in `<session>/subagents/agent-<id>.jsonl`. Resumed, it belongs behind the Task call, which is
// where the live run showed it — otherwise a Task resumes as a call and a result with nothing in
// between, and the work the subagent did is missing from the session for good.
{
  const withTask = [
    line({
      type: "user",
      uuid: "s1",
      timestamp: T,
      message: { role: "user", content: [{ type: "text", text: "delegate this" }] },
    }),
    line({
      type: "assistant",
      uuid: "s2",
      timestamp: T,
      message: {
        id: "m1",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          { type: "text", text: "handing off" },
          { type: "tool_use", id: "toolu_1", name: "Task", input: { prompt: "go" } },
        ],
      },
    }),
    line({
      type: "user",
      uuid: "s3",
      timestamp: T,
      toolUseResult: { status: "completed", agentId: "a1f2", description: "scout" },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }],
      },
    }),
  ].join("\n");

  const folded = foldTranscript(withTask);
  assert.deepEqual([...folded.agents], [["toolu_1", "a1f2"]]);

  const agentFile = [
    line({ type: "user", isSidechain: true, message: { role: "user", content: "go" } }),
    line({
      type: "assistant",
      isSidechain: true,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "read the file" },
          { type: "tool_use", id: "toolu_x", name: "Read", input: {} },
        ],
      },
    }),
    line({
      type: "assistant",
      isSidechain: true,
      message: { role: "assistant", content: [{ type: "text", text: "found it" }] },
    }),
  ].join("\n");
  // The subagent's tool calls stay out: the live row folds its text only.
  assert.equal(subagentText(agentFile), "read the file\nfound it");
  assert.equal(subagentText(agentFile, 4), "read");

  attachSubagents(folded, new Map([["toolu_1", agentFile]]));
  const step = folded.turns[0]?.steps[0];
  assert.ok(step);
  assert.deepEqual(
    step.content.map((b) => b.type),
    ["text", "tool-call", "reasoning"],
  );
  const said = step.content[2];
  assert.equal(
    said?.type === "reasoning" ? said.text : "",
    "\u21b3 subagent\nread the file\nfound it",
  );

  // A call whose subagent file could not be read keeps the shape it has today.
  const bare = foldTranscript(withTask);
  attachSubagents(bare, new Map());
  assert.deepEqual(
    bare.turns[0]?.steps[0]?.content.map((b) => b.type),
    ["text", "tool-call"],
  );

  // Two results in one record leave the agent unclaimed rather than pinning it to the wrong call.
  const twoResults = foldTranscript(
    [
      line({
        type: "user",
        uuid: "s1",
        timestamp: T,
        message: { role: "user", content: [{ type: "text", text: "two" }] },
      }),
      line({
        type: "assistant",
        uuid: "s2",
        timestamp: T,
        message: {
          id: "m1",
          role: "assistant",
          content: [
            { type: "tool_use", id: "toolu_1", name: "Task", input: {} },
            { type: "tool_use", id: "toolu_2", name: "Task", input: {} },
          ],
        },
      }),
      line({
        type: "user",
        uuid: "s3",
        timestamp: T,
        toolUseResult: { agentId: "a1f2" },
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "a" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "b" },
          ],
        },
      }),
    ].join("\n"),
  );
  assert.equal(twoResults.agents.size, 0);

  // The subagents directory hangs off the session's id, beside the transcript file itself.
  assert.equal(subagentsDir("/p/x/1234.jsonl"), join("/p/x/1234", "subagents"));
}

console.log("transcript ok");

// --- terminal turns: rows another entrypoint wrote, folded and rendered ---
{
  const { alreadyShown, foreignTurns, mirrorReply, mirrorReplyBlocks } =
    await import("./transcript.js");
  const { readFromAt } = await import("./remote-fs.js");
  const readTranscriptFrom = (p: string, o: number) => readFromAt({}, p, o);
  const own = "dsh-oh-my-claude";
  const row = (o: object) => JSON.stringify(o);
  const user = (uuid: string, ep: string, content: unknown) =>
    row({ type: "user", uuid, timestamp: T, entrypoint: ep, message: { role: "user", content } });
  const asst = (uuid: string, ep: string, content: unknown) =>
    row({
      type: "assistant",
      uuid,
      timestamp: T,
      entrypoint: ep,
      message: { id: uuid, role: "assistant", content },
    });
  const ours = [
    user("d1", own, "from dsh"),
    asst("d2", own, [{ type: "text", text: "dsh reply" }]),
  ].join("\n");
  const done = [
    row({ type: "queue-operation", operation: "enqueue", timestamp: T }),
    user("t1", "cli", "hello from terminal\nline two"),
    asst("t2", "cli", [{ type: "text", text: "terminal reply" }]),
  ].join("\n");
  const running = [
    user("t3", "cli", "still typing"),
    asst("t3a", "cli", [{ type: "thinking", thinking: "hm" }]),
    asst("t4", "cli", [{ type: "tool_use", id: "c1", name: "Bash", input: {} }]),
    user("t5", "cli", [{ type: "tool_result", tool_use_id: "c1", content: "out" }]),
  ].join("\n");
  // Only the terminal's finished exchange counts: ours are skipped, bookkeeping rows have no stamp,
  // and a prompt whose newest assistant row has not reached a terminal stop_reason is still running.
  const text = `${ours}\n${done}\n${running}\n`;
  const found = foreignTurns(text, own);
  assert.equal(found.turns.length, 1, "one finished terminal turn");
  assert.equal(found.turns[0]!.content[0]!.text, "hello from terminal\nline two");
  const runningAt = Buffer.byteLength(`${ours}\n${done}\n`);
  assert.equal(found.consumed, runningAt, "settled up to the running prompt's row");
  // Once its final text row lands, the running turn is reported from that offset, exactly once.
  const rest = `${running}\n${asst("t6", "cli", [{ type: "text", text: "done now" }])}\n`;
  const later = foreignTurns(rest, own);
  assert.equal(later.turns.length, 1, "the finished turn is reported");
  assert.equal(later.turns[0]!.content[0]!.text, "still typing");
  assert.equal(later.consumed, Buffer.byteLength(rest), "everything settled");
  assert.deepEqual(foreignTurns(`${ours}\n`, own).turns, [], "nothing foreign reads as no turns");
  // A background-task notification is a user row the CLI wrote itself (`promptSource: "system"`);
  // it is not a person's prompt and must not mirror as one. The typed rows around it still do.
  const notice = row({
    type: "user",
    uuid: "n1",
    timestamp: T,
    entrypoint: "cli",
    promptSource: "system",
    origin: { kind: "task-notification" },
    message: { role: "user", content: "<task-notification>done</task-notification>" },
  });
  const withNotice = [
    user("p1", "cli", "first typed"),
    asst("p2", "cli", [{ type: "text", text: "one" }]),
    notice,
    asst("p3", "cli", [{ type: "text", text: "noted" }]),
    user("p4", "cli", "second typed"),
    asst("p5", "cli", [{ type: "text", text: "two" }]),
  ].join("\n");
  assert.deepEqual(
    foreignTurns(`${withNotice}\n`, own).turns.map((t) => t.content[0]!.text),
    ["first typed", "second typed"],
    "a system-sourced user row is skipped; the typed prompts either side mirror",
  );
  const sdk = [
    user("s1", "sdk-cli", "from a script"),
    asst("s2", "sdk-cli", [{ type: "text", text: "x" }]),
  ];
  assert.deepEqual(
    foreignTurns(`${sdk.join("\n")}\n`, own).turns,
    [],
    "an SDK run is not a terminal",
  );
  assert.equal(foreignTurns("", own).consumed, 0, "an empty tail is settled at zero");
  assert.deepEqual([...found.stamps], ["cli"], "the stamps seen are reported");
  // The reply renders as one assistant message: text as is, a tool call and its result drawn the
  // way a live turn draws them, cut at the limit.
  assert.equal(mirrorReply(found.turns[0]!, 1000), "terminal reply");
  const tooled = foreignTurns(
    [
      user("p1", "cli", "list it"),
      asst("p2", "cli", [{ type: "tool_use", id: "c9", name: "Bash", input: { command: "ls" } }]),
      user("p3", "cli", [{ type: "tool_result", tool_use_id: "c9", content: "a.txt\nb.txt" }]),
      asst("p4", "cli", [{ type: "text", text: "two files" }]),
    ].join("\n"),
    own,
  ).turns[0]!;
  const md = mirrorReply(tooled, 1000);
  assert.match(md, /Bash/, "the call is drawn");
  assert.match(md, /a\.txt\nb\.txt/, "the result is drawn");
  assert.match(md, /two files$/, "the text closes the reply");
  assert.doesNotMatch(mirrorReply(tooled, 3), /a\.txt\nb\.txt/, "results are cut at the limit");
  // A terminal reply of only a thinking row is not a finished turn: nothing is reported, and the
  // baseline stops at its prompt so the same prompt is read again once a text reply lands.
  const thinkingOnly = foreignTurns(
    [user("k1", "cli", "wait"), asst("k2", "cli", [{ type: "thinking", thinking: "hmm" }])].join(
      "\n",
    ) + "\n",
    own,
  );
  assert.deepEqual(thinkingOnly.turns, [], "a thinking-only reply is still running");
  assert.equal(thinkingOnly.consumed, 0, "the baseline stops at the open prompt");
  // The real terminal shape: a reply writes a sentence, calls a tool, then writes the answer. Every
  // row before the tool carries stop_reason "tool_use"; only the last carries a terminal one. The
  // exchange must not be cut at the opening sentence — its tool call and closing text belong to it.
  const stop = (uuid: string, blocks: unknown[], reason: string) =>
    row({
      type: "assistant",
      uuid,
      timestamp: T,
      entrypoint: "cli",
      message: { id: uuid, role: "assistant", content: blocks, stop_reason: reason },
    });
  const midStream = [
    user("m0", "cli", "do the thing"),
    stop("m1", [{ type: "text", text: "Let me check." }], "tool_use"),
    stop(
      "m2",
      [{ type: "tool_use", id: "cc", name: "Bash", input: { command: "ls" } }],
      "tool_use",
    ),
    user("m3", "cli", [{ type: "tool_result", tool_use_id: "cc", content: "a.txt" }]),
  ].join("\n");
  assert.deepEqual(
    foreignTurns(midStream + "\n", own).turns,
    [],
    "not cut at the opening sentence",
  );
  assert.equal(foreignTurns(midStream + "\n", own).consumed, 0, "baseline holds at the prompt");
  const whole = foreignTurns(
    midStream + "\n" + stop("m4", [{ type: "text", text: "Done: found a.txt" }], "end_turn") + "\n",
    own,
  );
  assert.equal(whole.turns.length, 1, "the finished turn mirrors once end_turn lands");
  const wholeMd = mirrorReply(whole.turns[0]!, 2000);
  assert.match(wholeMd, /Let me check\./, "the opening sentence is kept");
  assert.match(wholeMd, /Bash/, "the tool call is drawn");
  assert.match(wholeMd, /a\.txt/, "the result is drawn");
  assert.match(wholeMd, /Done: found a\.txt$/, "the closing answer is kept");
  // lastPromptAt points at the newest prompt, so a re-read from there covers the latest exchange.
  const twoPrompts =
    user("p0", "cli", "first") +
    "\n" +
    stop("p0a", [{ type: "text", text: "one" }], "end_turn") +
    "\n";
  const secondAt = Buffer.byteLength(twoPrompts);
  const ft = foreignTurns(twoPrompts + user("p1", "cli", "second") + "\n", own);
  assert.equal(ft.lastPromptAt, secondAt, "lastPromptAt is the newest prompt's byte offset");
  // firstEnd stops at the end of the first settled exchange. A live stream settles by this much, so
  // an exchange that landed behind the one it was showing stays ahead of the baseline to be mirrored.
  assert.equal(ft.firstEnd, secondAt, "firstEnd is the end of the first completed turn");
  const twoDone = foreignTurns(
    `${twoPrompts + user("p1", "cli", "second")}\n${stop("p1a", [{ type: "text", text: "two" }], "end_turn")}\n`,
    own,
  );
  assert.equal(twoDone.turns.length, 2, "both exchanges are settled");
  assert.equal(twoDone.firstEnd, secondAt, "firstEnd covers only the first of them");
  assert.ok(twoDone.consumed > twoDone.firstEnd, "consumed covers both");
  // Two settled exchanges with a third still being answered: firstEnd still ends the first, so
  // settling a stream cannot jump the exchange sitting behind it. Read once as collapsing to
  // `consumed` here, which would drop that middle exchange from the mirror entirely.
  const settledThenRunning = foreignTurns(
    `${twoPrompts + user("p1", "cli", "second")}\n${stop("p1a", [{ type: "text", text: "two" }], "end_turn")}\n${user("p2", "cli", "third")}\n${stop("p2a", [{ type: "tool_use", id: "z", name: "Bash", input: {} }], "tool_use")}\n`,
    own,
  );
  assert.equal(settledThenRunning.turns.length, 2, "both settled exchanges are there");
  assert.ok(settledThenRunning.running, "the third is still running");
  assert.equal(settledThenRunning.firstEnd, secondAt, "firstEnd still ends the first exchange");
  assert.ok(
    settledThenRunning.consumed > settledThenRunning.firstEnd,
    "and consumed reaches the running prompt, past the second exchange",
  );
  // A message typed while the CLI was busy is written as a `queue-operation` row, with no entrypoint
  // and no message of its own, so both the fold and the foreign filter used to drop it and the words
  // reached dsh by no route at all. One taken back out of the queue was never said.
  const q = (operation: string, content: string) =>
    JSON.stringify({ type: "queue-operation", operation, content });
  const queuedRun = foreignTurns(
    `${user("k0", "cli", "first")}\n${q("enqueue", "typed while busy")}\n${stop("k1", [{ type: "text", text: "answer" }], "end_turn")}\n`,
    own,
  );
  assert.equal(
    queuedRun.running?.content[0]?.text ?? queuedRun.turns.at(-1)?.content[0]?.text,
    "typed while busy",
    "a queued message opens an exchange of its own",
  );
  // A `remove` row does not drop the message. Counted across every transcript on this box: 2046
  // removals, of which 1238 are `absorbed_mid_turn`, 3 are `delivered_to_agent` and 805 carry no
  // reason at all — and of those 805, 439 hold text that appears as a user row nowhere, which is
  // what a message delivered mid-turn looks like. Not one removal in 2046 names a retraction, and
  // two earlier attempts at reading one as a retraction each lost real messages.
  const removed = foreignTurns(
    `${user("k2", "cli", "first")}\n${q("enqueue", "said anyway")}\n${q("remove", "said anyway")}\n${stop("k3", [{ type: "text", text: "answer" }], "end_turn")}\n`,
    own,
  );
  assert.ok(
    JSON.stringify([removed.turns, removed.running]).includes("said anyway"),
    "a removal does not drop a queued message, whatever reason it carries",
  );
  // The CLI also writes a `remove` when it hands a queued message to the turn already running, marked
  // `absorbed_mid_turn`. That one was said, and reading it as a retraction dropped every message the
  // owner typed mid-turn — the whole reason this reads queue rows at all.
  const absorbed = (content: string) =>
    JSON.stringify({
      type: "queue-operation",
      operation: "remove",
      reason: "absorbed_mid_turn",
      content,
    });
  const wasAbsorbed = foreignTurns(
    `${user("k4", "cli", "first")}\n${q("enqueue", "typed mid turn")}\n${absorbed("typed mid turn")}\n${stop("k5", [{ type: "text", text: "answer" }], "end_turn")}\n`,
    own,
  );
  assert.ok(
    JSON.stringify([wasAbsorbed.turns, wasAbsorbed.running]).includes("typed mid turn"),
    "a message absorbed into the running turn was said, and is kept",
  );
  // ...but when the CLI also delivers it as a prompt of its own, that row is the canonical one and
  // the queue row is skipped. Folding both put the same words in twice, as two exchanges with
  // different replies, which is what makes a mirrored conversation read as though it jumped around.
  const alsoDelivered = foreignTurns(
    `${q("enqueue", "typed while busy")}\n${user("k6", "cli", "typed while busy")}\n${stop("k7", [{ type: "text", text: "answer" }], "end_turn")}\n`,
    own,
  );
  const foldedText = JSON.stringify([alsoDelivered.turns, alsoDelivered.running]);
  assert.equal(
    foldedText.split("typed while busy").length - 1,
    1,
    "a queued message that also arrives as a prompt folds exactly once",
  );
  // Dedup against what dsh actually holds: the prompt in a user message, the rendered reply in an
  // assistant message. The fingerprint this replaces glued both into one string and looked for it in
  // assistant text alone, which matched nothing ever, so every re-read mirrored the exchange twice.
  const shownBoth = `do the thing\n${wholeMd}`;
  assert.equal(alreadyShown(whole.turns[0]!, shownBoth, 2000), true, "both halves present: shown");
  assert.equal(
    alreadyShown(whole.turns[0]!, wholeMd, 2000),
    false,
    "the reply alone is not enough, or a repeated opening line would drop a real exchange",
  );
  assert.equal(alreadyShown(whole.turns[0]!, "", 2000), false, "an empty log shows nothing");
  // A turn still running is exposed as `running`, folded up to its completed steps, so a live stream
  // can render it while it grows: its finished tool step shows, the open tail waits for more.
  const midRun = foreignTurns(midStream + "\n", own);
  assert.equal(midRun.turns.length, 0, "no completed turn yet");
  assert.ok(midRun.running, "the in-flight turn is exposed");
  assert.equal(midRun.running!.content[0]!.text, "do the thing", "running carries the prompt");
  const runBlocks = mirrorReplyBlocks(midRun.running!, 1000);
  assert.ok(
    runBlocks.some((b) => /Bash/.test(b)),
    "the call renders",
  );
  assert.ok(
    runBlocks.some((b) => /a\.txt/.test(b)),
    "and its output follows",
  );
  // A call is shown as soon as the CLI writes its row, without waiting for the tool to return: the
  // output is a block of its own that follows when it lands, so a slow command is visible while it
  // runs instead of leaving the tab blank for its whole duration.
  const callOnly = foreignTurns(
    [
      user("c0", "cli", "go"),
      stop("c1", [{ type: "tool_use", id: "z", name: "Bash", input: {} }], "tool_use"),
    ].join("\n") + "\n",
    own,
  );
  const pending = mirrorReplyBlocks(callOnly.running!, 1000);
  assert.equal(pending.length, 1, "a call with no result yet still shows its card");
  assert.match(pending[0]!, /Bash/, "and the card names the tool");
  const long = foreignTurns(
    [
      user("q1", "cli", "talk"),
      asst("q2", "cli", [{ type: "text", text: "x".repeat(60_000) }]),
    ].join("\n"),
    own,
  ).turns[0]!;
  assert.ok(
    Buffer.byteLength(mirrorReply(long, 1000)) < 50_000,
    "a long reply is cut as one message",
  );
  assert.match(mirrorReply(long, 1000), /cut here/, "and says so");
  // The tail read starts at the byte offset the last turn ended on; a shorter file reads as "".
  const dir = await mkdtemp(join(tmpdir(), "omc-tail-"));
  const path = join(dir, "s.jsonl");
  await writeFile(path, `${ours}\n`);
  const seen = Buffer.byteLength(`${ours}\n`);
  assert.equal(await readTranscriptFrom(path, seen), "", "no growth reads as nothing");
  await writeFile(path, `${ours}\n${done}\n`);
  assert.equal(await readTranscriptFrom(path, seen), `${done}\n`, "only the new bytes");
  assert.equal(await readTranscriptFrom(path, seen * 10), "", "a file shorter than the offset");
  console.log("terminal turns ok");
}

// A fold appended onto a stored log: seqs continue from the cursor, turns count on from the last
// stored turn, and neither the system head nor the title is written again.
{
  const delta = toSessionEvents(folded, 4, { seq: 40, turn: 3 });
  assert.equal(delta[0]?.seq, 40, "seqs continue from the base");
  assert.deepEqual(
    delta.map((e) => e.seq),
    delta.map((_, i) => 40 + i),
    "and stay contiguous",
  );
  assert.equal(
    delta.some((e) => e.type === "system/message"),
    false,
    "no second head",
  );
  assert.equal(
    delta.some((e) => e.type === "session/title"),
    false,
    "no second title",
  );
  const firstTurn = delta.find((e) => e.type === "turn/start");
  assert.equal(firstTurn?.data.turn, 4, "the first appended turn follows the stored ones");
  const cited = delta.flatMap((e) => e.sourceEventSeqs ?? []);
  assert.ok(cited.length > 0, "the fixture has rows that cite others");
  for (const c of cited)
    assert.ok(
      delta.some((e) => e.seq === c),
      `a citation names a row of the appended stretch, absolute in the log (${c})`,
    );
  assert.deepEqual(
    toSessionEvents(folded, 4),
    toSessionEvents(folded, 4, { seq: 0, turn: 0 }),
    "the default base is today's seed",
  );
  console.log("seed-base ok");
}

// A restored transcript opens on its own model and access, not dsh's fallbacks.
{
  const picked = settingsEvents(
    { provider: "claude-code", model: "claude-opus-5-5", permissionMode: "bypassPermissions" },
    500,
    40,
  );
  assert.deepEqual(
    picked.map((e) => [e.type, e.seq, e.data]),
    [
      ["model/selection", 40, { provider: "claude-code", model: "claude-opus-5-5" }],
      ["permission/preset", 41, { preset: "danger-full-access" }],
      ["sandbox/mode", 42, { mode: "danger-full-access" }],
      ["approval/policy", 43, { policy: "never" }],
    ],
    "bypass maps to full access, seqs run on",
  );
  assert.deepEqual(
    settingsEvents({ provider: "claude-code", model: undefined, permissionMode: "odd" }, 1, 0),
    [],
    "no model and an unknown mode write nothing",
  );
  assert.equal(
    settingsEvents({ provider: undefined, model: "x", permissionMode: "plan" }, 1, 0)[0]?.data
      .preset,
    "read-only",
    "no provider skips the model, plan is read-only",
  );
  assert.equal(lastModelOf(folded), folded.turns.at(-1)?.steps.at(-1)?.model, "last step's model");
}
