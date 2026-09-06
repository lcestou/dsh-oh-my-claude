import type { Spawner, ContextUsage, WorkspaceDiff } from "./process.js";
import { LlmAdapter, type ContentBlock, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { type ClaudeEvent, ClaudeProcess } from "./process.js";
import type { Agent, ImageAttachmentRef, JsonValue, PluginContext, SessionController, SessionId, SubprocessRuntime } from "./dsh.js";
import { ADAPTER_CURRENT, RESUME_TIMER, PROCESS_REGISTRY } from "./dsh.js";
import type { RewindResult } from "./process.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import type { FinishReason } from "@deepseek-ai/dsh-llm";
import type { ClaudeContentBlock, ClaudeProcessSpec, ClaudeStreamPartial, RelayEvent, RelayResult, TurnPrep } from "./process.js";
/** A dsh request that belongs to a session; everything on the persistent path has one. */
type SessionOptions = GenerateOptions & {
    sessionId: SessionId;
};
/** The CLI asking for a permission or a question. */
type ControlRequestEvent = Extract<ClaudeEvent, {
    type: "control_request";
}>;
/** How this request continues the session's Claude process; see continuationFor(). */
type Continuation = {
    mode: "abandon" | "steer";
    proc: ClaudeProcess;
    options: SessionOptions;
} | {
    mode: "relay";
    proc: ClaudeProcess;
    options: SessionOptions;
    results: RelayResult[];
} | {
    mode: "prompt";
    proc?: undefined;
    options: SessionOptions;
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
/** Configuration shape produced by the Config schema with defaults applied. */
export type Config = {
    command: string;
    spawn: "node" | "dsh";
    configDir: string;
    permissionMode: "dsh" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | "manual";
    allowedTools: string[];
    disallowedTools: string[];
    addDirs: string[];
    maxTurns?: number;
    maxBudgetUsd?: number;
    titleModel: string;
    toolActivity: boolean;
    hookRows: boolean;
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
export declare const name = "dsh-oh-my-claude";
/** Services injected into the plugin by the dsh runtime. */
export declare const inject: string[];
/** Configuration schema for Claude Code plugin settings. */
export declare const Config: z<Schemastery.ObjectS<{
    command: z<string, string>;
    spawn: z<"dsh" | "keeper" | "node", "dsh" | "keeper" | "node">;
    permissionMode: z<"acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan", "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan">;
    allowedTools: z<string[], string[]>;
    disallowedTools: z<string[], string[]>;
    addDirs: z<string[], string[]>;
    maxTurns: z<number, number>;
    maxBudgetUsd: z<number, number>;
    titleModel: z<string, string>;
    toolActivity: z<boolean, boolean>;
    hookRows: z<boolean, boolean>;
    resume: z<boolean, boolean>;
    idleTimeoutMs: z<number, number>;
    toolTextLimit: z<number, number>;
    dshTools: z<boolean, boolean>;
    fastMode: z<boolean, boolean>;
    commandBridge: z<boolean, boolean>;
    redactSecrets: z<boolean, boolean>;
    persistTodos: z<boolean, boolean>;
    debug: z<boolean, boolean>;
    approvals: z<boolean, boolean>;
    processIdleMs: z<number, number>;
    maxProcesses: z<number, number>;
    configDir: z<string, string>;
    providerId: z<string, string>;
    providerName: z<string, string>;
}>, Schemastery.ObjectT<{
    command: z<string, string>;
    spawn: z<"dsh" | "keeper" | "node", "dsh" | "keeper" | "node">;
    permissionMode: z<"acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan", "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan">;
    allowedTools: z<string[], string[]>;
    disallowedTools: z<string[], string[]>;
    addDirs: z<string[], string[]>;
    maxTurns: z<number, number>;
    maxBudgetUsd: z<number, number>;
    titleModel: z<string, string>;
    toolActivity: z<boolean, boolean>;
    hookRows: z<boolean, boolean>;
    resume: z<boolean, boolean>;
    idleTimeoutMs: z<number, number>;
    toolTextLimit: z<number, number>;
    dshTools: z<boolean, boolean>;
    fastMode: z<boolean, boolean>;
    commandBridge: z<boolean, boolean>;
    redactSecrets: z<boolean, boolean>;
    persistTodos: z<boolean, boolean>;
    debug: z<boolean, boolean>;
    approvals: z<boolean, boolean>;
    processIdleMs: z<number, number>;
    maxProcesses: z<number, number>;
    configDir: z<string, string>;
    providerId: z<string, string>;
    providerName: z<string, string>;
}>>;
/** Keys the shared process registry by instance so two mounts never see each other's processes. */
/** Outcome of a control request this plugin sent to the CLI; `response` is the CLI's payload. */
export type ControlReply = {
    ok: true;
    error?: undefined;
    response?: JsonValue;
} | {
    ok: false;
    error: string;
    response?: undefined;
};
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
/** What the context route reports: the CLI's own context breakdown for a live session. */
export type ContextUsageReply = ({
    ok: true;
    error?: undefined;
} & ContextUsage) | {
    ok: false;
    error: string;
};
/** What the diff route reports: the CLI's working-tree diff for a live session. */
export type WorkspaceDiffReply = ({
    ok: true;
    error?: undefined;
} & WorkspaceDiff) | {
    ok: false;
    error: string;
};
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
export declare function registryKey(providerId: string, sessionId: string): string;
declare const EFFORTS_ALL: readonly ["low", "medium", "high", "xhigh", "max"];
/** One effort level's capability flag, as the Models API reports it. */
type EffortLevelCaps = {
    supported?: boolean;
};
/** The effort capability block: an overall flag plus one flag per level. */
type EffortCaps = {
    supported?: boolean;
} & Partial<Record<(typeof EFFORTS_ALL)[number], EffortLevelCaps>>;
declare const M: (id: string, label: string, contextWindow: number, efforts: readonly string[]) => {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
};
export declare const KNOWN_MODELS: {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
}[];
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
export declare function modelFromApi(m: {
    id?: string;
    display_name?: string;
    max_input_tokens?: number;
    capabilities?: {
        effort?: EffortCaps;
    };
}): LlmModelInfo;
/**
 * Fetches or returns cached model catalog from Anthropic Models API.
 * Falls back to KNOWN_MODELS if the API is unreachable.
 * @param {Function} fetchImpl - Fetch implementation to use (default: global fetch)
 * @returns {Promise<Array>} Array of available models
 */
export declare function getCatalog(fetchImpl?: typeof fetch): Promise<{
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
}[]>;
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export declare function resolveModelInfo(provider: string, modelId: string, models?: ReturnType<typeof M>[]): LlmResolvedModelInfo;
/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
export declare function claudeSessionId(sessionId: string): string;
/** Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl */
export declare function projectDirName(cwd: string): string;
/** The slice of a dsh message this adapter reads; dsh's own Message type is wider. */
/** The slice of a dsh message this adapter reads; exported for test fixtures. */
export type LooseMessage = {
    role?: string;
    source?: {
        kind?: string;
        plugin?: string;
        rpcId?: string;
    };
    content?: string | ContentBlock[];
};
/**
 * Pick the messages that go into this call. Resuming: only what came after the last assistant turn
 * (the new prompt plus dsh's context injections). Fresh: the whole transcript, since `claude -p` is stateless.
 */
export declare function selectTurns(messages: LooseMessage[] | undefined, resuming: boolean): LooseMessage[];
/** dsh's instruction bundle repeats files Claude Code already loads on its own (`CLAUDE.md` in the
 *  workspace, `~/.claude/CLAUDE.md`), so those blocks are dropped from what goes to Claude. The
 *  bundle is one `<system-reminder>` with `Instructions from: <path>` headers; a block runs to
 *  the next header or the closing tag. Empty when nothing but the wrapper would remain. */
export declare function withoutNativeInstructions(text: string): string;
/** Text body sent as the user prompt. Assistant turns get role labels so history stays legible. */
export declare function buildPrompt(turns: LooseMessage[]): string;
/**
 * Extracts image attachment references from message turns.
 * Limits to the last MAX_IMAGES to avoid exceeding CLI limits.
 * @param {Array} turns - Message turns
 * @returns {Array} Image attachment references
 */
/** An image loaded from dsh's attachment store, ready for the stdin line. */
type LoadedImage = {
    mediaType: string;
    data: string;
    attachmentId?: string;
};
/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export declare function accessModeOf(messages: LooseMessage[] | undefined): string | undefined;
/**
 * Resolves the Claude Code permission mode based on configuration and
 * dsh access mode.
 * @param {object} config - Plugin configuration
 * @param {string} accessMode - dsh access mode
 * @returns {string} Permission mode for Claude Code
 */
export declare function permissionModeFor(config: Schemastery.TypeT<typeof Config>, accessMode: string | undefined): string;
/**
 * Probes the Claude Code CLI to determine its version and supported flags.
 * Caches the result across multiple calls.
 * @param {Function} exec - execFile implementation (default: node's execFile)
 * @returns {Promise<object>} Object with flags Set and version string
 */
/** The slice of node's execFile the probe uses; tests hand in a fake with this shape. */
export type ExecLike = (cmd: string, args: string[], opts: {
    timeout: number;
}, cb: (err: Error | null, stdout: string | Buffer) => void) => void;
export declare function probeCli(exec?: ExecLike, command?: string): any;
/**
 * Checks if a CLI flag is supported. Returns true if flags are unknown
 * (probe failed) to assume support.
 */
export declare const supports: (flags: Set<string> | null | undefined, flag: string) => boolean;
/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export declare const usesStdin: (flags: Set<string> | null | undefined) => boolean;
/**
 * Constructs command-line arguments for spawning a Claude Code process.
 * Handles model, effort, permissions, MCP config, and other flags.
 */
/**
 * Appended to the system prompt whenever dsh tools are bridged. Claude Code's own Agent tool
 * spawns children dsh cannot see (no card, no header count, no notice), so subagents must go
 * through the bridged tools. Routes are box-specific, hence the pointer to list_subagent_models.
 */
export declare const DSH_TOOLS_GUIDANCE: string;
export declare function buildArgs({ model, reasoningEffort, system, purpose, config, session, accessMode, flags, promptText, mcp, temporary, permissionMode, }: Pick<GenerateOptions, "reasoningEffort" | "system" | "purpose"> & {
    model: string | undefined;
    config: Schemastery.TypeT<typeof Config>;
    session?: {
        id: string;
        resuming: boolean;
    } | undefined;
    accessMode?: string | undefined;
    flags?: Set<string> | null;
    promptText?: string;
    mcp?: {
        url: string;
        key: string;
    } | undefined;
    /** /temporary: keep no Claude transcript for this session. */
    temporary?: boolean;
    /** Optional permission mode override; if provided, used instead of computing from config. */
    permissionMode?: string;
}): string[];
/** One stream-json input line: the user turn with text and inline images. */
export declare function buildInput(prompt: string, images: Array<{
    mediaType: string;
    data: string;
}>): string;
/** Names from the CLI's init frame that dsh's command grammar accepts (lowercase, `[a-z0-9_-]`), deduped. */
export declare function commandNames(value: JsonValue | undefined): string[];
/** Bridged Claude commands are registered as `/claude-<name>` in dsh. */
export declare const BRIDGE_PREFIX = "claude-";
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
/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export declare function isStaleResume(event: ClaudeEvent): boolean;
export declare function finishReason(result: {
    is_error?: boolean;
    stop_reason?: string;
    result?: unknown;
    errors?: unknown[];
    api_error_status?: number;
    subtype?: string;
}): FinishReason;
/** dsh's tool-result for a relayed call, searched from the newest message back. */
export declare function toolResultFor(messages: LooseMessage[] | undefined, id: string): {
    text: string;
    isError?: boolean;
} | undefined;
/** Messages dsh delivered after the last assistant step. */
export declare function afterLastAssistant(messages: LooseMessage[] | undefined): LooseMessage[];
/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export declare const WAKE_TEXT = "Claude Code finished a background task and replied.";
/** Sent as a real prompt after dsh restarts mid-turn: the process is gone, Claude must carry on. */
/** Sent when a restarted dsh reattaches to a Claude process that kept running meanwhile. */
export declare const RECONNECT_TEXT = "[Oh My Claude] dsh restarted and reattached to your still-running Claude Code process; what you did meanwhile is shown above. Continue where you are.";
export declare const RESTART_TEXT = "[Oh My Claude] dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task. If this session has an active goal, dsh disarmed it on resume: call get_goal, then update_goal with action resume, so the goal rounds keep driving the work without anyone typing.";
/** A turn opened by our own wake notice, with no user prompt to send: only drain what Claude
 *  already wrote. A user prompt in the same batch takes precedence and is sent normally. */
export declare function wakeOnlyTurn(messages: LooseMessage[] | undefined): boolean;
/** Drop user messages Claude already received live on stdin (matched by the prompt's rpcId). */
export declare function dropSent<T extends LooseMessage>(messages: T[] | undefined, sent: Set<string> | undefined): T[];
/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. */
export declare function stepContextFor(messages: LooseMessage[] | undefined): string;
export { PROCESS_REGISTRY, ADAPTER_CURRENT, RESUME_TIMER };
/** Count the human prompts dsh has in a transcript (context injections and tool results excluded). */
export declare function userPromptCount(messages: LooseMessage[] | undefined): number;
/** The stream chunks that make one relayed dsh tool call a native tool-call block. */
export declare function relayBlocks(tr: Translator, call: RelayEvent): IterableIterator<StreamChunk>;
export interface TranslatorBlock {
    index: number;
    blockType: string;
    text: string;
    started: boolean;
    tool?: boolean;
}
export declare class Translator {
    log: (level: string, msg: string) => void;
    unknownSeen: Set<string>;
    toolActivity: boolean;
    relay: boolean;
    dshIds: Set<string>;
    dshNames: Map<string, string>;
    relayed: Set<string>;
    limit: number;
    index: number;
    open: Map<number, TranslatorBlock>;
    sawPartial: boolean;
    finished: boolean;
    denied: number;
    toolPending: boolean;
    aborting: boolean;
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
    readonly callInputs: Map<string, string>;
    /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
    readonly firedCalls: Map<string, number>;
    /**
     * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
     * reach the same tool_use block; a second append gives the client two `tool/call` starts for
     * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
     */
    private fireToolCall;
    constructor({ toolActivity, toolTextLimit, relay, dshIds, relayed, log, onToolCall, onToolResult, onResult, redact, onInit, }?: {
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
    });
    deltaType(block: TranslatorBlock): "text-delta" | "reasoning-delta";
    /** Warn once when a CLI event/block type is neither handled nor knowingly ignored, so a Claude
     *  Code stream-json schema change shows up loud in the log instead of as silently dropped output. */
    noteUnknown(where: string, type: string | null | undefined): void;
    /** A block is announced on its first text. Claude emits thinking blocks that carry only a
     *  signature and never any text; announcing those eagerly draws an empty bubble. */
    startBlock(blockType: string, prefix?: string): {
        block: TranslatorBlock;
        events: StreamChunk[];
    };
    /** Text for a block, with its block-start ahead of the first non-empty piece. Empty in, empty out. */
    delta(block: TranslatorBlock, text: string): StreamChunk[];
    /** Close a block; one that never got text was never announced and closes silently. */
    endBlock(block: TranslatorBlock): StreamChunk[];
    wholeBlock(blockType: string, text: string): StreamChunk[];
    translate(event: ClaudeEvent): StreamChunk[];
    partial(ev: ClaudeStreamPartial): StreamChunk[];
    /** Tracks content_block metadata for native-tool blocks whose input we collect via deltas. */
    readonly cbMeta: Map<number, {
        id?: string;
        name?: string;
    }>;
    openBlock(apiIndex: number, cb: {
        type?: string;
        id?: string;
        name?: string;
    }): StreamChunk[];
    assistant(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
    /** dsh tools reached over the MCP bridge (subagents, jobs...) render as visible text rows, the
     *  rest as collapsed reasoning. Returns [block kind, lead text]. */
    toolLead(cb: {
        id?: string;
        name?: string;
    }): [string, string];
    toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
}
export declare class ClaudeCodeAdapter extends LlmAdapter {
    ctx: PluginContext;
    config: Schemastery.TypeT<typeof Config>;
    subprocess?: Pick<SubprocessRuntime, "spawn">;
    processes: Map<string, ClaudeProcess>;
    mcp?: {
        base: string;
        key: string;
    };
    warnedNoSeam: boolean;
    loggedVersion: boolean;
    sessionController?: SessionController;
    /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
    readonly redact: ((s: string) => string) | undefined;
    /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
    readonly temporary: Set<string>;
    /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
     *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
    readonly turnBuffer: Map<string, TurnRecord[]>;
    /** Per-session idle watchdog deadline in epoch ms; null means no active arm. */
    readonly idleDeadlineMap: Map<string, number | null>;
    /** Per-session kill and warning timers, keyed by session id. */
    readonly idleKillTimers: Map<string, NodeJS.Timeout>;
    readonly idleWarnTimers: Map<string, NodeJS.Timeout>;
    /** What each armed key watches, so a route can re-arm it. */
    readonly idleTargets: Map<string, {
        proc: IdleTarget;
        warn: boolean;
    }>;
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
    constructor(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>);
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    listModels(provider: string): Promise<{
        provider: string;
        id: string;
        name: string;
        inputModalities: readonly ["text", "image"];
    }[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /** Get the effective permission mode for a session, checking for an override first. */
    getPermissionMode(sessionId: string, accessMode: string | undefined): string;
    sessionCwd(sessionId: string): string | undefined;
    log(level: string, message: string): void;
    loadImages(refs: ImageAttachmentRef[], signal: AbortSignal | undefined): Promise<LoadedImage[]>;
    /** A dsh fork of a Claude session becomes a Claude fork: the parent's transcript is copied under
     *  the new id, cut at the forked turn. True when a copy was made. */
    forkTranscript(options: GenerateOptions, cwd: string, id: string): Promise<boolean>;
    /** Everything one turn needs: spawn args + spec for the long-lived process, and the stdin line for this turn. */
    prepare(options: GenerateOptions, { forceFresh }?: {
        forceFresh?: boolean;
    }): Promise<TurnPrep>;
    /** Claude slash commands already registered as dsh commands, name → disposer. */
    readonly bridged: Map<string, () => void>;
    /**
     * Register Claude Code's slash commands (from the CLI's init frame) as dsh `/commands`. The
     * handler hands the line to Claude as the next prompt, where the CLI expands the skill or
     * custom command the way the terminal does; dsh keeps its own command of the same name.
     */
    bridgeCommands(names: string[], agent: Agent | undefined): void;
    /** The effective mode for a session and the stored override, for the header chip. */
    permissionModeInfo(sessionId: string): PermissionModeInfo;
    /**
     * Store a session's permission mode override (null clears it) and, when that session's Claude
     * process is alive, switch it live with a `set_permission_mode` control request. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens.
     */
    setPermissionMode(sessionId: string, mode: string | null): Promise<PermissionModeReply>;
    /**
     * A spec that differs from the live process only by model is switched in place with a
     * `set_model` control request, so a model flip keeps the process and its MCP bridge instead of
     * a kill and `--resume`. Anything else (cwd, effort, mode, session flags) still respawns: the CLI
     * has no live seam for `--effort`. On success the process carries the new spec and key.
     * ponytail: the keeper's spec.json keeps the old model; a reattach after a dsh restart sees a key
     * mismatch and respawns with --model, which is correct, only one spawn later than ideal.
     */
    retarget(proc: ClaudeProcess, spec: ClaudeProcessSpec): Promise<boolean>;
    /** Hand a `control_response` to whoever sent the request; true when someone was waiting. */
    resolveControl(event: ClaudeEvent): boolean;
    /**
     * Send one control request and wait for its answer. The process hands `control_response` lines
     * to `resolveControl` as they arrive, so this works between turns as well as inside one.
     */
    control(proc: ClaudeProcess, request: Record<string, JsonValue>, timeoutMs?: number): Promise<ControlReply>;
    /**
     * Rewind a session to one of its user prompts: `rewind_files` (dry run first, from the UI) puts
     * the working tree back, then `rewind_conversation` drops Claude's context after that prompt.
     * dsh's own transcript is not touched.
     */
    rewind(sessionId: string, uuid: string, dryRun: boolean): Promise<RewindReply>;
    /**
     * dsh's session-title request, served by the session's live Claude process through the
     * `generate_session_title` control request instead of a second one-shot spawn on `titleModel`.
     * `persist: true` also names Claude's own session, so `claude --resume` shows the same title.
     * Undefined when there is no live process or the CLI declines; the caller then falls back to
     * the one-shot path.
     */
    titleFromCli(sessionId: string, description: string): Promise<string | undefined>;
    /** The CLI's working-tree diff (`get_workspace_diff`) for a session with a live process. */
    workspaceDiff(sessionId: string): Promise<WorkspaceDiffReply>;
    /**
     * The CLI's own context breakdown (`/context` in the TUI) for a session with a live process;
     * answered between turns as well as inside one. 5 s: the CLI replies at once when it reads stdin.
     */
    contextUsage(sessionId: string): Promise<ContextUsageReply>;
    /**
     * `/temporary`: toggle "keep no Claude transcript" for the current dsh session. Registered here,
     * from the first init frame, because at apply() the commands service is not up yet and the
     * optional lookup returns nothing. The next process for the session starts with
     * --no-session-persistence; a live one is replaced by the spec change.
     */
    registerTemporaryCommand(commands: NonNullable<PluginContext["commands"]>): void;
    /** Two boots closer than this are a crash loop, not a restart. */
    static readonly BOOT_BACKOFF_MS = 60000;
    /**
     * After a dsh restart, sessions that had a turn running get a prompt to continue, so the user
     * does not have to come back and poke each one. Sessions with a live (adopted) process are a
     * hot reload, not a restart, and are left alone.
     */
    resumeInterrupted(path?: string): Promise<string[] | undefined>;
    /** Node's spawn, or dsh's subprocess seam when configured and mounted. */
    /** Where a session's keeper lives: one directory per provider id and dsh session. */
    keeperDir(sessionId: string): string;
    /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
    keeperEnv(): Record<string, string>;
    /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
    spawnerFor(sessionId: string | undefined, spec: ClaudeProcessSpec): Spawner;
    /**
     * At boot, reattach to keepers whose Claude process is still alive (a dsh restart left them
     * running) and register them as this instance's processes. One with output waiting gets a
     * drain turn so what Claude did during the gap shows up without anyone typing.
     */
    adoptKeepers(): Promise<void>;
    spawner(): Spawner;
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
    /** Reuse the session's process when its spec still matches; otherwise replace it. */
    acquire(options: SessionOptions, forceFresh?: boolean): Promise<{
        prep: TurnPrep;
        proc: null;
    } | {
        prep: TurnPrep;
        proc: ClaudeProcess;
    }>;
    /** Drop processes idle past processIdleMs, then keep the live count under maxProcesses by
     *  killing the longest-idle ones that are not mid-turn. Called before each spawn. */
    /** Live processes belonging to this mount; the registry is shared across mounts. */
    ownProcessCount(): number;
    evict(): void;
    /**
     * How this dsh request continues the session's Claude process, if at all:
     * - `relay`: parked on relayed tool call(s) and dsh brought every result: answer them, keep going.
     * - `steer`: parked after a live steer reached Claude mid-turn, or everything dsh delivers now was
     *   already forwarded and the CLI answered it as a turn of its own: keep translating, write nothing
     *   new (or only the messages Claude has not seen).
     * - `abandon`: parked on relays but dsh moved on without their results: reject them, start over.
     * - `prompt`: a normal turn; steers Claude already got live are dropped from the prompt.
     */
    continuationFor(options: SessionOptions, forceFresh?: boolean): Continuation;
    /** First write of a turn: relay results, unsent steers, or the prompt itself. */
    openTurn(cont: Continuation, proc: ClaudeProcess, prep: TurnPrep): void;
    /**
     * Arm the idle watchdog for a stream: `proc` is killed after `idleTimeoutMs` of silence. Every
     * event re-arms. Shortly before the kill (60 s, or half the timeout when it is under 120 s) a
     * warning event is queued on the process so the turn loop draws a countdown row; `warn: false`
     * skips that for the aux stream, whose loop has no reasoning lane.
     */
    armIdle(key: string, proc: IdleTarget, warn?: boolean): void;
    /** Stop the watchdog for a stream: the turn ended, or a tool is running and silence is expected. */
    clearIdle(key: string): void;
    /** Push a stream's deadline out by one full timeout; false when nothing is armed under `key`. */
    extendIdle(key: string): boolean;
    /** Why a turn that neither finished nor parked ended. */
    endReason(proc: ClaudeProcess, options: SessionOptions, idle: boolean): FinishReason;
    turn(options: SessionOptions, forceFresh?: boolean): AsyncGenerator<StreamChunk>;
    /** dsh's todo projection resets to null on every `turn/start`, so the panel empties each message.
     *  Called at the top of an open turn (dsh's invariant rejects a `todo/write` outside one), this
     *  re-appends the last todo list so it persists across messages and, because it reads persisted
     *  session events, across a restart too. Source-agnostic: works for dsh's own todo tool.
     *  ponytail: O(n) scan of session events per turn; cache the last list if long sessions lag. */
    restoreTodos(sessionId: string): void;
    /** Claude finished a turn of its own (a background task it launched completed) while dsh was
     *  idle. Drop a notice into the session's inbox so dsh opens a turn now and the reply shows,
     *  instead of riding on top of the user's next prompt. */
    wake(sessionId: string, proc: ClaudeProcess | undefined, text?: string): Promise<void>;
    /** Offer a dsh tool call from the MCP bridge to the session's live turn. Undefined when no turn
     *  can take it (idle process, a relay already pending); the bridge then executes it directly. */
    relay(sessionId: string, toolName: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<RelayResult> | undefined;
    /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
    handleControl(event: ControlRequestEvent, options: SessionOptions, prep: TurnPrep, proc: ClaudeProcess, pending: Map<string, AbortController>, tr: Translator): AsyncGenerator<StreamChunk, void, unknown>;
    decide({ toolName, input, request, toolUseId, agent, signal, accessMode }: Decision): Promise<{
        behavior: "allow";
        updatedInput: unknown;
        toolUseID: string;
        decisionClassification: "user_temporary";
    } | {
        behavior: "deny";
        message: string;
        toolUseID: string;
        decisionClassification: "user_reject";
    }>;
    oneShot(options: GenerateOptions): AsyncGenerator<StreamChunk>;
}
export declare function apply(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>): void;
