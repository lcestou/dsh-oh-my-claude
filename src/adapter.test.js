// Offline self-check: node src/adapter.test.js. No CLI, no network.
import assert from "node:assert/strict";
import {
  Config,
  KNOWN_MODELS,
  Translator,
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
} from "./adapter.js";

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
assert.deepEqual(aux.slice(-4), ["--tools", "", "--max-turns", "1"]);
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
  se({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }).map(
    (e) => e.type,
  ),
  ["block-start"],
);
assert.deepEqual(
  se({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
  [{ type: "reasoning-delta", index: 0, text: "hmm" }],
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
  [{ type: "text-delta", index: 3, text: "pong" }],
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
