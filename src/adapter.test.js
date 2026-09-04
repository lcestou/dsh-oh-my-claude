// Offline self-check: node src/adapter.test.js. No CLI, no network.
import assert from "node:assert/strict";
import {
  Config,
  KNOWN_MODELS,
  Translator,
  ClaudeCodeAdapter,
  accessModeOf,
  buildArgs,
  permissionModeFor,
  isStaleResume,
  probeCli,
  supports,
  usesStdin,
  buildInput,
  buildPrompt,
  claudeSessionId,
  getCatalog,
  modelFromApi,
  projectDirName,
  resolveModelInfo,
  selectTurns,
  relayBlocks,
  toolResultFor,
  stepContextFor,
  forkTranscriptText,
  userPromptCount,
  dropSent,
  afterLastAssistant,
  wakeOnlyTurn,
  WAKE_TEXT,
} from "./adapter.js";
import { ClaudeProcess, LineQueue, TIMEOUT } from "./process.js";

const config = new Config({});
assert.equal(config.permissionMode, "dsh");
assert.deepEqual(config.allowedTools, []);
assert.equal(config.titleModel, "haiku");
assert.equal(config.resume, true);

// resolveModelInfo echoes the requested id and only borrows the display name
assert.equal(resolveModelInfo("claude-code", "claude-opus-4").id, "claude-opus-4");
assert.equal(resolveModelInfo("claude-code", "claude-fable-5-1").name, "Claude Fable 5.1");
assert.equal(resolveModelInfo("claude-code", "bogus").name, "bogus");
assert.equal(resolveModelInfo("claude-code", "bogus").context, undefined);
assert.equal(resolveModelInfo("claude-code", "claude-fable-5-1").context.contextWindow, 1_000_000);
assert.equal(
  resolveModelInfo("claude-code", "claude-fable-5-1").reasoning.defaultEffort,
  undefined,
);
assert.equal(resolveModelInfo("claude-code", "claude-fable-5-1").reasoning.efforts.length, 5);
assert.equal(resolveModelInfo("claude-code", "claude-haiku-4-5").reasoning, undefined);
assert.deepEqual(resolveModelInfo("claude-code", "claude-haiku-4-5").inputModalities, [
  "text",
  "image",
]);

// session mapping is deterministic and UUID-shaped
const sid = claudeSessionId("abc");
assert.equal(sid, claudeSessionId("abc"));
assert.match(sid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.notEqual(sid, claudeSessionId("abd"));
assert.equal(projectDirName("/home/someone/.dsh/x"), "-home-someone--dsh-x");

// turn selection: fresh sends everything, resume sends only what follows the last assistant turn
const inj = {
  role: "user",
  content: [{ type: "text", text: "<system-reminder>ctx</system-reminder>" }],
};
const toolMsg = {
  role: "user",
  source: { kind: "tool", callId: "x" },
  content: [{ type: "tool-result" }],
};
const history = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "yo" },
  toolMsg,
  { role: "user", content: "again" },
  inj,
];
assert.equal(selectTurns(history, false).length, 4);
assert.deepEqual(
  selectTurns(history, true).map((m) => textOf(m)),
  ["again", "<system-reminder>ctx</system-reminder>"],
);
function textOf(m) {
  return typeof m.content === "string" ? m.content : m.content[0].text;
}
assert.equal(
  buildPrompt(selectTurns([{ role: "user", content: "hi" }, inj], false)),
  "hi\n\n<system-reminder>ctx</system-reminder>",
);
assert.equal(
  buildPrompt(selectTurns(history, false)),
  "[user]\nhi\n\n[assistant]\nyo\n\n[user]\nagain\n\n[user]\n<system-reminder>ctx</system-reminder>",
);
assert.throws(() => buildPrompt([{ role: "assistant", content: "x" }]));
// image-only / attachment-only user turn: no typed text, but not rejected — synthesize a prompt
assert.equal(
  buildPrompt([{ role: "user", content: [{ type: "image", attachment: { path: "/x.png" } }] }]),
  "(see attached)",
);
// no user turn at all still rejects
assert.throws(() => buildPrompt([{ role: "assistant", content: [{ type: "text", text: "x" }] }]));

// args: chat call carries permission mode and session flags; aux calls are one turn, no tools
const chat = buildArgs({
  model: "claude-fable-5-1",
  reasoningEffort: "max",
  system: "sys",
  config,
  session: { id: "u", resuming: true },
});
assert.ok(chat.includes("--include-partial-messages") && chat.includes("--input-format"));
assert.deepEqual(chat.slice(-2), ["--resume", "u"]);
assert.ok(
  chat.join(" ").includes("--permission-prompt-tool stdio") &&
    chat.join(" ").includes("--tools default"),
);
assert.ok(chat.join(" ").includes("--permission-mode acceptEdits"));
assert.ok(
  chat.join(" ").includes("--effort max") && chat.join(" ").includes("--append-system-prompt sys"),
);
const fresh = buildArgs({ model: "m", config, session: { id: "u", resuming: false } });
assert.deepEqual(fresh.slice(-2), ["--session-id", "u"]);
const aux = buildArgs({ model: "haiku", purpose: "session-title", config, session: undefined });
assert.deepEqual(aux.slice(-5), ["--tools", "", "--max-turns", "1", "--no-session-persistence"]);
const auxOld = buildArgs({
  model: "haiku",
  purpose: "session-title",
  config,
  session: undefined,
  flags: new Set(["--tools", "--max-turns"]),
});
assert.deepEqual(auxOld.slice(-4), ["--tools", "", "--max-turns", "1"], "older CLI: flag left out");
assert.equal(aux.filter((a) => a === "--tools").length, 1);
assert.ok(!aux.includes("--permission-mode"));
const custom = buildArgs({
  model: "m",
  config: new Config({ allowedTools: ["Bash"], addDirs: ["/x"], maxTurns: 3 }),
});
assert.ok(
  custom.join(" ").includes("--allowedTools Bash") &&
    custom.join(" ").includes("--add-dir /x") &&
    custom.join(" ").includes("--max-turns 3"),
);

// input line: text first, then images
const line = JSON.parse(buildInput("hi", [{ mediaType: "image/png", data: "AAA" }]));
assert.equal(line.type, "user");
assert.equal(line.message.content[0].text, "hi");
assert.equal(line.message.content[1].source.media_type, "image/png");

// translator: partial deltas become live text/reasoning, whole assistant messages are then ignored
const tr = new Translator();
const se = (event) => tr.translate({ type: "stream_event", event });
assert.deepEqual(se({ type: "message_start" }), []);
assert.deepEqual(
  se({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
  [],
  "a block is announced with its first text, not at start",
);
assert.deepEqual(
  se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
  [
    { type: "block-start", index: 0, blockType: "reasoning" },
    { type: "reasoning-delta", index: 0, text: "hmm" },
  ],
);
assert.deepEqual(
  se({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "x" } }),
  [],
);
assert.deepEqual(se({ type: "content_block_stop", index: 0 }), [
  { type: "block-end", index: 0, block: { type: "reasoning", text: "hmm" } },
]);
assert.deepEqual(
  se({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", name: "Read" },
  }).map((e) => e.type),
  ["block-start", "reasoning-delta"],
);
se({
  type: "content_block_delta",
  index: 1,
  delta: { type: "input_json_delta", partial_json: '{"a":1}' },
});
assert.equal(se({ type: "content_block_stop", index: 1 })[0].block.text, '▶ Read {"a":1}');
assert.deepEqual(
  tr.translate({ type: "assistant", message: { content: [{ type: "text", text: "dup" }] } }),
  [],
);
const res = tr.translate({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "t", content: "1\thello" }] },
});
assert.equal(res.at(-1).block.text, "◀ result\n1\thello");
se({ type: "message_start" });
se({ type: "content_block_start", index: 0, content_block: { type: "text" } });
assert.deepEqual(
  se({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "pong" } }),
  [
    { type: "block-start", index: 3, blockType: "text" },
    { type: "text-delta", index: 3, text: "pong" },
  ],
);
assert.equal(tr.finished, false);
const done = tr.translate({
  type: "result",
  is_error: false,
  stop_reason: "end_turn",
  usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 10 },
});
assert.deepEqual(
  done.map((e) => e.type),
  ["usage", "finish"],
);
assert.deepEqual(done[0].usage, {
  inputTokens: 2,
  outputTokens: 4,
  totalTokens: 16,
  cacheReadTokens: 10,
});
assert.equal(done[1].reason.kind, "stop");
assert.equal(tr.finished, true);

// dsh tools called over the MCP bridge render as visible text rows, results too
const trd = new Translator();
const dshCall = trd.translate({
  type: "assistant",
  message: {
    content: [
      { type: "tool_use", id: "d1", name: "mcp__dsh__subagent_local", input: { prompt: "x" } },
    ],
  },
});
assert.equal(dshCall[0].blockType, "text", "bridge call is a text block");
assert.match(dshCall[1].text, /^⤷ subagent_local /, "bridge call drops the mcp prefix");
const dshResult = trd.translate({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "d1", content: "abc" }] },
});
assert.equal(dshResult[0].blockType, "text", "bridge result is a text block");
assert.match(dshResult[1].text, /^⤶ result\nabc/);
const nativeResult = trd.translate({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "other", content: "y" }] },
});
assert.equal(nativeResult[0].blockType, "reasoning", "other tools stay in reasoning");

// translator fallback: no partials seen → whole assistant message is emitted
const tr2 = new Translator({ toolActivity: false });
const whole = tr2.translate({
  type: "assistant",
  message: {
    content: [
      { type: "thinking", thinking: "t" },
      { type: "text", text: "pong" },
      { type: "tool_use", name: "Bash", input: {} },
    ],
  },
});
assert.deepEqual(
  whole.map((e) => e.type),
  ["block-start", "reasoning-delta", "block-end", "block-start", "text-delta", "block-end"],
);
assert.deepEqual(
  tr2.translate({ type: "user", message: { content: [{ type: "tool_result", content: "x" }] } }),
  [],
);
assert.equal(
  new Translator().translate({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })
    .length,
  0,
);
const limited = new Translator().translate({
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected" },
});
assert.equal(limited[0].reason.failure.code, "RATE_LIMIT");
assert.equal(
  new Translator().translate({ type: "result", is_error: true, result: "boom" }).at(-1).reason
    .failure.message,
  "boom",
);
assert.deepEqual(new Translator().translate({ type: "system", subtype: "init" }), []);

// Models API mapping + fallback
const api = modelFromApi({
  id: "claude-x",
  display_name: "X",
  max_input_tokens: 500,
  capabilities: {
    effort: { supported: true, low: { supported: true }, max: { supported: false } },
  },
});
assert.deepEqual(api, { id: "claude-x", name: "X", contextWindow: 500, efforts: ["low"] });
const failing = await getCatalog(async () => {
  throw new Error("offline");
});
assert.equal(failing, KNOWN_MODELS);

// access-mode switch from the dsh UI → Claude Code permission mode, unless config pins one
const policy = (mode) => ({
  role: "user",
  content: [
    { type: "text", text: `Current runtime context.\n\nCurrent DSH file policy: ${mode}. Any` },
  ],
});
assert.equal(accessModeOf([{ role: "user", content: "hi" }]), undefined);
assert.equal(
  accessModeOf([policy("read-only"), policy("danger-full-access")]),
  "danger-full-access",
);
assert.equal(permissionModeFor(config, "read-only"), "plan");
assert.equal(permissionModeFor(config, "workspace-write"), "acceptEdits");
assert.equal(permissionModeFor(config, "danger-full-access"), "bypassPermissions");
assert.equal(permissionModeFor(config, undefined), "acceptEdits");
assert.equal(
  permissionModeFor(new Config({ permissionMode: "plan" }), "danger-full-access"),
  "plan",
);
const switched = buildArgs({ model: "m", config, accessMode: "danger-full-access" });
assert.ok(switched.join(" ").includes("--permission-mode bypassPermissions"));

// CLI flag probe: missing flags are left out; missing --input-format switches to positional prompt
assert.equal(supports(null, "--anything"), true);
const oldCli = new Set(["--print", "--output-format", "--model", "--permission-mode"]);
assert.equal(usesStdin(oldCli), false);
const legacy = buildArgs({
  model: "m",
  config,
  flags: oldCli,
  promptText: "hello there",
  session: { id: "u", resuming: true },
});
assert.deepEqual(legacy.slice(0, 2), ["-p", "hello there"]);
assert.ok(
  !legacy.includes("--include-partial-messages") &&
    !legacy.includes("--resume") &&
    !legacy.includes("--effort"),
);
assert.ok(legacy.includes("--permission-mode"));
const probed = await probeCli((cmd, args, opts, cb) =>
  cb(
    null,
    args[0] === "--help"
      ? "Usage: claude [options]\n  --effort <level>\n  --input-format <f>\n"
      : "9.9.9 (Claude Code)\n",
  ),
);
assert.equal(probed.version, "9.9.9 (Claude Code)");
assert.ok(probed.flags.has("--effort") && probed.flags.has("--input-format"));

// rate limit carries the provider reset time as retry-after
const soon = Math.floor(Date.now() / 1000) + 120;
const rl = new Translator().translate({
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected", resetsAt: soon },
});
assert.ok(
  rl[0].reason.failure.providerRetryAfterMs > 100_000 &&
    rl[0].reason.failure.providerRetryAfterMs <= 120_000,
);

// stale --resume detection
assert.equal(
  isStaleResume({
    type: "result",
    is_error: true,
    errors: ["No conversation found with session ID: x"],
  }),
  true,
);
assert.equal(isStaleResume({ type: "result", is_error: true, errors: ["boom"] }), false);
assert.equal(isStaleResume({ type: "result", is_error: false }), false);
assert.equal(
  new Translator().translate({ type: "result", is_error: true, errors: ["a", "b"] })[0].reason
    .failure.message,
  "a; b",
);

// denied tool calls are counted and reported once at the end of the turn
const td = new Translator({ toolTextLimit: 100 });
td.translate({
  type: "user",
  message: {
    content: [{ type: "tool_result", is_error: true, content: "This command requires approval" }],
  },
});
td.translate({
  type: "user",
  message: { content: [{ type: "tool_result", is_error: true, content: "boom" }] },
});
const ended = td.translate({ type: "result", is_error: false, stop_reason: "end_turn" });
assert.equal(ended[0].type, "block-start");
assert.ok(ended.find((e) => e.type === "text-delta").text.includes("denied 1 tool call "));
assert.equal(ended.at(-1).reason.kind, "stop");
assert.equal(new Translator().translate({ type: "result", is_error: false })[0].type, "finish");

// forwarded subagent text renders as reasoning even while partials are on
const ts2 = new Translator();
ts2.translate({ type: "stream_event", event: { type: "message_start" } });
const sub = ts2.translate({
  type: "assistant",
  parent_tool_use_id: "toolu_1",
  message: { content: [{ type: "text", text: "child says hi" }] },
});
assert.equal(sub.at(-1).block.text, "↳ subagent\nchild says hi");
assert.equal(
  new Translator({ toolTextLimit: 5 })
    .translate({
      type: "user",
      message: { content: [{ type: "tool_result", content: "abcdefghij" }] },
    })
    .at(-1).block.text,
  "◀ result\nabcde…",
);
assert.ok(buildArgs({ model: "m", config }).includes("--forward-subagent-text"));
assert.equal(new Config({}).idleTimeoutMs, 1_800_000);

// control channel helpers
const {
  parseQuestions,
  answersFor,
  userTurnLine,
  controlResponseLine,
  allowResult,
  denyResult,
  permissionReason,
} = await import("./process.js");
const qs = parseQuestions(
  {
    questions: [
      {
        question: "Tea or coffee?",
        header: "Drink",
        options: [{ label: "tea" }, { label: "coffee", description: "hot" }],
      },
    ],
  },
  "toolu_9",
);
assert.equal(qs.length, 1);
assert.equal(qs[0].id, "toolu_9:0");
assert.deepEqual(qs[0].options[1], { label: "coffee", description: "hot" });
assert.equal(parseQuestions({ questions: [] }, "x"), undefined);
assert.equal(
  parseQuestions({ questions: [{ question: "q", options: [{ nope: 1 }] }] }, "x"),
  undefined,
);
assert.deepEqual(answersFor(qs, { answers: [{ id: "toolu_9:0", selected: ["tea"] }] }), {
  "Tea or coffee?": "tea",
});
assert.deepEqual(
  answersFor(qs, { answers: [{ id: "toolu_9:0", selected: [], custom: "water" }] }),
  { "Tea or coffee?": "water" },
);
const turn = JSON.parse(userTurnLine([{ type: "text", text: "hi" }]));
assert.equal(turn.type, "user");
assert.equal(turn.parent_tool_use_id, null);
assert.equal(turn.message.content[0].text, "hi");
const cr = JSON.parse(controlResponseLine("r1", allowResult("t1", { a: 1 })));
assert.equal(cr.type, "control_response");
assert.equal(cr.response.request_id, "r1");
assert.equal(cr.response.response.behavior, "allow");
assert.deepEqual(cr.response.response.updatedInput, { a: 1 });
assert.equal(denyResult("t1", "no").decisionClassification, "user_reject");
assert.equal(
  permissionReason("Bash", { command: "ls -la" }, { title: "Run ls" }),
  "Run ls — ls -la",
);
assert.ok(buildArgs({ model: "m", config }).includes("--permission-prompt-tool"));
assert.ok(
  !buildArgs({ model: "m", config: new Config({ approvals: false }) }).includes(
    "--permission-prompt-tool",
  ),
);
assert.ok(
  !buildArgs({ model: "m", purpose: "session-title", config }).includes("--permission-prompt-tool"),
);

// idle-timer pause: a closed tool_use block sets toolPending until the tool result arrives
const tp = new Translator();
tp.translate({ type: "stream_event", event: { type: "message_start" } });
tp.translate({
  type: "stream_event",
  event: {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", name: "Bash" },
  },
});
assert.equal(tp.toolPending, false);
tp.translate({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
assert.equal(tp.toolPending, true);
tp.translate({ type: "user", message: { content: [{ type: "tool_result", content: "done" }] } });
assert.equal(tp.toolPending, false);
const tq = new Translator({ toolActivity: false });
tq.translate({ type: "stream_event", event: { type: "message_start" } });
assert.deepEqual(
  tq.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", name: "Bash" },
    },
  }),
  [],
);
assert.deepEqual(
  tq.translate({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }),
  [],
);
assert.equal(tq.toolPending, true);

console.log("ok");

// --- native relay: Claude's view of a relayed dsh tool call stays hidden, dsh renders it ---
{
  const tr = new Translator({ relay: true });
  const start = tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu1", name: "mcp__dsh__subagent_local" },
    },
  });
  assert.deepEqual(start, [], "relayed dsh tool_use opens no visible block");
  const stop = tr.translate({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
  });
  assert.deepEqual(stop, []);
  assert.equal(tr.toolPending, true, "still counts as a running tool for the idle timer");
  tr.relayed.add("tu1"); // dsh ran it natively
  const res = tr.translate({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "done" }] },
  });
  assert.deepEqual(res, [], "its result row is dsh's to render, not ours");
  const plain = new Translator({ relay: false });
  plain.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu2", name: "mcp__dsh__subagent_local" },
    },
  });
  assert.equal(plain.open.get(0).blockType, "text", "without relay the old visible row stays");
}
{
  const tr = new Translator();
  tr.index = 3;
  const chunks = [...relayBlocks(tr, { id: "c1", name: "subagent_local", args: { prompt: "hi" } })];
  assert.deepEqual(
    chunks.map((c) => c.type),
    ["block-start", "tool-call-delta", "block-end"],
  );
  assert.equal(chunks[0].index, 3);
  assert.equal(tr.index, 4, "reserves one block index");
  assert.deepEqual(chunks[2].block, {
    type: "tool-call",
    id: "c1",
    name: "subagent_local",
    arguments: '{"prompt":"hi"}',
  });
}
{
  const messages = [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "x", arguments: "{}" }] },
    {
      role: "user",
      source: { kind: "tool", callId: "c1" },
      content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "42" }] }],
    },
  ];
  assert.deepEqual(toolResultFor(messages, "c1"), { text: "42", isError: false });
  assert.equal(toolResultFor(messages, "nope"), undefined);
  assert.equal(toolResultFor([{ role: "user", content: [] }], "c1"), undefined);
}
{
  const base = [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "x", arguments: "{}" }] },
    {
      role: "user",
      source: { kind: "tool", callId: "c1" },
      content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "42" }] }],
    },
  ];
  assert.equal(stepContextFor(base), "", "only the tool result: nothing to add");
  const steered = [
    ...base,
    {
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "also check /tmp" }],
    },
    {
      role: "user",
      source: { kind: "subagent-settled" },
      content: [{ type: "text", text: "child done" }],
    },
  ];
  const ctx = stepContextFor(steered);
  assert.match(ctx, /also check \/tmp/);
  assert.match(ctx, /child done/);
  assert.doesNotMatch(
    ctx,
    /\bgo\b/,
    "the turn's original prompt is before the assistant step, not repeated",
  );
}
{
  const msgs = [
    {
      role: "user",
      source: { kind: "user", rpcId: "r1" },
      content: [{ type: "text", text: "go" }],
    },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    {
      role: "user",
      source: { kind: "user", rpcId: "r2" },
      content: [{ type: "text", text: "steer" }],
    },
    {
      role: "user",
      source: { kind: "user", rpcId: "r3" },
      content: [{ type: "text", text: "new" }],
    },
  ];
  assert.equal(afterLastAssistant(msgs).length, 2);
  assert.deepEqual(
    dropSent(msgs, new Set(["r2"])).map((m) => m.source?.rpcId),
    ["r1", undefined, "r3"],
  );
  assert.equal(dropSent(msgs, new Set()).length, 4);
  assert.equal(
    dropSent(afterLastAssistant(msgs), new Set(["r2", "r3"])).length,
    0,
    "all already live-sent: no-op turn",
  );
}
{
  const adapter = new ClaudeCodeAdapter(
    { on() {} },
    Config({ maxProcesses: 2, processIdleMs: 10_000 }),
  );
  const fake = (extra) => ({
    alive: true,
    busy: false,
    relays: new Map(),
    lastUsed: Date.now() - 20_000,
    killed: 0,
    kill() {
      this.killed++;
    },
    ...extra,
  });
  const parked = fake({ relays: new Map([["c1", {}]]) });
  const steered = fake({ parked: "steer" });
  const idle = fake({});
  adapter.processes.set("a", parked);
  adapter.processes.set("b", steered);
  adapter.processes.set("c", idle);
  adapter.evict();
  assert.equal(parked.killed, 0, "a process waiting on dsh's tool result is not idle");
  assert.equal(steered.killed, 0, "a process parked for a steer is not idle");
  assert.equal(idle.killed, 1, "a truly idle process past processIdleMs is culled");
}
{
  const tr = new Translator({ relay: true });
  tr.aborting = true;
  const fin = tr.translate({ type: "result", subtype: "error_during_execution", is_error: true });
  assert.equal(
    fin.at(-1).reason.kind,
    "aborted",
    "an interrupted turn finishes as aborted, not error",
  );
  const plain = new Translator({ relay: true });
  const fin2 = plain.translate({
    type: "result",
    subtype: "error_during_execution",
    is_error: true,
    result: "x",
  });
  assert.equal(fin2.at(-1).reason.kind, "error");
}
{
  const tr = new Translator({ relay: true });
  tr.translate({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "d1", name: "mcp__dsh__subagent_local", input: {} },
        { type: "tool_use", id: "d2", name: "mcp__dsh__subagent_local", input: {} },
        { type: "tool_use", id: "b1", name: "Bash", input: {} },
      ],
    },
  });
  assert.equal(tr.dshIds.size, 2, "whole-message path counts outstanding dsh calls for batching");
}
{
  const line = (o) => JSON.stringify(o);
  const src = [
    line({ type: "user", sessionId: "OLD", message: { role: "user", content: "first" } }),
    line({
      type: "assistant",
      sessionId: "OLD",
      message: { role: "assistant", content: [{ type: "text", text: "a1" }] },
    }),
    line({
      type: "user",
      sessionId: "OLD",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t" }] },
    }),
    line({
      type: "user",
      sessionId: "OLD",
      message: { role: "user", content: [{ type: "text", text: "second" }] },
    }),
    line({
      type: "assistant",
      sessionId: "OLD",
      message: { role: "assistant", content: [{ type: "text", text: "a2" }] },
    }),
  ].join("\n");
  const cut = forkTranscriptText(src, "OLD", "NEW", 1);
  assert.equal(
    cut.split("\n").filter(Boolean).length,
    3,
    "kept only the first prompt's turn (tool results are not prompts)",
  );
  assert.doesNotMatch(cut, /OLD/);
  assert.match(cut, /"sessionId":"NEW"/);
  assert.equal(
    forkTranscriptText(src, "OLD", "NEW", 0).split("\n").filter(Boolean).length,
    5,
    "keep <= 0 keeps everything",
  );
  assert.equal(forkTranscriptText(src, "OLD", "NEW", 9).split("\n").filter(Boolean).length, 5);
  const msgs = [
    { role: "user", source: { kind: "user" }, content: [] },
    { role: "assistant", content: [] },
    { role: "user", source: { kind: "subagent-settled" }, content: [] },
    { role: "user", source: { kind: "user" }, content: [] },
  ];
  assert.equal(userPromptCount(msgs), 2);
}
{
  const q = new LineQueue();
  assert.equal(await q.next(30), TIMEOUT, "times out with nothing queued");
  q.push("late");
  assert.equal(
    await q.next(30),
    "late",
    "a line pushed after a timeout is not swallowed by the dead waiter",
  );
  const pending = q.next(1000);
  q.push("now");
  assert.equal(await pending, "now");
}
{
  // Claude ran a turn on its own while dsh was idle (background task finished): its whole
  // output is queued ahead of the next prompt. Count its results so the turn loop skips them.
  const queue = new LineQueue();
  const count = () => ClaudeProcess.prototype.countStaleResults.call({ queue });
  assert.equal(count(), 0, "empty queue");
  queue.push(
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "done" }] } }),
  );
  queue.push(JSON.stringify({ type: "result", subtype: "success", is_error: false }));
  queue.push('{"type":"assistant","message":{"content":[{"type":"text","text":"result"}]}}');
  queue.push("not json result line");
  queue.push({ type: "dsh_relay" });
  assert.equal(
    count(),
    1,
    "one stale turn: text mentioning result, junk and injected objects do not count",
  );
  queue.push(JSON.stringify({ type: "result", subtype: "success", is_error: false }));
  assert.equal(count(), 2, "two stale turns");
  await queue.next();
  await queue.next();
  assert.equal(count(), 1, "only what is still queued counts");
}
{
  // Idle result → wake callback; busy or non-result lines stay silent.
  let woke = 0;
  const fake = { busy: false, onIdleResult: () => woke++ };
  const note = (line) => ClaudeProcess.prototype.noteIdleResult.call(fake, line);
  note('{"type":"assistant","message":{"content":[{"type":"text","text":"result"}]}}');
  note("plain result text");
  assert.equal(woke, 0, "assistant text and junk do not wake");
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "an idle result wakes once");
  fake.busy = true;
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "a result during a live turn is the turn's own, no wake");
  fake.busy = false;
  fake.onIdleResult = undefined;
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "no callback, no throw");
}
{
  const wake = {
    role: "user",
    source: { kind: "plugin", plugin: "dsh-llm-claude", form: "notice", summary: WAKE_TEXT },
    content: [{ type: "text", text: WAKE_TEXT }],
  };
  const user = { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hi" }] };
  const other = { role: "user", source: { kind: "plugin", plugin: "dsh-skills" }, content: [] };
  const asst = { role: "assistant", content: [{ type: "text", text: "ok" }] };
  assert.equal(wakeOnlyTurn([user, asst, wake]), true, "our notice alone opens a drain-only turn");
  assert.equal(
    wakeOnlyTurn([user, asst, wake, other]),
    true,
    "other plugins' context does not change that",
  );
  assert.equal(wakeOnlyTurn([user, asst, wake, user]), false, "a user prompt in the batch wins");
  assert.equal(
    wakeOnlyTurn([wake, asst, user]),
    false,
    "an old notice behind an assistant reply is history",
  );
  assert.equal(wakeOnlyTurn([user, asst, other]), false, "no notice, no drain turn");
}
{
  // Claude Code's own compaction shows as one line; other system events stay silent.
  const t = new Translator();
  assert.deepEqual(t.translate({ type: "system", subtype: "init", session_id: "x" }), []);
  const out = t.translate({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "auto", pre_tokens: 150000 },
  });
  assert.equal(out.at(-1).type, "block-end");
  assert.match(
    out.at(-1).block.text,
    /Context compacted by Claude Code \(auto, 150000 tokens before\)/,
  );
  assert.equal(t.finished, false, "compaction does not end the turn");
  const manual = t.translate({
    type: "system",
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual" },
  });
  assert.match(manual.at(-1).block.text, /\(manual\)\._/, "manual trigger, no token count");
}
{
  // wake(): a live agent gets the notice directly; an unloaded one is resumed through the
  // session controller first; a busy process never wakes.
  const sent = [];
  const agent = { followup: (m) => sent.push(m) };
  const ctx = { on() {}, agents: { get: () => undefined }, logger: { info() {}, warn() {} } };
  const a = new ClaudeCodeAdapter(ctx, Config({}));
  let resumed = 0;
  a.sessionController = { resolveAgent: async () => (resumed++, agent) };
  await a.wake("s1", { busy: false });
  assert.equal(resumed, 1, "unloaded agent: resumed through the controller");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].role, "user");
  assert.deepEqual(
    [sent[0].source.kind, sent[0].source.plugin, sent[0].source.form],
    ["plugin", "dsh-llm-claude", "notice"],
  );
  assert.equal(sent[0].content[0].text, WAKE_TEXT);
  ctx.agents.get = () => agent;
  await a.wake("s1", { busy: false });
  assert.equal(resumed, 1, "live agent: no resume");
  assert.equal(sent.length, 2);
  await a.wake("s1", { busy: true });
  assert.equal(sent.length, 2, "busy process: the turn is dsh's own, no wake");
  ctx.agents.get = () => undefined;
  a.sessionController = {
    resolveAgent: async () => {
      throw new Error("gone");
    },
  };
  await a.wake("s1", { busy: false });
  assert.equal(sent.length, 2, "resume failure is logged, not thrown");
}
{
  const tr = new Translator();
  const s1 = tr.translate({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
  });
  assert.deepEqual(s1, [], "a thinking block is not announced before it has text");
  const e1 = tr.translate({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
  });
  assert.deepEqual(e1, [], "an empty thinking block closes silently: no empty bubble");
  tr.translate({
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "thinking" } },
  });
  const d = tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "thinking_delta", thinking: "hmm" },
    },
  });
  assert.deepEqual(
    d.map((c) => c.type),
    ["block-start", "reasoning-delta"],
    "block-start rides ahead of the first text",
  );
  const e2 = tr.translate({
    type: "stream_event",
    event: { type: "content_block_stop", index: 1 },
  });
  assert.equal(e2[0].type, "block-end");
  assert.equal(e2[0].block.text, "hmm");
}
{
  const a = new ClaudeCodeAdapter({ on() {} }, Config({}));
  const b = new ClaudeCodeAdapter({ on() {} }, Config({}));
  a.processes.set("shared", { alive: true });
  assert.equal(
    b.processes.get("shared")?.alive,
    true,
    "a reloaded adapter adopts running processes",
  );
  a.processes.delete("shared");
}
{
  const tr = new Translator({ relay: true });
  const open = (id) =>
    tr.translate({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id, name: "mcp__dsh__subagent_local" },
      },
    });
  const result = (id) =>
    tr.translate({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id, content: "out" }] },
    });
  open("r1");
  tr.relayed.add("r1");
  assert.deepEqual(result("r1"), [], "a relayed call's result is dsh's to draw");
  open("f1");
  const shown = result("f1");
  assert.equal(shown.at(-1).block.type, "text");
  assert.match(
    shown.at(-1).block.text,
    /subagent_local \(ran in bridge\)/,
    "a call that fell back is drawn as one row",
  );
}
console.log("relay ok");

// Unknown stream-json shapes warn once (schema-drift canary); knowingly-benign types stay silent.
{
  const warnings = [];
  const tr = new Translator({ log: (level, msg) => level === "warn" && warnings.push(msg) });
  tr.translate({ type: "system", subtype: "init" }); // benign top-level: no warn
  tr.translate({ type: "brand_new_event" }); // unknown: warn
  tr.translate({ type: "brand_new_event" }); // same type again: deduped, no second warn
  tr.partial({ type: "message_delta" }); // benign partial: no warn
  tr.partial({ type: "mystery_partial" }); // unknown partial: warn
  tr.openBlock(9, { type: "redacted_thinking" }); // unknown content block: warn
  assert.equal(warnings.length, 3, "one warn per distinct unknown type, deduped");
  assert.match(warnings[0], /brand_new_event/);
  assert.match(warnings[0], /schema may have changed/);
  assert.match(warnings[1], /mystery_partial/);
  assert.match(warnings[2], /redacted_thinking/);
}
console.log("schema-guard ok");
