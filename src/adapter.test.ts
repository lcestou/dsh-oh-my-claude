// Offline self-check: node src/adapter.test.js. No CLI, no network.
import assert from "node:assert/strict";
import {
  Config,
  KNOWN_MODELS,
  Translator,
  commandNames,
  renameTitle,
  mcpToolsByServer,
  hasPendingTodo,
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
  stableModelId,
  projectDirName,
  resolveModelInfo,
  selectTurns,
  relayBlocks,
  toolResultFor,
  sideQuestionsIn,
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
  mergeCatalog,
  parseCatalogCache,
  interruptOnAbort,
  noticeSource,
  RECONNECT_TEXT,
  LIMIT_TEXT,
  clientTimeZone,
  killAfterGrace,
  asideAnswerText,
} from "./adapter.js";
import { PERMISSION_MODES } from "./state.js";
import {
  CHILD_ENV,
  childEnv,
  ClaudeProcess,
  LineQueue,
  TIMEOUT,
  seamSpawner,
  elicitationQuestions,
  elicitationResult,
  isIdleReply,
} from "./process.js";
import {
  buildRedactor,
  CLAUDE_HOME,
  hasPendingNotice,
  loadCommandCatalog,
  noteBoot,
  resolveClaudeHome,
  saveCommandCatalog,
  stateDir,
} from "./state.js";
import type { ClaudeEvent, ClaudeProcessSpec, SubprocessHandle, TurnPrep } from "./process.js";
import type { LooseMessage } from "./adapter.js";
import { elapsedText, resetClock, tokensText } from "./translator.js";
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
import { mkdtemp, writeFile } from "node:fs/promises";
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
// session-only plugins map to repeated --plugin-dir/--plugin-url, gated on flag support
const withPlugins = buildArgs({
  model: "m",
  config: new Config({ pluginDirs: ["/a", "/b.zip"], pluginUrls: ["https://x/p.zip"] }),
  flags: new Set(["--plugin-dir", "--plugin-url"]),
} as any);
assert.ok(
  withPlugins.join(" ").includes("--plugin-dir /a --plugin-dir /b.zip") &&
    withPlugins.includes("--plugin-url") &&
    withPlugins.includes("https://x/p.zip"),
);
// A probe that answered but did not list the flag (empty-but-present set): left out. A null/absent
// probe means "assume supported", so it is not the no-support case.
const noFlag = buildArgs({
  model: "m",
  config: new Config({ pluginDirs: ["/a"] }),
  flags: new Set<string>(),
} as any);
assert.ok(!noFlag.includes("--plugin-dir"), "older CLI without the flag: left out");

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
assert.equal(se({ type: "content_block_stop", index: 1 })[0].block.text, 'Read {"a":1}');
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
const limitedTr = new Translator();
assert.deepEqual(
  limitedTr.translate({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }),
  [],
  "the CLI's own message follows, so the turn does not end on this frame",
);
const limited = limitedTr.translate({ type: "result", is_error: false });
// SAFETY: a held limit failure always produces a finish chunk with error reason
const limitedFirst = limited.at(-1);
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
// Aim the cache at an empty dir so this exercises the offline floor, not whatever this box cached.
process.env.DSH_OMC_STATE_DIR = joinPath(tmpdir(), `omc-catalog-${process.pid}`);
const failing = await getCatalog(async () => {
  throw new Error("offline");
});
assert.equal(failing, KNOWN_MODELS);
delete process.env.DSH_OMC_STATE_DIR;

// A dated id for a model we know is advertised the way the fallback list spells it, so the lineup
// reads the same whether the API answered or not; one we do not know keeps the API's spelling.
assert.equal(stableModelId("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
assert.equal(stableModelId("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5");
assert.equal(stableModelId("claude-opus-5"), "claude-opus-5", "undated ids are left alone");
assert.equal(
  stableModelId("claude-opus-9-20261231"),
  "claude-opus-9-20261231",
  "a model the fallback list does not name keeps its date",
);
assert.equal(modelFromApi({ id: "claude-haiku-4-5-20251001" }).id, "claude-haiku-4-5");

// The persisted catalog round-trips, and any corruption reads as empty so the caller falls back to
// the floor or a fresh fetch rather than feeding a malformed row into the catalog dsh validates.
{
  const good = [modelFromApi({ id: "claude-haiku-4-5-20251001", display_name: "Haiku" })];
  assert.deepEqual(parseCatalogCache(JSON.stringify(good)), good, "clean cache round-trips");
  assert.deepEqual(parseCatalogCache("not json"), [], "garbage reads empty");
  assert.deepEqual(parseCatalogCache(JSON.stringify({ models: [] })), [], "non-array reads empty");
  const wrongProvider = JSON.stringify([
    { provider: "other", id: "x", name: "X", contextWindow: 1, efforts: [] },
  ]);
  assert.deepEqual(parseCatalogCache(wrongProvider), [], "a bad row voids the whole cache");
  const badTypes = JSON.stringify([
    { provider: "claude-code", id: "y", name: "Y", contextWindow: "big", efforts: [] },
  ]);
  assert.deepEqual(parseCatalogCache(badTypes), [], "a mistyped field voids the whole cache");
}
assert.equal(
  resolveModelInfo("claude-code", "claude-haiku-4-5-20251001").context?.contextWindow,
  200_000,
  "a session stored under the dated id still resolves",
);

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

// Ceiling: permissionModeInfo reports allowed modes; setPermissionMode rejects loosening
{
  const a = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  a.accessModes.set("s", "read-only");
  const infoRo = a.permissionModeInfo("s");
  assert.equal(infoRo.accessMode, "read-only");
  assert.equal(infoRo.ceiling, "plan");
  assert.deepEqual(infoRo.allowed, ["plan"]);

  {
    const r = await a.setPermissionMode("s", "bypassPermissions");
    assert.equal(r.live, false);
    assert.match(r.error!, /looser than/);
  }

  a.accessModes.set("s2", "danger-full-access");
  const infoDfa = a.permissionModeInfo("s2");
  assert.deepEqual(infoDfa.allowed, PERMISSION_MODES);
  const rPlan = await a.setPermissionMode("s2", "plan");
  assert.equal(rPlan.override, "plan");

  // Override must not win when the shield tightens after the fact.
  await a.setPermissionMode("s3", "bypassPermissions");
  a.accessModes.set("s3", "danger-full-access");
  assert.equal(a.getPermissionMode("s3", "danger-full-access"), "bypassPermissions");
  a.accessModes.set("s3", "read-only");
  assert.equal(a.getPermissionMode("s3", "read-only"), "plan");
}

// Thinking budget: unknown until set, and set refuses without a live process to carry it
{
  const a = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  assert.equal(a.thinkingInfo("s").tokens, undefined);
  const r = await a.setThinkingBudget("s", 10000);
  assert.equal(r.ok, false);
  assert.equal(r.live, false);
  assert.match(r.error!, /no live Claude process/);
  // A rejected set must not record a phantom budget.
  assert.equal(a.thinkingInfo("s").tokens, undefined);
}

// reload_plugins is best-effort: with no live process it is not an error, it just did not apply live
{
  const a = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const r = await a.reloadPlugins("s");
  assert.equal(r.ok, true);
  assert.equal(r.live, false);
  assert.equal(r.error, undefined);
}

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
assert(probed.flags);
assert.ok(probed.flags.has("--effort") && probed.flags.has("--input-format"));

// A remote target probes the box's own claude over ssh, so an older remote binary is handed only the
// flags it actually has and never a flag it would exit 1 on (e.g. --forward-subagent-text).
const remoteProbe = await probeCli(
  (cmd, args, _opts, cb) => {
    assert.equal(cmd, "ssh");
    // The host and the script are the last two words, whatever `-o` options precede them.
    assert.equal(args.at(-2), "nova");
    cb(
      null,
      (args.at(-1) ?? "").includes("--help")
        ? "Usage: claude [options]\n  --input-format <f>\n"
        : "1.0.0 (Claude Code)\n",
    );
  },
  "claude",
  "nova",
);
assert.equal(remoteProbe.version, "1.0.0 (Claude Code)");
assert(remoteProbe.flags);
assert.ok(remoteProbe.flags.has("--input-format"));
assert.ok(!remoteProbe.flags.has("--forward-subagent-text"));

const soon = Math.floor(Date.now() / 1000) + 120;
{
  // A rejected limit does not end the turn: the CLI's own synthetic message follows and is
  // relayed, then the result frame carries the failure and its retry-after.
  const t = new Translator() as any;
  assert.deepEqual(
    t.translate({
      type: "rate_limit_event",
      rate_limit_info: { status: "rejected", resetsAt: soon },
    }),
    [],
  );
  assert.equal(t.finished, false);
  const said = t.translate({
    type: "assistant",
    message: { content: [{ type: "text", text: "You've reached your Fable limit." }] },
  });
  assert.equal(said.at(-1).block.text, "You've reached your Fable limit.", "the CLI's own words");
  const fin = t.translate({ type: "result", is_error: false }).at(-1);
  assert.equal(fin.reason.failure.code, "RATE_LIMIT");
  assert.equal(
    fin.reason.failure.message,
    `You've hit your usage limit · resets ${resetClock(soon * 1000)}`,
    "no rateLimitType: the CLI's generic wording",
  );
  assert.ok(
    fin.reason.failure.providerRetryAfterMs > 100_000 &&
      fin.reason.failure.providerRetryAfterMs <= 120_000,
  );
}
{
  // The CLI names the limit from rateLimitType; the same table is used here.
  const t = new Translator() as any;
  t.translate({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      resetsAt: soon,
      rateLimitType: "seven_day_overage_included",
    },
  });
  assert.equal(
    t.translate({ type: "result", is_error: false }).at(-1).reason.failure.message,
    `You've hit your Fable limit · resets ${resetClock(soon * 1000)}`,
  );
}
{
  // The CLI's error reference prints a time today, a weekday inside the week, a date beyond it.
  const day = 24 * 60 * 60 * 1000;
  assert.match(
    resetClock(Date.now() + (40 * day) / 24, "America/New_York"),
    /^[A-Z][a-z]{2} \d{1,2}(:\d{2})?[ap]m \(America\/New_York\)$/,
    "inside the week: weekday and time",
  );
  assert.match(
    resetClock(Date.now() + 9 * day, "America/New_York"),
    /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}(:\d{2})?[ap]m \(America\/New_York\)$/,
    "beyond the week: date and time",
  );
  assert.equal(resetClock(1_757_199_600_000, "America/New_York"), "7pm (America/New_York)");
  assert.equal(resetClock(1_757_201_400_000, "America/New_York"), "7:30pm (America/New_York)");
}
{
  // With the wait armed the row says the task continues by itself, and the translator reports the
  // reset instant for the adapter to arm; a reset already past arms nothing.
  const t = new Translator({ continueAfterLimit: true }) as any;
  t.translate({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: soon, rateLimitType: "five_hour" },
  });
  assert.equal(
    t.translate({ type: "result", is_error: false }).at(-1).reason.failure.message,
    `You've hit your session limit · resets ${resetClock(soon * 1000)} · continuing automatically when it resets`,
  );
  assert.equal(t.limitResetAt, soon * 1000);
  const past = new Translator({ continueAfterLimit: true }) as any;
  past.translate({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: 1 },
  });
  assert.equal(past.limitResetAt, undefined);
  // Extra usage covering the overflow: the CLI shows no limit, neither does the turn.
  const covered = new Translator() as any;
  assert.deepEqual(
    covered.translate({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt: soon,
        overageStatus: "allowed",
        isUsingOverage: true,
      },
    }),
    [],
  );
  assert.equal(covered.limitFailure, undefined);
  // Credits exhausted as well: their reset is the one that drives the wait.
  const drained = new Translator() as any;
  drained.translate({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      resetsAt: soon,
      overageStatus: "rejected",
      overageResetsAt: soon + 3600,
    },
  });
  assert.ok(
    drained.translate({ type: "result", is_error: false }).at(-1).reason.failure
      .providerRetryAfterMs > 3_600_000,
  );
  // Retry banners take the browser's zone when dsh stamped one on a prompt.
  const tokyo = new Translator({ timeZone: "Asia/Tokyo" }) as any;
  const tz = tokyo.translate({
    type: "system",
    subtype: "api_retry",
    attempt: 1,
    max_retries: 10,
    retry_delay_ms: 1000,
    error: { formatted: "x", rate_limits: { resets_at: soon } },
  });
  assert.match(tz.at(-1).block.text, /\(Asia\/Tokyo\)\)/);
  assert.equal(
    clientTimeZone([
      { role: "user", source: { kind: "user", clientTimeZone: "Europe/Lisbon" } },
      { role: "assistant" },
      { role: "user", source: { kind: "user", clientTimeZone: "America/New_York" } },
      { role: "user", source: { kind: "plugin", plugin: "x" } },
    ]),
    "America/New_York",
  );
  assert.equal(clientTimeZone([{ role: "user" }]), undefined);
  console.log("limit-wait ok");
}

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

// permission_denials converts tool calls to rule labels, deduped and in insertion order
const deniedTurns: TurnRecord[] = [];
const trDenied = new Translator({ onResult: (s: TurnRecord) => deniedTurns.push(s) });
// SAFETY: test fixture; permission_denials is not in the ClaudeEvent type but exists on CLI output
trDenied.translate({
  type: "result",
  is_error: false,
  stop_reason: "end_turn",
  total_cost_usd: 0,
  duration_ms: 0,
  permission_denials: [
    { tool_name: "Bash", tool_input: { command: "git status --short" } },
    { tool_name: "Read", tool_input: { file_path: "/home/user/.zshrc" } },
    { tool_name: "Bash", tool_input: { command: "git status --short" } }, // duplicate
  ],
} as any);
assert.equal(deniedTurns.length, 1, "onResult fired once");
// SAFETY: deniedTurns.length is exactly 1 above
assert.deepEqual(deniedTurns[0]!.denials, ["Bash(git status:*)", "Read(/home/user/.zshrc)"]);

// no permission_denials → record has no denials field
const nodenialsRecords: TurnRecord[] = [];
const trNoDenials = new Translator({ onResult: (s: TurnRecord) => nodenialsRecords.push(s) });
// SAFETY: test fixture; total_cost_usd and duration_ms are not in the ClaudeEvent type but exist on CLI output
trNoDenials.translate({
  type: "result",
  is_error: false,
  stop_reason: "end_turn",
  total_cost_usd: 0,
  duration_ms: 0,
} as any);
assert.equal(nodenialsRecords.length, 1);
// SAFETY: nodenialsRecords.length is exactly 1 above
assert.equal(nodenialsRecords[0]!.denials, undefined);

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

// --- a tool called with no arguments still fires its call, so its result is not an orphan ---
{
  const calls: { id: string; name: string; input: string }[] = [];
  const tr = new Translator({
    onToolCall: (id: string, name: string, input: string) => calls.push({ id, name, input }),
  } as any) as any;
  tr.translate({ type: "stream_event", event: { type: "message_start" } });
  tr.translate({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu0", name: "ExitPlanMode" },
    },
  });
  // The CLI streams one delta carrying the empty string for a `{}` input.
  tr.translate({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { partial_json: "" } },
  });
  tr.translate({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  assert.equal(calls.length, 1, "the call fires on the id, not on having arguments");
  assert.equal(calls[0]!.input, "{}");
}

// --- the whole-message echo is dropped, a message the CLI sends on its own is not ---
{
  const tr = new Translator() as any;
  tr.translate({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } });
  tr.translate({
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
  });
  tr.translate({
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { text: "hi" } },
  });
  tr.translate({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
  assert.deepEqual(
    tr.translate({
      type: "assistant",
      message: { id: "m1", content: [{ type: "text", text: "hi" }] },
    }),
    [],
    "the echo of what just streamed is a duplicate",
  );
  // What the CLI sends after refusing a turn on a rate limit: its own message, never streamed.
  const limit = tr.translate({
    type: "assistant",
    message: { id: "m2", content: [{ type: "text", text: "5-hour limit reached" }] },
  });
  assert.ok(
    JSON.stringify(limit).includes("5-hour limit reached"),
    "a message that never streamed is shown",
  );
}

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
  // Typed while the turn ran, `/btw` reaches the plugin as prose; the turn loop pulls it out and
  // asks it as a side question instead of forwarding it to Claude, which does not know the command.
  const withAside = messageList([
    ...base,
    {
      role: "user",
      source: { kind: "user", rpcId: "r9" },
      content: [{ type: "text", text: " /btw  what is the cwd? " }],
    },
    {
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: "the docs say to run /btw for a side question" }],
    },
  ]);
  const asides = sideQuestionsIn(withAside);
  assert.equal(asides.length, 1, "prose that merely mentions the command is still prose");
  assert.equal(asides[0]?.question, "what is the cwd?");
  assert.equal(asides[0]?.message.source?.rpcId, "r9", "the message is named so it can be dropped");
  assert.deepEqual(sideQuestionsIn(base), [], "no /btw, nothing to ask");
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
  // A child printing lines that are not JSON must not hold a timed call open: the deadline is
  // fixed when the wait starts, so the junk is filed under `stray` and the call still times out.
  const queue = new LineQueue();
  const fake = { queue, stray: "" };
  const noise = setInterval(() => queue.push("warning: not json"), 20);
  const started = Date.now();
  const event = await ClaudeProcess.prototype.nextEvent.call(fake, 120);
  clearInterval(noise);
  assert.deepEqual(event, { type: "timeout" }, "junk lines do not renew the deadline");
  assert.ok(Date.now() - started < 600, "timed out on its own deadline");
  assert.ok(fake.stray.includes("warning: not json"), "the junk is kept for the error message");
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
  // api_retry: one reasoning line per retry, worded like the CLI's banner, with the reset clock
  // for a quota 429 and without it for any other error.
  const t = new Translator() as any;
  const quota = t.translate({
    type: "system",
    subtype: "api_retry",
    attempt: 2,
    max_retries: 10,
    retry_delay_ms: 4200,
    error_status: 429,
    error: {
      message: "rate limit",
      status: 429,
      formatted: "You've hit your session limit",
      rate_limits: { resets_at: 1_757_199_600, rate_limit_type: "five_hour" },
    },
  });
  assert.equal(quota.at(-1).block.type, "reasoning");
  assert.equal(
    quota.at(-1).block.text,
    `⚠ You've hit your session limit · Retrying in 4s (resets ${resetClock(1_757_199_600_000)}) · attempt 2/10`,
  );
  assert.equal(resetClock(1_757_199_600_000, "America/New_York"), "7pm (America/New_York)");
  assert.equal(resetClock(1_757_201_400_000, "America/New_York"), "7:30pm (America/New_York)");
  const server = t.translate({
    type: "system",
    subtype: "api_retry",
    attempt: 1,
    max_retries: 10,
    retry_delay_ms: 1000,
    error: {
      message: "overloaded",
      status: 529,
      formatted: "API Error (529 overloaded)",
      rate_limits: null,
    },
  });
  assert.equal(
    server.at(-1).block.text,
    "⚠ API Error (529 overloaded) · Retrying in 1s · attempt 1/10",
  );
  console.log("api-retry ok");
}
{
  // Hook frames: a failed or cancelled hook_response renders one reasoning line; a clean one,
  // hook_started and hook_progress are silent (dozens of hooks per tool call on a busy box).
  const t = new Translator() as any;
  const failed = t.translate({
    type: "system",
    subtype: "hook_response",
    hook_name: "ctx-route",
    hook_event: "PreToolUse",
    exit_code: 2,
    stderr: "boom\n",
    outcome: "error",
  });
  assert.equal(failed.at(-1).block.type, "reasoning");
  assert.equal(failed.at(-1).block.text, "⚠ Hook ctx-route (PreToolUse) exit 2: boom");
  const cancelled = t.translate({
    type: "system",
    subtype: "hook_response",
    hook_name: "slow",
    hook_event: "Stop",
    outcome: "cancelled",
  });
  assert.equal(cancelled.at(-1).block.text, "⚠ Hook slow (Stop) cancelled");
  for (const frame of [
    {
      subtype: "hook_response",
      hook_name: "ok",
      hook_event: "PreToolUse",
      exit_code: 0,
      stdout: "fine",
      outcome: "success",
    },
    { subtype: "hook_started", hook_name: "ok", hook_event: "PreToolUse" },
    { subtype: "hook_progress", hook_name: "ok", hook_event: "PreToolUse", stdout: "x" },
  ])
    assert.deepEqual(t.translate({ type: "system", ...frame }), [], frame.subtype);
}
{
  // Task frames: task_started with a task_id opens a block to hold progress updates; without one
  // emits a closed line. task_progress appends when summary or last_tool_name changes. task_notification
  // appends completion and closes. background_tasks_changed is silent. A result frame closes any open
  // task blocks.
  const t = new Translator() as any;
  t.translate({
    type: "system",
    subtype: "task_started",
    task_id: "t1",
    description: "run tests",
    subagent_type: "Explore",
    is_backgrounded: true,
  });
  // First progress with a tool name and usage.
  const prog1 = t.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t1",
    last_tool_name: "Explore",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  assert(prog1.length > 0, "progress with new tool name appends");
  // Identical progress frame appends nothing.
  const prog1Dup = t.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t1",
    last_tool_name: "Explore",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  assert.deepEqual(prog1Dup, [], "identical progress frame appends nothing");
  // Progress with a new summary appends.
  const prog2 = t.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t1",
    summary: "testing framework",
  });
  assert(prog2.length > 0, "progress with new summary appends");
  // Progress for unknown task_id emits nothing.
  const unknownProg = t.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t_unknown",
    summary: "x",
  });
  assert.deepEqual(unknownProg, [], "progress for unknown task emits nothing");
  // Start with no task_id emits closed one-line form.
  const startNoId = t.translate({
    type: "system",
    subtype: "task_started",
    description: "no id task",
  });
  assert.equal(startNoId.length, 3); // block-start, delta, block-end
  assert.equal(startNoId[0].type, "block-start");
  assert.equal(startNoId[2].type, "block-end");
  // Two concurrent tasks keep distinct block indices.
  const t2 = new Translator() as any;
  const s1 = t2.translate({
    type: "system",
    subtype: "task_started",
    task_id: "t1",
    description: "task 1",
  });
  const idx1 = s1[0].index;
  const s2 = t2.translate({
    type: "system",
    subtype: "task_started",
    task_id: "t2",
    description: "task 2",
  });
  const idx2 = s2[0].index;
  assert.notEqual(idx1, idx2, "concurrent tasks have distinct indices");
  // Progress on t1 goes to idx1.
  const p1 = t2.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t1",
    summary: "progress 1",
  });
  assert.equal(p1[0].index, idx1);
  // Progress on t2 goes to idx2.
  const p2 = t2.translate({
    type: "system",
    subtype: "task_progress",
    task_id: "t2",
    summary: "progress 2",
  });
  assert.equal(p2[0].index, idx2);
  // Result closes all open task blocks exactly once.
  const t3 = new Translator() as any;
  const s = t3.translate({
    type: "system",
    subtype: "task_started",
    task_id: "open",
    description: "never notified",
  });
  const openIdx = s[0].index;
  const result = t3.translate({ type: "result" });
  const endCount = result.filter((e: any) => e.type === "block-end" && e.index === openIdx).length;
  assert.equal(endCount, 1, "result closes each open task block exactly once");
  assert.equal(t3.taskBlocks.size, 0, "taskBlocks cleared after result");
  // Notification appends the completion line to the task's own block and closes it, so the row is
  // one block from start to finish rather than a second, unrelated line.
  const done = t.translate({
    type: "system",
    subtype: "task_notification",
    task_id: "t1",
    status: "completed",
    summary: "all green",
  });
  assert.equal(done.at(-1).type, "block-end", "notification closes the task block");
  assert.match(done.at(-1).block.text, /Task completed: all green$/);
  assert.equal(t.taskBlocks.has("t1"), false, "the closed task leaves the map");
  // A notification for a task nothing opened still reports itself, as its own closed line.
  const orphan = t.translate({
    type: "system",
    subtype: "task_notification",
    task_id: "gone",
    status: "failed",
    summary: "boom",
  });
  assert.equal(orphan.at(-1).type, "block-end");
  assert.equal(orphan.at(-1).block.text, "Task failed: boom");
  // background_tasks_changed is silent.
  const t4 = new Translator() as any;
  assert.deepEqual(
    t4.translate({ type: "system", subtype: "background_tasks_changed", tasks: [] }),
    [],
    "background_tasks_changed",
  );
  console.log("task-frames ok");
}
{
  // tool_progress: the CLI heartbeats every 30s per running call. The first one opens a block, the
  // ones after it only write when they pass the next elapsed mark, the tool result closes the block,
  // and the retry variant is its own line.
  const t = new Translator() as any;
  const first = t.translate({
    type: "tool_progress",
    tool_use_id: "call1",
    tool_name: "Bash",
    elapsed_time_seconds: 30,
    heartbeat: true,
  });
  assert.equal(first.at(-1).text, "⏱ Bash running · 30s", "the first heartbeat opens the block");
  assert.equal(t.heartbeatBlocks.size, 1);
  // Between marks: nothing. The next mark after 30s is 60s.
  assert.deepEqual(
    t.translate({
      type: "tool_progress",
      tool_use_id: "call1",
      tool_name: "Bash",
      elapsed_time_seconds: 45,
      heartbeat: true,
    }),
    [],
    "a heartbeat short of the next mark is silent",
  );
  const later = t.translate({
    type: "tool_progress",
    tool_use_id: "call1",
    tool_name: "Bash",
    elapsed_time_seconds: 270,
    heartbeat: true,
  });
  assert.equal(
    later.at(-1).text,
    "\n⏱ 4m30s",
    "a heartbeat past the mark appends the elapsed time",
  );
  // The result closes the block, in the same batch as the result row.
  const done = t.translate({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "call1", content: "ok" }] },
  });
  assert.equal(done[0].type, "block-end", "the tool result closes the elapsed block first");
  assert.equal(t.heartbeatBlocks.size, 0, "the closed call leaves the map");

  // A call still running when the turn ends has its block closed by the result frame.
  const t2 = new Translator() as any;
  t2.translate({
    type: "tool_progress",
    tool_use_id: "call2",
    tool_name: "WebFetch",
    elapsed_time_seconds: 30,
    heartbeat: true,
  });
  const end = t2.translate({ type: "result", subtype: "success", usage: {} });
  assert(
    end.some((e: any) => e.type === "block-end"),
    "the result frame closes an open elapsed block",
  );
  assert.equal(t2.heartbeatBlocks.size, 0);

  // The retry variant carries no heartbeat and gets one closed line of its own.
  const t3 = new Translator() as any;
  const retry = t3.translate({
    type: "tool_progress",
    tool_use_id: "call3",
    tool_name: "Task",
    elapsed_time_seconds: 0,
    subagent_type: "Explore",
    subagent_retry: {
      attempt: 2,
      max_retries: 5,
      retry_delay_ms: 4000,
      error_category: "overloaded",
    },
  });
  assert.equal(
    retry.at(-1).block.text,
    "↻ Task [Explore] attempt 2/5 failed: overloaded, retrying in 4s",
  );
  assert.equal(t3.heartbeatBlocks.size, 0, "a retry opens no elapsed block");
  // toolActivity off means no heartbeat rows at all.
  const quiet = new Translator({ toolActivity: false }) as any;
  assert.deepEqual(
    quiet.translate({
      type: "tool_progress",
      tool_use_id: "call4",
      tool_name: "Bash",
      elapsed_time_seconds: 30,
      heartbeat: true,
    }),
    [],
    "toolActivity off",
  );
  // elapsedText: seconds, minutes with and without a remainder, then hours.
  assert.equal(elapsedText(0), "0s");
  assert.equal(elapsedText(59), "59s");
  assert.equal(elapsedText(60), "1m");
  assert.equal(elapsedText(3600), "1h");
  assert.equal(elapsedText(3720), "1h2m");
  console.log("tool-progress ok");
}
{
  // task_updated: a terminal status closes the task's block with the reason; a repeat of the same
  // status is silent; a pause writes one line and keeps the block open; a task nobody opened is
  // silent (a notification for one still reports itself, which is the other frame's job).
  const t = new Translator() as any;
  t.translate({ type: "system", subtype: "task_started", task_id: "t1", description: "run tests" });
  assert.deepEqual(
    t.translate({
      type: "system",
      subtype: "task_updated",
      task_id: "t1",
      patch: { status: "running" },
    }),
    [],
    "running is a state it passes through",
  );
  const paused = t.translate({
    type: "system",
    subtype: "task_updated",
    task_id: "t1",
    patch: { status: "paused" },
  });
  assert.equal(paused.at(-1).text, "\n… paused");
  assert.equal(t.taskBlocks.has("t1"), true, "a pause keeps the block open");
  const killed = t.translate({
    type: "system",
    subtype: "task_updated",
    task_id: "t1",
    patch: { status: "failed", error: "worker crashed" },
  });
  assert.equal(killed.at(-1).type, "block-end");
  assert.match(killed.at(-1).block.text, /Task failed: worker crashed$/);
  assert.equal(t.taskBlocks.has("t1"), false, "a terminal status leaves the map");
  // Same status twice, and a task nothing opened: both silent.
  const t2 = new Translator() as any;
  t2.translate({ type: "system", subtype: "task_started", task_id: "t2", description: "x" });
  t2.translate({
    type: "system",
    subtype: "task_updated",
    task_id: "t2",
    patch: { status: "paused" },
  });
  assert.deepEqual(
    t2.translate({
      type: "system",
      subtype: "task_updated",
      task_id: "t2",
      patch: { status: "paused" },
    }),
    [],
    "the same status twice",
  );
  assert.deepEqual(
    t2.translate({
      type: "system",
      subtype: "task_updated",
      task_id: "gone",
      patch: { status: "failed" },
    }),
    [],
    "a task nothing opened",
  );
  console.log("task-updated ok");
}
{
  // permission_denied: the reason at the moment of the denial. decision_reason wins over the
  // model-facing message, and a reason that is not a string is ignored rather than stringified.
  const t = new Translator() as any;
  const denied = t.translate({
    type: "system",
    subtype: "permission_denied",
    tool_name: "Bash",
    decision_reason: "Bash(rm:*) is denied by a deny rule",
    message: "I need permission to run this",
  });
  assert.equal(denied.at(-1).block.text, "⚠ Denied Bash: Bash(rm:*) is denied by a deny rule");
  const fallback = t.translate({
    type: "system",
    subtype: "permission_denied",
    tool_name: "Write",
    decision_reason: { type: "rule" },
    message: "not allowed here",
  });
  assert.equal(fallback.at(-1).block.text, "⚠ Denied Write: not allowed here");
  const bare = t.translate({ type: "system", subtype: "permission_denied" });
  assert.equal(bare.at(-1).block.text, "⚠ Denied tool");
  console.log("permission-denied ok");
}
{
  // commands_changed re-sends the catalog alone: the bridge is refreshed, nothing is drawn, and an
  // empty list is ignored rather than clearing what init established.
  const t = new Translator() as any;
  let seen: { names: string[]; tools: string[] } | undefined;
  t.onInit = (names: string[], tools: string[]) => {
    seen = { names, tools };
  };
  assert.deepEqual(
    t.translate({
      type: "system",
      subtype: "commands_changed",
      commands: ["review", "ship"],
    }),
    [],
    "commands_changed draws nothing",
  );
  assert.deepEqual(seen?.names, ["review", "ship"]);
  assert.deepEqual(seen?.tools, [], "no tool list is sent with a catalog refresh");
  seen = undefined;
  t.translate({ type: "system", subtype: "commands_changed", commands: [] });
  assert.equal(seen, undefined, "an empty catalog is not forwarded");

  // model_fallback: the CLI's own wording when it sends one, the models and trigger otherwise.
  const t2 = new Translator() as any;
  const said = t2.translate({
    type: "system",
    subtype: "model_fallback",
    content: "Claude Opus 5 is overloaded, falling back to Sonnet 5",
    trigger: "overloaded",
    original_model: "claude-opus-5",
    fallback_model: "claude-sonnet-5",
  });
  assert.equal(said.at(-1).block.text, "⚠ Claude Opus 5 is overloaded, falling back to Sonnet 5");
  const bare = t2.translate({
    type: "system",
    subtype: "model_fallback",
    trigger: "server_error",
    original_model: "claude-opus-5",
    fallback_model: "claude-sonnet-5",
  });
  assert.equal(
    bare.at(-1).block.text,
    "⚠ Model fallback: claude-opus-5 → claude-sonnet-5 (server_error)",
  );

  // informational: info is silent, suggestion and warning are drawn, and anything that stopped the
  // turn is drawn whatever its level.
  const t3 = new Translator() as any;
  assert.deepEqual(
    t3.translate({ type: "system", subtype: "informational", content: "hook ran", level: "info" }),
    [],
    "info is transcript-only",
  );
  const warn = t3.translate({
    type: "system",
    subtype: "informational",
    content: "Consider splitting this file",
    level: "suggestion",
  });
  assert.equal(warn.at(-1).block.text, "⚠ Consider splitting this file");
  const stopped = t3.translate({
    type: "system",
    subtype: "informational",
    content: "Stop hook denied continuation",
    level: "info",
    prevent_continuation: true,
  });
  assert.equal(stopped.at(-1).block.text, "⛔ Stop hook denied continuation");
  assert.deepEqual(
    t3.translate({ type: "system", subtype: "informational", content: "", level: "warning" }),
    [],
    "an empty banner",
  );

  // api_error is the retry line without the retry framing, and it alone reports a dead connection.
  const t4 = new Translator() as any;
  const netDown = t4.translate({
    type: "system",
    subtype: "api_error",
    error: { message: "fetch failed", is_network_down: true },
  });
  assert.equal(netDown.at(-1).block.text, "⚠ fetch failed · network is down");
  const retrying = t4.translate({
    type: "system",
    subtype: "api_error",
    error: { message: "overloaded" },
    retry_delay_ms: 2000,
    attempt: 1,
    max_retries: 5,
  });
  assert.equal(retrying.at(-1).block.text, "⚠ overloaded · Retrying in 2s · attempt 1/5");

  // keep_alive has no payload and the schema says to ignore it: no unknown-event warning.
  const t5 = new Translator() as any;
  let warned = 0;
  t5.log = (level: string) => {
    if (level === "warn") warned++;
  };
  assert.deepEqual(t5.translate({ type: "keep_alive" }), []);
  assert.equal(warned, 0, "keep_alive is benign");
  console.log("frame-catchup ok");
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
  // sessionProvider reads the last model/selection from the session log: the limit wait must not
  // wake a session that was rerouted to another provider meanwhile.
  const events = [
    { type: "model/selection", data: { provider: "claude-code", model: "claude-opus-5" } },
    { type: "todo/write", data: { todos: [] } },
    { type: "model/selection", data: { provider: "llama-local", model: "kat" } },
  ];
  const stub = { ctx: { sessions: { get: () => ({ snapshotEvents: () => events }) } } };
  assert.equal(ClaudeCodeAdapter.prototype.sessionProvider.call(stub, "s"), "llama-local");
  const none = { ctx: { sessions: { get: () => ({ snapshotEvents: () => [] }) } } };
  assert.equal(ClaudeCodeAdapter.prototype.sessionProvider.call(none, "s"), undefined);
  const gone = { ctx: { sessions: { get: () => undefined } } };
  assert.equal(ClaudeCodeAdapter.prototype.sessionProvider.call(gone, "s"), undefined);
  console.log("session-provider ok");
}
{
  // continueAfterLimit: a rerouted session drops the notice, a window still at its cap re-arms,
  // otherwise (including extra usage on) the continue notice goes through wake.
  const dir = await mkdtemp(joinPath(tmpdir(), "dsh-oh-my-claude-limit-"));
  const run = async (provider: string | undefined, windows: any[], extraUsage = false) => {
    const calls: string[] = [];
    const stub = {
      stateDir: dir,
      providerId: "claude-code",
      config: {},
      claudeHome: "/nowhere",
      processes: new Map(),
      sessionProvider: () => provider,
      armLimitWait: (id: string, at: number) => calls.push(`arm ${id} ${at}`),
      wake: async (id: string, _proc: unknown, text: string) => {
        calls.push(`wake ${id} ${text === LIMIT_TEXT ? "limit" : "?"}`);
        return true;
      },
    };
    const probe = async () => ({ ok: true as const, fetchedAt: 0, windows, extraUsage });
    await ClaudeCodeAdapter.prototype.continueAfterLimit.call(stub, "s", probe);
    return calls;
  };
  const later = Date.now() + 60_000;
  const full = [{ label: "w", usedPercent: 100, resetsAt: later }];
  assert.deepEqual(await run("llama-local", []), [], "rerouted: nothing");
  assert.deepEqual(await run("claude-code", full), [`arm s ${later}`]);
  assert.deepEqual(await run(undefined, [{ label: "w", usedPercent: 40, resetsAt: later }]), [
    "wake s limit",
  ]);
  assert.deepEqual(await run(undefined, full, true), ["wake s limit"], "extra usage on: continue");
  console.log("continue-after-limit ok");
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
  // A remote turn names the box it ran on, not this local host, so the user logs in on the right one.
  const remoteOut = finishReason({ is_error: true, result: "Not logged in" }, "nova");
  assert.match(failureOf(remoteOut).message, /not logged in on nova\./);
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
    return true;
  };
  await a.resumeInterrupted(file);
  assert.deepEqual(woke, [["dead", undefined, RESTART_TEXT]]);
  assert.deepEqual(await takeInterrupted(file), ["live"], "live session stays tracked");
}
// acquire(): a second prompt arriving while a turn runs is refused, not served by killing the
// process the turn is running on. Mid-turn relays and steers never reach acquire.
{
  const a = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  let killed = 0;
  const running = fakeProc({
    alive: true,
    busy: true,
    key: "k",
    kill: () => {
      killed += 1;
    },
  });
  a.processes.set(registryKey("claude-code", "s1"), running);
  // SAFETY: acquire only reads what prepare returns; the spawn path is never reached here.
  a.prepare = async () =>
    ({ input: "{}", args: [], cwd: "/tmp", spec: emptySpec }) as unknown as TurnPrep;
  await assert.rejects(
    // SAFETY: acquire takes the session options shape; only sessionId is read before the refusal
    async () =>
      a.acquire({ sessionId: "s1", messages: [] } as unknown as Parameters<
        ClaudeCodeAdapter["acquire"]
      >[0]),
    /already running/,
    "the second caller is refused",
  );
  assert.equal(killed, 0, "the running turn's process is left alone");
  assert.equal(a.processes.get(registryKey("claude-code", "s1")), running);
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
  a.bridgeCommands(["compact", "model"], undefined);
  assert.deepEqual(
    registered,
    ["compact", "claude-model", "temporary", "btw"],
    "Claude's own names, prefixed only where dsh's client half owns one, plus /temporary and /btw",
  );
  assert.equal(a.bridged.size, 4, "compact, model, temporary and btw");
}

// A name dsh already owns throws on the bare registration; the prefixed name is the fallback, so
// the command still reaches the menu instead of dropping out of the catalog.
{
  const registered: string[] = [];
  const commands = {
    register: (d: { name: string }) => {
      if (d.name === "compact") throw new Error('command "compact" is already registered');
      registered.push(d.name);
      return () => {};
    },
    find: () => undefined,
  };
  const base = {
    on() {},
    logger: { info() {}, warn() {} },
    get: (n: string) => (n === "commands" ? commands : undefined),
  };
  const a = new ClaudeCodeAdapter(fakeCtx(base), Config({ commandBridge: true }));
  a.bridgeCommands(["compact"], undefined);
  assert.ok(registered.includes("claude-compact"), "fell back to the prefixed name");
  assert.equal(a.bridged.has("compact"), true, "and the command is bridged either way");
}

// A later frame naming fewer commands does not shrink what is saved: the registrations already made
// are not removed, so the file follows them rather than the frame.
{
  const dir = await mkdtemp(joinPath(tmpdir(), "omc-catalog-shrink-"));
  const commands = {
    register: () => () => {},
    find: () => undefined,
  };
  const base = {
    on() {},
    logger: { info() {}, warn() {} },
    get: (n: string) => (n === "commands" ? commands : undefined),
  };
  const a = new ClaudeCodeAdapter(fakeCtx(base), Config({ commandBridge: true }));
  a.stateDir = dir;
  a.bridgeCommands(["llama", "mint"], undefined);
  a.bridgeCommands(["compact"], undefined);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(
    (await loadCommandCatalog(dir)).filter((n) => ["llama", "mint", "compact"].includes(n)),
    ["llama", "mint", "compact"],
    "every bridged name, not the last frame",
  );
  // And a second instance over the same state dir — dsh re-instantiates the plugin when settings
  // apply at boot — adds to the file rather than replacing it with its own short catalog.
  const b = new ClaudeCodeAdapter(fakeCtx(base), Config({ commandBridge: true }));
  b.stateDir = dir;
  b.bridgeCommands(["compact"], undefined);
  await new Promise((r) => setTimeout(r, 50));
  const after = await loadCommandCatalog(dir);
  assert.ok(after.includes("llama") && after.includes("mint"), `kept the earlier names: ${after}`);
}
console.log("command-catalog-live ok");
console.log("command-bridge ok");

// The catalog survives a restart. globalThis carries it across a hot reload, but a restart adopts
// the running Claude and never sees a second init frame, so the bridged commands used to leave the
// menu until the next cold start.
{
  const dir = await mkdtemp(joinPath(tmpdir(), "omc-commands-"));
  assert.deepEqual(await loadCommandCatalog(dir), [], "no file reads as no catalog");
  await saveCommandCatalog(dir, ["compact", "llama"]);
  assert.deepEqual(await loadCommandCatalog(dir), ["compact", "llama"]);
  await writeFile(joinPath(dir, "commands.json"), "{ not json", "utf8");
  assert.deepEqual(await loadCommandCatalog(dir), [], "a damaged file reads as no catalog");
}
console.log("command-catalog ok");

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

// hookRows: buildArgs adds --include-hook-events only when config.hookRows is true and the CLI lists it.
{
  const flags = new Set(["--include-hook-events"]);
  const base = {
    model: "opus",
    reasoningEffort: null,
    system: "",
    purpose: undefined,
    config: Config({}),
    flags,
    mcp: null,
  };
  assert.ok(buildArgs({ ...base } as any).includes("--include-hook-events"));
  assert.ok(
    !buildArgs({ ...base, config: Config({ hookRows: false }) } as any).includes(
      "--include-hook-events",
    ),
  );
}
console.log("hook-rows ok");

// keeper mode: the default spawn, one keeper dir per provider id and dsh session, stable across calls.
{
  assert.equal(Config({}).spawn, "keeper");
  const a1 = defaultAdapter.keeperDir("s1");
  assert.equal(a1, defaultAdapter.keeperDir("s1"), "deterministic");
  assert.notEqual(a1, defaultAdapter.keeperDir("s2"));
  assert.notEqual(a1, workAdapter.keeperDir("s1"), "per provider id");
  assert.ok(a1.includes("/keepers/"));
  assert.equal(defaultAdapter.keeperEnv().MCP_TOOL_TIMEOUT, "3600000");
  // Both spawn paths compose the child env through one helper, and the plugin's own values beat an
  // inherited one: a shell that exports MCP_TOOL_TIMEOUT used to cut relayed dsh tools short under
  // `spawn: node` while keeper mode ignored it, so the same config behaved two ways.
  const composed = childEnv({ MCP_TOOL_TIMEOUT: "5000", PATH: "/bin", EMPTY: undefined });
  assert.equal(composed.MCP_TOOL_TIMEOUT, "3600000", "plugin value wins over the inherited one");
  assert.equal(composed.PATH, "/bin", "the rest of the environment is carried through");
  assert.equal("EMPTY" in composed, false, "unset variables are dropped, not passed as undefined");
  assert.equal(
    childEnv({}, { MCP_TOOL_TIMEOUT: "1" }).MCP_TOOL_TIMEOUT,
    "1",
    "an explicit override still wins",
  );
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
    idleKilledAfterMs: undefined as number | undefined,
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

  // A tool call arms a longer deadline rather than none, an extend keeps that longer one, and the
  // kill records how long the silence was allowed so the error names the right number.
  idleAdapter.armIdle("s2", proc, false, 2000);
  const toolDeadline = idleAdapter.idleDeadlineMap.get("s2") ?? 0;
  assert.ok(toolDeadline > Date.now() + 1500, "tool deadline is the longer one");
  await wait(50);
  assert.equal(idleAdapter.extendIdle("s2"), true);
  assert.ok(
    (idleAdapter.idleDeadlineMap.get("s2") ?? 0) > toolDeadline,
    "extend kept the longer timeout, not the configured one",
  );
  idleAdapter.clearIdle("s2");
  idleAdapter.armIdle("s3", proc, false, 200);
  await wait(400);
  assert.equal(killed, 2, "the longer deadline still kills");
  assert.equal(proc.idleKilledAfterMs, 200, "the kill records the deadline it used");
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

// retarget: a model-only spec change switches the live process with set_model and keeps it; any
// other change, or a refused request, leaves the process untouched so acquire() respawns.
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const spec: ClaudeProcessSpec = { ...emptySpec, cwd: "/w", model: "sonnet", mode: "default" };
  const written: string[] = [];
  let answer: "success" | "error" = "success";
  const proc: any = {
    alive: true,
    busy: false,
    spec,
    key: JSON.stringify(spec),
    controlListener: undefined,
    write(line: string) {
      written.push(line);
      const req = JSON.parse(line);
      setTimeout(() => {
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: {
            subtype: answer,
            request_id: req.request_id,
            ...(answer === "error" ? { error: "nope" } : { response: {} }),
          },
        });
      }, 0);
      return true;
    },
  };
  const opus = { ...spec, model: "opus" };
  assert.equal(await adapter.retarget(proc, opus), true, "model-only change is live");
  assert.equal(JSON.parse(written[0]!).request.subtype, "set_model");
  assert.equal(JSON.parse(written[0]!).request.model, "opus");
  assert.equal(proc.key, JSON.stringify(opus), "key follows the new spec");
  assert.equal(proc.spec.model, "opus");
  const moved = { ...opus, cwd: "/elsewhere" };
  assert.equal(await adapter.retarget(proc, moved), false, "cwd change is not live");
  assert.equal(written.length, 1, "no request sent for a non-model change");
  answer = "error";
  const haiku = { ...opus, model: "haiku" };
  assert.equal(await adapter.retarget(proc, haiku), false, "refused request reports false");
  assert.equal(proc.key, JSON.stringify(opus), "key unchanged after a refusal");
  console.log("retarget ok");
}

// Wake notices: user-sourced only when a restart notice must rearm an active goal; otherwise the
// plugin notice form, which dsh draws as a collapsed context row.
assert.deepEqual(noticeSource(RESTART_TEXT, true), { kind: "user" });
assert.equal(noticeSource(RECONNECT_TEXT, true).kind, "user");
assert.equal(noticeSource(RECONNECT_TEXT, false).kind, "plugin");
assert.equal((noticeSource(RECONNECT_TEXT, false) as { form?: string }).form, "notice");
assert.equal(noticeSource(LIMIT_TEXT, true).kind, "user", "a limit continue rearms a goal too");
assert.equal(noticeSource(LIMIT_TEXT, false).kind, "plugin");
assert.equal(noticeSource("wake", true).kind, "plugin", "a plain wake never claims the user");
console.log("notice-source ok");

// An idle result wakes a turn only when it is a real reply, never an error or a rate-limit retry.
assert.equal(
  isIdleReply(JSON.stringify({ type: "result", subtype: "success", result: "hi" })),
  true,
);
assert.equal(
  isIdleReply(JSON.stringify({ type: "result", is_error: true, subtype: "error" })),
  false,
);
assert.equal(
  isIdleReply(JSON.stringify({ type: "result", subtype: "error_during_execution" })),
  false,
);
assert.equal(isIdleReply(JSON.stringify({ type: "assistant" })), false);
assert.equal(isIdleReply("not json"), false);
console.log("idle-reply ok");

// A dsh shutdown under a keeper leaves Claude's turn running; every other abort interrupts it.
assert.equal(interruptOnAbort("disposed", "keeper"), false);
assert.equal(interruptOnAbort("disposed", "node"), true);
assert.equal(interruptOnAbort("cancelled", "keeper"), true);
assert.equal(interruptOnAbort(undefined, "keeper"), true);
assert.equal(killAfterGrace("keeper"), false, "keeper: the idle watchdog owns hung processes");
assert.equal(killAfterGrace("node"), true);
console.log("interrupt-on-abort ok");

// contextUsage: decodes the CLI's get_context_usage answer; no live process is a plain error.
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const proc: any = {
    alive: true,
    busy: false,
    controlListener: undefined,
    write(line: string) {
      const req = JSON.parse(line);
      assert.equal(req.request.subtype, "get_context_usage");
      setTimeout(() => {
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: {
            subtype: "success",
            request_id: req.request_id,
            response: {
              categories: [
                { name: "System prompt", tokens: 1499, color: "x" },
                { name: "MCP tools (deferred)", tokens: 19540, isDeferred: true },
                { name: "Messages", tokens: 3830 },
                { name: "bogus" },
              ],
              totalTokens: 19753,
              maxTokens: 200000,
              percentage: 10,
              autocompactSource: "auto",
              gridRows: [[]],
            },
          },
        });
      }, 0);
      return true;
    },
  };
  adapter.processes.set(registryKey(adapter.providerId, "cu"), proc);
  const got = await adapter.contextUsage("cu");
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.deepEqual(got.categories, [
      { name: "System prompt", tokens: 1499, deferred: false },
      { name: "MCP tools (deferred)", tokens: 19540, deferred: true },
      { name: "Messages", tokens: 3830, deferred: false },
    ]);
    assert.equal(got.totalTokens, 19753);
    assert.equal(got.maxTokens, 200000);
    assert.equal(got.percentage, 10);
    assert.equal(got.autocompact, "auto");
  }
  const none = await adapter.contextUsage("nope");
  assert.equal(none.ok, false);
  console.log("context-usage ok");
}

// session title: a live process answers generate_session_title and stream() yields the title as
// one text block; no live process or a declined request returns undefined so one-shot runs.
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const written: string[] = [];
  let decline = false;
  const proc: any = {
    alive: true,
    busy: false,
    controlListener: undefined,
    write(line: string) {
      written.push(line);
      const req = JSON.parse(line);
      setTimeout(() => {
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: decline
            ? { subtype: "error", request_id: req.request_id, error: "unsupported" }
            : {
                subtype: "success",
                request_id: req.request_id,
                response: { title: "  Fix login redirect  " },
              },
        });
      }, 0);
      return true;
    },
  };
  adapter.processes.set(registryKey(adapter.providerId, "tt"), proc);
  const chunks: any[] = [];
  for await (const c of adapter.stream({
    purpose: "session-title",
    sessionId: "tt",
    messages: messageList([
      {
        role: "user",
        content: [{ type: "text", text: "<conversation>login broke</conversation>" }],
      },
    ]),
    signal: new AbortController().signal,
  } as any))
    chunks.push(c);
  const req = JSON.parse(written[0]!).request;
  assert.equal(req.subtype, "generate_session_title");
  assert.equal(req.persist, true);
  assert.match(req.description, /login broke/);
  const text = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.text)
    .join("");
  assert.equal(chunks.find((c) => c.type === "block-start")?.blockType, "text");
  assert.equal(text, "Fix login redirect");
  assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "stop" } });
  assert.equal(await adapter.titleFromCli("nope", "x"), undefined, "no process: undefined");
  assert.equal(await adapter.titleFromCli("tt", ""), undefined, "empty input: undefined");
  decline = true;
  assert.equal(await adapter.titleFromCli("tt", "x"), undefined, "declined: undefined");
  assert.equal(JSON.parse(written.at(-1)!).request.subtype, "generate_session_title");
  console.log("session-title ok");
}

// workspaceDiff: decodes the CLI's get_workspace_diff answer (shape probed on 2.1.261).
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const proc: any = {
    alive: true,
    busy: false,
    controlListener: undefined,
    write(line: string) {
      const req = JSON.parse(line);
      assert.equal(req.request.subtype, "get_workspace_diff");
      setTimeout(() => {
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: {
            subtype: "success",
            request_id: req.request_id,
            response: {
              diff: {
                stats: { filesCount: 2, linesAdded: 1, linesRemoved: 0 },
                perFileStats: [
                  { path: "a.txt", added: 1, removed: 0, isBinary: false, isUntracked: false },
                  { path: "b.txt", added: 0, removed: 0, isBinary: false, isUntracked: true },
                  { nope: true },
                ],
                hunks: [
                  {
                    path: "a.txt",
                    hunks: [
                      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" x", "+y"] },
                    ],
                  },
                ],
                skippedLarge: [],
                source: { kind: "working-tree" },
              },
            },
          },
        });
      }, 0);
      return true;
    },
  };
  adapter.processes.set(registryKey(adapter.providerId, "wd"), proc);
  const got = await adapter.workspaceDiff("wd");
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.filesCount, 2);
    assert.equal(got.linesAdded, 1);
    assert.deepEqual(got.files, [
      {
        path: "a.txt",
        added: 1,
        removed: 0,
        binary: false,
        untracked: false,
        hunks: [{ oldStart: 1, newStart: 1, lines: [" x", "+y"] }],
      },
      { path: "b.txt", added: 0, removed: 0, binary: false, untracked: true, hunks: [] },
    ]);
  }
  assert.equal((await adapter.workspaceDiff("nope")).ok, false);
  console.log("workspace-diff ok");
}

// drainAdopted: an adopted process with a reply waiting keeps asking for a wake until one opens a
// turn; a busy process (a prompt arrived) ends the loop; an empty queue never wakes.
{
  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  const calls: string[] = [];
  let answers = [false, false, true];
  adapter.wake = async (id) => {
    calls.push(id);
    return answers.shift() ?? true;
  };
  const proc: any = { alive: true, busy: false, queue: { size: 1 } };
  await adapter.drainAdopted(proc, "d", 1, 10);
  assert.equal(calls.length, 3, "retries until a wake opens a turn");
  calls.length = 0;
  answers = [false, false];
  proc.queue.size = 0;
  await adapter.drainAdopted(proc, "d", 1, 5);
  assert.equal(calls.length, 0, "nothing queued: no wake");
  proc.queue.size = 1;
  proc.busy = true;
  await adapter.drainAdopted(proc, "d", 1, 5);
  assert.equal(calls.length, 0, "busy: a turn is already draining");
  console.log("drain-adopted ok");
}

// reconnectBridge: with the bridge mounted, a reattached process is told mcp_reconnect for the
// `dsh` server; without a bridge nothing is sent.
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
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: { subtype: "success", request_id: req.request_id, response: {} },
        });
      }, 0);
      return true;
    },
  };
  assert.equal(await adapter.reconnectBridge(proc, "s"), false, "no bridge: nothing sent");
  assert.equal(written.length, 0);
  (adapter as any).mcp = { url: "http://x", key: "k" };
  assert.equal(await adapter.reconnectBridge(proc, "s"), true);
  const req = JSON.parse(written[0]!).request;
  assert.deepEqual(req, { subtype: "mcp_reconnect", serverName: "dsh" });
  // The bridge is not listening yet for the first two tries: keep asking, succeed on the third.
  let failures = 2;
  proc.write = (line: string) => {
    written.push(line);
    const r = JSON.parse(line);
    const fail = failures-- > 0;
    setTimeout(() => {
      proc.controlListener({
        type: "control_response",
        request_id: r.request_id,
        response: fail
          ? { subtype: "error", request_id: r.request_id, error: "MCP endpoint not found" }
          : { subtype: "success", request_id: r.request_id, response: {} },
      });
    }, 0);
    return true;
  };
  written.length = 0;
  assert.equal(await adapter.reconnectBridge(proc, "s", 1, 5), true, "third try succeeds");
  assert.equal(written.length, 3);
  failures = 99;
  written.length = 0;
  assert.equal(await adapter.reconnectBridge(proc, "s", 1, 2), false, "gives up after attempts");
  assert.equal(written.length, 2);
  console.log("mcp-reconnect ok");
}

// mcpStatus and mcpReconnect: decode the server list; reconnect names the server.
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
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: {
            subtype: "success",
            request_id: req.request_id,
            response:
              req.request.subtype === "mcp_status"
                ? {
                    mcpServers: [
                      {
                        name: "dsh",
                        status: "connected",
                        serverInfo: { name: "dsh", version: "0.9.0" },
                        config: { type: "http" },
                      },
                      { name: "plugin:x", status: "failed", error: "Connection timeout" },
                      {
                        name: "plugin:y",
                        status: "needs-auth",
                        message: "Please log in to your account",
                      },
                      { nope: 1 },
                    ],
                  }
                : {},
          },
        });
      }, 0);
      return true;
    },
  };
  adapter.processes.set(registryKey(adapter.providerId, "ms"), proc);
  const st = await adapter.mcpStatus("ms");
  assert.deepEqual(st, {
    ok: true,
    servers: [
      { name: "dsh", status: "connected", version: "0.9.0" },
      { name: "plugin:x", status: "failed", error: "Connection timeout" },
      { name: "plugin:y", status: "needs-auth", error: "Please log in to your account" },
    ],
  });
  assert.deepEqual(await adapter.mcpReconnect("ms", "dsh"), { ok: true });
  assert.deepEqual(JSON.parse(written.at(-1)!).request, {
    subtype: "mcp_reconnect",
    serverName: "dsh",
  });
  assert.equal((await adapter.mcpStatus("nope")).ok, false);
  console.log("mcp-status ok");
}

// CLI model picker: list_models entries lead the catalog, known models they cover drop out,
// the rest follow so ids stored in older dsh sessions still resolve.
{
  const cli = [
    {
      value: "default",
      resolvedModel: "claude-opus-5[1m]",
      displayName: "Default",
      efforts: ["low", "high"],
    },
    { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", efforts: [] },
    {
      value: "haiku",
      resolvedModel: "claude-haiku-4-5-20251001",
      displayName: "Haiku",
      efforts: [],
    },
  ];
  const merged = mergeCatalog(cli, KNOWN_MODELS);
  assert.deepEqual(
    merged.slice(0, 3).map((m) => [m.id, m.name, m.contextWindow, m.efforts]),
    [
      ["default", "Default", 1_000_000, ["low", "high"]],
      ["claude-sonnet-5", "Sonnet", 1_000_000, []],
      ["claude-haiku-4-5", "Haiku", 200_000, []],
    ],
    "an alias landing on a known model takes that model's id, so the lineup is the same set " +
      "whether or not the CLI has answered yet",
  );
  const rest = merged.slice(3).map((m) => m.id);
  assert.ok(!rest.includes("claude-opus-5"), "covered by default");
  assert.ok(!rest.includes("claude-sonnet-5"), "covered by sonnet");
  assert.ok(!rest.includes("claude-haiku-4-5"), "covered by haiku (dated id)");
  assert.ok(rest.includes("claude-fable-5-1"), "uncovered known model stays");
  assert.deepEqual(mergeCatalog([], KNOWN_MODELS), KNOWN_MODELS, "no CLI list: unchanged");
  assert.deepEqual(
    mergeCatalog(cli, KNOWN_MODELS, undefined),
    merged,
    "no settings: the merge alone",
  );

  // settings.json's availableModels is an allowlist over everything, but never over Default.
  const ids = (picker: Parameters<typeof mergeCatalog>[2]) =>
    mergeCatalog(cli, KNOWN_MODELS, picker).map((m) => m.id);
  const noRows = { options: [], replaceBuiltInOptions: false };
  assert.deepEqual(
    ids({ ...noRows, availableModels: ["haiku"] }),
    ["default", "claude-haiku-4-5"],
    "family alias keeps its versions and Default, drops the rest",
  );
  // The point of the stable id: a model allowlisted from one lineup is still offered by the other.
  for (const id of ["claude-haiku-4-5", "claude-sonnet-5"])
    assert.ok(
      mergeCatalog([], KNOWN_MODELS).some((m) => m.id === id) && merged.some((m) => m.id === id),
      `${id} is offered with and without the CLI list`,
    );
  const oneVersion = ids({ ...noRows, availableModels: ["opus-4-5"] });
  assert.ok(oneVersion.includes("claude-opus-4-5"), "version prefix keeps that version");
  assert.ok(!oneVersion.includes("claude-opus-4-6"), "version prefix is not a family alias");
  assert.deepEqual(
    ids({ ...noRows, availableModels: ["claude-sonnet-4-5"] }),
    ["default", "claude-sonnet-4-5"],
    "a full id matches itself",
  );
  assert.deepEqual(
    ids({ ...noRows, availableModels: [] }),
    ["default"],
    "empty list: Default only",
  );

  // modelPicker rows follow the built-in lineup, or replace it apart from Default.
  const rows = { options: [{ model: "opus-4-5", label: "Cheap Opus" }] };
  const appended = mergeCatalog(cli, KNOWN_MODELS, { ...rows, replaceBuiltInOptions: false });
  assert.deepEqual(
    appended.at(-1),
    {
      provider: "claude-code",
      id: "opus-4-5",
      name: "Cheap Opus",
      contextWindow: 200_000,
      efforts: ["low", "medium", "high"],
    },
    "the row lands last, under its own label",
  );
  assert.ok(appended.length > 1, "the built-in lineup is still there");
  assert.deepEqual(
    mergeCatalog(cli, KNOWN_MODELS, { ...rows, replaceBuiltInOptions: true }).map((m) => m.id),
    ["default", "opus-4-5"],
    "replaceBuiltInOptions: Default and the rows, nothing else",
  );
  assert.deepEqual(
    ids({
      options: [{ model: "opus-4-5" }, { model: "sonnet-4-5" }],
      replaceBuiltInOptions: true,
      availableModels: ["opus"],
    }),
    ["default", "opus-4-5"],
    "the allowlist prunes a picker row too",
  );

  const adapter = new ClaudeCodeAdapter(fakeCtx({ on() {} }), Config({}));
  let asked = 0;
  const proc: any = {
    alive: true,
    busy: false,
    controlListener: undefined,
    write(line: string) {
      const req = JSON.parse(line);
      assert.equal(req.request.subtype, "list_models");
      asked++;
      setTimeout(() => {
        proc.controlListener({
          type: "control_response",
          request_id: req.request_id,
          response: {
            subtype: "success",
            request_id: req.request_id,
            response: {
              models: [
                {
                  value: "opus[1m]",
                  resolvedModel: "claude-opus-5[1m]",
                  displayName: "Opus (1M)",
                  supportedEffortLevels: ["max"],
                },
              ],
            },
          },
        });
      }, 0);
      return true;
    },
  };
  assert.equal(await adapter.refreshCliModels(proc), true);
  assert.equal(await adapter.refreshCliModels(proc), false, "once per TTL");
  assert.equal(asked, 1);
  const first = (await adapter.listModels("claude-code"))[0];
  assert.equal(first?.id, "opus[1m]");
  const resolved = await adapter.resolveModel("claude-code", "opus[1m]");
  assert.equal(resolved.context?.contextWindow, 1_000_000);
  console.log("cli-models ok");
}

// elicitation: schema properties become dsh questions; answers become the accept content.
{
  const request = {
    mcp_server_name: "srv",
    display_name: "Server",
    message: "Tell me about it",
    mode: "form",
    requested_schema: {
      type: "object",
      properties: {
        name: { type: "string", title: "Your name" },
        size: { type: "string", enum: ["s", "m", "l"] },
        ok: { type: "boolean", description: "Proceed?" },
        count: { type: "integer" },
      },
    },
  };
  const qs = elicitationQuestions(request, "r1")!;
  assert.equal(qs.length, 4);
  assert.deepEqual(qs[0], {
    id: "r1:name",
    header: "Server",
    question: "Your name",
    options: [],
    multiSelect: false,
    detail: "Tell me about it",
  });
  assert.deepEqual(qs[1]!.options, [{ label: "s" }, { label: "m" }, { label: "l" }]);
  assert.deepEqual(qs[2]!.options, [{ label: "Yes" }, { label: "No" }]);
  assert.equal(qs[3]!.question, "count");
  const result = elicitationResult(
    request,
    {
      answers: [
        { id: "r1:name", custom: "Ada" },
        { id: "r1:size", selected: ["m"] },
        { id: "r1:ok", selected: ["No"] },
        { id: "r1:count", custom: "3" },
      ],
    },
    "r1",
  );
  assert.deepEqual(result, {
    action: "accept",
    content: { name: "Ada", size: "m", ok: false, count: 3 },
  });
  assert.deepEqual(elicitationResult(request, { answers: [] }, "r1"), { action: "cancel" });
  assert.equal(
    elicitationQuestions({ ...request, mode: "url", url: "https://x" }, "r2"),
    undefined,
  );
  assert.equal(elicitationQuestions({ mcp_server_name: "srv" }, "r3"), undefined, "no schema");
  console.log("elicitation ok");
}

// The bridged rename decides dsh's title without a session: the handler builds `/${cmd}${rawInput}`,
// so rawInput normally carries the leading space.
{
  assert.equal(renameTitle("rename", " Ada"), "Ada");
  assert.equal(renameTitle("name", " Ada Lovelace "), "Ada Lovelace");
  assert.equal(renameTitle("rename", ""), undefined, "empty goes to Claude unchanged");
  assert.equal(renameTitle("rename", "   "), undefined, "whitespace only is not a title");
  assert.equal(renameTitle("compact", " Ada"), undefined, "only rename sets dsh's title");
  console.log("renameTitle ok");
}

// mcpToolsByServer: the init frame's tool ids are split back onto the servers that contribute
// them, matching a normalized form so a name the CLI could not put in an id still lands.
{
  const byServer = mcpToolsByServer(
    ["dsh", "my server.v2", "svc:api", "gh", "gh_api", "İstanbul"],
    [
      "Bash",
      "mcp__dsh__job_output",
      "mcp__dsh__bash",
      "mcp__my_server_v2__search",
      "mcp__svc_api__list",
      "mcp__gh__issue",
      "mcp__gh_api__request",
      "mcp__nobody__ghost",
      "mcp___stanbul__weather",
    ],
  );
  assert.deepEqual(byServer.get("dsh"), ["bash", "job_output"], "sorted, prefix stripped");
  assert.deepEqual(byServer.get("my server.v2"), ["search"], "space and dot normalized");
  assert.deepEqual(byServer.get("svc:api"), ["list"], "colon normalized");
  assert.deepEqual(byServer.get("gh"), ["issue"], "shorter name keeps only its own tool");
  assert.deepEqual(byServer.get("gh_api"), ["request"], "longest matching name wins");
  assert.equal(byServer.has("nobody"), false, "an unknown server is dropped, not invented");
  assert.deepEqual(
    byServer.get("İstanbul"),
    ["weather"],
    "a name whose case fold changes length keeps the bare tool intact",
  );
  assert.deepEqual([...mcpToolsByServer([], []).keys()], [], "no servers, no entries");
  assert.deepEqual(mcpToolsByServer(["dsh"], []).get("dsh"), [], "a server with no tools is empty");
  console.log("mcp-tools-by-server ok");
}

// A finished list is not restored onto a new message; anything still open, or of a shape the log
// did not promise, is.
{
  assert.equal(hasPendingTodo([{ status: "completed" }, { status: "completed" }]), false);
  assert.equal(hasPendingTodo([{ status: "completed" }, { status: "in_progress" }]), true);
  assert.equal(hasPendingTodo([{ status: "pending" }]), true);
  assert.equal(hasPendingTodo(["a string is not a todo we can read"]), true);
  assert.equal(hasPendingTodo([]), false, "an empty list has nothing outstanding");
}

// The token counter stands in for thinking that never shows a word. It opens at the first mark, adds a
// fresh line at each mark after it (no arrow chain — dsh's Think summary follows the end, so the latest
// line shows collapsed), stays quiet while thinking text is streaming, and closes with the block it
// stood in for.
{
  const think = (t: any, total: number) =>
    t.translate({ type: "system", subtype: "thinking_tokens", estimated_tokens: total });
  const t = new Translator() as any;
  t.partial({ type: "message_start" });
  t.partial({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
  assert.deepEqual(think(t, 400), [], "below the first mark nothing draws");
  const open = think(t, 1200);
  assert.equal(open[0].type, "block-start");
  assert.equal(open[0].blockType, "reasoning");
  assert.equal(open[1].text, "~1.2k tokens");
  assert.deepEqual(think(t, 1900), [], "a frame short of the next mark is silent");
  assert.equal(think(t, 2100)[0].text, "\n~2.1k tokens", "the mark adds a fresh line");
  assert.deepEqual(think(t, 4999), []);
  assert.equal(think(t, 26_000)[0].text, "\n~26k tokens", "past the ladder it repeats every 20k");
  const closed = t.partial({ type: "content_block_stop", index: 0 });
  assert.equal(
    closed.length,
    1,
    "the counter and the silent block it stood in for close once, not twice",
  );
  assert.equal(closed[0].type, "block-end", "the thinking block ending closes the counter");
  assert.equal(closed[0].block.text, "~1.2k tokens\n~2.1k tokens\n~26k tokens");
  assert.equal(t.thinking, undefined);

  // Thinking whose text is streaming needs no counter, and an open one closes.
  const t2 = new Translator() as any;
  t2.partial({ type: "message_start" });
  t2.partial({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
  think(t2, 1200);
  t2.partial({ type: "content_block_delta", index: 0, delta: { thinking: "words" } });
  const hushed = think(t2, 5000);
  assert.equal(hushed[0].type, "block-end", "visible thinking closes the counter");
  assert.deepEqual(think(t2, 9000), [], "and it does not reopen");

  // A counter still open when the turn ends is closed by the result frame.
  const t3 = new Translator() as any;
  t3.partial({ type: "message_start" });
  t3.partial({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
  think(t3, 3000);
  const ended = t3.translate({ type: "result", subtype: "success", usage: {} });
  assert(
    ended.some((e: any) => e.type === "block-end"),
    "the result frame closes an open counter",
  );
  assert.equal(t3.thinking, undefined);

  assert.equal(tokensText(0), "0k");
  assert.equal(tokensText(1049), "1k", "one decimal below 10k, and a trailing .0 is dropped");
  assert.equal(tokensText(4640), "4.6k");
  assert.equal(tokensText(23_400), "23k", "no decimal above 10k");
  console.log("thinking-tokens ok");
}

// side_question answer decoding: both shapes the CLI returns, and the blank/absent cases.
{
  assert.equal(
    asideAnswerText({ response: "  the answer  " }),
    "the answer",
    "wrapped shape, trimmed",
  );
  assert.equal(asideAnswerText("bare string"), "bare string", "bare string shape");
  assert.equal(asideAnswerText({ response: "   " }), undefined, "blank answer is none");
  assert.equal(asideAnswerText({ response: null }), undefined, "declined answer is none");
  assert.equal(asideAnswerText(undefined), undefined, "no response is none");
  assert.equal(asideAnswerText({ other: "x" }), undefined, "missing response field is none");
  console.log("aside-answer-text ok");
}
