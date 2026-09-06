// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { basename, join } from "node:path";
import type { Spawner } from "./process.js";
import {
  LlmAdapter,
  LlmError,
  type ContentBlock,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
  boundContextSummary,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { accountIdentity, registerSessionRoutes } from "./sessions.js";
import { registerUsageRoute } from "./usage.js";
import { KEY_HEADER, MCP_PATH, registerMcpBridge } from "./mcp.js";
import {
  type ClaudeEvent,
  ClaudeProcess,
  allowResult,
  answersFor,
  controlErrorLine,
  controlResponseLine,
  denyResult,
  parseQuestions,
  permissionReason,
  userTurnLine,
  interruptLine,
  controlRequestLine,
  decodeRewindResult,
  toJsonValue,
  nodeSpawner,
  seamSpawner,
  attachKeeper,
  launchKeeper,
  lazyHandle,
  pidAlive,
  readKeeperInfo,
  readKeeperSpec,
  spawnKeeper,
} from "./process.js";
import type {
  Agent,
  ApprovalOutcome,
  ImageAttachmentRef,
  JsonValue,
  PluginContext,
  SessionController,
  SessionId,
  SubprocessRuntime,
} from "./dsh.js";
import {
  ADAPTER_CURRENT,
  COMMAND_CATALOG,
  RESUME_TIMER,
  PROCESS_REGISTRY,
  TEMPORARY_SESSIONS,
  TURN_RECORDS,
  asSessionId,
} from "./dsh.js";
import {
  authHeaders,
  auxCwd,
  buildRedactor,
  CLAUDE_HOME,
  hasPendingNotice,
  loadStarted,
  isPermissionMode,
  loadPermissionModes,
  markBusy,
  noteBoot,
  rememberStarted,
  resolveClaudeHome,
  savePermissionMode,
  STATE_DIR,
  stateDir,
  takeInterrupted,
  trace,
} from "./state.js";
import { CHILD_ENV, errorText, toolResultText } from "./process.js";
import type { RewindResult } from "./process.js";
import { forkTranscriptText } from "./transcript.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import type {
  ContentBlockType,
  FinishReason,
  LlmFailure,
  ReasoningEffortId,
  TokenUsage,
  ToolCallId,
} from "@deepseek-ai/dsh-llm";
import type {
  ClaudeContentBlock,
  ClaudeProcessSpec,
  ClaudeStreamPartial,
  RelayEvent,
  RelayResult,
  TurnPrep,
} from "./process.js";

/** A dsh request that belongs to a session; everything on the persistent path has one. */
type SessionOptions = GenerateOptions & { sessionId: SessionId };
/** The CLI asking for a permission or a question. */
type ControlRequestEvent = Extract<ClaudeEvent, { type: "control_request" }>;
/** How a turn ended, as the turn loop tracks it. */
type Outcome = "continue" | "finished" | "parked" | "retry" | "relayed" | "ended" | undefined;
/** How this request continues the session's Claude process; see continuationFor(). */
type Continuation =
  | { mode: "abandon" | "steer"; proc: ClaudeProcess; options: SessionOptions }
  | { mode: "relay"; proc: ClaudeProcess; options: SessionOptions; results: RelayResult[] }
  | { mode: "prompt"; proc?: undefined; options: SessionOptions };
/** dsh splicing messages into a session's inbox mid-turn; the steers this adapter forwards live. */
type SpliceEvent = {
  type?: string;
  data?: { target?: string; inserted?: LooseMessage[] };
};
/** The permission decision inputs, one control request's worth. */
interface Decision {
  toolName: string;
  input: Record<string, JsonValue>;
  request: NonNullable<ControlRequestEvent["request"]>;
  toolUseId: string;
  agent: Agent | undefined;
  signal: AbortSignal;
  accessMode: string | undefined;
}

/** A live process always carries the prep it was spawned with; acquire() sets it before use. */
/** A process parked on a relayed tool call or a steer is mid-turn, not idle. */
const isSettled = (p: ClaudeProcess) => !p.busy && p.relays.size === 0 && !p.parked;
function requirePrep(proc: ClaudeProcess): TurnPrep {
  if (!proc.prep) throw new LlmError("claude process has no turn state", "PROVIDER_ERROR");
  return proc.prep;
}

/** Configuration shape produced by the Config schema with defaults applied. */
export type Config = {
  command: string;
  spawn: "node" | "dsh";
  configDir: string;
  permissionMode:
    | "dsh"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto"
    | "manual";
  allowedTools: string[];
  disallowedTools: string[];
  addDirs: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  titleModel: string;
  toolActivity: boolean;
  resume: boolean;
  idleTimeoutMs: number;
  toolTextLimit: number;
  dshTools: boolean;
  fastMode: boolean;
  commandBridge: boolean;
  redactSecrets: boolean;
  persistTodos: boolean;
  debug: boolean;
  approvals: boolean;
  processIdleMs: number;
  maxProcesses: number;
  providerId: string;
  providerName: string;
};

/** Plugin name identifier. */
export const name = "dsh-oh-my-claude";
/** Services injected into the plugin by the dsh runtime. */
export const inject = ["llm", "sessions", "attachments", "agents", "approval", "userQuestions"];

/** Configuration schema for Claude Code plugin settings. */
export const Config = z.object({
  command: z
    .string()
    .default("claude")
    .description("Claude Code binary: a name on PATH or an absolute path"),
  spawn: z
    .union(["keeper", "node", "dsh"])
    .default("keeper")
    .description(
      "How the Claude Code process is started. 'keeper' (default): under a small keeper outside dsh's process tree (its own systemd user scope when available), so a dsh restart leaves Claude running and the new dsh reattaches. 'node': directly, as dsh's child. 'dsh': through dsh's subprocess seam (ctx.subprocess); with a remote provider such as a remote subprocess provider mounted, a remote workspace then runs Claude Code on that machine. The seam scrubs credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD), so log in on the machine that runs it",
    ),
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
    .description("Show Claude Code tool calls and results as native tool rows"),
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
  fastMode: z
    .boolean()
    .default(false)
    .description(
      "Launch each Claude process with fast mode enabled (--settings fastMode); the bridged /fast then toggles it per session",
    ),
  commandBridge: z
    .boolean()
    .default(true)
    .description(
      "Register Claude Code's slash commands (skills, custom commands) as dsh /commands that send the line to Claude",
    ),
  redactSecrets: z
    .boolean()
    .default(true)
    .description(
      "Mask values of env vars named *KEY, *TOKEN, *SECRET, *PASSWORD or *CREDENTIAL in Claude's tool results before they reach dsh",
    ),
  persistTodos: z
    .boolean()
    .default(true)
    .description(
      "Keep the todo list on screen across messages and resume (dsh clears it each turn by default)",
    ),
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
  configDir: z
    .string()
    .default("")
    .description(
      "Claude Code config dir for this plugin instance (exported as CLAUDE_CONFIG_DIR); empty = CLAUDE_CONFIG_DIR env or ~/.claude",
    ),
  providerId: z
    .string()
    .default("claude-code")
    .description(
      "Provider id; 'claude-code' is the default, anything starting with 'claude-code-' mounts a second instance",
    ),
  providerName: z
    .string()
    .default("")
    .description(
      "Display name for this instance in the model picker; empty = 'Oh My Claude' for the default id, else 'Oh My Claude (<suffix>)'",
    ),
});

/** Keys the shared process registry by instance so two mounts never see each other's processes. */
/** Outcome of a control request this plugin sent to the CLI; `response` is the CLI's payload. */
export type ControlReply =
  | { ok: true; error?: undefined; response?: JsonValue }
  | { ok: false; error: string; response?: undefined };
/** One user prompt of a session's transcript, as the Rewind list shows it. */
export interface RewindPrompt {
  id: string;
  time: number;
  text: string;
}
/** What `rewind_files` answers, plus whether the conversation was rewound too. */
export interface RewindReply extends Partial<RewindResult> {
  ok: boolean;
  dryRun: boolean;
}
/** What the permission-mode route reports: the mode in force and the stored override. */
export interface PermissionModeInfo {
  mode: string;
  override: string | null;
}
export interface PermissionModeReply extends PermissionModeInfo {
  /** A live process was told; false when the override only applies at the next spawn. */
  live: boolean;
  error?: string;
}

export function registryKey(providerId: string, sessionId: string): string {
  return `${providerId}:${sessionId}`;
}

const EFFORTS_ALL = ["low", "medium", "high", "xhigh", "max"] as const;
/** One effort level's capability flag, as the Models API reports it. */
type EffortLevelCaps = { supported?: boolean };
/** The effort capability block: an overall flag plus one flag per level. */
type EffortCaps = { supported?: boolean } & Partial<
  Record<(typeof EFFORTS_ALL)[number], EffortLevelCaps>
>;
const EFFORTS_45 = ["low", "medium", "high"];
const M = (id: string, label: string, contextWindow: number, efforts: readonly string[]) => ({
  provider: "claude-code",
  id,
  name: label,
  contextWindow,
  efforts,
});

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
const MAX_IMAGES = 20;
const TOOL_TEXT_LIMIT = 600;

// ---------------------------------------------------------------------------
// Model catalog

const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog = { at: 0, models: KNOWN_MODELS };

/**
 * Retrieves authentication headers for the Anthropic API, checking
 * environment variables and stored credentials.
 * @returns {Promise<object|null>} API auth headers or null if unavailable
 */
/**
 * Converts an Anthropic Models API response into the internal model format.
 * @param {object} m - Model metadata from the API
 * @returns {object} Internal model representation
 */
export function modelFromApi(m: {
  id?: string;
  display_name?: string;
  max_input_tokens?: number;
  capabilities?: { effort?: EffortCaps };
}): LlmModelInfo {
  const eff = m.capabilities?.effort;
  const efforts: string[] = eff?.supported ? EFFORTS_ALL.filter((l) => eff[l]?.supported) : [];
  return M(m.id ?? "", m.display_name ?? m.id ?? "", m.max_input_tokens ?? 200_000, efforts);
}

/**
 * Fetches or returns cached model catalog from Anthropic Models API.
 * Falls back to KNOWN_MODELS if the API is unreachable.
 * @param {Function} fetchImpl - Fetch implementation to use (default: global fetch)
 * @returns {Promise<Array>} Array of available models
 */
export async function getCatalog(fetchImpl = fetch) {
  if (Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.models;
  const headers = await authHeaders(CLAUDE_HOME);
  if (headers) {
    try {
      const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          ...headers,
          "anthropic-version": "2023-06-01",
        },
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

/**
 * Constructs base model information object with provider and modalities.
 * @param {string} provider - Provider identifier
 * @param {object} model - Model object with id and name
 * @returns {object} Model info with provider and inputModalities
 */
function modelInfo(provider: string, model: { id?: string; name?: string }) {
  return {
    provider,
    id: model.id ?? "",
    name: model.name ?? "",
    inputModalities: ["text", "image"] as const,
  };
}

/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export function resolveModelInfo(
  provider: string,
  modelId: string,
  models: ReturnType<typeof M>[] = catalog.models,
): LlmResolvedModelInfo {
  const pool = [...models, ...KNOWN_MODELS];
  const found = pool.find((m) => m.id === modelId) ?? pool.find((m) => m.id.startsWith(modelId));
  const info: LlmResolvedModelInfo = {
    ...modelInfo(provider, { id: modelId, name: found?.name ?? modelId }),
  };
  if (!found) return info;
  info.context = { contextWindow: found.contextWindow };
  if (found.efforts.length > 0) {
    info.reasoning = {
      // SAFETY: effort ids come from the CLI's own catalog; the brand marks provenance only
      efforts: found.efforts.map((id) => ({ id: id as ReasoningEffortId, name: id })),
    };
  }
  return info;
}

// ---------------------------------------------------------------------------
// Session mapping: one Claude Code session per dsh session

/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
export function claudeSessionId(sessionId: string): string {
  const h = createHash("sha256").update(`dsh-llm-claude:${sessionId}`).digest("hex");
  const variant = ((parseInt(h.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Checks if a Claude Code session transcript exists on disk.
 */
async function claudeSessionExists(home: string, cwd: string, id: string): Promise<boolean> {
  try {
    await access(join(home, "projects", projectDirName(cwd), `${id}.jsonl`));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Request assembly

/** The slice of a dsh message this adapter reads; dsh's own Message type is wider. */
/** The slice of a dsh message this adapter reads; exported for test fixtures. */
export type LooseMessage = {
  role?: string;
  source?: { kind?: string; plugin?: string; rpcId?: string };
  content?: string | ContentBlock[];
};

const textOf = (content: LooseMessage["content"]): string => {
  if (!Array.isArray(content)) return content ?? "";
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
};

const isTurn = (m: LooseMessage) =>
  (m.role === "user" && m.source?.kind !== "tool") || m.role === "assistant";

/**
 * Pick the messages that go into this call. Resuming: only what came after the last assistant turn
 * (the new prompt plus dsh's context injections). Fresh: the whole transcript, since `claude -p` is stateless.
 */
export function selectTurns(
  messages: LooseMessage[] | undefined,
  resuming: boolean,
): LooseMessage[] {
  const turns = (messages ?? []).filter(isTurn);
  if (!resuming) return turns;
  let last = -1;
  for (let i = 0; i < turns.length; i++) if (turns[i]?.role === "assistant") last = i;
  return turns.slice(last + 1);
}

/** dsh's instruction bundle repeats files Claude Code already loads on its own (`CLAUDE.md` in the
 *  workspace, `~/.claude/CLAUDE.md`), so those blocks are dropped from what goes to Claude. The
 *  bundle is one `<system-reminder>` with `Instructions from: <path>` headers; a block runs to
 *  the next header or the closing tag. Empty when nothing but the wrapper would remain. */
export function withoutNativeInstructions(text: string): string {
  const header = /^Instructions from: (.+)$/m;
  if (!header.test(text)) return text;
  const close = /\s*<\/system-reminder>\s*$/.exec(text);
  const body = close ? text.slice(0, close.index) : text;
  const pieces = body.split(/^(?=Instructions from: )/m);
  const kept = pieces.filter((p) => {
    const m = header.exec(p);
    return !m || !/(^|\/)CLAUDE\.md\s*$/.test((m[1] ?? "").trim());
  });
  if (kept.length === pieces.length) return text;
  if (!kept.some((p) => header.test(p))) return "";
  return kept.join("").trimEnd() + (close ? close[0] : "");
}

/** Prompt text of one dsh message, with Claude-native instruction files filtered out. */
const promptTextOf = (m: LooseMessage): string =>
  m.source?.kind === "agent-instructions"
    ? withoutNativeInstructions(textOf(m.content))
    : textOf(m.content);

/** Text body sent as the user prompt. Assistant turns get role labels so history stays legible. */
export function buildPrompt(turns: LooseMessage[]): string {
  const parts = turns
    .map((m) => ({ role: m.role, text: promptTextOf(m) }))
    .filter((t) => t.text !== "");
  if (!parts.some((t) => t.role === "user")) {
    // Attachment-only turn: the user sent an image (or other non-text block) with no typed
    // text. Images ride along separately via imageRefs, but Claude still needs a non-empty
    // prompt on stdin, so synthesize a minimal one rather than reject the whole turn.
    const hasUserAttachment = turns.some(
      (m) =>
        m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type !== "text"),
    );
    if (hasUserAttachment) return "(see attached)";
    throw new LlmError("no user message", "INVALID_REQUEST");
  }
  const multi = parts.some((t) => t.role === "assistant");
  return parts.map((t) => (multi ? `[${t.role}]\n${t.text}` : t.text)).join("\n\n");
}

/**
 * Extracts image attachment references from message turns.
 * Limits to the last MAX_IMAGES to avoid exceeding CLI limits.
 * @param {Array} turns - Message turns
 * @returns {Array} Image attachment references
 */
// Lightweight image ref shape; full ImageAttachmentRef from dsh-attachment has attachmentId too.
/** An image loaded from dsh's attachment store, ready for the stdin line. */
type LoadedImage = { mediaType: string; data: string; attachmentId?: string };

function imageRefs(turns: LooseMessage[]): ImageAttachmentRef[] {
  const refs: ImageAttachmentRef[] = [];
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
} as const satisfies Record<string, string>;
/** Claude permission mode for a dsh access mode, or undefined for one this table does not know. */
const modeForAccess = (accessMode: string): string | undefined =>
  // SAFETY: the key is checked against the table before it is used as its index
  Object.hasOwn(MODE_FOR_ACCESS, accessMode)
    ? MODE_FOR_ACCESS[accessMode as keyof typeof MODE_FOR_ACCESS]
    : undefined;

/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export function accessModeOf(messages: LooseMessage[] | undefined): string | undefined {
  let mode: string | undefined;
  for (const m of messages ?? []) {
    if (m.role !== "user") continue;
    const found = textOf(m.content).match(/Current DSH file policy: ([a-z-]+)/);
    if (found) mode = found[1];
  }
  return mode;
}

/**
 * Resolves the Claude Code permission mode based on configuration and
 * dsh access mode.
 * @param {object} config - Plugin configuration
 * @param {string} accessMode - dsh access mode
 * @returns {string} Permission mode for Claude Code
 */
export function permissionModeFor(
  config: Schemastery.TypeT<typeof Config>,
  accessMode: string | undefined,
): string {
  if (config.permissionMode !== "dsh") return config.permissionMode;
  return modeForAccess(accessMode ?? "") ?? "acceptEdits";
}

// ---------------------------------------------------------------------------
// CLI probe: Claude Code auto-updates itself, so flags are checked against `claude --help` once per
// process and anything missing is left out. Unknown = assume supported (probe failed, older CLI).

let cliProbe;
/**
 * Probes the Claude Code CLI to determine its version and supported flags.
 * Caches the result across multiple calls.
 * @param {Function} exec - execFile implementation (default: node's execFile)
 * @returns {Promise<object>} Object with flags Set and version string
 */
/** The slice of node's execFile the probe uses; tests hand in a fake with this shape. */
export type ExecLike = (
  cmd: string,
  args: string[],
  opts: { timeout: number },
  cb: (err: Error | null, stdout: string | Buffer) => void,
) => void;

// SAFETY: execFile's overloads include exactly this call shape; the alias only narrows them
export function probeCli(exec: ExecLike = execFile as ExecLike, command = "claude") {
  cliProbe ??= (async () => {
    const run = (args: string[]) =>
      new Promise<string>((resolve) => {
        exec(command, args, { timeout: 8000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
      });
    const [help, version] = await Promise.all([run(["--help"]), run(["--version"])]);
    const flags = new Set(help.match(/--[a-zA-Z-]+/g) ?? []);
    return { flags: flags.size > 0 ? flags : null, version: version.trim() || "unknown" };
  })();
  return cliProbe;
}

/**
 * Checks if a CLI flag is supported. Returns true if flags are unknown
 * (probe failed) to assume support.
 */
export const supports = (flags: Set<string> | null | undefined, flag: string) =>
  !flags || flags.has(flag);

/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export const usesStdin = (flags: Set<string> | null | undefined) =>
  supports(flags, "--input-format");

/**
 * Constructs command-line arguments for spawning a Claude Code process.
 * Handles model, effort, permissions, MCP config, and other flags.
 */
/**
 * Appended to the system prompt whenever dsh tools are bridged. Claude Code's own Agent tool
 * spawns children dsh cannot see (no card, no header count, no notice), so subagents must go
 * through the bridged tools. Routes are box-specific, hence the pointer to list_subagent_models.
 */
export const DSH_TOOLS_GUIDANCE = [
  "dsh tools are available as mcp__dsh__* over MCP. For any subagent, worker, helper or a",
  "specific model, use those and never the built-in Agent/Task tool: a native Agent child is",
  "invisible to dsh (no card, no header count, no completion notice, no transcript).",
  "mcp__dsh__subagent takes provider and model for a named route; mcp__dsh__list_subagent_models",
  "lists the allowed routes; omit both for the default. Other preset subagent tools",
  "(mcp__dsh__subagent_*, mcp__dsh__researcher_*) and mcp__dsh__subagent_fork are children",
  "too. run_in_background: false returns the answer inline; background returns an id and the",
  "notice arrives next turn. mcp__dsh__open_session makes a new top-level session, not a child.",
  "Long-running or background commands (test suites, builds, code reviews, watchers, anything you",
  "would run with `run_in_background`) go through `mcp__dsh__bash` with `run_in_background: true`;",
  "dsh registers the job, shows its card and panel entry, and the finish notice arrives next turn;",
  "read output with `mcp__dsh__job_output`, stop with `mcp__dsh__job_kill`. Short foreground",
  "commands stay on native `Bash`; do not use native `Bash` `run_in_background` because dsh cannot",
  "see it.",
].join(" ");

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
  temporary = false,
  permissionMode,
}: Pick<GenerateOptions, "reasoningEffort" | "system" | "purpose"> & {
  model: string | undefined;
  config: Schemastery.TypeT<typeof Config>;
  session?: { id: string; resuming: boolean } | undefined;
  accessMode?: string | undefined;
  flags?: Set<string> | null;
  promptText?: string;
  mcp?: { url: string; key: string } | undefined;
  /** /temporary: keep no Claude transcript for this session. */
  temporary?: boolean;
  /** Optional permission mode override; if provided, used instead of computing from config. */
  permissionMode?: string;
}) {
  const args = ["-p"];
  if (usesStdin(flags)) args.push("--input-format", "stream-json");
  else args.push(promptText ?? "");
  args.push("--output-format", "stream-json", "--verbose");
  if (supports(flags, "--include-partial-messages")) args.push("--include-partial-messages");
  if (supports(flags, "--forward-subagent-text")) args.push("--forward-subagent-text");
  if (model) args.push("--model", model);
  if (reasoningEffort && supports(flags, "--effort")) args.push("--effort", reasoningEffort);
  // In -p mode /fast only works in a session launched with fast mode in --settings (fast-mode docs).
  if (config.fastMode && supports(flags, "--settings"))
    args.push("--settings", JSON.stringify({ fastMode: true }));
  const appended = [system, mcp ? DSH_TOOLS_GUIDANCE : ""].filter(Boolean).join("\n\n");
  if (appended && supports(flags, "--append-system-prompt")) {
    args.push("--append-system-prompt", appended);
  }
  if (purpose) {
    // Auxiliary calls (title, compaction): one turn, no tools, no session of their own. Without
    // --no-session-persistence each one still leaves a transcript under the scratch project dir.
    args.push("--tools", "", "--max-turns", "1");
    if (supports(flags, "--no-session-persistence")) args.push("--no-session-persistence");
    return args;
  }
  if (temporary && supports(flags, "--no-session-persistence"))
    args.push("--no-session-persistence");
  if (supports(flags, "--permission-mode")) {
    const mode = permissionMode ?? permissionModeFor(config, accessMode);
    args.push("--permission-mode", mode);
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

/** One stream-json input line: the user turn with text and inline images. */
export function buildInput(
  prompt: string,
  images: Array<{ mediaType: string; data: string }>,
): string {
  const content: Array<{
    type: string;
    text?: string;
    source?: { type: string; media_type: string; data: string };
  }> = [{ type: "text", text: prompt }];
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

const clip = (s: string, n = TOOL_TEXT_LIMIT): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const DENIED_RE = /requires? approval|permission (was )?denied|not allowed/i;
/** Names from the CLI's init frame that dsh's command grammar accepts (lowercase, `[a-z0-9_-]`), deduped. */
export function commandNames(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) if (String(v) === v && /^[a-z0-9][a-z0-9_-]*$/.test(v)) out.add(v);
  return [...out];
}
/** Bridged Claude commands are registered as `/claude-<name>` in dsh. */
export const BRIDGE_PREFIX = "claude-";
const PLAN_APPROVE = "Approve";
const PLAN_KEEP = "Keep planning";
// Claude Code tool names → dsh tool name that the client-ui-tool presenter recognises.
// Unknown names fall through to the generic "others" row.
const NATIVE_TOOL_MAP = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Write: "write",
  Grep: "grep",
  Glob: "glob",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
} as const;
/** Every Claude Code tool except the dsh MCP relay gets a session row: mapped names pick the
 *  client's bash/read/edit presenters, the rest (TodoWrite, ToolSearch, Skill, mcp__*) the generic one. */
const isNativeTool = (toolName: string) => toolName !== "" && !toolName.startsWith("mcp__dsh__");

function usageEvent(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): StreamChunk {
  // dsh TokenUsage: inputTokens excludes cache hits; the three prompt counters plus output sum to totalTokens.
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const usage: TokenUsage = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + cacheRead + cacheWrite + output,
  };
  if (cacheRead) usage.cacheReadTokens = cacheRead;
  if (cacheWrite) usage.cacheWriteTokens = cacheWrite;
  return { type: "usage", usage };
}

export interface TurnRecord {
  at: number;
  costUsd: number;
  durationMs: number;
  apiMs: number;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The slice of a Claude process the idle watchdog needs. */
export interface IdleTarget {
  idleKilled: boolean;
  kill(): void;
  inject(event: ClaudeEvent): void;
}

/** Per-session ring buffer (last 50 turns) keyed by dsh sessionId, on the adapter instance. */
const TURN_RING = 50;

/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export function isStaleResume(event: ClaudeEvent): boolean {
  if (event?.type !== "result" || !event.is_error) return false;
  return /No conversation found/i.test(JSON.stringify(event.errors ?? event.result ?? ""));
}

/** A logged-out CLI: the -p mode text, or the API's 401 once a stored token has expired. */
const NOT_LOGGED_IN_RE =
  /not logged in|authentication_error|failed to authenticate|oauth .*invalid/i;

export function finishReason(result: {
  is_error?: boolean;
  stop_reason?: string;
  result?: unknown;
  errors?: unknown[];
  api_error_status?: number;
  subtype?: string;
}): FinishReason {
  if (result.is_error) {
    const errors = Array.isArray(result.errors) ? result.errors.join("; ") : "";
    let message = String(result.result ?? errors ?? result.subtype ?? "claude error");
    if (result.api_error_status === 401 || NOT_LOGGED_IN_RE.test(message))
      message = `Claude Code is not logged in on ${hostname()}. Run \`claude auth login\` in a terminal there, then send your message again. (${message})`;
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
/** The `kind` dsh's loop puts on an abort reason ("disposed" on shutdown), else undefined. */
function abortKind(signal: AbortSignal | undefined): string | undefined {
  if (!signal?.aborted) return undefined;
  const reason: unknown = signal.reason;
  if (reason instanceof Object && "kind" in reason && !Array.isArray(reason)) {
    const kind = reason.kind;
    return kind === "disposed" || kind === "aborted" || kind === "cancelled" ? kind : undefined;
  }
  return undefined;
}

/** dsh's tool-result for a relayed call, searched from the newest message back. */
export function toolResultFor(
  messages: LooseMessage[] | undefined,
  id: string,
): { text: string; isError?: boolean } | undefined {
  const list = messages ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!m || m.role !== "user" || m.source?.kind !== "tool" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool-result" && b.toolCallId === id)
        return { text: textOf(b.content), isError: b.isError === true };
    }
  }
  return undefined;
}

/** Messages dsh delivered after the last assistant step. */
export function afterLastAssistant(messages: LooseMessage[] | undefined): LooseMessage[] {
  const list = messages ?? [];
  let last = -1;
  for (let i = 0; i < list.length; i++) if (list[i]?.role === "assistant") last = i;
  return list.slice(last + 1);
}

/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export const WAKE_TEXT = "Claude Code finished a background task and replied.";
/** Sent as a real prompt after dsh restarts mid-turn: the process is gone, Claude must carry on. */
/** Sent when a restarted dsh reattaches to a Claude process that kept running meanwhile. */
export const RECONNECT_TEXT =
  "[Oh My Claude] dsh restarted and reattached to your still-running Claude Code process; what you did meanwhile is shown above. Continue where you are.";
export const RESTART_TEXT =
  "[Oh My Claude] dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task. If this session has an active goal, dsh disarmed it on resume: call get_goal, then update_goal with action resume, so the goal rounds keep driving the work without anyone typing.";
/** How long after boot to nudge interrupted sessions; dsh needs its sessions and agents loaded. */
const RESUME_DELAY_MS = 10_000;
const isWake = (m: LooseMessage) =>
  m.role === "user" &&
  m.source?.kind === "plugin" &&
  m.source.plugin === "dsh-oh-my-claude" &&
  textOf(m.content) === WAKE_TEXT;
/** A turn opened by our own wake notice, with no user prompt to send: only drain what Claude
 *  already wrote. A user prompt in the same batch takes precedence and is sent normally. */
export function wakeOnlyTurn(messages: LooseMessage[] | undefined): boolean {
  const fresh = afterLastAssistant(messages);
  return fresh.some(isWake) && !fresh.some((m) => m.source?.kind === "user");
}

/** Drop user messages Claude already received live on stdin (matched by the prompt's rpcId). */
export function dropSent<T extends LooseMessage>(
  messages: T[] | undefined,
  sent: Set<string> | undefined,
): T[] {
  if (!sent || sent.size === 0) return messages ?? [];
  return (messages ?? []).filter((m) => {
    const rpcId = m.source?.rpcId;
    return !(rpcId && sent.has(rpcId));
  });
}

/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. */
export function stepContextFor(messages: LooseMessage[] | undefined): string {
  const parts = [];
  for (const m of afterLastAssistant(messages)) {
    if (m.role !== "user") continue;
    if (m.source?.kind === "tool") continue;
    const text = promptTextOf(m);
    if (text) parts.push(text);
  }
  return parts.length === 0
    ? ""
    : `\n\n<user_messages_during_tool_call>\n${parts.join("\n\n")}\n</user_messages_during_tool_call>`;
}

// Re-export symbols so tests that import from adapter.ts can access them too.
export { PROCESS_REGISTRY, ADAPTER_CURRENT, RESUME_TIMER };
/** How long to wait for the rest of a parallel dsh tool-call batch after the first one arrives. */
const RELAY_BATCH_MS = 1500;
/** After asking the CLI to interrupt, how long before falling back to killing the process. */
const INTERRUPT_GRACE_MS = 5000;

/** Count the human prompts dsh has in a transcript (context injections and tool results excluded). */
export function userPromptCount(messages: LooseMessage[] | undefined): number {
  return (messages ?? []).filter((m) => m.role === "user" && m.source?.kind === "user").length;
}

/** The stream chunks that make one relayed dsh tool call a native tool-call block. */
export function* relayBlocks(tr: Translator, call: RelayEvent): IterableIterator<StreamChunk> {
  const index = tr.index++;
  const args = JSON.stringify(call.args ?? {});
  // SAFETY: ToolCallId is a branded string, cast from plain string
  yield { type: "block-start", index, blockType: "tool-call" as ContentBlockType };
  yield {
    type: "tool-call-delta",
    index,
    // SAFETY: relay ids are minted by this plugin (randomUUID); the brand marks provenance only
    id: call.id as ToolCallId,
    name: call.name,
    argumentsDelta: args,
  };
  yield {
    type: "block-end",
    index,
    block: {
      type: "tool-call",
      // SAFETY: same minted id as the delta above
      id: call.id as ToolCallId,
      name: call.name,
      arguments: args,
    },
  };
}

// Top-level CLI event types we knowingly swallow (protocol/handshake, not renderable content).
// Anything not here and not handled in translate() is a stream-json schema drift worth one warning.
const BENIGN_EVENTS = new Set([
  "system",
  "control_request",
  "control_cancel_request",
  "control_response",
  "timeout",
  "dsh_relay",
]);
// stream_event sub-types with no renderable delta (SSE bookkeeping).
const BENIGN_PARTIALS = new Set(["message_delta", "message_stop", "ping"]);

export interface TranslatorBlock {
  index: number;
  blockType: string;
  text: string;
  started: boolean;
  tool?: boolean;
}

export class Translator {
  log: (level: string, msg: string) => void;
  unknownSeen: Set<string>; // (where:type) already warned, so schema drift warns once, not per event
  toolActivity: boolean;
  relay: boolean; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
  dshIds: Set<string>; // tool_use ids of dsh tools called over the MCP bridge
  dshNames: Map<string, string>; // dsh tool_use id → tool name, for a fallback row
  relayed: Set<string>; // dsh tool_use ids dsh ran natively; results not drawn here
  limit: number;
  index: number;
  open: Map<number, TranslatorBlock>; // api block index → { index, blockType, text }
  sawPartial: boolean;
  finished: boolean;
  denied: number; // tool calls Claude Code refused because a non-interactive run cannot ask
  toolPending: boolean; // a tool_use block closed and its result has not arrived yet
  aborting: boolean; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
  /** Injected: append tool/call to the dsh session for a native Claude Code tool. */
  onToolCall?: (callId: string, name: string, args: string) => number | undefined;
  /** Injected: append tool/result to the dsh session for a native Claude Code tool. */
  onToolResult?: (callId: string, text: string, isError: boolean, meta?: object) => void;
  /** Injected: fire per-turn accounting summary from the result frame. */
  onResult?: (summary: TurnRecord) => void;
  /** Injected: mask secret values in tool results before they are shown or appended. */
  redact?: (s: string) => string;
  /** Injected: the CLI's slash-command catalog from its init frame. */
  onInit?: (commands: string[]) => void;
  /** callId → original input JSON string, kept so Edit can build meta.diffs from it. */
  readonly callInputs = new Map<string, string>();
  /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
  readonly firedCalls = new Map<string, number>();

  /**
   * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
   * reach the same tool_use block; a second append gives the client two `tool/call` starts for
   * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
   */
  private fireToolCall(callId: string, toolName: string, input: string): number | undefined {
    const seen = this.firedCalls.get(callId);
    if (seen !== undefined) return seen;
    const seq = this.onToolCall?.(callId, toolName, input);
    if (seq !== undefined) {
      this.firedCalls.set(callId, seq);
      this.callInputs.set(callId, input);
    }
    return seq;
  }

  constructor({
    toolActivity = true,
    toolTextLimit = TOOL_TEXT_LIMIT,
    relay = false,
    dshIds,
    relayed,
    log,
    onToolCall,
    onToolResult,
    onResult,
    redact,
    onInit,
  }: {
    toolActivity?: boolean;
    toolTextLimit?: number;
    relay?: boolean;
    dshIds?: Set<string>;
    relayed?: Set<string>;
    log?: (level: string, msg: string) => void;
    onToolCall?: (callId: string, name: string, args: string) => number | undefined;
    onToolResult?: (callId: string, text: string, isError: boolean, meta?: object) => void;
    onResult?: (summary: TurnRecord) => void;
    redact?: (s: string) => string;
    onInit?: (commands: string[]) => void;
  } = {}) {
    this.log = log ?? (() => {});
    this.unknownSeen = new Set(); // (where:type) already warned, so schema drift warns once, not per event
    this.toolActivity = toolActivity;
    this.relay = relay; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
    this.dshIds = dshIds ?? new Set(); // tool_use ids of dsh tools called over the MCP bridge
    this.dshNames = new Map(); // dsh tool_use id → tool name, for a fallback row
    this.relayed = relayed ?? new Set(); // dsh tool_use ids dsh ran natively; results not drawn here
    this.limit = toolTextLimit;
    this.index = 0;
    this.open = new Map(); // api block index → { index, blockType, text }
    this.sawPartial = false;
    this.finished = false;
    this.denied = 0; // tool calls Claude Code refused because a non-interactive run cannot ask
    this.toolPending = false; // a tool_use block closed and its result has not arrived yet
    this.aborting = false; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
    this.onToolCall = onToolCall;
    this.onToolResult = onToolResult;
    this.onResult = onResult;
    this.redact = redact;
    this.onInit = onInit;
  }

  deltaType(block: TranslatorBlock): "text-delta" | "reasoning-delta" {
    return block.blockType === "text" ? "text-delta" : "reasoning-delta";
  }

  /** Warn once when a CLI event/block type is neither handled nor knowingly ignored, so a Claude
   *  Code stream-json schema change shows up loud in the log instead of as silently dropped output. */
  noteUnknown(where: string, type: string | null | undefined) {
    if (type === null || type === undefined) return;
    const key = `${where}:${type}`;
    if (this.unknownSeen.has(key)) return;
    this.unknownSeen.add(key);
    this.log(
      "warn",
      `unhandled Claude Code ${where} "${type}" — stream-json schema may have changed`,
    );
  }

  /** A block is announced on its first text. Claude emits thinking blocks that carry only a
   *  signature and never any text; announcing those eagerly draws an empty bubble. */
  startBlock(blockType: string, prefix = "") {
    const block: TranslatorBlock = { index: this.index++, blockType, text: "", started: false };
    return { block, events: prefix ? this.delta(block, prefix) : [] };
  }

  /** Text for a block, with its block-start ahead of the first non-empty piece. Empty in, empty out. */
  delta(block: TranslatorBlock, text: string): StreamChunk[] {
    if (!text) return [];
    block.text += text;
    const events: StreamChunk[] = [];
    if (!block.started) {
      block.started = true;
      // SAFETY: blocks are opened with "text", "reasoning" or "tool-call"; hidden ones never announce
      events.push({
        type: "block-start",
        index: block.index,
        blockType: block.blockType as ContentBlockType,
      });
    }
    events.push({ type: this.deltaType(block), index: block.index, text });
    return events;
  }

  /** Close a block; one that never got text was never announced and closes silently. */
  endBlock(block: TranslatorBlock): StreamChunk[] {
    if (!block.started) return [];
    return [
      {
        type: "block-end",
        index: block.index,
        block:
          block.blockType === "text"
            ? { type: "text", text: block.text }
            : { type: "reasoning", text: block.text },
      },
    ];
  }

  wholeBlock(blockType: string, text: string): StreamChunk[] {
    const { block, events } = this.startBlock(blockType);
    events.push(...this.delta(block, text), ...this.endBlock(block));
    return events;
  }

  translate(event: ClaudeEvent): StreamChunk[] {
    switch (event?.type) {
      case "system": {
        if (event.subtype === "init") {
          const names = commandNames(event.slash_commands);
          if (names.length > 0) this.onInit?.(names);
          return [];
        }
        // Compaction opens with a `status:"compacting"` frame, then a long silent stretch while the
        // CLI summarizes, then `compact_boundary` when done. Announce the start at once so the silence
        // is explained; the boundary line reports the result. A failed run gets neither boundary nor a
        // start it can pair with, so surface its error here. All of it rides the reasoning lane so it
        // reads as model activity in the UI, not as chat text the model appears to have typed.
        if (event.subtype === "status") {
          if (event.status === "compacting")
            return this.wholeBlock("reasoning", "⟳ Compacting context…");
          if (event.compact_result === "failed")
            return this.wholeBlock(
              "reasoning",
              `⚠ Compaction failed: ${event.compact_error || "unknown reason"}`,
            );
          return [];
        }
        // Auto-memory traffic: one line each way, so the Memory button's count is explained.
        if (event.subtype === "memory_saved") {
          const paths = event.written_paths ?? [];
          const names = paths.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ");
          return this.wholeBlock(
            "reasoning",
            `${event.verb ?? "Saved"} ${paths.length} ${paths.length === 1 ? "memory" : "memories"}${names ? `: ${names}` : ""}`,
          );
        }
        if (event.subtype === "memory_recall") {
          const n = event.memories?.length ?? 0;
          return n > 0
            ? this.wholeBlock("reasoning", `Recalled ${n} ${n === 1 ? "memory" : "memories"}`)
            : [];
        }
        // Claude Code compacted its own context (auto or /compact). One line so the user knows
        // why the model may have lost detail; every other system subtype is handshake noise.
        if (event.subtype !== "compact_boundary") return [];
        const meta = event.compact_metadata ?? {};
        const how = meta.trigger === "manual" ? "manual" : "auto";
        const size = Number.isFinite(meta.pre_tokens) ? `, ${meta.pre_tokens} tokens before` : "";
        return this.wholeBlock("reasoning", `✓ Context compacted by Claude Code (${how}${size})`);
      }
      case "stream_event":
        return this.partial(event.event ?? { type: "" });
      case "assistant":
        return this.assistant(event.message?.content ?? [], event.parent_tool_use_id);
      case "user":
        return this.toolResults(event.message?.content ?? [], event.parent_tool_use_id);
      case "result": {
        this.finished = true;
        const events: StreamChunk[] = [];
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
        // Per-turn accounting: forward the summary to the adapter's ring buffer.
        // SAFETY: these fields are emitted by the Claude Code CLI on the result frame; they may not be in every schema version
        const e = event as {
          total_cost_usd?: unknown;
          duration_ms?: unknown;
          duration_api_ms?: unknown;
          num_turns?: unknown;
        };
        const totalCost = Number(e.total_cost_usd);
        const durationMs = Number(e.duration_ms);
        const apiMs = Number(e.duration_api_ms);
        if (Number.isFinite(totalCost) || Number.isFinite(durationMs)) {
          this.onResult?.({
            at: Date.now(),
            costUsd: Number.isFinite(totalCost) ? totalCost : 0,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            apiMs: Number.isFinite(apiMs) ? apiMs : 0,
            turns: Number.isFinite(Number(e.num_turns)) ? Number(e.num_turns) : 0,
            input: event.usage?.input_tokens ?? 0,
            output: event.usage?.output_tokens ?? 0,
            cacheRead: event.usage?.cache_read_input_tokens ?? 0,
            cacheWrite: event.usage?.cache_creation_input_tokens ?? 0,
          });
        }
        events.push({
          type: "finish",
          reason: this.aborting
            ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
            : finishReason(event),
        });
        return events;
      }
      case "rate_limit_event": {
        // Emitted on every run. Status is allowed | allowed_warning | rejected (SDK types);
        // only "rejected" is a limit. allowed_warning means "near the cap", the turn goes on.
        // Treating it as an error ended turns early and dsh's retry re-sent the prompt.
        const info = event.rate_limit_info ?? {};
        const status = info.status ?? "allowed";
        if (status !== "rejected") return [];
        this.finished = true;
        const resetMs = Number.isFinite(info.resetsAt)
          ? (info.resetsAt ?? 0) * 1000 - Date.now()
          : 0;
        const failure: LlmFailure & { providerRetryAfterMs?: number } = {
          message: `Rate limited (${status})`,
          code: "RATE_LIMIT",
        };
        if (resetMs > 0) failure.providerRetryAfterMs = resetMs;
        return [{ type: "finish", reason: { kind: "error", failure } }];
      }
      default:
        if (!BENIGN_EVENTS.has(event?.type)) this.noteUnknown("event", event?.type);
        return [];
    }
  }

  // SAFETY: ev is ClaudeStreamPartial from Claude Code stream-json protocol
  partial(ev: ClaudeStreamPartial) {
    switch (ev.type) {
      case "message_start":
        this.sawPartial = true;
        this.toolPending = false;
        this.open.clear();
        return [];
      case "content_block_start":
        return this.openBlock(ev.index ?? -1, ev.content_block ?? {});
      case "content_block_delta": {
        const block = this.open.get(ev.index ?? -1);
        // Hidden native-tool blocks still need their input JSON accumulated.
        const apiIndex = ev.index ?? -1;
        const cbMeta = this.cbMeta.get(apiIndex);
        if (cbMeta && ev.delta?.partial_json !== undefined) {
          const partial = ev.delta?.partial_json ?? "";
          // Store accumulated input on the meta so content_block_stop can emit tool/call.
          if (!cbMeta.id) return [];
          const existing = this.callInputs.get(cbMeta.id);
          this.callInputs.set(cbMeta.id, (existing ?? "") + partial);
          return [];
        }
        if (!block || block.index < 0) return [];
        const d = ev.delta ?? {};
        const text = d.text ?? d.thinking ?? d.partial_json ?? "";
        return this.delta(block, text);
      }
      case "content_block_stop": {
        const block = this.open.get(ev.index ?? -1);
        if (!block) return [];
        const apiIndex = ev.index ?? -1;
        // For native tools, emit tool/call now that the input is complete.
        const cbMeta = this.cbMeta.get(apiIndex);
        if (cbMeta?.id && this.onToolCall) {
          this.cbMeta.delete(apiIndex);
          // Hidden blocks accumulate input via callInputs in the delta handler; live blocks use block.text.
          const input = this.callInputs.get(cbMeta.id) ?? block.text;
          if (input) {
            // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
            const mapped =
              NATIVE_TOOL_MAP[(cbMeta.name ?? "") as keyof typeof NATIVE_TOOL_MAP] ??
              cbMeta.name ??
              "";
            this.fireToolCall(cbMeta.id, mapped, input);
          }
        }
        this.open.delete(apiIndex);
        // A finished tool_use block means the CLI is now running that tool: no stream events until
        // its result arrives, however long it takes. Callers read this to pause their idle timer.
        this.toolPending = block.tool === true;
        return block.index < 0 ? [] : this.endBlock(block);
      }
      default:
        if (!BENIGN_PARTIALS.has(ev?.type)) this.noteUnknown("stream event", ev?.type);
        return [];
    }
  }

  /** Tracks content_block metadata for native-tool blocks whose input we collect via deltas. */
  readonly cbMeta = new Map<number, { id?: string; name?: string }>();

  openBlock(apiIndex: number, cb: { type?: string; id?: string; name?: string }) {
    let opened: { block: TranslatorBlock; events: StreamChunk[] };
    if (cb.type === "text") opened = this.startBlock("text");
    else if (cb.type === "thinking") opened = this.startBlock("reasoning");
    else if (cb.type === "tool_use") {
      const toolName = cb.name ?? "";
      const dsh = toolName.startsWith("mcp__dsh__");
      if (dsh && cb.id) {
        this.dshIds.add(cb.id);
        this.dshNames.set(cb.id, toolName.slice("mcp__dsh__".length));
      }
      // Native tools get a dsh session row; hide the reasoning-lane block entirely.
      if (isNativeTool(toolName) && this.onToolCall && cb.id) {
        this.cbMeta.set(apiIndex, { id: cb.id, name: toolName });
        this.open.set(apiIndex, {
          index: -1,
          blockType: "hidden",
          text: "",
          started: false,
          tool: true,
        });
        return [];
      }
      if (!this.toolActivity || (dsh && this.relay)) {
        this.open.set(apiIndex, {
          index: -1,
          blockType: "hidden",
          text: "",
          started: false,
          tool: true,
        });
        return [];
      }
      opened = this.startBlock(...this.toolLead(cb));
      opened.block.tool = true;
    } else {
      this.noteUnknown("content block", cb.type);
      return [];
    }
    this.open.set(apiIndex, opened.block);
    return opened.events;
  }

  assistant(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined) {
    // Claude Code subagent output (--forward-subagent-text) arrives as whole messages tagged with the
    // parent tool id; it never comes as partials, so it is always rendered, folded into reasoning.
    if (parentToolUseId) {
      if (!this.toolActivity) return [];
      const text = content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n");
      return text ? this.wholeBlock("reasoning", `↳ subagent\n${clip(text, this.limit)}`) : [];
    }
    if (this.sawPartial) return []; // already streamed as deltas
    const events: StreamChunk[] = [];
    for (const b of content) {
      if (b.type === "text" && b.text) events.push(...this.wholeBlock("text", b.text));
      else if (b.type === "thinking" && b.thinking)
        events.push(...this.wholeBlock("reasoning", b.thinking));
      else if (b.type === "tool_use") {
        const toolName = b.name ?? "";
        const dsh = toolName.startsWith("mcp__dsh__");
        if (dsh) {
          this.dshIds.add(b.id);
          this.dshNames.set(b.id, toolName.slice("mcp__dsh__".length));
        }
        // Native tools render as session rows; skip the reasoning-lane block.
        if (isNativeTool(toolName) && this.onToolCall && b.id) {
          const args = JSON.stringify(b.input ?? {});
          // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
          const mapped = NATIVE_TOOL_MAP[toolName as keyof typeof NATIVE_TOOL_MAP] ?? toolName;
          this.fireToolCall(b.id, mapped, args);
          continue;
        }
        if (!this.toolActivity || (dsh && this.relay)) continue;
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
  toolLead(cb: { id?: string; name?: string }): [string, string] {
    const toolName = cb.name ?? "";
    if (toolName.startsWith("mcp__dsh__")) {
      if (cb.id) this.dshIds.add(cb.id);
      return ["text", `⤷ ${toolName.slice("mcp__dsh__".length)} `];
    }
    return ["reasoning", `▶ ${cb.name} `];
  }

  toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined) {
    this.toolPending = false;
    if (!this.toolActivity) return [];
    const events: StreamChunk[] = [];
    for (const b of content) {
      if (b.type !== "tool_result") continue;
      const rawText = toolResultText(b).trim();
      const raw = this.redact ? this.redact(rawText) : rawText;
      if (b.is_error && DENIED_RE.test(raw)) this.denied++;
      const body = clip(raw || "(empty)", this.limit);
      const tag = parentToolUseId ? "↳ " : "";
      const toolUseId = b.tool_use_id ?? "";
      const dsh = this.dshIds.delete(toolUseId);
      if (dsh && this.relayed.delete(toolUseId)) continue; // dsh drew the native call and result
      // Native tool result: append a dsh session row, skip reasoning text.
      if (this.onToolResult && !this.callInputs.has(toolUseId)) {
        // Not a native tool we tracked — fall through to old behaviour.
      } else if (this.onToolResult && this.callInputs.has(toolUseId)) {
        const argsJson = this.callInputs.get(toolUseId)!;
        let meta: object | undefined;
        try {
          // SAFETY: argsJson was produced by Claude's tool_use input and stored verbatim; the shape is trusted here
          interface EditCallInput {
            file_path: string;
            old_string: string;
            new_string: string;
          }
          // SAFETY: JSON.parse output cast to EditCallInput; fields validated below with truthiness checks
          const inp = JSON.parse(argsJson) as EditCallInput;
          if (inp.file_path && inp.old_string && inp.new_string) {
            meta = {
              diffs: [{ path: inp.file_path, oldText: inp.old_string, newText: inp.new_string }],
            };
          }
        } catch {
          // ignore malformed input JSON
        }
        try {
          this.onToolResult(toolUseId, raw, b.is_error ?? false, meta);
        } catch (err) {
          this.log("warn", `native tool result append failed: ${err}`);
          // fall through to render reasoning text as before
        }
        continue;
      }
      const toolName = this.dshNames.get(toolUseId);
      this.dshNames.delete(toolUseId);
      // A dsh call that could not be relayed ran inside the bridge: show it as one compact row.
      const lead = dsh && this.relay ? `⤷ ${toolName ?? "dsh tool"} (ran in bridge)\n` : "";
      events.push(
        ...this.wholeBlock(
          dsh ? "text" : "reasoning",
          `${lead}${tag}${dsh ? "⤶" : "◀"} ${b.is_error ? "error" : "result"}\n${body}`,
        ),
      );
    }
    return events;
  }
}

// ---------------------------------------------------------------------------
// Adapter

const specKey = (spec: ClaudeProcessSpec) => JSON.stringify(spec);

export class ClaudeCodeAdapter extends LlmAdapter {
  ctx: PluginContext;
  config: Schemastery.TypeT<typeof Config>;
  subprocess?: Pick<SubprocessRuntime, "spawn">;
  processes: Map<string, ClaudeProcess>;
  mcp?: { base: string; key: string };
  warnedNoSeam = false;
  loggedVersion = false;
  sessionController?: SessionController;
  /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
  readonly redact: ((s: string) => string) | undefined;
  /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
  readonly temporary: Set<string>;
  /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
   *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
  readonly turnBuffer: Map<string, TurnRecord[]>;
  /** Per-session idle watchdog deadline in epoch ms; null means no active arm. */
  readonly idleDeadlineMap = new Map<string, number | null>();
  /** Per-session kill and warning timers, keyed by session id. */
  readonly idleKillTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly idleWarnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** What each armed key watches, so a route can re-arm it. */
  readonly idleTargets = new Map<string, { proc: IdleTarget; warn: boolean }>();
  /** Per-session permission mode overrides; loaded from disk at init, saved on change. */
  permissionModes: Map<string, string | null>;
  /** dsh access mode seen on each session's last turn, so the effective mode can be reported. */
  accessModes: Map<string, string | undefined>;
  /** Callers waiting for the CLI's `control_response` to a request this plugin sent, by request id. */
  controlWaiters: Map<string, (reply: ControlReply) => void>;
  claudeHome: string;
  providerId: string;
  displayName: string;
  settingsNs: string;
  stateDir: string;
  constructor(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>) {
    super();
    this.ctx = ctx;
    this.config = config;
    this.providerId = config.providerId;
    // SAFETY: regex only matches 'claude-code' or 'claude-code-…'; the string shape is enforced by the schema default
    if (!/^claude-code(-.+)?$/.test(this.providerId)) {
      throw new Error(
        `invalid providerId "${this.providerId}": must be 'claude-code' or start with 'claude-code-'`,
      );
    }
    this.claudeHome = resolveClaudeHome(config.configDir);
    this.redact = config.redactSecrets ? buildRedactor(process.env) : undefined;
    this.displayName =
      config.providerName ||
      (this.providerId === "claude-code"
        ? "Oh My Claude"
        : `Oh My Claude (${this.providerId.slice("claude-code".length).slice(1)})`);
    this.settingsNs = `llm-${this.providerId}`;
    this.stateDir = stateDir(this.providerId);
    this.permissionModes = new Map(); // loaded async below; fire-and-forget
    this.accessModes = new Map();
    this.controlWaiters = new Map();
    loadPermissionModes(this.stateDir)
      .then((modes) => {
        this.permissionModes = modes;
      })
      .catch(() => {}); // state is an optimization only
    this.warnedNoSeam = false;
    this.loggedVersion = false;
    // Kept on globalThis so a hot reload of this plugin adopts the running Claude processes
    // instead of orphaning them: their pipes belong to this node process, not to the plugin scope.
    // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
    const registry = globalThis as typeof globalThis & {
      [PROCESS_REGISTRY]?: Map<string, ClaudeProcess>;
      [TURN_RECORDS]?: Map<string, TurnRecord[]>;
      [TEMPORARY_SESSIONS]?: Set<string>;
    };
    this.processes = registry[PROCESS_REGISTRY] ??= new Map(); // providerId:sessionId → ClaudeProcess
    this.turnBuffer = registry[TURN_RECORDS] ??= new Map();
    this.temporary = registry[TEMPORARY_SESSIONS] ??= new Set();
    // Adopted processes still point their idle-reply callback at the previous (now dead) adapter.
    for (const [key, proc] of this.processes) {
      if (!key.startsWith(`${this.providerId}:`)) continue; // another mount's process, not ours
      const sessionId = key.slice(this.providerId.length + 1);
      proc.onIdleResult = () => this.wake(sessionId, proc);
    }
    // Steers: dsh only delivers them at step boundaries, and a Claude turn has none of its own.
    // Forward them to Claude's stdin as they arrive; the CLI injects them at its next tool call.
    ctx.on?.("session/event", (sessionArg, eventArg) => {
      // SAFETY: dsh's session/event carries (session, event); only the spliced-inbox fields are read
      const session = sessionArg as { id?: string };
      // SAFETY: same event object, narrowed to the agent/inbox/spliced shape this handler reads
      const event = eventArg as SpliceEvent;
      if (event?.type !== "agent/inbox/spliced" || event.data?.target !== "next-step") return;
      const proc = this.processes.get(registryKey(this.providerId, session?.id ?? ""));
      if (!proc?.alive || !proc.busy || proc.relays.size > 0) return;
      for (const m of event.data?.inserted ?? []) {
        const src = m.source;
        const rpcId = src?.rpcId;
        if (m.role !== "user" || src?.kind !== "user" || !rpcId) continue;
        const text = textOf(m.content);
        if (!text) continue;
        // ponytail: text only; a steer with images waits for the boundary like before.
        if (proc.write(buildInput(text, []))) {
          proc.sent.add(rpcId);
          proc.steerPending = true;
        }
      }
    });
  }

  override providerInfo(provider: string) {
    return { id: provider, name: this.displayName };
  }

  override async listModels(provider: string) {
    return (await getCatalog()).map((m) => modelInfo(provider, m));
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal) {
    return resolveModelInfo(provider, model, await getCatalog());
  }

  /** Get the effective permission mode for a session, checking for an override first. */
  getPermissionMode(sessionId: string, accessMode: string | undefined): string {
    const override = this.permissionModes.get(sessionId);
    if (override !== undefined && override !== null) return override;
    return permissionModeFor(this.config, accessMode);
  }

  sessionCwd(sessionId: string): string | undefined {
    try {
      return this.ctx.sessions.get(asSessionId(sessionId))?.header?.cwd;
    } catch {
      return undefined;
    }
  }

  log(level: string, message: string) {
    try {
      this.ctx.logger[level]?.(`dsh-oh-my-claude: ${message}`);
    } catch {
      // cordis throws on service access from an inactive scope; a log line is not worth that
    }
  }

  async loadImages(
    refs: ImageAttachmentRef[],
    signal: AbortSignal | undefined,
  ): Promise<LoadedImage[]> {
    const store = this.ctx.attachments;
    if (!store || refs.length === 0) return [];
    const out: LoadedImage[] = [];
    for (const ref of refs) {
      try {
        const stored = await store.readImage(ref, signal);
        out.push({
          mediaType: ref.mediaType,
          data: Buffer.from(stored.data).toString("base64"),
          attachmentId: ref.attachmentId,
        });
      } catch (error: unknown) {
        this.log(
          "warn",
          `skipping image ${ref.attachmentId ?? "unknown"}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return out;
  }

  /** A dsh fork of a Claude session becomes a Claude fork: the parent's transcript is copied under
   *  the new id, cut at the forked turn. True when a copy was made. */
  async forkTranscript(options: GenerateOptions, cwd: string, id: string): Promise<boolean> {
    let header;
    try {
      header = options.sessionId ? this.ctx.sessions.get(options.sessionId)?.header : undefined;
    } catch {
      return false;
    }
    const parentId = header?.parentSession;
    if (!parentId || header?.origin === "subagent") return false;
    const parentCwd = this.sessionCwd(parentId) ?? cwd;
    const parentClaude = (await claudeSessionExists(this.claudeHome, parentCwd, parentId))
      ? parentId
      : claudeSessionId(parentId);
    let text;
    try {
      text = await readFile(
        join(this.claudeHome, "projects", projectDirName(parentCwd), `${parentClaude}.jsonl`),
        "utf8",
      );
    } catch {
      return false;
    }
    // ponytail: prompt counting assumes one Claude prompt per dsh user turn; a turn dsh skipped
    // as already-forwarded (see dropSent) shifts the cut by one.
    const keep =
      userPromptCount(options.messages) - userPromptCount(afterLastAssistant(options.messages));
    const dest = join(this.claudeHome, "projects", projectDirName(cwd), `${id}.jsonl`);
    try {
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, forkTranscriptText(text, parentClaude, id, keep));
    } catch (error) {
      this.log("warn", `fork transcript copy failed: ${errorText(error)}`);
      return false;
    }
    await rememberStarted(id, true);
    this.log("info", `forked claude session ${parentClaude} -> ${id} (${keep} prompts kept)`);
    return true;
  }

  /** Everything one turn needs: spawn args + spec for the long-lived process, and the stdin line for this turn. */
  // SAFETY: options shape from dsh LlmAdapter.generate() contract
  async prepare(
    options: GenerateOptions,
    { forceFresh = false }: { forceFresh?: boolean } = {},
  ): Promise<TurnPrep> {
    const cli = await probeCli(execFile, this.config.command);
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
    const temporary = Boolean(options.sessionId) && this.temporary.has(options.sessionId ?? "");
    if (!options.purpose && this.config.resume && options.sessionId && !temporary) {
      // A dsh session opened from a Claude Code transcript carries the Claude id itself.
      const own = await claudeSessionExists(this.claudeHome, cwd, options.sessionId);
      const id = own ? options.sessionId : claudeSessionId(options.sessionId);
      let known =
        own ||
        (await loadStarted()).has(id) ||
        (await claudeSessionExists(this.claudeHome, cwd, id));
      if (!known && !forceFresh) known = await this.forkTranscript(options, cwd, id);
      session = { id, resuming: known && !forceFresh };
    }
    const turns = selectTurns(options.messages, session?.resuming ?? false);
    const prompt = buildPrompt(turns);
    const stdin = usesStdin(cli.flags);
    const images = stdin ? await this.loadImages(imageRefs(turns), options.signal) : [];
    const model = options.purpose === "session-title" ? this.config.titleModel : options.model;
    const accessMode = accessModeOf(options.messages);
    if (options.sessionId) this.accessModes.set(options.sessionId, accessMode);
    const effectivePermissionMode = options.sessionId
      ? this.getPermissionMode(options.sessionId, accessMode)
      : undefined;
    const args = buildArgs({
      ...options,
      model,
      config: this.config,
      session,
      accessMode,
      flags: cli.flags,
      promptText: prompt,
      temporary,
      permissionMode: effectivePermissionMode,
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
      mode: effectivePermissionMode ?? permissionModeFor(this.config, accessMode),
      sessionId: session?.id ?? null,
      temporary,
    };
    return {
      cwd,
      args,
      session,
      spec,
      accessMode,
      input: stdin ? buildInput(prompt, images) : null,
    };
  }

  /** Claude slash commands already registered as dsh commands, name → disposer. */
  readonly bridged = new Map<string, () => void>();

  /**
   * Register Claude Code's slash commands (from the CLI's init frame) as dsh `/commands`. The
   * handler hands the line to Claude as the next prompt, where the CLI expands the skill or
   * custom command the way the terminal does; dsh keeps its own command of the same name.
   */
  bridgeCommands(names: string[], agent: Agent | undefined) {
    // Optional service: cordis rejects `ctx.commands` unless it is in `inject`; `get` does not.
    const commands = this.ctx?.get("commands");
    if (!this.config.commandBridge || this.providerId !== "claude-code" || !commands) return;
    // SAFETY: a plain slot on globalThis, written only here
    (globalThis as { [COMMAND_CATALOG]?: string[] })[COMMAND_CATALOG] = names;
    const failed: string[] = [];
    for (const cmd of names) {
      if (this.bridged.has(cmd)) continue;
      // Prefixed on the dsh side: dsh's command menu throws when a host command name collides
      // with a client-side contribution, and Claude's catalog is 200 names long (2026-09-05, the
      // whole menu went blank). The line handed to Claude keeps the bare name.
      const dshName = `${BRIDGE_PREFIX}${cmd}`;
      if (agent && commands.find(agent, dshName) !== undefined) continue;
      try {
        const dispose = commands.register({
          name: dshName,
          description: `Claude Code /${cmd}`,
          input: { hint: "<arguments>" },
          handler: ({ agent: target, rawInput }) => {
            const line = `/${cmd}${rawInput}`;
            target.followup(
              createUserMessage({
                content: [{ type: "text", text: line }],
                source: {
                  kind: "plugin",
                  plugin: "dsh-oh-my-claude",
                  form: "notice",
                  summary: boundContextSummary(line),
                },
              }),
            );
            return { kind: "success", text: `${line} sent to Claude Code` };
          },
        });
        this.bridged.set(cmd, dispose);
      } catch (error) {
        failed.push(`/${cmd}: ${errorText(error)}`);
      }
    }
    if (failed.length > 0)
      this.log(
        "warn",
        `command bridge: ${failed.length} of ${names.length} not registered (first: ${failed[0]})`,
      );
    this.registerTemporaryCommand(commands);
  }

  /** The effective mode for a session and the stored override, for the header chip. */
  permissionModeInfo(sessionId: string): PermissionModeInfo {
    const override = this.permissionModes.get(sessionId) ?? null;
    return {
      mode: this.getPermissionMode(sessionId, this.accessModes.get(sessionId)),
      override,
    };
  }

  /**
   * Store a session's permission mode override (null clears it) and, when that session's Claude
   * process is alive, switch it live with a `set_permission_mode` control request. The CLI reads
   * stdin during a turn; between turns the line is queued and answered when the next turn opens.
   */
  async setPermissionMode(sessionId: string, mode: string | null): Promise<PermissionModeReply> {
    if (mode !== null && !isPermissionMode(mode))
      return {
        ...this.permissionModeInfo(sessionId),
        live: false,
        error: `unknown mode "${mode}"`,
      };
    await savePermissionMode(this.stateDir, sessionId, mode);
    if (mode === null) this.permissionModes.delete(sessionId);
    else this.permissionModes.set(sessionId, mode);
    const info = this.permissionModeInfo(sessionId);
    const proc = this.processes.get(registryKey(this.providerId, sessionId));
    if (!proc?.alive) return { ...info, live: false };
    // 5 s: the CLI answers at once when it reads stdin; a longer wait would only stall the chip.
    const reply = await this.control(
      proc,
      { subtype: "set_permission_mode", mode: info.mode },
      5000,
    );
    return reply.ok ? { ...info, live: true } : { ...info, live: true, error: reply.error };
  }

  /** Hand a `control_response` to whoever sent the request; true when someone was waiting. */
  resolveControl(event: ClaudeEvent): boolean {
    if (event.type !== "control_response") return false;
    const id = event.response?.request_id ?? event.request_id;
    const waiter = this.controlWaiters.get(id);
    if (!waiter) return false;
    this.controlWaiters.delete(id);
    if (event.response?.subtype === "error")
      waiter({ ok: false, error: errorText(event.response.error) });
    else waiter({ ok: true, response: toJsonValue(event.response?.response) });
    return true;
  }

  /**
   * Send one control request and wait for its answer. The process hands `control_response` lines
   * to `resolveControl` as they arrive, so this works between turns as well as inside one.
   */
  control(
    proc: ClaudeProcess,
    request: Record<string, JsonValue>,
    timeoutMs = 15_000,
  ): Promise<ControlReply> {
    proc.controlListener ??= (event) => this.resolveControl(event);
    const requestId = `omc-${randomUUID()}`;
    return new Promise<ControlReply>((resolve) => {
      const timer = setTimeout(() => {
        this.controlWaiters.delete(requestId);
        resolve({
          ok: false,
          error: `no reply from claude within ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);
      this.controlWaiters.set(requestId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      if (!proc.write(controlRequestLine(requestId, request))) {
        clearTimeout(timer);
        this.controlWaiters.delete(requestId);
        resolve({ ok: false, error: "claude process is not accepting input" });
      }
    });
  }

  /**
   * Rewind a session to one of its user prompts: `rewind_files` (dry run first, from the UI) puts
   * the working tree back, then `rewind_conversation` drops Claude's context after that prompt.
   * dsh's own transcript is not touched.
   */
  async rewind(sessionId: string, uuid: string, dryRun: boolean): Promise<RewindReply> {
    const proc = this.processes.get(registryKey(this.providerId, sessionId));
    if (!proc?.alive)
      return {
        ok: false,
        dryRun,
        error: "no live Claude process for this session; send a prompt first",
      };
    const files = await this.control(proc, {
      subtype: "rewind_files",
      user_message_id: uuid,
      dry_run: dryRun,
    });
    if (!files.ok) return { ok: false, dryRun, error: files.error };
    const r = decodeRewindResult(files.response);
    const reply: RewindReply = { ...r, ok: r.canRewind, dryRun };
    if (dryRun || !reply.ok) return reply;
    const conv = await this.control(proc, {
      subtype: "rewind_conversation",
      target_message_uuid: uuid,
    });
    if (!conv.ok)
      return { ...reply, ok: false, error: `files rewound, conversation not: ${conv.error}` };
    return reply;
  }

  /**
   * `/temporary`: toggle "keep no Claude transcript" for the current dsh session. Registered here,
   * from the first init frame, because at apply() the commands service is not up yet and the
   * optional lookup returns nothing. The next process for the session starts with
   * --no-session-persistence; a live one is replaced by the spec change.
   */
  registerTemporaryCommand(commands: NonNullable<PluginContext["commands"]>) {
    if (this.bridged.has("temporary")) return;
    try {
      const dispose = commands.register({
        name: "temporary",
        description: "Oh My Claude: keep no Claude transcript for this session (toggle)",
        handler: ({ agent }) => {
          const id = String(agent.id);
          const on = !this.temporary.has(id);
          if (on) this.temporary.add(id);
          else this.temporary.delete(id);
          return {
            kind: "success",
            text: on
              ? "Temporary: on. Claude keeps no transcript for this session from the next turn; after a dsh restart the session continues from dsh's own log."
              : "Temporary: off. The next turn starts a Claude session that is kept again.",
          };
        },
      });
      this.bridged.set("temporary", dispose);
    } catch (error) {
      this.log("warn", `/temporary not registered: ${errorText(error)}`);
    }
  }

  /** Two boots closer than this are a crash loop, not a restart. */
  static readonly BOOT_BACKOFF_MS = 60_000;

  /**
   * After a dsh restart, sessions that had a turn running get a prompt to continue, so the user
   * does not have to come back and poke each one. Sessions with a live (adopted) process are a
   * hot reload, not a restart, and are left alone.
   */
  async resumeInterrupted(path = join(this.stateDir, "busy.json")) {
    const log = join(dirname(path), "resume.log"); // beside the busy file, so tests stay in tmp
    // Backoff: a boot within a minute of the previous one is a crash loop (14 in a row on
    // 2026-09-05, from a throw in the nudged turn). Leave the busy file alone so a later healthy
    // boot still resumes, and do not nudge now.
    const since = await noteBoot(join(dirname(path), "boot.json"));
    if (since !== undefined && since < ClaudeCodeAdapter.BOOT_BACKOFF_MS) {
      await trace(log, `boot: backoff, previous boot ${since}ms ago; nudge skipped`);
      return;
    }
    const ids = await takeInterrupted(path);
    await trace(
      log,
      `boot: interrupted=${JSON.stringify(ids)} live=${JSON.stringify([...this.processes.keys()])}`,
    );
    for (const id of ids) {
      const proc = this.processes.get(registryKey(this.providerId, id));
      if (proc) {
        // A hot reload, or the user already typed since boot: the turn is live, keep it tracked.
        if (proc.busy) await markBusy(id, true, path);
        await trace(log, `skip ${id}: process live (busy=${proc.busy})`);
        continue;
      }
      try {
        await this.wake(id, undefined, RESTART_TEXT);
        await trace(log, `nudged ${id}`);
      } catch (e) {
        await trace(log, `nudge ${id} failed: ${errorText(e)}`);
      }
    }
    return ids;
  }

  /** Node's spawn, or dsh's subprocess seam when configured and mounted. */
  /** Where a session's keeper lives: one directory per provider id and dsh session. */
  keeperDir(sessionId: string): string {
    const h = createHash("sha256").update(registryKey(this.providerId, sessionId)).digest("hex");
    return join(this.stateDir, "keepers", h.slice(0, 16));
  }

  /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
  keeperEnv() {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, CHILD_ENV);
    if (this.config.configDir) env.CLAUDE_CONFIG_DIR = this.claudeHome;
    return env;
  }

  /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
  spawnerFor(sessionId: string | undefined, spec: ClaudeProcessSpec): Spawner {
    if (this.config.spawn !== "keeper" || !sessionId) return this.spawner();
    return (command, args, cwd) => {
      const dir = this.keeperDir(sessionId);
      const unit = `omc-keeper-${basename(dir)}-${Date.now().toString(36)}`;
      return lazyHandle(
        spawnKeeper(
          dir,
          { command, args, cwd, env: this.keeperEnv(), sessionId, procSpec: spec },
          (argv) => launchKeeper(argv, unit),
        ),
      );
    };
  }

  /**
   * At boot, reattach to keepers whose Claude process is still alive (a dsh restart left them
   * running) and register them as this instance's processes. One with output waiting gets a
   * drain turn so what Claude did during the gap shows up without anyone typing.
   */
  async adoptKeepers() {
    if (this.config.spawn !== "keeper") return;
    const root = join(this.stateDir, "keepers");
    let dirs: string[] = [];
    try {
      dirs = (await readdir(root)).map((d) => join(root, d));
    } catch {
      return;
    }
    for (const dir of dirs) {
      const info = readKeeperInfo(dir);
      const spec = readKeeperSpec(dir);
      if (
        !info ||
        !spec ||
        info.exit ||
        !pidAlive(info.pid) ||
        !pidAlive(info.claudePid) ||
        !spec.procSpec
      ) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      const procSpec = spec.procSpec;
      const key2 = registryKey(this.providerId, spec.sessionId);
      if (this.processes.has(key2)) continue;
      const proc = new ClaudeProcess({
        args: spec.args,
        cwd: spec.cwd,
        spec: procSpec,
        command: spec.command,
        spawner: () => lazyHandle(attachKeeper(dir, 5000)),
        onExit: (p) => {
          if (this.processes.get(key2) === p) this.processes.delete(key2);
        },
      });
      proc.key = specKey(procSpec);
      proc.resuming = true;
      proc.onIdleResult = () => this.wake(spec.sessionId, proc);
      this.processes.set(key2, proc);
      await trace(
        join(this.stateDir, "resume.log"),
        `adopted keeper ${basename(dir)} for ${spec.sessionId} (claude pid ${info.claudePid})`,
      );
      // Anything Claude wrote while dsh was away sits in the keeper's buffer and now in our queue;
      // a wake opens a dsh turn that reads it out.
      setTimeout(() => {
        if (proc.alive && !proc.busy && proc.queue.size > 0)
          void this.wake(spec.sessionId, proc, RECONNECT_TEXT);
      }, 1500).unref();
    }
  }

  spawner() {
    const base =
      this.config.spawn === "dsh" && this.subprocess ? seamSpawner(this.subprocess) : nodeSpawner;
    if (this.config.spawn === "dsh" && !this.subprocess && !this.warnedNoSeam) {
      this.warnedNoSeam = true;
      this.log("warn", "spawn: dsh requested but ctx.subprocess is not mounted; using node spawn");
    }
    if (!this.config.configDir) return base;
    const envOverride = { CLAUDE_CONFIG_DIR: this.claudeHome };
    return (command: string, args: string[], cwd: string) => base(command, args, cwd, envOverride);
  }

  async *stream(options: GenerateOptions) {
    if (options.purpose || !options.sessionId || !this.config.resume) {
      yield* this.oneShot(options);
      return;
    }
    // SAFETY: sessionId was checked just above; the persistent path always has one
    yield* this.turn(options as SessionOptions, false);
  }

  // ── persistent path ──────────────────────────────────────────────────────

  /** Reuse the session's process when its spec still matches; otherwise replace it. */
  // SAFETY: options from dsh LlmAdapter.generate(); forceFresh is optional bool flag
  async acquire(options: SessionOptions, forceFresh?: boolean) {
    const prep = await this.prepare(options, { forceFresh });
    if (prep.input === null) return { prep, proc: null }; // text-mode CLI: fall back to one-shot semantics
    const key = specKey(prep.spec);
    const key2 = registryKey(this.providerId, options.sessionId);
    let proc = this.processes.get(key2);
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
        command: this.config.command,
        spawner: this.spawnerFor(options.sessionId, prep.spec),
        onExit: (p) => {
          if (this.processes.get(key2) === p) this.processes.delete(key2);
        },
      });
      proc.key = key;
      proc.resuming = prep.session?.resuming ?? false;
      proc.onIdleResult = () => this.wake(options.sessionId, proc);
      this.processes.set(key2, proc);
      if (this.config.debug) {
        this.log("info", `spawn cwd=${prep.cwd} claude ${prep.args.join(" ")}`);
      }
    }
    return { prep, proc };
  }

  /** Drop processes idle past processIdleMs, then keep the live count under maxProcesses by
   *  killing the longest-idle ones that are not mid-turn. Called before each spawn. */
  /** Live processes belonging to this mount; the registry is shared across mounts. */
  ownProcessCount(): number {
    let n = 0;
    for (const key of this.processes.keys()) if (key.startsWith(`${this.providerId}:`)) n++;
    return n;
  }

  evict() {
    const now = Date.now();
    for (const [key, p] of this.processes) {
      if (!key.startsWith(`${this.providerId}:`)) continue;
      if (!p.alive || (isSettled(p) && now - p.lastUsed > this.config.processIdleMs)) {
        p.kill();
        this.processes.delete(key);
      }
    }
    const idle = [...this.processes.entries()]
      .filter(([k]) => k.startsWith(`${this.providerId}:`))
      .filter(([, p]) => isSettled(p))
      .toSorted((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.ownProcessCount() >= this.config.maxProcesses && idle.length > 0) {
      const next = idle.shift();
      if (!next) break;
      const [key, p] = next;
      p.kill();
      this.processes.delete(key);
    }
  }

  /**
   * How this dsh request continues the session's Claude process, if at all:
   * - `relay`: parked on relayed tool call(s) and dsh brought every result: answer them, keep going.
   * - `steer`: parked after a live steer reached Claude mid-turn, or everything dsh delivers now was
   *   already forwarded and the CLI answered it as a turn of its own: keep translating, write nothing
   *   new (or only the messages Claude has not seen).
   * - `abandon`: parked on relays but dsh moved on without their results: reject them, start over.
   * - `prompt`: a normal turn; steers Claude already got live are dropped from the prompt.
   */
  // SAFETY: mirrors acquire() shape for the turn loop
  continuationFor(options: SessionOptions, forceFresh?: boolean): Continuation {
    const held = this.processes.get(registryKey(this.providerId, options.sessionId));
    const live = held?.alive && !forceFresh ? held : undefined;
    const fresh = afterLastAssistant(options.messages);
    const onlySent =
      (live?.sent.size ?? 0) > 0 && fresh.length > 0 && dropSent(fresh, live?.sent).length === 0;
    if (live && live.relays.size > 0) {
      const results = [...live.relays.keys()].map((id) => toolResultFor(options.messages, id));
      return results.some((r) => r === undefined)
        ? { mode: "abandon", proc: live, options }
        : {
            mode: "relay",
            proc: live,
            options,
            results: results.filter((r): r is RelayResult => r !== undefined),
          };
    }
    if (live && (live.parked === "steer" || onlySent))
      return { mode: "steer", proc: live, options };
    const messages =
      (held?.sent.size ?? 0) > 0 ? dropSent(options.messages, held?.sent) : options.messages;
    return { mode: "prompt", options: { ...options, messages } };
  }

  /** First write of a turn: relay results, unsent steers, or the prompt itself. */
  openTurn(cont: Continuation, proc: ClaudeProcess, prep: TurnPrep) {
    if (cont.mode === "relay") {
      const relays = [...proc.relays.values()];
      proc.relays.clear();
      const extra = stepContextFor(cont.options.messages); // steers and notices ride on the last result
      relays.forEach((relay, i) => {
        const result = cont.results[i];
        if (!result) return; // cannot happen: results were built from relays.keys()
        relay.resolve(i === relays.length - 1 ? { ...result, text: result.text + extra } : result);
      });
      return;
    }
    if (cont.mode === "steer") {
      proc.parked = undefined;
      for (const m of afterLastAssistant(cont.options.messages)) {
        const rpcId = m.source?.rpcId;
        if (m.role !== "user" || m.source?.kind !== "user" || !rpcId || proc.sent.has(rpcId))
          continue;
        const text = textOf(m.content);
        if (text && proc.write(buildInput(text, []))) proc.sent.add(rpcId);
      }
      return;
    }
    if (prep.input === null || !proc.write(prep.input))
      throw new LlmError("claude process is not running", "PROVIDER_ERROR");
  }

  /**
   * Arm the idle watchdog for a stream: `proc` is killed after `idleTimeoutMs` of silence. Every
   * event re-arms. Shortly before the kill (60 s, or half the timeout when it is under 120 s) a
   * warning event is queued on the process so the turn loop draws a countdown row; `warn: false`
   * skips that for the aux stream, whose loop has no reasoning lane.
   */
  armIdle(key: string, proc: IdleTarget, warn = true): void {
    const timeoutMs = this.config.idleTimeoutMs;
    const warnMs = timeoutMs < 120_000 ? Math.round(timeoutMs / 2) : 60_000;
    this.clearIdle(key);
    const deadline = Date.now() + timeoutMs;
    this.idleDeadlineMap.set(key, deadline);
    this.idleTargets.set(key, { proc, warn });
    this.idleKillTimers.set(
      key,
      setTimeout(() => {
        this.idleDeadlineMap.set(key, null);
        proc.idleKilled = true;
        proc.kill();
      }, timeoutMs),
    );
    if (!warn) return;
    this.idleWarnTimers.set(
      key,
      setTimeout(() => {
        proc.inject({
          type: "idle_warning",
          silentSeconds: Math.round((timeoutMs - warnMs) / 1000),
          leftSeconds: Math.round(warnMs / 1000),
        });
      }, timeoutMs - warnMs),
    );
  }

  /** Stop the watchdog for a stream: the turn ended, or a tool is running and silence is expected. */
  clearIdle(key: string): void {
    clearTimeout(this.idleKillTimers.get(key));
    clearTimeout(this.idleWarnTimers.get(key));
    this.idleKillTimers.delete(key);
    this.idleWarnTimers.delete(key);
    this.idleTargets.delete(key);
    this.idleDeadlineMap.set(key, null);
  }

  /** Push a stream's deadline out by one full timeout; false when nothing is armed under `key`. */
  extendIdle(key: string): boolean {
    const target = this.idleTargets.get(key);
    if (!target || !this.idleDeadlineMap.get(key)) return false;
    this.armIdle(key, target.proc, target.warn);
    return true;
  }

  /** Why a turn that neither finished nor parked ended. */
  // SAFETY: returns FinishReason shape for the adapter loop
  endReason(proc: ClaudeProcess, options: SessionOptions, idle: boolean): FinishReason {
    if (options.signal?.aborted)
      return { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } };
    if (idle)
      return {
        kind: "error",
        failure: {
          message: `claude produced no output for ${Math.round(this.config.idleTimeoutMs / 1000)}s and was stopped`,
          code: "IDLE_TIMEOUT",
        },
      };
    return {
      kind: "error",
      failure: {
        message: `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
        code: "PROVIDER_ERROR",
      },
    };
  }

  async *turn(options: SessionOptions, forceFresh?: boolean): AsyncGenerator<StreamChunk> {
    const cont = this.continuationFor(options, forceFresh);
    options = cont.options;
    if (cont.mode === "abandon") {
      for (const r of cont.proc.relays.values())
        r.reject(new Error("dsh moved on without a result for this tool call"));
      cont.proc.relays.clear();
      cont.proc.kill();
      this.processes.delete(registryKey(this.providerId, options.sessionId));
      yield* this.turn(options, true);
      return;
    }
    const { prep, proc } = cont.proc
      ? { prep: requirePrep(cont.proc), proc: cont.proc }
      : await this.acquire(options, forceFresh);
    if (proc === null) {
      yield* this.oneShot(options);
      return;
    }
    proc.prep = prep;
    if (cont.mode !== "relay") {
      proc.dshIds = new Set(); // ids only need to survive a relay round trip
      proc.relayed = new Set();
      // dsh clears the todo panel at turn/start; re-append the last list now that the turn is
      // open (a todo/write outside an open turn is rejected by dsh's todo invariant).
      this.restoreTodos(options.sessionId);
    }
    // Compute turn/step once per stream from the open session; used by native tool callbacks.
    let turnStep: { turn: number; step: number } | undefined;
    const callSeqs = new Map<string, number>(); // callId → tool/call seq the result must cite
    try {
      const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
      if (session) {
        // Inline scan to avoid type assertions; TypeScript narrows e.data after the type guard.
        let turn: number | undefined;
        let step: number | undefined;
        for (const e of session.snapshotEvents()) {
          if (e.type === "turn/start")
            // SAFETY: turn/start events carry turn as a number in data at runtime
            turn = e.data.turn as number | undefined;
          else if (e.type === "step/start")
            // SAFETY: step/start events carry step as a number in data at runtime
            step = e.data.step as number | undefined;
        }
        if (turn !== undefined && step !== undefined) turnStep = { turn, step };
      }
    } catch {
      // session unavailable; native rows will fall back to old reasoning blocks
    }
    const tr = new Translator({
      toolActivity: this.config.toolActivity,
      toolTextLimit: this.config.toolTextLimit,
      relay: this.mcp !== undefined && this.config.dshTools,
      dshIds: proc.dshIds,
      relayed: proc.relayed,
      log: this.log.bind(this),
      onToolCall:
        turnStep && this.config.toolActivity
          ? (callId: string, toolName: string, args: string) => {
              // SAFETY: NATIVE_TOOL_MAP is a readonly const object; keyof typeof narrows to known keys only
              const mapped = NATIVE_TOOL_MAP[toolName as keyof typeof NATIVE_TOOL_MAP] ?? toolName;
              try {
                const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
                // SAFETY: append accepts plain-object data; seq is a number at runtime even though SessionSeq is branded
                const seq = session?.append("tool/call", {
                  turn: turnStep!.turn,
                  step: turnStep!.step,
                  callId,
                  name: mapped,
                  arguments: args,
                } as any)?.seq;
                if (seq !== undefined) callSeqs.set(callId, seq);
                return seq;
              } catch (err) {
                this.log("warn", `native tool call append failed: ${err}`);
                return undefined;
              }
            }
          : undefined,
      redact: this.redact,
      onInit: (names) => this.bridgeCommands(names, this.ctx?.agents?.get?.(options.sessionId)),
      onResult: (summary: TurnRecord) => {
        // ponytail: ring buffer capped at 50 entries per session; upgrade to a durable store if cost history beyond one page is needed.
        const buf = this.turnBuffer.get(options.sessionId) ?? [];
        buf.push(summary);
        if (buf.length > TURN_RING) buf.shift();
        this.turnBuffer.set(options.sessionId, buf);
      },
      onToolResult:
        turnStep && this.config.toolActivity
          ? (callId, text, isError, meta) => {
              try {
                const session = this.ctx?.sessions?.get?.(asSessionId(options.sessionId));
                if (!session) return;
                const callSeq = callSeqs.get(callId);
                callSeqs.delete(callId);
                // SAFETY: createToolResultMessage returns a user-role message; session.append validates shape at runtime
                const message = createToolResultMessage({
                  callId: callId as any,
                  content: [{ type: "text" as const, text }],
                  isError,
                });
                // SAFETY: message is ToolResultMessage (a user-role Message); session.append validates JSON at runtime
                const resultData = { turn: turnStep!.turn, step: turnStep!.step, message };
                if (meta) Object.assign(resultData, { meta });
                // SAFETY: resultData has the shape expected by session.append for tool/result; fields validated at runtime
                session.append(
                  "tool/result",
                  resultData as any,
                  // SAFETY: sourceEventSeqs is optional when no call was recorded; invariant allows TOOL_NOT_STARTED as fallback
                  {
                    surfaceOp: "append",
                    sourceEventSeqs: callSeq !== undefined ? [callSeq] : [],
                  } as any,
                );
              } catch (err) {
                this.log("warn", `native tool result append failed: ${err}`);
              }
            }
          : undefined,
    });
    const pending = new Map(); // control request id → AbortController
    let outcome: Outcome = "ended"; // ended | finished | relayed | parked | retry
    const wakeOnly = cont.mode === "prompt" && wakeOnlyTurn(options.messages);
    const onAbort = () => {
      // Ask the CLI to stop; it answers with a result and stays alive for the next turn. Kill only
      // if it does not.
      tr.aborting = true;
      if (!proc.write(interruptLine(`interrupt-${randomUUID()}`))) return proc.kill();
      const fallback = setTimeout(() => {
        if (!tr.finished) proc.kill();
      }, INTERRUPT_GRACE_MS);
      fallback.unref?.();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    proc.busy = true;
    proc.lastUsed = Date.now();
    markBusy(options.sessionId, true, join(this.stateDir, "busy.json")).catch((e) =>
      this.log("warn", `busy.json: ${errorText(e)}`),
    );
    const handleControl = this.handleControl.bind(this);
    const clearIdle = this.clearIdle.bind(this);
    const resolveControl = this.resolveControl.bind(this);
    /** One CLI event. Returns what the loop should do next. */
    const dispatch = async function* (event: ClaudeEvent) {
      if (event.type === "idle_warning") {
        yield* tr.wholeBlock(
          "reasoning",
          `⏳ Idle watchdog: no output for ${event.silentSeconds}s, stopping in ${event.leftSeconds}s`,
        );
        return "continue";
      }
      if (event.type === "control_request") {
        yield* handleControl(event, options, prep, proc, pending, tr);
        return "continue";
      }
      if (event.type === "control_cancel_request") {
        pending.get(event.request_id)?.abort();
        return "continue";
      }
      if (event.type === "control_response") {
        resolveControl(event);
        return "continue";
      }
      if (event.type === "timeout") return "continue";
      if (isStaleResume(event) && proc.resuming && !forceFresh) return "retry";
      if (event.type === "result" && proc.staleResults > 0) {
        // End of a turn Claude ran on its own between prompts (see ClaudeProcess.countStaleResults).
        // Its text already streamed into this step. On a wake-only turn the last one ends the
        // turn; under a real prompt, draw a rule and keep reading for the real reply.
        proc.staleResults--;
        if (wakeOnly && proc.staleResults === 0) {
          yield* tr.translate(event);
          return "finished";
        }
        yield* tr.wholeBlock("text", "\n\n---\n\n");
        return "continue";
      }
      yield* tr.translate(event);
      if (tr.toolPending) clearIdle(options.sessionId); // tool running: silence is expected
      if (tr.finished) return "finished";
      if (proc.steerPending && event.type === "user") {
        // Tool results are in; the CLI injects the forwarded steer next. End the dsh step here
        // so dsh draws the steer now, then resume this same Claude turn on the next call.
        proc.steerPending = false;
        proc.parked = "steer";
        return "parked";
      }
      return "continue";
    };
    /** Claude fires parallel dsh calls as separate MCP requests: gather the batch (one per
     *  outstanding dsh tool_use block), end this step with those tool-calls, keep Claude parked on
     *  its requests, and resolve them when dsh calls back. Returns the turn outcome: "relayed", or
     *  whatever ended the turn under us (its calls are then rejected). */
    const relayBatch = async function* (first: RelayEvent) {
      const calls: RelayEvent[] = [first];
      const abandon = (outcomeUnderUs: Outcome) => {
        for (const c of calls)
          c.reject(new Error("claude turn ended before dsh could run the tool"));
        return outcomeUnderUs;
      };
      while (calls.length < tr.dshIds.size) {
        const more = await proc.nextEvent(RELAY_BATCH_MS);
        if (more === null) return abandon("ended");
        if (more.type === "timeout") break;
        if (more.type === "dsh_relay") {
          calls.push(more);
          continue;
        }
        const what = yield* dispatch(more);
        if (what !== "continue") return abandon(what);
      }
      // The oldest outstanding dsh tool_use blocks are the ones these calls came from.
      const ids = [...tr.dshIds];
      for (const [i, call] of calls.entries()) {
        if (ids[i] !== undefined) tr.relayed.add(ids[i]);
        yield* relayBlocks(tr, call);
        proc.relays.set(call.id, call);
      }
      return "relayed";
    };
    try {
      // A fresh prompt: anything already queued is output from a turn Claude ran while dsh was
      // idle (background task finished). Relay/steer modes are mid-turn; their queue is live.
      proc.staleResults = cont.mode === "prompt" ? (proc.countStaleResults?.() ?? 0) : 0;
      // Our own wake notice opened this turn: nothing to send, only that queued output to show.
      // If a user prompt already drained it, there is nothing to do at all.
      if (wakeOnly && proc.staleResults === 0) {
        outcome = "finished";
        yield { type: "finish", reason: { kind: "stop" } };
        return;
      }
      if (!wakeOnly) this.openTurn(cont, proc, prep);
      this.armIdle(options.sessionId, proc);
      for (;;) {
        const event = await proc.nextEvent();
        if (event === null) break;
        if (event.type !== "idle_warning") this.armIdle(options.sessionId, proc);
        if (event.type === "dsh_relay") {
          outcome = yield* relayBatch(event);
          break;
        }
        const what = yield* dispatch(event);
        if (what === "continue") continue;
        outcome = what;
        break;
      }
      if (outcome === "relayed") yield { type: "finish", reason: { kind: "tool-calls" } };
      else if (outcome === "parked") yield { type: "finish", reason: { kind: "stop" } };
      else if (outcome === "retry") {
        if (prep.session) await rememberStarted(prep.session.id, false);
      } else if (outcome === "finished") {
        if (prep.session) await rememberStarted(prep.session.id, true);
      } else yield { type: "finish", reason: this.endReason(proc, options, proc.idleKilled) };
    } finally {
      this.clearIdle(options.sessionId);
      options.signal?.removeEventListener("abort", onAbort);
      for (const c of pending.values()) c.abort();
      proc.busy = false;
      proc.lastUsed = Date.now();
      // A dsh shutdown aborts the stream with a "disposed" reason. Clearing the busy mark then
      // leaves nothing for the boot resume to nudge (2026-09-05, third restart of the day), so the
      // mark stays for that one case and the next boot picks the session up.
      if (abortKind(options.signal) === "disposed") {
        void trace(`kept busy ${options.sessionId}: stream aborted by disposal`);
      } else {
        markBusy(options.sessionId, false, join(this.stateDir, "busy.json")).catch((e) =>
          this.log("warn", `busy.json: ${errorText(e)}`),
        );
      }
      if (outcome === "retry" || outcome === "ended") {
        // A dsh shutdown ends the stream with a "disposed" abort; in keeper mode the process must
        // outlive it (that is the point of the keeper), so leave it for the next boot to adopt.
        const disposing = abortKind(options.signal) === "disposed";
        if (this.config.spawn === "keeper" && disposing) {
          void trace(
            join(this.stateDir, "resume.log"),
            `kept keeper process for ${options.sessionId}: dsh disposing`,
          );
        } else {
          proc.kill();
          this.processes.delete(registryKey(this.providerId, options.sessionId));
        }
      }
    }
    if (outcome === "retry") yield* this.turn(options, true);
  }

  /** dsh's todo projection resets to null on every `turn/start`, so the panel empties each message.
   *  Called at the top of an open turn (dsh's invariant rejects a `todo/write` outside one), this
   *  re-appends the last todo list so it persists across messages and, because it reads persisted
   *  session events, across a restart too. Source-agnostic: works for dsh's own todo tool.
   *  ponytail: O(n) scan of session events per turn; cache the last list if long sessions lag. */
  restoreTodos(sessionId: string) {
    if (!this.config.persistTodos || !sessionId) return;
    try {
      const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
      if (!session) return;
      let todos: JsonValue | undefined;
      for (const e of session.snapshotEvents()) if (e.type === "todo/write") todos = e.data.todos;
      if (!Array.isArray(todos) || todos.length === 0) return;
      session.append("todo/write", { todos });
    } catch (error) {
      this.log("warn", `todo restore: ${errorText(error)}`);
    }
  }

  /** Claude finished a turn of its own (a background task it launched completed) while dsh was
   *  idle. Drop a notice into the session's inbox so dsh opens a turn now and the reply shows,
   *  instead of riding on top of the user's next prompt. */
  async wake(sessionId: string, proc: ClaudeProcess | undefined, text = WAKE_TEXT) {
    if (proc?.busy) return;
    if (text === RESTART_TEXT) await trace(`wake ${sessionId}: start`);
    let agent;
    try {
      agent = this.ctx?.agents?.get?.(asSessionId(sessionId));
    } catch (error) {
      // This adapter's cordis scope is gone (plugin hot-reloaded); the new instance re-adopts
      // the process in its constructor, so the next idle reply will wake through it.
      this.log("warn", `wake: adapter scope inactive (${errorText(error)}); skipped`);
      return;
    }
    let how = "live";
    if (agent === undefined && this.sessionController) {
      // Idle for minutes: dsh unloaded the Agent. Resume it the way a typed prompt would.
      try {
        agent = await this.sessionController.resolveAgent(sessionId);
        how = "resumed";
      } catch (error) {
        this.log("warn", `wake: could not resume session ${sessionId}: ${errorText(error)}`);
        return;
      }
    }
    if (!agent) {
      this.log("warn", `wake: no agent for session ${sessionId}; reply waits for the next prompt`);
      if (text === RESTART_TEXT) await trace(`wake ${sessionId}: no agent (${how})`);
      return;
    }
    if (text === RESTART_TEXT) {
      // A notice from a previous boot may still sit in the durable inbox: do not stack another.
      try {
        const session = this.ctx?.sessions?.get?.(asSessionId(sessionId));
        if (
          session &&
          hasPendingNotice(session.snapshotEvents(), "dsh-oh-my-claude", [
            RESTART_TEXT,
            RECONNECT_TEXT,
          ])
        ) {
          await trace(`wake ${sessionId}: restart notice already pending, not stacking another`);
          return;
        }
      } catch (error) {
        this.log("warn", `wake: pending-notice check failed: ${errorText(error)}`);
      }
      await trace(`wake ${sessionId}: agent ${how}, sending followup`);
    }
    try {
      this.log("info", `wake: idle reply in session ${sessionId} (agent ${how})`);
      // Restart and reconnect notices stand in for the owner who configured hands-free resume, so
      // they carry the user source: dsh accepts goal resume only from a direct human turn, and
      // the notice asks the model to rearm its goal.
      const onBehalfOfUser = text === RESTART_TEXT || text === RECONNECT_TEXT;
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: onBehalfOfUser
            ? { kind: "user" }
            : {
                kind: "plugin",
                plugin: "dsh-oh-my-claude",
                form: "notice",
                summary: boundContextSummary(text),
              },
        }),
      );
    } catch (error) {
      this.log("warn", `wake after idle reply failed: ${errorText(error)}`);
    }
    if (text === RESTART_TEXT) {
      // 2026-09-05: with no browser attached, the restart notice was spliced but no turn started
      // until the next typed prompt. Record the agent's phase after the followup so the next
      // occurrence says whether the loop was idle (driver never kicked) or busy (maintenance).
      // dsh's Agent exposes `status` as a getter ("idle" | "running"); some builds expose a
      // method. Read it defensively: a throw inside setTimeout would take the whole dsh process
      // down (2026-09-05: 14 crash-loop restarts from `a.status()` on a string).
      // SAFETY: only read, never called; any value stringifies, a getter that throws is caught
      const a = agent as { status?: unknown };
      const phase = (): string => {
        try {
          const v = a.status;
          return v === undefined ? "unknown" : String(v).slice(0, 40);
        } catch (error) {
          return `error:${errorText(error)}`;
        }
      };
      for (const delayMs of [2000, 15000]) {
        setTimeout(() => {
          void trace(`wake ${sessionId}: phase ${phase()} at +${delayMs}ms`);
        }, delayMs);
      }
    }
  }

  /** Offer a dsh tool call from the MCP bridge to the session's live turn. Undefined when no turn
   *  can take it (idle process, a relay already pending); the bridge then executes it directly. */
  relay(
    sessionId: string,
    toolName: string,
    args: Record<string, JsonValue>,
    signal: AbortSignal,
  ): Promise<RelayResult> | undefined {
    const proc = this.processes.get(registryKey(this.providerId, sessionId));
    if (!proc?.alive || !proc.busy || proc.relays.size > 0) {
      // Why a dsh tool ran in the bridge instead of dsh's loop; goal tools refuse the bridge path.
      void trace(
        join(this.stateDir, "resume.log"),
        `relay ${toolName} for ${sessionId} declined: alive=${String(proc?.alive)} busy=${String(proc?.busy)} pending=${proc?.relays.size ?? 0}`,
      );
      return undefined;
    }
    return new Promise<RelayResult>((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("relay aborted")), { once: true });
      proc.inject({ type: "dsh_relay", id: randomUUID(), name: toolName, args, resolve, reject });
    });
  }

  /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
  async *handleControl(
    event: ControlRequestEvent,
    options: SessionOptions,
    prep: TurnPrep,
    proc: ClaudeProcess,
    pending: Map<string, AbortController>,
    tr: Translator,
  ) {
    const request = event.request ?? {};
    const requestId = event.request_id;
    if (request.subtype !== "can_use_tool") {
      proc.write(
        controlErrorLine(
          requestId,
          `${request.subtype ?? "unknown"} is not supported by dsh-oh-my-claude`,
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
    const reply = (line: string) => {
      if (!proc.write(line))
        this.log("warn", `control response for ${toolName} dropped: claude process already exited`);
    };
    this.decide({ toolName, input, request, toolUseId, agent, signal, accessMode: prep.accessMode })
      .then((result) => reply(controlResponseLine(requestId, result)))
      .catch((error) => reply(controlErrorLine(requestId, errorText(error))))
      .finally(() => pending.delete(requestId));
  }

  // SAFETY: destructured from ClaudeCodeControlRequest shape in process.ts
  async decide({ toolName, input, request, toolUseId, agent, signal, accessMode }: Decision) {
    if (toolName === "AskUserQuestion") {
      const questions = parseQuestions(input, toolUseId);
      const ask = this.ctx?.userQuestions?.ask;
      if (!questions || !ask) return denyResult(toolUseId, "dsh could not present this question");
      try {
        const response = await this.ctx.userQuestions.ask({ questions, agent, signal });
        return allowResult(toolUseId, { ...input, answers: answersFor(questions, response) });
      } catch (error) {
        return denyResult(toolUseId, `question cancelled: ${errorText(error)}`);
      }
    }
    if (toolName === "ExitPlanMode") {
      // Claude's plan arrives as a permission request with input.plan (markdown). Present it the
      // way dsh presents its own exit_plan_mode, so the native Plan review panel renders it.
      const plan = String(input.plan ?? "");
      if (plan !== "") {
        const id = `plan-review:${toolUseId}`;
        try {
          const response = await this.ctx.userQuestions.ask({
            questions: [
              {
                id,
                header: "Plan review",
                question: "Approve this plan and leave plan mode?",
                detail: plan,
                options: [
                  { label: PLAN_APPROVE, description: "Leave plan mode and carry the plan out." },
                  {
                    label: PLAN_KEEP,
                    description: "Stay in plan mode; your feedback goes to Claude.",
                  },
                ],
                intent: { kind: "plan-review", approve: PLAN_APPROVE },
                multiSelect: false,
              },
            ],
            agent,
            signal,
          });
          const item = (response.answers ?? []).find((a) => a.id === id);
          const feedback = item?.custom ?? "";
          if (item?.selected?.length === 1 && item.selected[0] === PLAN_APPROVE && feedback === "")
            return allowResult(toolUseId, input);
          return denyResult(
            toolUseId,
            feedback === ""
              ? "The user chose to keep planning; revise the plan and present it again."
              : `The user chose to keep planning; their feedback: ${feedback}`,
          );
        } catch (error) {
          return denyResult(toolUseId, `plan review cancelled: ${errorText(error)}`);
        }
      }
    }
    if (accessMode === "danger-full-access") return allowResult(toolUseId, input);
    const approval = this.ctx?.approval;
    if (!approval || !agent)
      return denyResult(toolUseId, "dsh approval is unavailable for this session");
    let outcome: ApprovalOutcome;
    try {
      outcome = await approval.request({
        agent,
        toolName,
        reason: permissionReason(toolName, input, request),
        signal,
      });
    } catch (error) {
      return denyResult(toolUseId, `approval failed: ${errorText(error)}`);
    }
    if (outcome === "allowed-once") return allowResult(toolUseId, input);
    return denyResult(
      toolUseId,
      outcome === "rejected" ? "The user denied this action in dsh." : `approval ${outcome}`,
    );
  }

  // ── one-shot path (aux calls, text-mode CLI, no session id) ──────────────

  async *oneShot(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const { cwd, args, session, input } = await this.prepare(options);
    const proc = new ClaudeProcess({
      args: args.filter(
        (a, i) => !(a === "--permission-prompt-tool" || args[i - 1] === "--permission-prompt-tool"),
      ),
      cwd,
      spec: {
        cwd,
        model: options.model ?? "",
        effort: null,
        mode: "plan",
        sessionId: null,
        temporary: false,
      },
      command: this.config.command,
      spawner: this.spawner(),
      onExit: () => {},
    });
    if (this.config.debug) this.log("info", `one-shot cwd=${cwd} claude ${proc.args.join(" ")}`);
    if (input !== null) {
      proc.write(input);
      proc.child.stdin.end();
    } else {
      proc.child.stdin.end();
    }
    const tr = new Translator({
      toolActivity: false,
      toolTextLimit: this.config.toolTextLimit,
      log: this.log.bind(this),
    });
    const onAbort = () => proc.kill();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const idleKey = `aux-${randomUUID()}`;
    this.armIdle(idleKey, proc, false);
    try {
      for (;;) {
        const event = await proc.nextEvent();
        if (event === null) break;
        this.armIdle(idleKey, proc, false);
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
              message: proc.idleKilled
                ? `claude produced no output for ${Math.round(this.config.idleTimeoutMs / 1000)}s and was stopped`
                : `claude exited ${proc.exitCode}: ${(proc.stderr || proc.stray).trim() || "no output"}`,
              code: proc.idleKilled ? "IDLE_TIMEOUT" : "PROVIDER_ERROR",
            },
          };
      // SAFETY: reason matches FinishReason shape for error/aborted cases
      yield { type: "finish", reason: reason as FinishReason };
    } finally {
      this.clearIdle(idleKey);
      options.signal?.removeEventListener("abort", onAbort);
      proc.kill();
    }
  }
}

export function apply(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>) {
  const adapter = new ClaudeCodeAdapter(ctx, config);
  const claudeHome = adapter.claudeHome;
  ctx.llm.registerConfigurableProviders([
    {
      provider: adapter.providerId,
      displayName: adapter.displayName,
      settingsNs: adapter.settingsNs,
      settingsPath: [],
    },
  ]);
  ctx.llm.registerAdapter([adapter.providerId], adapter);
  // dsh drops a session's Agent out of `ctx.agents` after a few idle minutes; the controller's
  // resolveAgent() cold-resumes it, which is what a wake after a long idle needs.
  ctx.inject?.(["sessionController"], (host) => {
    // SAFETY: cordis hands services untyped; this key holds dsh's session controller
    adapter.sessionController = host.sessionController as SessionController | undefined;
  });
  // One timer per dsh process, never tied to this cordis scope: dsh re-instantiates the plugin
  // when settings apply at boot, and a scope-bound timer was disposed before it fired.
  // SAFETY: the two symbols are this plugin's own keys on globalThis, typed here once
  const g = globalThis as typeof globalThis & {
    [ADAPTER_CURRENT]?: Map<string, ClaudeCodeAdapter>;
    [RESUME_TIMER]?: ReturnType<typeof setTimeout>;
    [COMMAND_CATALOG]?: string[];
  };
  (g[ADAPTER_CURRENT] ??= new Map()).set(adapter.providerId, adapter);
  void adapter.adoptKeepers().catch((e) => adapter.log("warn", `keeper adoption: ${errorText(e)}`));
  // A hot reload disposes the previous instance's command registrations with its scope and
  // brings no new init frame; re-bridge from the catalog the last one saw.
  if (g[COMMAND_CATALOG]) adapter.bridgeCommands(g[COMMAND_CATALOG], undefined);
  if (!g[RESUME_TIMER]) {
    g[RESUME_TIMER] = setTimeout(() => {
      // Resume every mounted instance over its own busy file.
      for (const inst of g[ADAPTER_CURRENT]?.values() ?? [])
        inst
          .resumeInterrupted(join(inst.stateDir, "busy.json"))
          .catch((e) => trace(`resume after restart failed: ${errorText(e)}`));
    }, RESUME_DELAY_MS);
    g[RESUME_TIMER].unref?.();
    void trace("timer armed");
  }
  // Optional: the subprocess seam (stock dsh mounts a local provider; a remote subprocess provider a remote one).
  ctx.inject?.(["subprocess"], (host) => {
    // SAFETY: cordis hands services untyped; dsh's subprocess seam is what this key holds
    adapter.subprocess = host.subprocess as Pick<SubprocessRuntime, "spawn"> | undefined;
  });
  // Routes, MCP bridge, usage route and the client panel are registered once per process: only
  // the default instance owns them. A non-default mount logs an info line and skips registration.
  if (adapter.providerId !== "claude-code") {
    adapter.log("info", "panel/routes/usage belong to the default claude-code instance");
  } else {
    registerMcpBridge(ctx, {
      keyFile: join(STATE_DIR, "mcp.key"),
      log: (level, msg) => adapter.log(level, msg),
      version: "0.9.0",
      relay: (sessionId, toolName, args, signal) =>
        adapter.relay(sessionId, toolName, args, signal),
    }).then(
      (mcp) => {
        adapter.mcp = mcp;
      },
      (e) => adapter.log("warn", `mcp bridge unavailable: ${errorText(e)}`),
    );
    registerUsageRoute(
      ctx,
      (level, msg) => adapter.log(level, msg),
      () => accountIdentity(adapter.config.command),
      claudeHome,
    );
    registerSessionRoutes(ctx, {
      log: (level: string, msg: string) => adapter.log(level, msg),
      projectDir: (cwd: string) => join(claudeHome, "projects", projectDirName(cwd)),
      projectsDir: join(claudeHome, "projects"),
      startedIds: loadStarted,
      claudeIdOf: claudeSessionId,
      settingsPath: join(claudeHome, "settings.json"),
      configDir: claudeHome,
      boxesPath: join(STATE_DIR, "boxes.json"),
      command: adapter.config.command,
      turnRecords: adapter.turnBuffer,
      idle: {
        deadlineFor: (session: string) => adapter.idleDeadlineMap.get(session) ?? null,
        extend: (session: string) => adapter.extendIdle(session),
        timeoutMs: adapter.config.idleTimeoutMs,
      },
      permissionModes: {
        info: (sessionId: string) => adapter.permissionModeInfo(sessionId),
        set: (sessionId: string, mode: string | null) => adapter.setPermissionMode(sessionId, mode),
      },
      rewind: (sessionId: string, uuid: string, dryRun: boolean) =>
        adapter.rewind(sessionId, uuid, dryRun),
    });
  }
}
