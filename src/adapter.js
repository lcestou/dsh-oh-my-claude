// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { registerSessionRoutes } from "./sessions.js";
import { KEY_HEADER, MCP_PATH, registerMcpBridge } from "./mcp.js";
import {
  ClaudeProcess,
  allowResult,
  answersFor,
  controlErrorLine,
  controlResponseLine,
  denyResult,
  parseQuestions,
  permissionReason,
  userTurnLine,
} from "./process.js";

export const name = "dsh-llm-claude";
export const inject = ["llm", "sessions", "attachments", "agents", "approval", "userQuestions"];

export const Config = z.object({
  permissionMode: z
    .union(["dsh", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto", "manual"])
    .default("dsh")
    .description(
      "Claude Code permission mode for tools the child runs on its own. 'dsh' follows the session's access mode switch: read-only → plan, workspace-write → acceptEdits, danger-full-access → bypassPermissions",
    ),
  allowedTools: z.array(z.string()).default([]).description("Extra --allowedTools entries"),
  disallowedTools: z.array(z.string()).default([]).description("--disallowedTools entries"),
  addDirs: z.array(z.string()).default([]).description("Extra --add-dir directories"),
  maxTurns: z
    .number()
    .step(1)
    .min(1)
    .description("--max-turns cap per request; unset = CLI default"),
  maxBudgetUsd: z.number().min(0).description("--max-budget-usd per request; unset = no cap"),
  titleModel: z.string().default("haiku").description("Model for session-title requests"),
  toolActivity: z
    .boolean()
    .default(true)
    .description("Show Claude Code tool calls and results as reasoning blocks"),
  resume: z
    .boolean()
    .default(true)
    .description("Keep one Claude Code session per dsh session via --session-id/--resume"),
  idleTimeoutMs: z
    .number()
    .step(1)
    .min(1000)
    .default(1_800_000)
    .description(
      "Kill the child when no stream event arrives for this long (a running tool emits nothing until it ends)",
    ),
  toolTextLimit: z
    .number()
    .step(1)
    .min(100)
    .default(600)
    .description("Characters of tool arguments/results shown in the activity blocks"),
  dshTools: z
    .boolean()
    .default(true)
    .description("Expose dsh tools (subagents, jobs, skills...) to Claude Code over MCP"),
  debug: z.boolean().default(false).description("Log spawn arguments (minus the prompt) per call"),
  approvals: z
    .boolean()
    .default(true)
    .description(
      "Route Claude Code permission prompts and AskUserQuestion to dsh dialogs (--permission-prompt-tool stdio)",
    ),
  processIdleMs: z
    .number()
    .step(1)
    .min(10_000)
    .default(30 * 60 * 1000)
    .description("Kill a session's idle Claude Code process after this long without a turn"),
  maxProcesses: z
    .number()
    .step(1)
    .min(1)
    .default(4)
    .description("Cap on live Claude Code processes; the longest-idle one is evicted first"),
});

const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"];
const EFFORTS_45 = ["low", "medium", "high"];
const M = (id, name, contextWindow, efforts) => ({ id, name, contextWindow, efforts });

// Fallback catalog when the Models API is unreachable. Ids are what `claude --model` accepts.
export const KNOWN_MODELS = [
  M("claude-fable-5-1", "Claude Fable 5.1", 1_000_000, EFFORTS_ALL),
  M("claude-fable-5", "Claude Fable 5", 1_000_000, EFFORTS_ALL),
  M("claude-opus-5", "Claude Opus 5", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-8", "Claude Opus 4.8", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-7", "Claude Opus 4.7", 1_000_000, EFFORTS_ALL),
  M("claude-opus-4-6", "Claude Opus 4.6", 1_000_000, ["low", "medium", "high", "max"]),
  M("claude-sonnet-5", "Claude Sonnet 5", 1_000_000, EFFORTS_ALL),
  M("claude-sonnet-4-6", "Claude Sonnet 4.6", 1_000_000, ["low", "medium", "high", "max"]),
  M("claude-opus-4-5", "Claude Opus 4.5", 200_000, EFFORTS_45),
  M("claude-sonnet-4-5", "Claude Sonnet 4.5", 200_000, []),
  M("claude-haiku-4-5", "Claude Haiku 4.5", 200_000, []),
];

// No default effort is advertised: `--effort` is only sent when dsh picks one, so the CLI's own default rules.
const CLAUDE_HOME = join(homedir(), ".claude");
const MAX_IMAGES = 20;
const TOOL_TEXT_LIMIT = 600;

// ---------------------------------------------------------------------------
// Model catalog

const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog = { at: 0, models: KNOWN_MODELS };

async function authHeaders() {
  if (process.env.ANTHROPIC_API_KEY) return { "x-api-key": process.env.ANTHROPIC_API_KEY };
  try {
    const raw = await readFile(join(CLAUDE_HOME, ".credentials.json"), "utf8");
    const oauth = JSON.parse(raw).claudeAiOauth;
    if (oauth?.accessToken && (oauth.expiresAt ?? 0) > Date.now()) {
      return { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" };
    }
  } catch {
    /* no stored credential */
  }
  return null;
}

export function modelFromApi(m) {
  const eff = m.capabilities?.effort;
  const efforts = eff?.supported ? EFFORTS_ALL.filter((l) => eff[l]?.supported) : [];
  return M(m.id, m.display_name ?? m.id, m.max_input_tokens ?? 200_000, efforts);
}

export async function getCatalog(fetchImpl = fetch) {
  if (Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.models;
  const headers = await authHeaders();
  if (headers) {
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=100", {
        headers: { ...headers, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = (await res.json()).data ?? [];
        if (data.length > 0) catalog = { at: Date.now(), models: data.map(modelFromApi) };
        return catalog.models;
      }
    } catch {
      /* offline or rejected: keep previous catalog */
    }
  }
  catalog = { at: Date.now(), models: catalog.models }; // retry no sooner than the TTL
  return catalog.models;
}

function modelInfo(provider, model) {
  return { provider, id: model.id, name: model.name, inputModalities: ["text", "image"] };
}

/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(provider, modelId, models = catalog.models) {
  const pool = [...models, ...KNOWN_MODELS];
  const found = pool.find((m) => m.id === modelId) ?? pool.find((m) => m.id.startsWith(modelId));
  const info = { ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }) };
  if (!found) return info;
  info.context = { contextWindow: found.contextWindow };
  if (found.efforts.length > 0) {
    info.reasoning = { efforts: found.efforts.map((id) => ({ id, name: id })) };
  }
  return info;
}

// ---------------------------------------------------------------------------
// Session mapping: one Claude Code session per dsh session

/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
export function claudeSessionId(sessionId) {
  const h = createHash("sha256").update(`dsh-llm-claude:${sessionId}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl */
export function projectDirName(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

async function claudeSessionExists(cwd, id) {
  try {
    await access(join(CLAUDE_HOME, "projects", projectDirName(cwd), `${id}.jsonl`));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request assembly

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  return String(content ?? "");
};

const isTurn = (m) => (m.role === "user" && m.source?.kind !== "tool") || m.role === "assistant";

/**
 * Pick the messages that go into this call. Resuming: only what came after the last assistant turn
 * (the new prompt plus dsh's context injections). Fresh: the whole transcript, since `claude -p` is stateless.
 */
export function selectTurns(messages, resuming) {
  const turns = (messages ?? []).filter(isTurn);
  if (!resuming) return turns;
  let last = -1;
  for (let i = 0; i < turns.length; i++) if (turns[i].role === "assistant") last = i;
  return turns.slice(last + 1);
}

/** Text body sent as the user prompt. Assistant turns get role labels so history stays legible. */
export function buildPrompt(turns) {
  const parts = turns.map((m) => ({ role: m.role, text: textOf(m.content) })).filter((t) => t.text);
  if (!parts.some((t) => t.role === "user"))
    throw new LlmError("no user message", "INVALID_REQUEST");
  const multi = parts.some((t) => t.role === "assistant");
  return parts.map((t) => (multi ? `[${t.role}]\n${t.text}` : t.text)).join("\n\n");
}

function imageRefs(turns) {
  const refs = [];
  for (const m of turns) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b.type === "image" && b.attachment) refs.push(b.attachment);
  }
  return refs.slice(-MAX_IMAGES);
}

const MODE_FOR_ACCESS = {
  "read-only": "plan",
  "workspace-write": "acceptEdits",
  "danger-full-access": "bypassPermissions",
};

/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export function accessModeOf(messages) {
  let mode;
  for (const m of messages ?? []) {
    if (m.role !== "user") continue;
    const found = textOf(m.content).match(/Current DSH file policy: ([a-z-]+)/);
    if (found) mode = found[1];
  }
  return mode;
}

export function permissionModeFor(config, accessMode) {
  if (config.permissionMode !== "dsh") return config.permissionMode;
  return MODE_FOR_ACCESS[accessMode] ?? "acceptEdits";
}

// ---------------------------------------------------------------------------
// CLI probe: Claude Code auto-updates itself, so flags are checked against `claude --help` once per
// process and anything missing is left out. Unknown = assume supported (probe failed, older CLI).

let cliProbe;
export function probeCli(exec = execFile) {
  cliProbe ??= (async () => {
    const run = (args) =>
      new Promise((resolve) => {
        exec("claude", args, { timeout: 8000 }, (err, stdout) =>
          resolve(err ? "" : String(stdout)),
        );
      });
    const [help, version] = await Promise.all([run(["--help"]), run(["--version"])]);
    const flags = new Set(help.match(/--[a-zA-Z-]+/g) ?? []);
    return { flags: flags.size > 0 ? flags : null, version: version.trim() || "unknown" };
  })();
  return cliProbe;
}

export const supports = (flags, flag) => !flags || flags.has(flag);

/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export const usesStdin = (flags) => supports(flags, "--input-format");

export function buildArgs({
  model,
  reasoningEffort,
  system,
  purpose,
  config,
  session,
  accessMode,
  flags,
  promptText,
  mcp,
}) {
  const args = ["-p"];
  if (usesStdin(flags)) args.push("--input-format", "stream-json");
  else args.push(promptText ?? "");
  args.push("--output-format", "stream-json", "--verbose");
  if (supports(flags, "--include-partial-messages")) args.push("--include-partial-messages");
  if (supports(flags, "--forward-subagent-text")) args.push("--forward-subagent-text");
  if (model) args.push("--model", model);
  if (reasoningEffort && supports(flags, "--effort")) args.push("--effort", reasoningEffort);
  if (typeof system === "string" && system && supports(flags, "--append-system-prompt")) {
    args.push("--append-system-prompt", system);
  }
  if (purpose) {
    // Auxiliary calls (title, compaction): one turn, no tools, no session of their own.
    args.push("--tools", "", "--max-turns", "1");
    return args;
  }
  if (supports(flags, "--permission-mode")) {
    args.push("--permission-mode", permissionModeFor(config, accessMode));
  }
  if (config.approvals && usesStdin(flags) && supports(flags, "--permission-prompt-tool")) {
    args.push("--permission-prompt-tool", "stdio");
  }
  // "default" is what the Agent SDK passes; without it the CLI keeps AskUserQuestion out of -p runs.
  if (supports(flags, "--tools")) args.push("--tools", "default");
  if (config.allowedTools.length > 0) args.push("--allowedTools", ...config.allowedTools);
  if (config.disallowedTools.length > 0) args.push("--disallowedTools", ...config.disallowedTools);
  for (const d of config.addDirs) args.push("--add-dir", d);
  if (config.maxTurns) args.push("--max-turns", String(config.maxTurns));
  if (config.maxBudgetUsd && supports(flags, "--max-budget-usd")) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }
  if (session && supports(flags, "--session-id") && supports(flags, "--resume")) {
    args.push(session.resuming ? "--resume" : "--session-id", session.id);
  }
  if (mcp && supports(flags, "--mcp-config")) {
    const dsh = { type: "http", url: mcp.url, headers: { [KEY_HEADER]: mcp.key } };
    args.push("--mcp-config", JSON.stringify({ mcpServers: { dsh } }));
  }
  return args;
}

// ---------------------------------------------------------------------------
// Session state: which Claude sessions this plugin started, so resume does not depend on guessing
// where Claude Code keeps its transcripts. A wrong guess still degrades to a fresh full-transcript run.

const STATE_DIR = join(homedir(), ".local", "state", "dsh-llm-claude");
const STATE_FILE = join(STATE_DIR, "sessions.json");
const AUX_DIR = join(STATE_DIR, "aux");
let auxReady;
const auxCwd = () => (auxReady ??= mkdir(AUX_DIR, { recursive: true }).then(() => AUX_DIR));
let started; // Set of Claude session ids known to exist

async function loadStarted() {
  if (started) return started;
  try {
    started = new Set(JSON.parse(await readFile(STATE_FILE, "utf8")));
  } catch {
    started = new Set();
  }
  return started;
}

async function rememberStarted(id, keep = true) {
  const set = await loadStarted();
  if (keep ? set.has(id) : !set.has(id)) return;
  if (keep) set.add(id);
  else set.delete(id);
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify([...set]));
  } catch {
    /* state is an optimization only */
  }
}

/** One stream-json input line: the user turn with text and inline images. */
export function buildInput(promptText, images) {
  const content = [{ type: "text", text: promptText }];
  for (const img of images) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  return userTurnLine(content);
}

// ---------------------------------------------------------------------------
// stream-json → dsh chunks

const clip = (s, n = TOOL_TEXT_LIMIT) => (s.length > n ? `${s.slice(0, n)}…` : s);
const DENIED_RE = /requires? approval|permission (was )?denied|not allowed/i;

function toolResultText(block) {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
  return "";
}

function usageEvent(u) {
  // dsh TokenUsage: inputTokens excludes cache hits; the three prompt counters plus output sum to totalTokens.
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    type: "usage",
    usage: {
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + cacheRead + cacheWrite + output,
      ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
    },
  };
}

/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export function isStaleResume(event) {
  if (event?.type !== "result" || !event.is_error) return false;
  return /No conversation found/i.test(JSON.stringify(event.errors ?? event.result ?? ""));
}

function finishReason(result) {
  if (result.is_error) {
    const errors = Array.isArray(result.errors) ? result.errors.join("; ") : "";
    const message = String(result.result ?? errors ?? result.subtype ?? "claude error");
    return { kind: "error", failure: { message, code: "PROVIDER_ERROR" } };
  }
  if (result.stop_reason === "max_tokens") return { kind: "max-tokens" };
  return { kind: "stop" };
}

/**
 * Incremental translator from Claude Code stream-json lines to dsh StreamChunks.
 * Prefers partial `stream_event`s; falls back to whole `assistant` messages when no partials arrived.
 * Tool calls and results are shown as reasoning blocks: the CLI runs its own tools, dsh only watches.
 */
export class Translator {
  constructor({ toolActivity = true, toolTextLimit = TOOL_TEXT_LIMIT } = {}) {
    this.toolActivity = toolActivity;
    this.dshIds = new Set(); // tool_use ids of dsh tools called over the MCP bridge
    this.limit = toolTextLimit;
    this.index = 0;
    this.open = new Map(); // api block index → { index, blockType, text }
    this.sawPartial = false;
    this.finished = false;
    this.denied = 0; // tool calls Claude Code refused because a non-interactive run cannot ask
    this.toolPending = false; // a tool_use block closed and its result has not arrived yet
  }

  deltaType(block) {
    return block.blockType === "text" ? "text-delta" : "reasoning-delta";
  }

  startBlock(blockType, prefix = "") {
    const block = { index: this.index++, blockType, text: prefix };
    const events = [{ type: "block-start", index: block.index, blockType }];
    if (prefix) events.push({ type: this.deltaType(block), index: block.index, text: prefix });
    return { block, events };
  }

  delta(block, text) {
    block.text += text;
    const type = this.deltaType(block);
    return { type, index: block.index, text };
  }

  endBlock(block) {
    return {
      type: "block-end",
      index: block.index,
      block: { type: block.blockType, text: block.text },
    };
  }

  wholeBlock(blockType, text) {
    const { block, events } = this.startBlock(blockType);
    events.push(this.delta(block, text), this.endBlock(block));
    return events;
  }

  translate(event) {
    switch (event?.type) {
      case "stream_event":
        return this.partial(event.event ?? {});
      case "assistant":
        return this.assistant(event.message?.content ?? [], event.parent_tool_use_id);
      case "user":
        return this.toolResults(event.message?.content ?? [], event.parent_tool_use_id);
      case "result": {
        this.finished = true;
        const events = [];
        if (this.denied > 0 && !event.is_error) {
          const n = this.denied;
          events.push(
            ...this.wholeBlock(
              "text",
              `\n\n_Claude Code denied ${n} tool call${n === 1 ? "" : "s"} that needed approval. Switch Access mode to Full Access to allow them._`,
            ),
          );
        }
        if (event.usage) events.push(usageEvent(event.usage));
        events.push({ type: "finish", reason: finishReason(event) });
        return events;
      }
      case "rate_limit_event": {
        // Emitted on every run with status "allowed"; only a non-allowed status is an error.
        const info = event.rate_limit_info ?? {};
        const status = info.status ?? "allowed";
        if (status === "allowed") return [];
        this.finished = true;
        const resetMs = Number.isFinite(info.resetsAt) ? info.resetsAt * 1000 - Date.now() : 0;
        const failure = {
          message: `Rate limited (${status})`,
          code: "RATE_LIMIT",
          ...(resetMs > 0 ? { providerRetryAfterMs: resetMs } : {}),
        };
        return [{ type: "finish", reason: { kind: "error", failure } }];
      }
      default:
        return [];
    }
  }

  partial(ev) {
    switch (ev.type) {
      case "message_start":
        this.sawPartial = true;
        this.toolPending = false;
        this.open.clear();
        return [];
      case "content_block_start":
        return this.openBlock(ev.index, ev.content_block ?? {});
      case "content_block_delta": {
        const block = this.open.get(ev.index);
        if (!block || block.index < 0) return [];
        const d = ev.delta ?? {};
        const text = d.text ?? d.thinking ?? d.partial_json ?? "";
        return text ? [this.delta(block, text)] : [];
      }
      case "content_block_stop": {
        const block = this.open.get(ev.index);
        if (!block) return [];
        this.open.delete(ev.index);
        // A finished tool_use block means the CLI is now running that tool: no stream events until
        // its result arrives, however long it takes. Callers read this to pause their idle timer.
        this.toolPending = block.tool === true;
        return block.index < 0 ? [] : [this.endBlock(block)];
      }
      default:
        return [];
    }
  }

  openBlock(apiIndex, cb) {
    let opened;
    if (cb.type === "text") opened = this.startBlock("text");
    else if (cb.type === "thinking") opened = this.startBlock("reasoning");
    else if (cb.type === "tool_use") {
      if (!this.toolActivity) {
        this.open.set(apiIndex, { index: -1, blockType: "hidden", text: "", tool: true });
        return [];
      }
      opened = this.startBlock(...this.toolLead(cb));
      opened.block.tool = true;
    } else return [];
    this.open.set(apiIndex, opened.block);
    return opened.events;
  }

  assistant(content, parentToolUseId) {
    // Claude Code subagent output (--forward-subagent-text) arrives as whole messages tagged with the
    // parent tool id; it never comes as partials, so it is always rendered, folded into reasoning.
    if (parentToolUseId) {
      if (!this.toolActivity) return [];
      const text = content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
      return text ? this.wholeBlock("reasoning", `↳ subagent\n${clip(text, this.limit)}`) : [];
    }
    if (this.sawPartial) return []; // already streamed as deltas
    const events = [];
    for (const b of content) {
      if (b.type === "text" && b.text) events.push(...this.wholeBlock("text", b.text));
      else if (b.type === "thinking" && b.thinking)
        events.push(...this.wholeBlock("reasoning", b.thinking));
      else if (b.type === "tool_use" && this.toolActivity) {
        const [kind, lead] = this.toolLead(b);
        events.push(
          ...this.wholeBlock(kind, lead + clip(JSON.stringify(b.input ?? {}), this.limit)),
        );
      }
    }
    return events;
  }

  /** dsh tools reached over the MCP bridge (subagents, jobs...) render as visible text rows, the
   *  rest as collapsed reasoning. Returns [block kind, lead text]. */
  toolLead(cb) {
    if (cb.name?.startsWith("mcp__dsh__")) {
      this.dshIds.add(cb.id);
      return ["text", `⤷ ${cb.name.slice("mcp__dsh__".length)} `];
    }
    return ["reasoning", `▶ ${cb.name} `];
  }

  toolResults(content, parentToolUseId) {
    this.toolPending = false;
    if (!this.toolActivity) return [];
    const events = [];
    for (const b of content) {
      if (b.type !== "tool_result") continue;
      const raw = toolResultText(b).trim();
      if (b.is_error && DENIED_RE.test(raw)) this.denied++;
      const body = clip(raw || "(empty)", this.limit);
      const tag = parentToolUseId ? "↳ " : "";
      const dsh = this.dshIds.delete(b.tool_use_id);
      events.push(
        ...this.wholeBlock(
          dsh ? "text" : "reasoning",
          `${tag}${dsh ? "⤶" : "◀"} ${b.is_error ? "error" : "result"}\n${body}`,
        ),
      );
    }
    return events;
  }
}

// ---------------------------------------------------------------------------
// Adapter

const specKey = (spec) => JSON.stringify(spec);

export class ClaudeCodeAdapter extends LlmAdapter {
  constructor(ctx, config) {
    super();
    this.ctx = ctx;
    this.config = config;
    this.processes = new Map(); // dsh sessionId → ClaudeProcess
  }

  providerInfo(provider) {
    return { id: provider, name: "Claude Code" };
  }

  async listModels(provider) {
    return (await getCatalog()).map((m) => modelInfo(provider, m));
  }

  async resolveModel(provider, model, _signal) {
    return resolveModelInfo(provider, model, await getCatalog());
  }

  sessionCwd(sessionId) {
    try {
      return this.ctx?.sessions?.get(sessionId)?.header?.cwd;
    } catch {
      return undefined;
    }
  }

  log(level, message) {
    this.ctx?.logger?.[level]?.(`dsh-llm-claude: ${message}`);
  }

  async loadImages(refs, signal) {
    const store = this.ctx?.attachments;
    if (!store || refs.length === 0) return [];
    const out = [];
    for (const ref of refs) {
      try {
        const stored = await store.readImage(ref, signal);
        out.push({ mediaType: ref.mediaType, data: Buffer.from(stored.data).toString("base64") });
      } catch (error) {
        this.log("warn", `skipping image ${ref.attachmentId}: ${error?.message ?? error}`);
      }
    }
    return out;
  }

  /** Everything one turn needs: spawn args + spec for the long-lived process, and the stdin line for this turn. */
  async prepare(options, { forceFresh = false } = {}) {
    const cli = await probeCli();
    if (!this.loggedVersion) {
      this.loggedVersion = true;
      this.log("info", `claude ${cli.version}, stdin input ${usesStdin(cli.flags) ? "on" : "off"}`);
    }
    // Title/compaction one-shots run from a scratch dir so their transcripts never show up in a
    // workspace's Claude Code session list.
    const cwd = options.purpose
      ? await auxCwd()
      : (options.sessionId && this.sessionCwd(options.sessionId)) || process.cwd();
    let session;
    if (!options.purpose && this.config.resume && options.sessionId) {
      // A dsh session opened from a Claude Code transcript carries the Claude id itself.
      const own = await claudeSessionExists(cwd, options.sessionId);
      const id = own ? options.sessionId : claudeSessionId(options.sessionId);
      const known = own || (await loadStarted()).has(id) || (await claudeSessionExists(cwd, id));
      session = { id, resuming: known && !forceFresh };
    }
    const turns = selectTurns(options.messages, session?.resuming ?? false);
    const promptText = buildPrompt(turns);
    const stdin = usesStdin(cli.flags);
    const images = stdin ? await this.loadImages(imageRefs(turns), options.signal) : [];
    const model = options.purpose === "session-title" ? this.config.titleModel : options.model;
    const accessMode = accessModeOf(options.messages);
    const args = buildArgs({
      ...options,
      model,
      config: this.config,
      session,
      accessMode,
      flags: cli.flags,
      promptText,
      mcp:
        this.mcp && options.sessionId && !options.purpose && this.config.dshTools
          ? { url: `${this.mcp.base}${MCP_PATH}/${options.sessionId}`, key: this.mcp.key }
          : undefined,
    });
    // Spec = what a running process was spawned with. `resuming` is deliberately left out: it flips
    // to true after the first turn and must not force a respawn.
    const spec = {
      cwd,
      model,
      effort: options.reasoningEffort ?? null,
      mode: permissionModeFor(this.config, accessMode),
      sessionId: session?.id ?? null,
    };
    return {
      cwd,
      args,
      session,
      spec,
      accessMode,
      input: stdin ? buildInput(promptText, images) : null,
    };
  }

  async *stream(options) {
    if (options.purpose || !options.sessionId || !this.config.resume) {
      yield* this.oneShot(options);
      return;
    }
    yield* this.turn(options, false);
  }

  // ── persistent path ──────────────────────────────────────────────────────

  /** Reuse the session's process when its spec still matches; otherwise replace it. */
  async acquire(options, forceFresh) {
    const prep = await this.prepare(options, { forceFresh });
    if (prep.input === null) return { prep, proc: null }; // text-mode CLI: fall back to one-shot semantics
    const key = specKey(prep.spec);
    let proc = this.processes.get(options.sessionId);
    if (proc && (!proc.alive || proc.key !== key || proc.busy)) {
      proc.kill();
      proc = undefined;
    }
    if (!proc) {
      this.evict();
      proc = new ClaudeProcess({
        args: prep.args,
        cwd: prep.cwd,
        spec: prep.spec,
        onExit: (p) => {
          if (this.processes.get(options.sessionId) === p) this.processes.delete(options.sessionId);
        },
      });
      proc.key = key;
      proc.resuming = prep.session?.resuming ?? false;
      this.processes.set(options.sessionId, proc);
      if (this.config.debug) {
        this.log("info", `spawn cwd=${prep.cwd} claude ${prep.args.join(" ")}`);
      }
    }
    return { prep, proc };
  }

  /** Drop processes idle past processIdleMs, then keep the live count under maxProcesses by
   *  killing the longest-idle ones that are not mid-turn. Called before each spawn. */
  evict() {
    const now = Date.now();
    for (const [id, p] of this.processes) {
      if (!p.alive || (!p.busy && now - p.lastUsed > this.config.processIdleMs)) {
        p.kill();
        this.processes.delete(id);
      }
    }
    const idle = [...this.processes.entries()]
      .filter(([, p]) => !p.busy)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.processes.size >= this.config.maxProcesses && idle.length > 0) {
      const [id, p] = idle.shift();
      p.kill();
      this.processes.delete(id);
    }
  }

  async *turn(options, forceFresh) {
    const { prep, proc } = await this.acquire(options, forceFresh);
    if (proc === null) {
      yield* this.oneShot(options);
      return;
    }
    const tr = new Translator({
      toolActivity: this.config.toolActivity,
      toolTextLimit: this.config.toolTextLimit,
    });
    const pending = new Map(); // control request id → AbortController
    let retryFresh = false;
    let idle = false;
    let timer;
    const armIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        proc.kill();
      }, this.config.idleTimeoutMs);
    };
    const onAbort = () => proc.kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    proc.busy = true;
    proc.lastUsed = Date.now();
    try {
      if (!proc.write(prep.input))
        throw new LlmError("claude process is not running", "PROVIDER_ERROR");
      armIdle();
      for (;;) {
        const event = await proc.nextEvent();
        if (event === null) break;
        armIdle();
        if (event.type === "control_request") {
          yield* this.handleControl(event, options, prep, proc, pending, tr);
          continue;
        }
        if (event.type === "control_cancel_request") {
          pending.get(event.request_id)?.abort();
          continue;
        }
        if (event.type === "control_response") continue; // replies to our own initialize etc.
        if (isStaleResume(event) && proc.resuming && !forceFresh) {
          retryFresh = true;
          break;
        }
        yield* tr.translate(event);
        if (tr.toolPending) clearTimeout(timer); // tool running: silence is expected, do not time out
        if (tr.finished) break;
      }
      if (retryFresh) {
        await rememberStarted(prep.session.id, false);
      } else if (tr.finished) {
        if (prep.session) await rememberStarted(prep.session.id, true);
      } else {
        const reason = options.signal?.aborted
          ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
          : idle
            ? {
                kind: "error",
                failure: {
                  message: `claude produced no output for ${Math.round(this.config.idleTimeoutMs / 1000)}s and was stopped`,
                  code: "IDLE_TIMEOUT",
                },
              }
            : {
                kind: "error",
                failure: {
                  message: `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
                  code: "PROVIDER_ERROR",
                },
              };
        yield { type: "finish", reason };
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      for (const c of pending.values()) c.abort();
      proc.busy = false;
      proc.lastUsed = Date.now();
      if (retryFresh || !tr.finished) {
        proc.kill();
        this.processes.delete(options.sessionId);
      }
    }
    if (retryFresh) yield* this.turn(options, true);
  }

  /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
  async *handleControl(event, options, prep, proc, pending, tr) {
    const request = event.request ?? {};
    const requestId = event.request_id;
    if (request.subtype !== "can_use_tool") {
      proc.write(
        controlErrorLine(
          requestId,
          `${request.subtype ?? "unknown"} is not supported by dsh-llm-claude`,
        ),
      );
      return;
    }
    const toolName = request.tool_name ?? "tool";
    const input = request.input ?? {};
    const toolUseId = request.tool_use_id ?? requestId;
    const controller = new AbortController();
    pending.set(requestId, controller);
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const agent = this.ctx?.agents?.get?.(options.sessionId);
    const label = toolName === "AskUserQuestion" ? "❓ question" : `⚑ approval: ${toolName}`;
    yield* tr.wholeBlock("reasoning", `${label} ${permissionReason(toolName, input, request)}`);
    // Decide asynchronously so the stream keeps flowing while the user thinks; the CLI waits on stdin.
    const reply = (line) => {
      if (!proc.write(line))
        this.log("warn", `control response for ${toolName} dropped: claude process already exited`);
    };
    this.decide({ toolName, input, request, toolUseId, agent, signal, accessMode: prep.accessMode })
      .then((result) => reply(controlResponseLine(requestId, result)))
      .catch((error) => reply(controlErrorLine(requestId, String(error?.message ?? error))))
      .finally(() => pending.delete(requestId));
  }

  async decide({ toolName, input, request, toolUseId, agent, signal, accessMode }) {
    if (toolName === "AskUserQuestion") {
      const questions = parseQuestions(input, toolUseId);
      const ask = this.ctx?.userQuestions?.ask;
      if (!questions || !ask) return denyResult(toolUseId, "dsh could not present this question");
      try {
        const response = await this.ctx.userQuestions.ask({ questions, agent, signal });
        return allowResult(toolUseId, { ...input, answers: answersFor(questions, response) });
      } catch (error) {
        return denyResult(toolUseId, `question cancelled: ${error?.message ?? error}`);
      }
    }
    if (accessMode === "danger-full-access") return allowResult(toolUseId, input);
    const approval = this.ctx?.approval;
    if (!approval || !agent)
      return denyResult(toolUseId, "dsh approval is unavailable for this session");
    let outcome;
    try {
      outcome = await approval.request({
        agent,
        toolName,
        reason: permissionReason(toolName, input, request),
        signal,
      });
    } catch (error) {
      return denyResult(toolUseId, `approval failed: ${error?.message ?? error}`);
    }
    if (outcome === "allowed-once") return allowResult(toolUseId, input);
    return denyResult(
      toolUseId,
      outcome === "rejected" ? "The user denied this action in dsh." : `approval ${outcome}`,
    );
  }

  // ── one-shot path (aux calls, text-mode CLI, no session id) ──────────────

  async *oneShot(options) {
    const { cwd, args, session, input } = await this.prepare(options);
    const proc = new ClaudeProcess({
      args: args.filter(
        (a, i) => !(a === "--permission-prompt-tool" || args[i - 1] === "--permission-prompt-tool"),
      ),
      cwd,
      spec: {},
    });
    if (this.config.debug) this.log("info", `one-shot cwd=${cwd} claude ${proc.args.join(" ")}`);
    if (input !== null) {
      proc.write(input);
      proc.child.stdin.end();
    } else {
      proc.child.stdin.end();
    }
    const tr = new Translator({ toolActivity: false, toolTextLimit: this.config.toolTextLimit });
    const onAbort = () => proc.kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let timer;
    let idle = false;
    const armIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        proc.kill();
      }, this.config.idleTimeoutMs);
    };
    armIdle();
    try {
      for (;;) {
        const event = await proc.nextEvent();
        if (event === null) break;
        armIdle();
        if (event.type === "control_request") {
          proc.write(controlErrorLine(event.request_id, "not supported in one-shot mode"));
          continue;
        }
        yield* tr.translate(event);
        if (tr.finished) break;
      }
      if (tr.finished) {
        if (session) await rememberStarted(session.id, true);
        return;
      }
      const reason = options.signal?.aborted
        ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
        : {
            kind: "error",
            failure: {
              message: idle
                ? `claude produced no output for ${Math.round(this.config.idleTimeoutMs / 1000)}s and was stopped`
                : `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
              code: idle ? "IDLE_TIMEOUT" : "PROVIDER_ERROR",
            },
          };
      yield { type: "finish", reason };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      proc.kill();
    }
  }
}

export function apply(ctx, config) {
  ctx.llm.registerConfigurableProviders([
    {
      provider: "claude-code",
      displayName: "Claude Code",
      settingsNs: "llm-claude-code",
      settingsPath: [],
    },
  ]);
  const adapter = new ClaudeCodeAdapter(ctx, config);
  ctx.llm.registerAdapter(["claude-code"], adapter);
  registerMcpBridge(ctx, { log: (level, msg) => adapter.log(level, msg), version: "0.7.0" }).then(
    (mcp) => {
      adapter.mcp = mcp;
    },
    (e) => adapter.log("warn", `mcp bridge unavailable: ${e?.message ?? e}`),
  );
  registerSessionRoutes(ctx, {
    log: (level, msg) => adapter.log(level, msg),
    projectDir: (cwd) => join(CLAUDE_HOME, "projects", projectDirName(cwd)),
    startedIds: loadStarted,
  });
}
