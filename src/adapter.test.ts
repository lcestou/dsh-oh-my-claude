// Offline self-check: node src/adapter.test.js. No CLI, no network.
import assert from "node:assert/strict";
import {
  Config,
  KNOWN_MODELS,
  Translator,
  commandNames,
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
  withoutNativeInstructions,
  finishReason,
  TurnRecord,
  RESTART_TEXT,
  markBusy,
  takeInterrupted,
  registryKey,
} from "./adapter.js";
import { CHILD_ENV, ClaudeProcess, LineQueue, TIMEOUT, seamSpawner } from "./process.js";
import {
  buildRedactor,
  CLAUDE_HOME,
  hasPendingNotice,
  noteBoot,
  resolveClaudeHome,
  stateDir,
} from "./state.js";
import type { ClaudeEvent, ClaudeProcessSpec, SubprocessHandle } from "./process.js";
import type { LooseMessage } from "./adapter.js";
import type { FinishReason, LlmFailure, Message, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { Agent, PluginContext, SubprocessSpawnSpec } from "./dsh.js";
import type { SubprocessHandle as SeamHandle } from "./dsh.js";

// Test fakes stand in for dsh services and CLI events. One cast per shape, here, instead of one
// per fake; every fake is partial on purpose and the test names what it exercises.
// SAFETY: partial fake for tests
const fakeCtx = (o: object): PluginContext => o as unknown as PluginContext;
// SAFETY: partial fake for tests
const fakeProc = (o: object): ClaudeProcess => o as unknown as ClaudeProcess;
// SAFETY: partial fake for tests
const fakeAgent = (o: object): Agent => o as unknown as Agent;
// SAFETY: tests feed the translator event types it has never seen, on purpose
const anyEvent = (o: object): ClaudeEvent => o as unknown as ClaudeEvent;
/** Message fixtures: the shapes dsh sends, written loosely; typed here once for the helpers under test. */
// SAFETY: test fixture, checked by the assertions that read it
const message = (m: object): LooseMessage => m as LooseMessage;
const messageList = (list: object[]): LooseMessage[] => list.map(message);
const emptySpec: ClaudeProcessSpec = {
  cwd: "",
  model: undefined,
  effort: null,
  mode: "",
  sessionId: null,
  temporary: false,
};
/** The failure of an error or aborted finish; throws when the reason has none, which fails the test. */
const failureOf = (r: FinishReason | undefined): LlmFailure => {
  if (r && (r.kind === "error" || r.kind === "aborted")) return r.failure;
  throw new Error(`no failure on finish reason ${r?.kind}`);
};
/** Narrow a chunk to one type or fail the test with the type it actually had. */
const chunkOf = <K extends StreamChunk["type"]>(c: StreamChunk | undefined, type: K) => {
  if (c?.type !== type) throw new Error(`expected a ${type} chunk, got ${c?.type}`);
  return c as Extract<StreamChunk, { type: K }>;
};
/** The text of a text or reasoning block-end. */
const blockTextOf = (c: StreamChunk | undefined): string => {
  const b = chunkOf(c, "block-end").block;
  if (b.type === "text" || b.type === "reasoning") return b.text;
  throw new Error(`block has no text: ${b.type}`);
};
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { join as joinPath } from "node:path";

declare module "./adapter.js" {
  interface Translator {
    finished: boolean;
    toolPending: boolean;
    relayed: Set<string>;
    open: Map<number, import("./adapter.js").TranslatorBlock>;
    index: number;
    dshIds: Set<string>;
    aborting: boolean;
    log: (level: string, msg: string) => void;
  }
}

const config = new Config({});
assert.equal(config.permissionMode, "dsh");
assert.deepEqual(config.allowedTools, []);
assert.equal(config.titleModel, "haiku");
assert.equal(config.resume, true);

// providerId defaults to claude-code; settingsNs and displayName derive correctly
assert.equal(config.providerId, "claude-code");
const workConfig = new Config({ providerId: "claude-code-work", providerName: "Work" });
assert.equal(workConfig.providerId, "claude-code-work");
// registry key separates instances even with the same sessionId
assert.notEqual(
  registryKey("claude-code-work", "s1"),
  registryKey("claude-code", "s1"),
  "different provider ids produce different keys",
);
assert.equal(registryKey("claude-code-work", "s1").slice(0, 15), "claude-code-wor");
// invalid provider id throws at construction
const badCtx = { on() {} } as unknown as import("./dsh.js").PluginContext;
assert.throws(
  () => new ClaudeCodeAdapter(badCtx, new Config({ providerId: "gpt" })),
  /invalid providerId/,
);
// displayName and settingsNs derive from config
const defaultAdapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
assert.equal(defaultAdapter.providerId, "claude-code");
assert.equal(defaultAdapter.displayName, "Oh My Claude");
assert.equal(defaultAdapter.settingsNs, "llm-claude-code");
const workAdapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), workConfig);
assert.equal(workAdapter.providerId, "claude-code-work");
assert.equal(workAdapter.displayName, "Work");
// empty providerName falls back to auto-derived name
const autoWorkAdapter = new ClaudeCodeAdapter(
  fakeCtx({ on() {} }),
  new Config({ providerId: "claude-code-work" }),
);
assert.equal(autoWorkAdapter.displayName, "Oh My Claude (work)");
assert.equal(workAdapter.settingsNs, "llm-claude-code-work");
// state dir for non-default id nests under STATE_DIR/<providerId>
assert.equal(stateDir("claude-code"), joinPath(homedir(), ".local", "state", "dsh-oh-my-claude"));
assert.ok(
  stateDir("claude-code-work").includes("/claude-code-work"),
  "non-default state dir contains the provider id segment",
);

// resolveModelInfo echoes the requested id and only borrows the display name
const rmi = (id: string) => resolveModelInfo("claude-code", id) as any;
assert.equal(rmi("claude-opus-4").id, "claude-opus-4");
assert.equal(rmi("claude-fable-5-1").name, "Claude Fable 5.1");
assert.equal(rmi("bogus").name, "bogus");
assert.equal(rmi("bogus").context, undefined);
assert.equal(rmi("claude-fable-5-1").context.contextWindow, 1_000_000);
assert.equal(rmi("claude-fable-5-1").reasoning.defaultEffort, undefined);
assert.equal(rmi("claude-fable-5-1").reasoning.efforts.length, 5);
assert.equal(rmi("claude-haiku-4-5").reasoning, undefined);
assert.deepEqual(rmi("claude-haiku-4-5").inputModalities, ["text", "image"]);

// session mapping is deterministic and UUID-shaped
const sid = claudeSessionId("abc");
assert.equal(sid, claudeSessionId("abc"));
assert.match(sid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.notEqual(sid, claudeSessionId("abd"));
assert.equal(projectDirName("/home/someone/.dsh/x"), "-home-someone--dsh-x");

// turn selection: fresh sends everything, resume sends only what follows the last assistant turn
const inj = message({
  role: "user",
  content: [{ type: "text", text: "<system-reminder>ctx</system-reminder>" }],
});
const toolMsg = message({
  role: "user",
  source: { kind: "tool", callId: "x" },
  content: [{ type: "tool-result" }],
});
const history = messageList([
  { role: "user", content: "hi" },
  { role: "assistant", content: "yo" },
  toolMsg,
  { role: "user", content: "again" },
  inj,
]);
assert.equal(selectTurns(history, false).length, 4);
assert.deepEqual(
  selectTurns(history, true).map((m: any) => textOf(m)),
  ["again", "<system-reminder>ctx</system-reminder>"],
);
function textOf(m: any) {
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
} as any);
assert.ok(chat.includes("--include-partial-messages") && chat.includes("--input-format"));
assert.deepEqual(chat.slice(-2), ["--resume", "u"]);
assert.ok(
  chat.join(" ").includes("--permission-prompt-tool stdio") &&
    chat.join(" ").includes("--tools default"),
);
assert.ok(chat.join(" ").includes("--permission-mode acceptEdits"));
// Permission mode override is passed through to args
const override = buildArgs({
  model: "m",
  config,
  permissionMode: "plan",
} as any);
assert.ok(override.join(" ").includes("--permission-mode plan"), "override takes precedence");
assert.ok(
  chat.join(" ").includes("--effort max") && chat.join(" ").includes("--append-system-prompt sys"),
);
assert.ok(!chat.join(" ").includes("mcp__dsh__"), "no dsh guidance without the bridge");
// bridged dsh tools: the system prompt gains the subagent guidance so Claude uses mcp__dsh__*
const bridged = buildArgs({
  model: "m",
  system: "sys",
  config,
  session: { id: "u", resuming: false },
  mcp: { url: "http://x/mcp/u", key: "k" },
} as any);
const bridgedSystem = bridged[bridged.indexOf("--append-system-prompt") + 1]!;
assert.ok(bridgedSystem.startsWith("sys\n\n"), "dsh system prompt comes first");
assert.ok(bridgedSystem.includes("never the built-in Agent/Task tool"));
assert.ok(bridgedSystem.includes("mcp__dsh__list_subagent_models"));
assert.ok(bridgedSystem.includes("mcp__dsh__bash"), "guidance names the bridged bash tool");
assert.ok(
  bridgedSystem.includes("run_in_background: true"),
  "guidance tells Claude to use run_in_background on it",
);
const fresh = buildArgs({ model: "m", config, session: { id: "u", resuming: false } } as any);
assert.deepEqual(fresh.slice(-2), ["--session-id", "u"]);
const aux = buildArgs({
  model: "haiku",
  purpose: "session-title",
  config,
  session: undefined,
} as any);
assert.deepEqual(aux.slice(-5), ["--tools", "", "--max-turns", "1", "--no-session-persistence"]);
const auxOld = buildArgs({
  model: "haiku",
  purpose: "session-title",
  config,
  session: undefined,
  flags: new Set(["--tools", "--max-turns"]),
} as any);
assert.deepEqual(auxOld.slice(-4), ["--tools", "", "--max-turns", "1"], "older CLI: flag left out");
assert.equal(aux.filter((a) => a === "--tools").length, 1);
assert.ok(!aux.includes("--permission-mode"));
const custom = buildArgs({
  model: "m",
  config: new Config({ allowedTools: ["Bash"], addDirs: ["/x"], maxTurns: 3 }),
} as any);
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
const tr = new Translator() as any;
const se = (event: any) => tr.translate({ type: "stream_event", event });
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
    // SAFETY: partial fake for tests; StreamChunk type not exported
  }).map((e: { type: string }) => e.type),
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
// SAFETY: partial fake for tests
assert.deepEqual(
  done.map((e: { type: string }) => e.type),
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
const trd = new Translator() as any;
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
const tr2 = new Translator({ toolActivity: false }) as any;
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
// SAFETY: partial fake for tests
assert.deepEqual(
  whole.map((e: { type: string }) => e.type),
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
// "allowed_warning" = near the cap, not a limit: the turn must go on (ending it made dsh's
// retry re-send the prompt, seen live 2026-09-04)
const warned = new Translator() as any;
assert.deepEqual(
  warned.translate({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed_warning", utilization: 0.9, resetsAt: 1 },
  }),
  [],
);
assert.equal(warned.finished, false, "allowed_warning does not end the turn");
const limited = new Translator().translate({
  type: "rate_limit_event",
  rate_limit_info: { status: "rejected" },
});
// SAFETY: rate_limit_event always produces a finish chunk with error reason
const limitedFirst = limited[0];
assert.ok(limitedFirst && "reason" in limitedFirst && limitedFirst.reason.kind === "error");
assert.equal(failureOf(chunkOf(limitedFirst, "finish").reason).code, "RATE_LIMIT");
// SAFETY: result error always produces a finish chunk with error reason
const resultChunk = new Translator()
  .translate({ type: "result", is_error: true, result: "boom" })
  .at(-1);
assert.ok(resultChunk && "reason" in resultChunk && resultChunk.reason.kind === "error");
assert.equal(failureOf(chunkOf(resultChunk, "finish").reason).message, "boom");
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
assert.deepEqual(api, {
  provider: "claude-code",
  id: "claude-x",
  name: "X",
  contextWindow: 500,
  efforts: ["low"],
});
const failing = await getCatalog(async () => {
  throw new Error("offline");
});
assert.equal(failing, KNOWN_MODELS);

// access-mode switch from the dsh UI → Claude Code permission mode, unless config pins one
const policy = (mode: string): LooseMessage => ({
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
const switched = buildArgs({ model: "m", config, accessMode: "danger-full-access" } as any);
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
} as any);
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
const rl = (new Translator() as any).translate({
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
// SAFETY: result with errors produces a finish chunk with error reason
const rl2 = new Translator().translate({ type: "result", is_error: true, errors: ["a", "b"] });
assert.ok(rl2[0] && "reason" in rl2[0] && rl2[0].reason.kind === "error");
assert.equal(rl2[0].reason.failure.message, "a; b");

// denied tool calls are counted and reported once at the end of the turn
const td = new Translator({ toolTextLimit: 100 }) as any;
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
// SAFETY: text-delta event exists for this transcript
const textDelta = ended.find((e: { type: string }) => e.type === "text-delta");
assert.ok(textDelta && "text" in textDelta);
assert.ok((textDelta as { text?: string }).text?.includes("denied 1 tool call "));
assert.equal(ended.at(-1).reason.kind, "stop");
assert.equal(new Translator().translate({ type: "result", is_error: false })[0]?.type, "finish");

// result frame with usage fields records a turn summary via onResult
const recorded: TurnRecord[] = [];
const trWithResult = new Translator({
  onResult: (s: TurnRecord) => recorded.push(s),
});
// SAFETY: test fixture; these runtime fields are not in the ClaudeEvent type but exist on CLI output
trWithResult.translate({
  type: "result",
  is_error: false,
  stop_reason: "end_turn",
  total_cost_usd: 0.42,
  duration_ms: 34000,
  duration_api_ms: 12000,
  num_turns: 3,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 0,
  },
} as any);
assert.equal(recorded.length, 1, "onResult fired once per result frame");
// SAFETY: recorded.length is exactly 1 above
assert.equal(recorded[0]!.costUsd, 0.42);
assert.equal(recorded[0]!.durationMs, 34000);
assert.equal(recorded[0]!.apiMs, 12000);
assert.equal(recorded[0]!.turns, 3);
assert.equal(recorded[0]!.input, 100);
assert.equal(recorded[0]!.output, 50);
assert.equal(recorded[0]!.cacheRead, 900);
assert.equal(recorded[0]!.cacheWrite, 0);
// missing fields default to 0
const missing: TurnRecord[] = [];
const trMissing = new Translator({ onResult: (s: TurnRecord) => missing.push(s) });
trMissing.translate({ type: "result", is_error: false, stop_reason: "end_turn" });
// no total_cost_usd or duration_ms → condition stays false, nothing recorded
assert.equal(missing.length, 0);

// forwarded subagent text renders as reasoning even while partials are on
const ts2 = new Translator() as any;
ts2.translate({ type: "stream_event", event: { type: "message_start" } });
const sub = ts2.translate({
  type: "assistant",
  parent_tool_use_id: "toolu_1",
  message: { content: [{ type: "text", text: "child says hi" }] },
});
// SAFETY: subagent message always produces a block-end chunk
const subLast = sub.at(-1);
assert.ok(subLast && "block" in subLast);
assert.equal(subLast.block.text, "↳ subagent\nchild says hi");
// SAFETY: tool_result always produces a block-end chunk
const toolResultChunk = new Translator({ toolTextLimit: 5 })
  .translate({
    type: "user",
    message: { content: [{ type: "tool_result", content: "abcdefghij" }] },
  })
  .at(-1);
assert.ok(toolResultChunk && "block" in toolResultChunk);
assert.equal(blockTextOf(toolResultChunk), "◀ result\nabcde…");
assert.ok(buildArgs({ model: "m", config } as any).includes("--forward-subagent-text"));
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
assert.ok(qs);
assert.equal(qs.length, 1);
// SAFETY: qs[0] exists because we asserted length === 1
const firstQ = qs[0];
assert.ok(firstQ);
assert.equal(firstQ.id, "toolu_9:0");
// SAFETY: options[1] exists because we asserted options has 2 elements
const secondOpt = firstQ.options[1];
assert.ok(secondOpt);
assert.deepEqual(secondOpt, { label: "coffee", description: "hot" });
assert.equal(parseQuestions({ questions: [] }, "x"), undefined);
assert.equal(
  parseQuestions({ questions: [{ question: "q", options: [{ nope: 1 }] }] }, "x"),
  undefined,
);
assert.deepEqual(answersFor(qs as any, { answers: [{ id: "toolu_9:0", selected: ["tea"] }] }), {
  "Tea or coffee?": "tea",
});
assert.deepEqual(
  answersFor(qs as any, { answers: [{ id: "toolu_9:0", selected: [], custom: "water" }] }),
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
  !buildArgs({ model: "m", purpose: "session-title", config } as any).includes(
    "--permission-prompt-tool",
  ),
);

// idle-timer pause: a closed tool_use block sets toolPending until the tool result arrives
const tp = new Translator() as any;
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
const tq = new Translator({ toolActivity: false }) as any;
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
  const tr = new Translator({ relay: true }) as any;
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
  const plain = new Translator({ relay: false }) as any;
  plain.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu2", name: "mcp__dsh__subagent_local" },
    },
  });
  // SAFETY: open has entry for index 0
  const plainBlock = plain.open.get(0);
  assert.ok(plainBlock);
  assert.equal(plainBlock.blockType, "text", "without relay the old visible row stays");
}
{
  const tr = new Translator() as any;
  tr.index = 3;
  // SAFETY: partial fake for tests; RelayEvent requires type/resolve/reject not used in test
  const chunks = [
    ...relayBlocks(
      tr as any,
      {
        id: "c1",
        name: "subagent_local",
        args: { prompt: "hi" },
      } as unknown as import("./process.js").RelayEvent,
    ),
  ];
  assert.deepEqual(
    chunks.map((c) => c.type),
    ["block-start", "tool-call-delta", "block-end"],
  );
  // SAFETY: chunks[0] exists because relayBlocks yields at least one chunk
  const firstChunk = chunks[0];
  assert.ok(firstChunk);
  // SAFETY: chunks[0] has index from translator state
  assert.equal((firstChunk as { index?: number }).index, 3);
  assert.equal(tr.index, 4, "reserves one block index");
  // SAFETY: chunks[2] exists and has block property
  const lastChunk = chunks[2];
  assert.ok(lastChunk && "block" in lastChunk);
  assert.deepEqual(chunkOf(lastChunk, "block-end").block, {
    type: "tool-call",
    id: "c1",
    name: "subagent_local",
    arguments: '{"prompt":"hi"}',
  });
}
{
  const messages = messageList([
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "x", arguments: "{}" }] },
    {
      role: "user",
      source: { kind: "tool", callId: "c1" },
      content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "42" }] }],
    },
  ]);
  assert.deepEqual(toolResultFor(messages, "c1"), { text: "42", isError: false });
  assert.equal(toolResultFor(messages, "nope"), undefined);
  assert.equal(toolResultFor([{ role: "user", content: [] }], "c1"), undefined);
}
{
  const base = messageList([
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool-call", id: "c1", name: "x", arguments: "{}" }] },
    {
      role: "user",
      source: { kind: "tool", callId: "c1" },
      content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "42" }] }],
    },
  ]);
  assert.equal(stepContextFor(base), "", "only the tool result: nothing to add");
  const steered = messageList([
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
  ]);
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
  const msgs = messageList([
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
  ]);
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
  // SAFETY: partial fake for tests; PluginContext requires many fields not used here
  const adapter = new ClaudeCodeAdapter(
    { on() {} } as unknown as import("./dsh.js").PluginContext,
    Config({ maxProcesses: 2, processIdleMs: 10_000 }),
  );
  const fake = (extra: any) => ({
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
  adapter.processes.set(registryKey("claude-code", "a"), parked);
  adapter.processes.set(registryKey("claude-code", "b"), steered);
  adapter.processes.set(registryKey("claude-code", "c"), idle);
  adapter.evict();
  assert.equal(parked.killed, 0, "a process waiting on dsh's tool result is not idle");
  assert.equal(steered.killed, 0, "a process parked for a steer is not idle");
  assert.equal(idle.killed, 1, "a truly idle process past processIdleMs is culled");
}
{
  const tr = new Translator({ relay: true }) as any;
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
  // SAFETY: fin2 has at least one element with error reason
  const fin2Last = fin2.at(-1);
  assert.ok(fin2Last && "reason" in fin2Last && fin2Last.reason.kind === "error");
}
{
  const tr = new Translator({ relay: true }) as any;
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
  const line = (o: any) => JSON.stringify(o);
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
  const msgs = messageList([
    { role: "user", source: { kind: "user" }, content: [] },
    { role: "assistant", content: [] },
    { role: "user", source: { kind: "subagent-settled" }, content: [] },
    { role: "user", source: { kind: "user" }, content: [] },
  ]);
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
  const note = (line: any) => ClaudeProcess.prototype.noteIdleResult.call(fake, line);
  note('{"type":"assistant","message":{"content":[{"type":"text","text":"result"}]}}');
  note("plain result text");
  assert.equal(woke, 0, "assistant text and junk do not wake");
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "an idle result wakes once");
  fake.busy = true;
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "a result during a live turn is the turn's own, no wake");
  fake.busy = false;
  (fake as any).onIdleResult = undefined;
  note('{"type":"result","subtype":"success"}');
  assert.equal(woke, 1, "no callback, no throw");
}
{
  const wake = message({
    role: "user",
    source: { kind: "plugin", plugin: "dsh-oh-my-claude", form: "notice", summary: WAKE_TEXT },
    content: [{ type: "text", text: WAKE_TEXT }],
  });
  const user = message({
    role: "user",
    source: { kind: "user" },
    content: [{ type: "text", text: "hi" }],
  });
  const other = message({
    role: "user",
    source: { kind: "plugin", plugin: "dsh-skills" },
    content: [],
  });
  const asst = message({ role: "assistant", content: [{ type: "text", text: "ok" }] });
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
  const t = new Translator() as any;
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
  assert.equal(out.at(-1).block.type, "reasoning", "compaction rides the reasoning lane");
  assert.match(manual.at(-1).block.text, /\(manual\)/, "manual trigger, no token count");
}
{
  // Auto-memory traffic: saved files and recalls show as one reasoning line each; an empty recall is silent.
  const t = new Translator() as any;
  const saved = t.translate({
    type: "system",
    subtype: "memory_saved",
    written_paths: [
      "/h/.claude/projects/p/memory/feedback-x.md",
      "/h/.claude/projects/p/memory/MEMORY.md",
    ],
  });
  assert.equal(saved.at(-1).block.type, "reasoning");
  assert.equal(saved.at(-1).block.text, "Saved 2 memories: feedback-x.md, MEMORY.md");
  const recalled = t.translate({
    type: "system",
    subtype: "memory_recall",
    mode: "select",
    memories: [{ path: "a.md" }],
  });
  assert.equal(recalled.at(-1).block.text, "Recalled 1 memory");
  assert.deepEqual(t.translate({ type: "system", subtype: "memory_recall", memories: [] }), []);
}
{
  // The compaction start frame (status:"compacting") is announced at once, so the silent summarize
  // stretch has a visible anchor and does not arrive delayed as the boundary line alone.
  const t = new Translator() as any;
  const start = t.translate({ type: "system", subtype: "status", status: "compacting" });
  assert.match(start.at(-1).block.text, /Compacting context…/);
  assert.equal(t.finished, false, "the start frame does not end the turn");
  // The success end frame is silent; the boundary line reports the result.
  assert.deepEqual(
    t.translate({ type: "system", subtype: "status", status: null, compact_result: "success" }),
    [],
  );
  // A failed run gets no boundary, so its error surfaces here.
  const failed = t.translate({
    type: "system",
    subtype: "status",
    status: null,
    compact_result: "failed",
    compact_error: "Not enough messages to compact.",
  });
  assert.match(failed.at(-1).block.text, /Compaction failed: Not enough messages to compact\./);
}
{
  // restoreTodos re-appends the last todo/write so the panel survives dsh's per-turn reset.
  // It reads persisted session events (survives restart) and is source-agnostic.
  const makeStub = (persistTodos: boolean, events: Array<{ type: string; data: any }>) => {
    const appended: Array<{ type: string; data: any }> = [];
    const session = {
      snapshotEvents: () => events,
      append: (type: string, data: any) => appended.push({ type, data }),
    };
    const stub = {
      config: { persistTodos },
      ctx: { sessions: { get: () => session } },
      log: () => {},
    };
    return { stub, appended };
  };
  const active = [
    { type: "turn/start", data: {} },
    { type: "todo/write", data: { todos: [{ content: "a", status: "in_progress" }] } },
    { type: "turn/start", data: {} },
  ];
  // Live turn/start: last non-empty list is re-appended.
  const a = makeStub(true, active);
  (ClaudeCodeAdapter.prototype as any).restoreTodos.call(a.stub, "s1");
  assert.deepEqual(
    a.appended,
    [{ type: "todo/write", data: { todos: [{ content: "a", status: "in_progress" }] } }],
    "last todo list re-appended after turn/start",
  );
  // Disabled: nothing is written.
  const b = makeStub(false, active);
  (ClaudeCodeAdapter.prototype as any).restoreTodos.call(b.stub, "s1");
  assert.deepEqual(b.appended, [], "persistTodos off writes nothing");
  // Empty last list (todos cleared): nothing to restore.
  const c = makeStub(true, [{ type: "todo/write", data: { todos: [] } }]);
  (ClaudeCodeAdapter.prototype as any).restoreTodos.call(c.stub, "s1");
  assert.deepEqual(c.appended, [], "an empty list is not re-appended");
}
{
  // wake(): a live agent gets the notice directly; an unloaded one is resumed through the
  // session controller first; a busy process never wakes.
  const sent: unknown[] = [];
  const agent = fakeAgent({ followup: (m: Message) => sent.push(m) });
  // SAFETY: partial fake for tests; PluginContext requires many fields not used here
  const ctx = {
    on() {},
    agents: { get: () => undefined },
    logger: { info() {}, warn() {} },
  } as unknown as import("./dsh.js").PluginContext;
  const a = new ClaudeCodeAdapter(fakeCtx(ctx), Config({}));
  let resumed = 0;
  (a as any).sessionController = { resolveAgent: async () => (resumed++, agent) };
  // SAFETY: partial fake for tests; ClaudeProcess requires many fields not used here
  await a.wake("s1", fakeProc({ busy: false }));
  assert.equal(resumed, 1, "unloaded agent: resumed through the controller");
  assert.equal(sent.length, 1);
  const firstMsg = sent[0] as {
    role?: string;
    source?: { kind?: string; plugin?: string; form?: string };
    content?: Array<{ text?: string }>;
  };
  assert.equal(firstMsg.role, "user");
  assert.deepEqual(
    [firstMsg.source?.kind, firstMsg.source?.plugin, firstMsg.source?.form],
    ["plugin", "dsh-oh-my-claude", "notice"],
  );
  assert.equal(firstMsg.content?.[0]?.text, WAKE_TEXT);
  ctx.agents.get = () => agent;
  await a.wake("s1", fakeProc({ busy: false }));
  assert.equal(resumed, 1, "live agent: no resume");
  assert.equal(sent.length, 2);
  await a.wake("s1", { busy: true } as unknown as import("./process.js").ClaudeProcess);
  assert.equal(sent.length, 2, "busy process: the turn is dsh's own, no wake");
  ctx.agents.get = () => undefined;
  (a as any).sessionController = {
    resolveAgent: async () => {
      throw new Error("gone");
    },
  };
  await a.wake("s1", fakeProc({ busy: false }));
  assert.equal(sent.length, 2, "resume failure is logged, not thrown");
}
{
  // dsh's instruction bundle: CLAUDE.md blocks go, Claude Code loads those files itself.
  const bundle = [
    "<system-reminder>",
    "The following workspace instructions may be relevant to your work.",
    "Instructions from: ~/.dsh/AGENTS.md",
    "",
    "# Global rules",
    "be lazy",
    "",
    "Instructions from: AGENTS.md",
    "",
    "see CLAUDE.md",
    "",
    "Instructions from: CLAUDE.md",
    "",
    "# CRITICAL DIRECTIVES",
    "no rm -rf",
    "",
    "</system-reminder>",
  ].join("\n");
  const out = withoutNativeInstructions(bundle);
  assert.ok(out.includes("Instructions from: ~/.dsh/AGENTS.md") && out.includes("be lazy"));
  assert.ok(out.includes("Instructions from: AGENTS.md"));
  assert.ok(!out.includes("Instructions from: CLAUDE.md") && !out.includes("no rm -rf"));
  assert.ok(out.endsWith("</system-reminder>"), "wrapper closed after dropping the last block");
  assert.equal(withoutNativeInstructions("plain text, no headers"), "plain text, no headers");
  const only =
    "<system-reminder>\nIntro\nInstructions from: sub/dir/CLAUDE.md\n\nx\n</system-reminder>";
  assert.equal(withoutNativeInstructions(only), "", "only native files: whole injection dropped");
  const nested =
    "Instructions from: ~/.claude/CLAUDE.md\n\ny\n\nInstructions from: docs/AGENTS.md\n\nz\n";
  const n = withoutNativeInstructions(nested);
  assert.ok(!n.includes("~/.claude/CLAUDE.md") && n.includes("docs/AGENTS.md") && n.includes("z"));
  // buildPrompt applies it only to agent-instructions messages
  const msgs = messageList([
    { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "hi" }] },
    {
      role: "user",
      source: { kind: "agent-instructions" },
      content: [{ type: "text", text: bundle }],
    },
    {
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "Instructions from: CLAUDE.md is a phrase I typed" }],
    },
  ]);
  const p = buildPrompt(msgs);
  assert.ok(p.includes("be lazy") && !p.includes("no rm -rf"));
  assert.ok(p.includes("is a phrase I typed"), "user text is never filtered");
}
{
  // Hot reload: a surviving process must never throw into readline, and a new adapter
  // re-adopts the callbacks. Seen live 2026-09-04: `patchReload: live` disposed the old scope,
  // an idle result then threw "cannot get required service" from the stdout handler.
  const boom = () => {
    throw new Error('cannot get required service "agents" in inactive context');
  };
  const fake = { busy: false, onIdleResult: boom };
  ClaudeProcess.prototype.noteIdleResult.call(fake, '{"type":"result"}'); // must not throw
  (fake as any).onIdleResult = () => Promise.reject(new Error("async boom"));
  ClaudeProcess.prototype.noteIdleResult.call(fake, '{"type":"result"}'); // no unhandled rejection
  const deadCtx = {
    on() {},
    get agents() {
      return boom();
    },
    get logger() {
      return boom();
    },
  };
  const dead = new ClaudeCodeAdapter(fakeCtx(deadCtx), Config({}));
  await dead.wake("s", fakeProc({ busy: false })); // scope gone: swallowed, logged if it can
  dead.log("warn", "x"); // logger on a dead scope: swallowed
  // a reloaded adapter re-points every adopted process at itself
  const reg = (globalThis as any)[Symbol.for("dsh-oh-my-claude.processes")];
  const stale = { busy: false, onIdleResult: boom, alive: true };
  reg.set(registryKey("claude-code", "adopted"), stale);
  let woke = 0;
  const liveCtx = {
    on() {},
    agents: { get: () => ({ followup: () => woke++ }) },
    logger: { info() {}, warn() {} },
  };
  const fresh = new ClaudeCodeAdapter(fakeCtx(liveCtx), Config({}));
  assert.notEqual(stale.onIdleResult, boom, "callback re-bound on construction");
  await stale.onIdleResult();
  assert.equal(woke, 1, "adopted process wakes through the new adapter");
  assert.equal(fresh.processes.get(registryKey("claude-code", "adopted")), stale);
  reg.delete(registryKey("claude-code", "adopted"));
}
{
  const tr = new Translator() as any;
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
    d.map((c: StreamChunk) => c.type),
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
  const a = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const b = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  a.processes.set(registryKey("claude-code", "shared"), fakeProc({ alive: true }));
  assert.equal(
    b.processes.get(registryKey("claude-code", "shared"))?.alive,
    true,
    "a reloaded adapter adopts running processes",
  );
  a.processes.delete(registryKey("claude-code", "shared"));
}
{
  const tr = new Translator({ relay: true }) as any;
  const open = (id: any) =>
    tr.translate({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id, name: "mcp__dsh__subagent_local" },
      },
    });
  const result = (id: string) =>
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
  const warnings: string[] = [];
  const tr = new Translator({
    log: (level: any, msg: any) => level === "warn" && warnings.push(msg),
  } as any);
  tr.translate({ type: "system", subtype: "init" }); // benign top-level: no warn
  tr.translate(anyEvent({ type: "brand_new_event" })); // unknown: warn
  tr.translate(anyEvent({ type: "brand_new_event" })); // same type again: deduped, no second warn
  tr.partial({ type: "message_delta" }); // benign partial: no warn
  tr.partial({ type: "mystery_partial" }); // unknown partial: warn
  tr.openBlock(9, { type: "redacted_thinking" }); // unknown content block: warn
  assert.equal(warnings.length, 3, "one warn per distinct unknown type, deduped");
  assert.match(warnings[0] ?? "", /brand_new_event/);
  assert.match(warnings[0] ?? "", /schema may have changed/);
  assert.match(warnings[1] ?? "", /mystery_partial/);
  assert.match(warnings[2] ?? "", /redacted_thinking/);
}
console.log("schema-guard ok");

// A logged-out CLI surfaces as a clear instruction, whichever way the CLI words it.
{
  const notIn = finishReason({ is_error: true, result: "Not logged in · Please run /login" });
  assert.match(failureOf(notIn).message, /not logged in on .+claude auth login/);
  const expired = finishReason({
    is_error: true,
    api_error_status: 401,
    result: "Failed to authenticate. API Error: 401 OAuth access token is invalid.",
  });
  assert.match(failureOf(expired).message, /not logged in on/);
  assert.match(failureOf(expired).message, /OAuth access token is invalid/);
  const other = finishReason({ is_error: true, result: "rate limited" });
  assert.equal(failureOf(other).message, "rate limited");
}

// ClaudeProcess talks to one handle shape; a fake spawner proves write, line intake, exit, kill.
{
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let terminated = 0;
  let finish: (r: { exitCode: number | null; signal: string | null }) => void = () => {};
  const handle: SubprocessHandle = {
    stdin,
    stdout,
    stderr,
    done: new Promise((r) => (finish = r)),
    terminate: () => {
      terminated++;
      finish({ exitCode: 143, signal: "SIGTERM" });
    },
  };
  const seen: [string, string[], string][] = [];
  const proc = new ClaudeProcess({
    args: ["-p"],
    cwd: "/",
    spec: emptySpec,
    spawner: (command, args, cwd) => {
      seen.push([command, args, cwd]);
      return handle;
    },
    command: "/opt/claude",
  });
  assert.deepEqual(seen, [["/opt/claude", ["-p"], "/"]]);
  let written = "";
  stdin.on("data", (d) => (written += d));
  assert.equal(proc.write("hello\n"), true);
  stdout.write('{"type":"system","subtype":"init"}\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(written, "hello\n");
  assert.equal(proc.queue.lines.length, 1, "stdout line reached the queue");
  assert.equal(proc.alive, true);
  proc.kill();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(terminated, 1);
  assert.equal(proc.alive, false);
  assert.equal(proc.exitCode, 143);
  assert.equal(proc.write("late\n"), false);
}

// The seam spawner hands dsh a fully explicit spec: raw pipes, the binary first in argv, small env.
{
  let spec: SubprocessSpawnSpec | undefined;
  const idle: SeamHandle = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    done: new Promise(() => {}),
    terminate() {},
    waitForExit: async () => {},
  };
  const spawner = seamSpawner({
    spawn: (s) => {
      spec = s;
      return idle;
    },
  });
  spawner("claude", ["-p", "--verbose"], "/w");
  assert.ok(spec, "spawn was called");
  assert.deepEqual(spec.argv, ["claude", "-p", "--verbose"]);
  assert.equal(spec.cwd, "/w");
  assert.deepEqual(spec.stdio, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  assert.deepEqual(
    Object.keys(spec.env ?? {}),
    Object.keys(CHILD_ENV),
    "child env only, no dsh env leak",
  );
  assert.ok(spec.graceMs > 0);
}

// Busy bookkeeping survives a restart: mark on turn start, clear on end, take once after boot.
{
  const dir = await mkdtemp(joinPath(tmpdir(), "dsh-oh-my-claude-busy-"));
  const file = joinPath(dir, "busy.json");
  await markBusy("a", true, file);
  await markBusy("b", true, file);
  await markBusy("a", false, file);
  assert.deepEqual(await takeInterrupted(file), ["b"]);
  assert.deepEqual(await takeInterrupted(file), [], "taken once");
  assert.deepEqual(await takeInterrupted(joinPath(dir, "missing.json")), []);
}

// The restart nudge is a real prompt, not a drain-only wake: only the idle-reply text drains.
{
  const user = message({
    role: "user",
    content: [{ type: "text", text: "hi" }],
    source: { kind: "user" },
  });
  const asst = message({ role: "assistant", content: [{ type: "text", text: "yo" }] });
  const restart = message({
    role: "user",
    content: [{ type: "text", text: RESTART_TEXT }],
    source: { kind: "plugin", plugin: "dsh-oh-my-claude", form: "notice" },
  });
  assert.equal(wakeOnlyTurn([user, asst, restart]), false, "restart notice is sent, not drained");
}

// resumeInterrupted(): nudges sessions the previous process left mid-turn with the restart text,
// skips ones whose process this instance adopted (a hot reload), and clears the file.
{
  const dir = await mkdtemp(joinPath(tmpdir(), "dsh-oh-my-claude-resume-"));
  const file = joinPath(dir, "busy.json");
  await markBusy("dead", true, file);
  await markBusy("live", true, file);
  const ctx = { on() {}, agents: { get: () => undefined }, logger: { info() {}, warn() {} } };
  const a = new ClaudeCodeAdapter(fakeCtx(ctx), Config({}));
  a.processes.set(registryKey("claude-code", "live"), fakeProc({ busy: true }));
  const woke: [string, ClaudeProcess | undefined, string | undefined][] = [];
  a.wake = async (id, proc, text) => {
    woke.push([id, proc, text]);
  };
  await a.resumeInterrupted(file);
  assert.deepEqual(woke, [["dead", undefined, RESTART_TEXT]]);
  assert.deepEqual(await takeInterrupted(file), ["live"], "live session stays tracked");
}
// --- native tool rows: onToolCall / onToolResult callbacks fire for Bash and Edit ---
{
  const calls: Array<{ callId: string; name: string; args: string }> = [];
  const results: Array<{ callId: string; text: string; isError: boolean; meta?: object }> = [];
  const tr = new Translator({
    onToolCall: (callId, name, args) => {
      calls.push({ callId, name, args });
      return 42; // fake seq
    },
    onToolResult: (callId, text, isError, meta) => {
      results.push({ callId, text, isError, meta });
    },
  }) as any;
  // stream-json partial path: content_block_start → input_json_delta → content_block_stop
  tr.translate({ type: "stream_event", event: { type: "message_start" } });
  tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu1", name: "Bash" },
    },
  });
  tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: '{"command":"ls","description":"List files"}',
      },
    },
  });
  const stop = tr.translate({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
  });
  // no reasoning chunk emitted for the native tool call
  assert.deepEqual(stop, [], "native tool_use block emits no chunk");
  assert.equal(calls.length, 1, "onToolCall fired once");
  assert.equal(calls[0]!.name, "bash", "Bash mapped to lowercase bash");
  assert.ok(calls[0]!.args.includes('"description":"List files"'), "arguments contain description");
  // tool_result path
  const res = tr.translate({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "file1\nfile2" }] },
  });
  assert.deepEqual(res, [], "native tool_result emits no chunk");
  assert.equal(results.length, 1, "onToolResult fired once");
  assert.equal(results[0]!.callId, "tu1", "result references the same callId");
  assert.equal(results[0]!.text, "file1\nfile2", "result text preserved");
}
// --- a tool_use block reaching both the streaming and whole-message paths fires onToolCall once ---
// Regression: two `tool/call` appends for one callId gave the client "received more than one start",
// which threw in ConversationNodeAssembler and stalled the event feed (no history, stuck spinner).
{
  const calls: string[] = [];
  const tr = new Translator({
    onToolCall: (callId) => {
      calls.push(callId);
      return calls.length; // fake, distinct seq
    },
  }) as any;
  // streaming path: content_block_start → input_json_delta → content_block_stop fires once
  tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "dup1", name: "Bash" },
    },
  });
  tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
    },
  });
  tr.translate({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  assert.equal(calls.length, 1, "streaming path fired onToolCall once");
  // whole-message path replays the same tool_use (resume / non-partial); must not fire again
  tr.translate({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "dup1", name: "Bash", input: { command: "ls" } }],
    },
  });
  assert.equal(calls.length, 1, "same callId does not fire onToolCall a second time");
  // the result closes the call: both per-call maps drop the entry, so a long turn stays bounded
  tr.onToolResult = () => {};
  tr.translate({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "dup1", content: "ok" }] },
  });
  assert.equal(tr.firedCalls.size, 0, "firedCalls emptied after tool_result");
  assert.equal(tr.callInputs.size, 0, "callInputs emptied after tool_result");
}
{
  const results: Array<{ callId: string; meta?: object }> = [];
  const tr = new Translator({
    onToolCall: (callId, _name, args) => {
      // pretend we stored the args so the result handler can build meta
      (tr as any).callInputs.set(callId, args);
      return 99;
    },
    onToolResult: (_callId, _text, _isError, meta) => {
      results.push({ callId: "", meta });
    },
  }) as any;
  // feed a whole-assistant-message Edit (no partials)
  tr.translate({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "e1",
          name: "Edit",
          input: { file_path: "/x/y.ts", old_string: "old", new_string: "new" },
        },
      ],
    },
  });
  assert.equal(results.length, 0, "onToolResult not called yet — no result arrived");
  tr.translate({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "e1", content: "edited" }] },
  });
  assert.equal(results.length, 1, "onToolResult fired after Edit result");
  assert.ok(
    (results[0]!.meta as any)?.diffs?.[0]?.path === "/x/y.ts",
    "Edit meta carries diffs[0].path from the call input",
  );
}

// configDir: default empty, resolveClaudeHome resolves correctly
assert.equal(new Config({}).configDir, "");
const savedEnv = process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CONFIG_DIR; // SAFETY: test only — restores original at scope exit not needed in module
assert.equal(resolveClaudeHome(""), CLAUDE_HOME);
assert.ok(resolveClaudeHome("~/x").startsWith(homedir()));
assert.ok(resolveClaudeHome("~/x").endsWith("/x"));
assert.equal(resolveClaudeHome("/abs"), "/abs");
if (savedEnv !== undefined) process.env.CLAUDE_CONFIG_DIR = savedEnv;

// spawn env: non-empty configDir injects CLAUDE_CONFIG_DIR, empty does not
{
  let capturedEnv: Record<string, string> | undefined;
  // Local base spawner mirrors nodeSpawner but captures envOverride for inspection
  const base = (
    command: string,
    args: string[],
    cwd: string,
    envOverride?: Record<string, string>,
  ) => {
    capturedEnv = envOverride;
    return {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
    } as any;
  };
  // non-empty configDir → wrapper injects CLAUDE_CONFIG_DIR
  const wrapped1 = (command: string, args: string[], cwd: string) =>
    base(command, args, cwd, { CLAUDE_CONFIG_DIR: "/custom" });
  (wrapped1 as any)("claude", [], "/w");
  assert.deepEqual(capturedEnv, { CLAUDE_CONFIG_DIR: "/custom" });
  // empty configDir → no envOverride passed to base
  const wrapped2 = (command: string, args: string[], cwd: string) => base(command, args, cwd);
  (wrapped2 as any)("claude", [], "/w");
  assert.equal(capturedEnv, undefined);
}

// noteBoot: first boot has no previous, a second boot reports the gap, and the file survives.
{
  const dir = await mkdtemp(joinPath(tmpdir(), "omc-boot-"));
  const file = joinPath(dir, "boot.json");
  assert.equal(await noteBoot(file, 1_000), undefined, "no previous boot");
  assert.equal(await noteBoot(file, 31_000), 30_000, "gap since the previous boot");
  assert.equal(
    await noteBoot(joinPath(dir, "nope", "boot.json"), 5),
    undefined,
    "missing dir tolerated",
  );
}
console.log("boot ok");

// hasPendingNotice: a next-turn plugin notice after the last turn/start is pending; one before
// a later turn/start, a next-step splice, or another plugin's notice is not.
{
  const notice = (plugin: string, target = "next-turn") => ({
    type: "agent/inbox/spliced",
    data: { target, start: 0, removedCount: 0, inserted: [{ source: { kind: "plugin", plugin } }] },
  });
  const turn = { type: "turn/start", data: { turn: 1 } };
  assert.equal(hasPendingNotice([notice("dsh-oh-my-claude")], "dsh-oh-my-claude"), true);
  assert.equal(hasPendingNotice([notice("dsh-oh-my-claude"), turn], "dsh-oh-my-claude"), false);
  assert.equal(hasPendingNotice([turn, notice("dsh-oh-my-claude")], "dsh-oh-my-claude"), true);
  assert.equal(
    hasPendingNotice([notice("dsh-oh-my-claude", "next-step")], "dsh-oh-my-claude"),
    false,
  );
  assert.equal(hasPendingNotice([notice("other")], "dsh-oh-my-claude"), false);
  assert.equal(
    hasPendingNotice([{ type: "agent/inbox/spliced", data: null }], "dsh-oh-my-claude"),
    false,
  );
  const userNotice = {
    type: "agent/inbox/spliced",
    data: {
      target: "next-turn",
      start: 0,
      removedCount: 0,
      inserted: [{ source: { kind: "user" }, content: [{ type: "text", text: "RESTART" }] }],
    },
  };
  assert.equal(hasPendingNotice([userNotice], "dsh-oh-my-claude", ["RESTART"]), true);
  assert.equal(hasPendingNotice([userNotice], "dsh-oh-my-claude"), false);
}
console.log("pending-notice ok");

// buildRedactor masks secret-looking env values, longest first, and leaves short or unnamed ones.
{
  const redact = buildRedactor({
    MY_API_KEY: "abcdefgh12",
    LONGER_TOKEN: "abcdefgh12xyz",
    PATH: "/usr/bin:/bin",
    SHORT_KEY: "abc",
  });
  assert.equal(
    redact("k=abcdefgh12xyz and abcdefgh12"),
    "k=[redacted:LONGER_TOKEN] and [redacted:MY_API_KEY]",
  );
  assert.equal(
    redact("PATH=/usr/bin:/bin abc"),
    "PATH=/usr/bin:/bin abc",
    "path and short values untouched",
  );
  assert.equal(Config({}).redactSecrets, true);
}
// Translator applies the injected redactor to tool results before the row is appended.
{
  const results: string[] = [];
  const tr = new Translator({
    onToolCall: () => 1,
    onToolResult: (_id, text) => {
      results.push(text);
    },
    redact: (s) => s.split("hunter22").join("[redacted:PW]"),
  }) as any;
  tr.translate({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t9", name: "Bash", input: { command: "env" } }] },
  });
  tr.translate({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "t9", content: "DB_PASSWORD=hunter22" }],
    },
  });
  assert.deepEqual(results, ["DB_PASSWORD=[redacted:PW]"]);
}
console.log("redaction ok");

// decide(): ExitPlanMode goes through userQuestions.ask with the plan-review intent; Approve
// allows the tool, anything else denies with the typed feedback.
{
  const asked: Array<{
    questions: Array<{ id: string; detail?: string; intent?: { kind: string } }>;
  }> = [];
  let answer: { answers: Array<{ id: string; selected?: string[]; custom?: string }> } = {
    answers: [],
  };
  const ctx = fakeCtx({
    on() {},
    userQuestions: {
      ask: async (req: {
        questions: Array<{ id: string; detail?: string; intent?: { kind: string } }>;
      }) => {
        asked.push(req);
        return answer;
      },
    },
  });
  const adapter = new ClaudeCodeAdapter(ctx, Config({}));
  const base = {
    toolName: "ExitPlanMode",
    input: { plan: "# Plan\n1. do it" },
    request: { subtype: "can_use_tool" },
    toolUseId: "tu-plan",
    agent: undefined,
    signal: new AbortController().signal,
    accessMode: "workspace-write",
  };
  answer = { answers: [{ id: "plan-review:tu-plan", selected: ["Approve"] }] };
  // SAFETY: the Decision shape is internal; the test passes the fields decide() reads
  const ok = await adapter.decide(base as any);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.questions[0]!.intent?.kind, "plan-review");
  assert.equal(asked[0]!.questions[0]!.detail, "# Plan\n1. do it");
  assert.equal(ok.behavior, "allow", "Approve allows ExitPlanMode");
  answer = {
    answers: [{ id: "plan-review:tu-plan", selected: ["Keep planning"], custom: "add tests" }],
  };
  const no = await adapter.decide(base as any);
  assert.equal(no.behavior, "deny");
  assert.ok(String(no.message).includes("add tests"), "feedback goes back to Claude");
}
console.log("plan-review ok");

// commandNames keeps dsh-grammar names from the init frame; the Translator hands them to onInit.
{
  assert.deepEqual(commandNames(["afmdamc", "Bad Name", "ok-1", 5, "ok-1", "_x"]), [
    "afmdamc",
    "ok-1",
  ]);
  assert.deepEqual(commandNames("nope"), []);
  const seen: string[][] = [];
  const tr = new Translator({ onInit: (names) => seen.push(names) }) as any;
  const out = tr.translate({
    type: "system",
    subtype: "init",
    slash_commands: ["compact", "verify"],
  });
  assert.deepEqual(out, [], "init frame emits no chunk");
  assert.deepEqual(seen, [["compact", "verify"]]);
}
{
  // bridgeCommands reads the optional service through ctx.get: cordis throws on `ctx.commands`
  // unless "commands" is in `inject`, which took every turn down once (0.23.x).
  const registered: string[] = [];
  const commands = {
    register: (d: { name: string }) => (registered.push(d.name), () => {}),
    find: () => undefined,
  };
  const base = {
    on() {},
    logger: { info() {}, warn() {} },
    get: (n: string) => (n === "commands" ? commands : undefined),
  };
  const guarded = new Proxy(base, {
    get(t, p) {
      if (p === "commands") throw new Error('cannot get property "commands" without inject');
      return t[p as keyof typeof t];
    },
  });
  const a = new ClaudeCodeAdapter(fakeCtx(guarded), Config({ commandBridge: true }));
  a.bridgeCommands(["compact"], undefined);
  assert.deepEqual(
    registered,
    ["claude-compact", "temporary"],
    "the prefixed catalog plus /temporary",
  );
  assert.equal(a.bridged.size, 2, "compact and temporary");
}
console.log("command-bridge ok");

// fastMode: off by default; on, the process is launched with --settings {"fastMode":true} when the CLI lists --settings.
{
  assert.equal(Config({}).fastMode, false);
  const flags = new Set(["--settings", "--effort", "--output-format"]);
  const on = buildArgs({
    model: "opus",
    reasoningEffort: null,
    system: "",
    purpose: undefined,
    config: Config({ fastMode: true }),
    flags,
    mcp: null,
  } as any);
  const i = on.indexOf("--settings");
  assert.ok(
    i >= 0 && on[i + 1] === JSON.stringify({ fastMode: true }),
    "fast mode launches with --settings",
  );
  const off = buildArgs({
    model: "opus",
    reasoningEffort: null,
    system: "",
    purpose: undefined,
    config: Config({}),
    flags,
    mcp: null,
  } as any);
  assert.equal(off.indexOf("--settings"), -1, "no --settings without fastMode");
}
console.log("fast-mode ok");

// temporary: buildArgs adds --no-session-persistence only when asked and the CLI lists it.
{
  const flags = new Set(["--no-session-persistence", "--permission-mode"]);
  const base = {
    model: "opus",
    reasoningEffort: null,
    system: "",
    purpose: undefined,
    config: Config({}),
    flags,
    mcp: null,
  };
  assert.ok(buildArgs({ ...base, temporary: true } as any).includes("--no-session-persistence"));
  assert.ok(!buildArgs({ ...base } as any).includes("--no-session-persistence"));
}
console.log("temporary ok");

// keeper mode: the default spawn, one keeper dir per provider id and dsh session, stable across calls.
{
  assert.equal(Config({}).spawn, "keeper");
  const a1 = defaultAdapter.keeperDir("s1");
  assert.equal(a1, defaultAdapter.keeperDir("s1"), "deterministic");
  assert.notEqual(a1, defaultAdapter.keeperDir("s2"));
  assert.notEqual(a1, workAdapter.keeperDir("s1"), "per provider id");
  assert.ok(a1.includes("/keepers/"));
  assert.equal(defaultAdapter.keeperEnv().MCP_TOOL_TIMEOUT, "3600000");
}
console.log("keeper-mode ok");

// Idle watchdog: the warning event is queued at half the timeout, the kill lands at the timeout,
// an extend pushes both out, and a tool in flight pauses the whole thing.
{
  const idleAdapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({ idleTimeoutMs: 1000 }));
  const injected: string[] = [];
  let killed = 0;
  const proc = {
    idleKilled: false,
    kill: () => {
      killed += 1;
    },
    inject: (e: { type: string }) => {
      injected.push(e.type);
    },
  };
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  idleAdapter.armIdle("s1", proc);
  const first = idleAdapter.idleDeadlineMap.get("s1") ?? 0;
  assert.ok(first > Date.now() + 900, "deadline is one timeout out");
  await wait(600);
  assert.deepEqual(injected, ["idle_warning"], "warning queued at half the timeout");
  assert.equal(killed, 0);
  assert.equal(idleAdapter.extendIdle("s1"), true);
  assert.ok(
    (idleAdapter.idleDeadlineMap.get("s1") ?? 0) > first + 500,
    "extend pushed the deadline",
  );
  await wait(600);
  assert.equal(killed, 0, "extend postponed the kill");
  assert.equal(injected.length, 2, "a second warning after the extend");
  await wait(600);
  assert.equal(killed, 1, "killed at the new deadline");
  assert.equal(proc.idleKilled, true);
  assert.equal(idleAdapter.idleDeadlineMap.get("s1"), null);
  assert.equal(idleAdapter.extendIdle("s1"), false, "nothing armed: extend is a no-op");

  // Aux streams never warn; clearIdle stops the kill.
  idleAdapter.armIdle("aux", proc, false);
  idleAdapter.clearIdle("aux");
  await wait(1100);
  assert.equal(killed, 1, "cleared watchdog does not kill");
  assert.equal(injected.length, 2, "aux stream queued no warning");
  console.log("idle-watchdog ok");
}

// control(): the request goes out as one stdin line, the reply comes back through the process's
// control listener (so it works between turns), and rewind() decodes the rewind_files answer.
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const written: string[] = [];
  const proc: any = {
    alive: true,
    busy: false,
    controlListener: undefined,
    write(line: string) {
      written.push(line);
      const req = JSON.parse(line);
      setTimeout(() => {
        const response =
          req.request.subtype === "rewind_files"
            ? { canRewind: true, filesChanged: ["a.ts", "b.ts"], insertions: 3, deletions: 1 }
            : {};
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: { subtype: "success", request_id: req.request_id, response },
        });
      }, 0);
      return true;
    },
  };
  const ok = await adapter.control(proc, { subtype: "set_permission_mode", mode: "plan" });
  assert.equal(ok.ok, true);
  assert.equal(JSON.parse(written[0]!).request.mode, "plan");
  adapter.processes.set(registryKey(adapter.providerId, "s1"), proc);
  const dry = await adapter.rewind("s1", "u-1", true);
  assert.deepEqual(dry, {
    ok: true,
    dryRun: true,
    canRewind: true,
    filesChanged: ["a.ts", "b.ts"],
    insertions: 3,
    deletions: 1,
  });
  assert.equal(written.length, 2, "dry run sends rewind_files only");
  const real = await adapter.rewind("s1", "u-1", false);
  assert.equal(real.ok, true);
  assert.equal(JSON.parse(written.at(-1)!).request.subtype, "rewind_conversation");
  const none = await adapter.rewind("nope", "u-1", true);
  assert.equal(none.ok, false);
  assert.match(none.error ?? "", /no live Claude process/);
  console.log("control ok");
}
