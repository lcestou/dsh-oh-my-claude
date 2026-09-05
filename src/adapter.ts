// dsh LLM adapter that drives the Claude Code CLI (`claude -p --input-format stream-json --output-format stream-json`).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  LlmAdapter,
  LlmError,
  type ContentBlock,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
  boundContextSummary,
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
  nodeSpawner,
  seamSpawner,
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
import { ADAPTER_CURRENT, RESUME_TIMER, PROCESS_REGISTRY, asSessionId } from "./dsh.js";
import {
  CLAUDE_HOME,
  STATE_DIR,
  auxCwd,
  authHeaders,
  loadStarted,
  markBusy,
  rememberStarted,
  takeInterrupted,
  trace,
} from "./state.js";
import { errorText, toolResultText } from "./process.js";
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
  debug: boolean;
  approvals: boolean;
  processIdleMs: number;
  maxProcesses: number;
};

/** Plugin name identifier. */
export const name = "dsh-llm-claude";
/** Services injected into the plugin by the dsh runtime. */
export const inject = ["llm", "sessions", "attachments", "agents", "approval", "userQuestions"];

/** Configuration schema for Claude Code plugin settings. */
export const Config = z.object({
  command: z
    .string()
    .default("claude")
    .description("Claude Code binary: a name on PATH or an absolute path"),
  spawn: z
    .union(["node", "dsh"])
    .default("node")
    .description(
      "How the Claude Code process is started. 'node': directly, with dsh's environment. 'dsh': through dsh's subprocess seam (ctx.subprocess); with a remote provider such as a remote subprocess provider mounted, a remote workspace then runs Claude Code on that machine. The seam scrubs credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD), so log in on the machine that runs it",
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
  const headers = await authHeaders();
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
async function claudeSessionExists(cwd: string, id: string): Promise<boolean> {
  try {
    await access(join(CLAUDE_HOME, "projects", projectDirName(cwd), `${id}.jsonl`));
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
}: Pick<GenerateOptions, "reasoningEffort" | "system" | "purpose"> & {
  model: string | undefined;
  config: Schemastery.TypeT<typeof Config>;
  session?: { id: string; resuming: boolean } | undefined;
  accessMode?: string | undefined;
  flags?: Set<string> | null;
  promptText?: string;
  mcp?: { url: string; key: string } | undefined;
}) {
  const args = ["-p"];
  if (usesStdin(flags)) args.push("--input-format", "stream-json");
  else args.push(promptText ?? "");
  args.push("--output-format", "stream-json", "--verbose");
  if (supports(flags, "--include-partial-messages")) args.push("--include-partial-messages");
  if (supports(flags, "--forward-subagent-text")) args.push("--forward-subagent-text");
  if (model) args.push("--model", model);
  if (reasoningEffort && supports(flags, "--effort")) args.push("--effort", reasoningEffort);
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
export const RESTART_TEXT =
  "dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task.";
/** How long after boot to nudge interrupted sessions; dsh needs its sessions and agents loaded. */
const RESUME_DELAY_MS = 10_000;
const isWake = (m: LooseMessage) =>
  m.role === "user" &&
  m.source?.kind === "plugin" &&
  m.source.plugin === "dsh-llm-claude" &&
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

  constructor({
    toolActivity = true,
    toolTextLimit = TOOL_TEXT_LIMIT,
    relay = false,
    dshIds,
    relayed,
    log,
  }: {
    toolActivity?: boolean;
    toolTextLimit?: number;
    relay?: boolean;
    dshIds?: Set<string>;
    relayed?: Set<string>;
    log?: (level: string, msg: string) => void;
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
        // Compaction opens with a `status:"compacting"` frame, then a long silent stretch while the
        // CLI summarizes, then `compact_boundary` when done. Announce the start at once so the silence
        // is explained; the boundary line reports the result. A failed run gets neither boundary nor a
        // start it can pair with, so surface its error here.
        if (event.subtype === "status") {
          if (event.status === "compacting")
            // SAFETY: "text" is a valid ContentBlockType
            return this.wholeBlock("text" as ContentBlockType, "\n\n_Compacting context…_\n\n");
          if (event.compact_result === "failed")
            // SAFETY: "text" is a valid ContentBlockType
            return this.wholeBlock(
              "text" as ContentBlockType,
              `\n\n_Compaction failed: ${event.compact_error || "unknown reason"}._\n\n`,
            );
          return [];
        }
        // Claude Code compacted its own context (auto or /compact). One line so the user knows
        // why the model may have lost detail; every other system subtype is handshake noise.
        if (event.subtype !== "compact_boundary") return [];
        const meta = event.compact_metadata ?? {};
        const how = meta.trigger === "manual" ? "manual" : "auto";
        const size = Number.isFinite(meta.pre_tokens) ? `, ${meta.pre_tokens} tokens before` : "";
        // SAFETY: "text" is a valid ContentBlockType
        return this.wholeBlock(
          "text" as ContentBlockType,
          `\n\n_Context compacted by Claude Code (${how}${size})._\n\n`,
        );
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
        if (!block || block.index < 0) return [];
        const d = ev.delta ?? {};
        const text = d.text ?? d.thinking ?? d.partial_json ?? "";
        return this.delta(block, text);
      }
      case "content_block_stop": {
        const block = this.open.get(ev.index ?? -1);
        if (!block) return [];
        this.open.delete(ev.index ?? -1);
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
      const raw = toolResultText(b).trim();
      if (b.is_error && DENIED_RE.test(raw)) this.denied++;
      const body = clip(raw || "(empty)", this.limit);
      const tag = parentToolUseId ? "↳ " : "";
      const toolUseId = b.tool_use_id ?? "";
      const dsh = this.dshIds.delete(toolUseId);
      if (dsh && this.relayed.delete(toolUseId)) continue; // dsh drew the native call and result
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
  constructor(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>) {
    super();
    this.ctx = ctx;
    this.config = config;
    this.warnedNoSeam = false;
    this.loggedVersion = false;
    // Kept on globalThis so a hot reload of this plugin adopts the running Claude processes
    // instead of orphaning them: their pipes belong to this node process, not to the plugin scope.
    // SAFETY: the registry symbol is this plugin's own key on globalThis, typed here once
    const registry = globalThis as typeof globalThis & {
      [PROCESS_REGISTRY]?: Map<string, ClaudeProcess>;
    };
    this.processes = registry[PROCESS_REGISTRY] ??= new Map(); // dsh sessionId → ClaudeProcess
    // Adopted processes still point their idle-reply callback at the previous (now dead) adapter.
    for (const [sessionId, proc] of this.processes) {
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
      const proc = this.processes.get(session?.id ?? "");
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
    return { id: provider, name: "Claude Code" };
  }

  override async listModels(provider: string) {
    return (await getCatalog()).map((m) => modelInfo(provider, m));
  }

  override async resolveModel(provider: string, model: string, _signal?: AbortSignal) {
    return resolveModelInfo(provider, model, await getCatalog());
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
      this.ctx.logger[level]?.(`dsh-llm-claude: ${message}`);
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
    const parentClaude = (await claudeSessionExists(parentCwd, parentId))
      ? parentId
      : claudeSessionId(parentId);
    let text;
    try {
      text = await readFile(
        join(CLAUDE_HOME, "projects", projectDirName(parentCwd), `${parentClaude}.jsonl`),
        "utf8",
      );
    } catch {
      return false;
    }
    // ponytail: prompt counting assumes one Claude prompt per dsh user turn; a turn dsh skipped
    // as already-forwarded (see dropSent) shifts the cut by one.
    const keep =
      userPromptCount(options.messages) - userPromptCount(afterLastAssistant(options.messages));
    const dest = join(CLAUDE_HOME, "projects", projectDirName(cwd), `${id}.jsonl`);
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
    if (!options.purpose && this.config.resume && options.sessionId) {
      // A dsh session opened from a Claude Code transcript carries the Claude id itself.
      const own = await claudeSessionExists(cwd, options.sessionId);
      const id = own ? options.sessionId : claudeSessionId(options.sessionId);
      let known = own || (await loadStarted()).has(id) || (await claudeSessionExists(cwd, id));
      if (!known && !forceFresh) known = await this.forkTranscript(options, cwd, id);
      session = { id, resuming: known && !forceFresh };
    }
    const turns = selectTurns(options.messages, session?.resuming ?? false);
    const prompt = buildPrompt(turns);
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
      promptText: prompt,
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
      input: stdin ? buildInput(prompt, images) : null,
    };
  }

  /**
   * After a dsh restart, sessions that had a turn running get a prompt to continue, so the user
   * does not have to come back and poke each one. Sessions with a live (adopted) process are a
   * hot reload, not a restart, and are left alone.
   */
  async resumeInterrupted(path?: string) {
    const ids = await takeInterrupted(path);
    await trace(
      `boot: interrupted=${JSON.stringify(ids)} live=${JSON.stringify([...this.processes.keys()])}`,
    );
    for (const id of ids) {
      const proc = this.processes.get(id);
      if (proc) {
        // A hot reload, or the user already typed since boot: the turn is live, keep it tracked.
        if (proc.busy) await markBusy(id, true, path);
        await trace(`skip ${id}: process live (busy=${proc.busy})`);
        continue;
      }
      try {
        await this.wake(id, undefined, RESTART_TEXT);
        await trace(`nudged ${id}`);
      } catch (e) {
        await trace(`nudge ${id} failed: ${errorText(e)}`);
      }
    }
    return ids;
  }

  /** Node's spawn, or dsh's subprocess seam when configured and mounted. */
  spawner() {
    if (this.config.spawn === "dsh" && this.subprocess) return seamSpawner(this.subprocess);
    if (this.config.spawn === "dsh" && !this.warnedNoSeam) {
      this.warnedNoSeam = true;
      this.log("warn", "spawn: dsh requested but ctx.subprocess is not mounted; using node spawn");
    }
    return nodeSpawner;
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
        command: this.config.command,
        spawner: this.spawner(),
        onExit: (p) => {
          if (this.processes.get(options.sessionId) === p) this.processes.delete(options.sessionId);
        },
      });
      proc.key = key;
      proc.resuming = prep.session?.resuming ?? false;
      proc.onIdleResult = () => this.wake(options.sessionId, proc);
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
      if (!p.alive || (isSettled(p) && now - p.lastUsed > this.config.processIdleMs)) {
        p.kill();
        this.processes.delete(id);
      }
    }
    const idle = [...this.processes.entries()]
      .filter(([, p]) => isSettled(p))
      .toSorted((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.processes.size >= this.config.maxProcesses && idle.length > 0) {
      const next = idle.shift();
      if (!next) break;
      const [id, p] = next;
      p.kill();
      this.processes.delete(id);
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
    const held = this.processes.get(options.sessionId);
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
      this.processes.delete(options.sessionId);
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
    }
    const tr = new Translator({
      toolActivity: this.config.toolActivity,
      toolTextLimit: this.config.toolTextLimit,
      relay: this.mcp !== undefined && this.config.dshTools,
      dshIds: proc.dshIds,
      relayed: proc.relayed,
      log: this.log.bind(this),
    });
    const pending = new Map(); // control request id → AbortController
    let outcome: Outcome = "ended"; // ended | finished | relayed | parked | retry
    const wakeOnly = cont.mode === "prompt" && wakeOnlyTurn(options.messages);
    let idle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        proc.kill();
      }, this.config.idleTimeoutMs);
    };
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
    markBusy(options.sessionId, true).catch((e) => this.log("warn", `busy.json: ${errorText(e)}`));
    const handleControl = this.handleControl.bind(this);
    /** One CLI event. Returns what the loop should do next. */
    const dispatch = async function* (event: ClaudeEvent) {
      if (event.type === "control_request") {
        yield* handleControl(event, options, prep, proc, pending, tr);
        return "continue";
      }
      if (event.type === "control_cancel_request") {
        pending.get(event.request_id)?.abort();
        return "continue";
      }
      if (event.type === "control_response" || event.type === "timeout") return "continue";
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
      if (tr.toolPending) clearTimeout(timer); // tool running: silence is expected, do not time out
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
      armIdle();
      for (;;) {
        const event = await proc.nextEvent();
        if (event === null) break;
        armIdle();
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
      } else yield { type: "finish", reason: this.endReason(proc, options, idle) };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      for (const c of pending.values()) c.abort();
      proc.busy = false;
      proc.lastUsed = Date.now();
      markBusy(options.sessionId, false).catch((e) =>
        this.log("warn", `busy.json: ${errorText(e)}`),
      );
      if (outcome === "retry" || outcome === "ended") {
        proc.kill();
        this.processes.delete(options.sessionId);
      }
    }
    if (outcome === "retry") yield* this.turn(options, true);
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
    if (text === RESTART_TEXT) await trace(`wake ${sessionId}: agent ${how}, sending followup`);
    try {
      this.log("info", `wake: idle reply in session ${sessionId} (agent ${how})`);
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: {
            kind: "plugin",
            plugin: "dsh-llm-claude",
            form: "notice",
            summary: boundContextSummary(text),
          },
        }),
      );
    } catch (error) {
      this.log("warn", `wake after idle reply failed: ${errorText(error)}`);
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
    const proc = this.processes.get(sessionId);
    if (!proc?.alive || !proc.busy || proc.relays.size > 0) return undefined;
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
      spec: { cwd, model: options.model ?? "", effort: null, mode: "plan", sessionId: null },
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
    let timer: ReturnType<typeof setTimeout> | undefined;
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
      // SAFETY: reason matches FinishReason shape for error/aborted cases
      yield { type: "finish", reason: reason as FinishReason };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      proc.kill();
    }
  }
}

export function apply(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>) {
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
    [ADAPTER_CURRENT]?: ClaudeCodeAdapter;
    [RESUME_TIMER]?: ReturnType<typeof setTimeout>;
  };
  g[ADAPTER_CURRENT] = adapter;
  if (!g[RESUME_TIMER]) {
    g[RESUME_TIMER] = setTimeout(() => {
      const current = g[ADAPTER_CURRENT] ?? adapter;
      current
        .resumeInterrupted()
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
  registerMcpBridge(ctx, {
    log: (level, msg) => adapter.log(level, msg),
    version: "0.9.0",
    relay: (sessionId, toolName, args, signal) => adapter.relay(sessionId, toolName, args, signal),
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
  );
  registerSessionRoutes(ctx, {
    log: (level: string, msg: string) => adapter.log(level, msg),
    projectDir: (cwd: string) => join(CLAUDE_HOME, "projects", projectDirName(cwd)),
    projectsDir: join(CLAUDE_HOME, "projects"),
    startedIds: loadStarted,
    claudeIdOf: claudeSessionId,
    settingsPath: join(CLAUDE_HOME, "settings.json"),
    configDir: CLAUDE_HOME,
    boxesPath: join(STATE_DIR, "boxes.json"),
    command: adapter.config.command,
  });
}
