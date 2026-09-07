import type { Spawner, ContextUsage, WorkspaceDiff, McpServerStatus, CliModel } from "./process.js";
import { LlmAdapter, type ContentBlock, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { type PickerSettings } from "./sessions.js";
import { readUsage } from "./usage.js";
import { type ClaudeEvent, ClaudeProcess } from "./process.js";
import type { Agent, ImageAttachmentRef, JsonValue, PluginContext, SessionController, SessionId, SubprocessRuntime } from "./dsh.js";
import { ADAPTER_CURRENT, RESUME_TIMER, PROCESS_REGISTRY } from "./dsh.js";
import type { RewindResult } from "./process.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import { Translator } from "./translator.js";
export { Translator, type TranslatorBlock } from "./translator.js";
import type { FinishReason } from "@deepseek-ai/dsh-llm";
import type { ClaudeProcessSpec, RelayEvent, RelayResult, TurnPrep } from "./process.js";
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
    pluginDirs: string[];
    pluginUrls: string[];
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
    pluginDirs: z<string[], string[]>;
    pluginUrls: z<string[], string[]>;
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
    continueAfterLimit: z<boolean, boolean>;
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
    pluginDirs: z<string[], string[]>;
    pluginUrls: z<string[], string[]>;
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
    continueAfterLimit: z<boolean, boolean>;
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
/**
 * One `/btw` side question and its answer. The CLI answers a `side_question` control request out of
 * band, off the transcript, so the answer lands here and the client draws it in a floating bubble
 * rather than in the stream. `pending` is true from the moment the question is asked until the
 * control response (or an error) arrives.
 */
export interface AsideEntry {
    id: string;
    question: string;
    answer?: string;
    error?: string;
    pending: boolean;
    at: number;
}
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
/** What the MCP route reports: the servers Claude's process has, as `mcp_status` lists them. */
export type McpStatusReply = {
    ok: true;
    error?: undefined;
    servers: McpServerStatus[];
} | {
    ok: false;
    error: string;
};
/** What the permission-mode route reports: the mode in force and the stored override. */
export interface PermissionModeInfo {
    mode: string;
    override: string | null;
    /** The session's dsh access mode as last seen, or null when unknown. */
    accessMode: string | null;
    /** The Claude permission mode that maps from the access mode, via `permissionModeFor`. */
    ceiling: string;
    /** Permission modes the client may pick (at or below the ceiling). */
    allowed: readonly string[];
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
 * The Models API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone
 * (`claude-opus-5`), while the list above and the CLI's own picker use the undated form. The CLI
 * takes either, but dsh keys a model by its id: a lineup that spells the same model one way from
 * the API and another from this list retires the enabled one and offers a fresh unselected copy
 * every time the source changes. So an API id whose undated form is one we know is advertised
 * undated, and an id we do not know keeps whatever the API called it.
 */
export declare const stableModelId: (id: string) => string;
/**
 * Pull the answer text out of a `side_question` control response. The CLI answers with
 * `{ response: string }` (or a bare string on some paths, or null when it declined), so both shapes
 * are parsed at this I/O boundary and blank or absent answers report as none.
 */
export declare function asideAnswerText(response: JsonValue | undefined): string | undefined;
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export declare function parseCatalogCache(text: string): ReturnType<typeof M>[];
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
export declare function mergeCatalog(cli: CliModel[], base: ReturnType<typeof M>[], picker?: PickerSettings): {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
}[];
export declare function getCatalog(fetchImpl?: typeof fetch, cli?: CliModel[], picker?: PickerSettings): Promise<{
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
        clientTimeZone?: string;
    };
    content?: string | ContentBlock[];
};
/** The browser's IANA zone as dsh stamped it on the latest user prompt; undefined when no
 *  prompt carried one (an API caller, an old log), so clocks fall back to the box's zone. */
export declare function clientTimeZone(messages: readonly LooseMessage[]): string | undefined;
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
/**
 * Bare tool names per MCP server, from the init frame's `mcp__<server>__<tool>` ids. Every known
 * server gets an entry, empty when it contributes nothing; an id whose server is not in the list
 * is dropped rather than guessed at.
 */
export declare function mcpToolsByServer(serverNames: readonly string[], toolIds: readonly string[]): Map<string, string[]>;
/**
 * The dsh title a bridged command should set: the trimmed argument when this is Claude's rename
 * with one. An empty argument returns undefined so the line reaches Claude unchanged and the CLI
 * answers with its own usage message.
 */
export declare function renameTitle(cmd: string, rawInput: string): string | undefined;
export declare const NATIVE_TOOL_MAP: {
    readonly Bash: "bash";
    readonly Read: "read";
    readonly Edit: "edit";
    readonly Write: "write";
    readonly Grep: "grep";
    readonly Glob: "glob";
    readonly WebFetch: "web_fetch";
    readonly WebSearch: "web_search";
    readonly MultiEdit: "edit";
};
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
    denials?: string[];
    /** Wall-clock ms from the prompt write to the first stream chunk; absent when not measured. */
    ttftMs?: number;
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
/**
 * Incremental translator from Claude Code stream-json lines to dsh StreamChunks.
 * Prefers partial `stream_event`s; falls back to whole `assistant` messages when no partials arrived.
 * Tool calls and results are shown as reasoning blocks: the CLI runs its own tools, dsh only watches.
 */
/** The `kind` dsh's loop puts on an abort reason ("disposed" on shutdown), else undefined. */
/** The source a wake notice carries: user only when a restart notice must rearm an active goal. */
export declare function noticeSource(text: string, goalActive: boolean): {
    readonly kind: "user";
    readonly plugin?: undefined;
    readonly form?: undefined;
    readonly summary?: undefined;
} | {
    readonly kind: "plugin";
    readonly plugin: "dsh-oh-my-claude";
    readonly form: "notice";
    readonly summary: string;
};
/** After an interrupt, kill a process that did not finish in time: only when no keeper owns it. */
export declare const killAfterGrace: (spawn: string) => boolean;
/** Whether an aborted stream should interrupt Claude: always, except a dsh shutdown under a keeper. */
export declare function interruptOnAbort(kind: string | undefined, spawn: string): boolean;
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
/** Sent when a usage limit that ended a turn has reset, so Claude picks the task back up. */
export declare const LIMIT_TEXT = "[Oh My Claude] your usage limit has reset. Continue the task where the limit stopped you.";
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
/** Whether a todo list still has work on it. A list of nothing but completed items is finished,
 *  and a finished list is not worth painting over a fresh message. */
export declare function hasPendingTodo(todos: JsonValue[]): boolean;
export declare class ClaudeCodeAdapter extends LlmAdapter {
    ctx: PluginContext;
    config: Schemastery.TypeT<typeof Config>;
    subprocess?: Pick<SubprocessRuntime, "spawn">;
    /** dsh's permission preset service, when mounted: the shield's current preset per session. */
    permissionPresets?: {
        current: (session: object) => string;
    };
    processes: Map<string, ClaudeProcess>;
    /** Per session, the timer that continues the task once its usage limit resets. */
    limitTimers: Map<string, ReturnType<typeof setTimeout>>;
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
    /** The rules recent approval requests suggest, newest last, per session. */
    readonly permissionAsks: Map<string, string[]>;
    /** `/btw` side questions and their answers, newest last, per session; kept in memory only. */
    readonly sideQuestions: Map<string, AsideEntry[]>;
    /** The live thinking budget this plugin last set per session (null = session default, 0 = off);
     *  memory only, since a respawn resets it and the CLI has no flag to carry it. */
    readonly thinkingBudgets: Map<string, number | null>;
    cliModels: CliModel[];
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
    /** Read on every listing rather than cached: an edit to settings.json takes effect at once. */
    private pickerSettings;
    listModels(provider: string): Promise<{
        provider: string;
        id: string;
        name: string;
        inputModalities: readonly ["text", "image"];
    }[]>;
    /** No picker filter here: the allowlist curates what the picker offers, and the CLI keeps a
     *  session's own model when the allowlist excludes it rather than failing to resolve it. */
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
    /** dsh session id → the tool names its last init frame reported; absent until one arrives. */
    readonly sessionTools: Map<string, string[]>;
    /**
     * Register Claude Code's slash commands (from the CLI's init frame) as dsh `/commands`. The
     * handler hands the line to Claude as the next prompt, where the CLI expands the skill or
     * custom command the way the terminal does; dsh keeps its own command of the same name.
     */
    bridgeCommands(names: string[], agent: Agent | undefined): void;
    /** The effective mode for a session and the stored override, for the header chip. */
    /**
     * The session's dsh access mode right now: the shield's current preset from dsh's own service
     * when it is mounted (a pick there is live at once), else the last runtime-context snapshot.
     */
    currentAccessMode(sessionId: string): string | null;
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
    /**
     * Ask a freshly spawned process for the CLI's model picker once per boot and hand it to the
     * catalog; the answer arrives before the first prompt is even read. A failure leaves the API
     * and known models in place.
     */
    cliModelsAt: number;
    refreshCliModels(proc: ClaudeProcess): Promise<boolean>;
    /** Get the current model catalog for advisor selection. */
    getAdvisorModels(): Promise<Array<{
        id: string;
        name: string;
    }>>;
    /** The MCP servers of a session's live process (`mcp_status`). */
    mcpStatus(sessionId: string): Promise<McpStatusReply>;
    /** Ask a session's live process to reconnect one MCP server (`mcp_reconnect`). */
    mcpReconnect(sessionId: string, serverName: string): Promise<{
        ok: boolean;
        error?: string;
    }>;
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
    /**
     * `/btw <question>` asks Claude a side question over the `side_question` control request, which is
     * answered off the transcript. The pending entry lands in the ring at once so the client bubble
     * can show the question with a spinner; the answer or error fills in when the control response
     * arrives. Fire and forget: the command returns before Claude answers.
     */
    askSideQuestion(sessionId: string, question: string): void;
    /** What the /tune thinking selector shows: the budget this plugin last set for the session, or
     *  `undefined` when it has set none and the session runs on its own default. */
    thinkingInfo(sessionId: string): {
        tokens: number | null | undefined;
    };
    /**
     * Set a session's live thinking budget with a `set_max_thinking_tokens` control request: null keeps
     * the session default, 0 turns extended thinking off, any positive integer caps it. The CLI reads
     * stdin during a turn; between turns the line is queued and answered when the next turn opens. The
     * value is stored only after the process accepts it, since a dead process cannot apply it.
     */
    setThinkingBudget(sessionId: string, tokens: number | null): Promise<{
        ok: boolean;
        tokens: number | null;
        live: boolean;
        error?: string;
    }>;
    registerAsideCommand(commands: NonNullable<PluginContext["commands"]>): void;
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
    /** Every 2 s for a minute: a reply waiting in an adopted process's queue opens a dsh turn. */
    drainAdopted(proc: ClaudeProcess, sessionId: string, everyMs?: number, tries?: number): Promise<void>;
    /**
     * After a reattach, the surviving Claude still holds an MCP session against the previous dsh's
     * bridge. `mcp_reconnect` for the `dsh` server makes it open a fresh one; without it the first
     * dsh tool call after a restart can fail once. No bridge mounted (non-default instance, or the
     * bridge not up yet) means nothing to reconnect to. Retries every retryMs for attempts tries, since the web server listens several seconds after adoption.
     */
    reconnectBridge(proc: ClaudeProcess, sessionId: string, retryMs?: number, attempts?: number): Promise<boolean>;
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
    /** A usage limit ended the session's turn: once it resets (plus a grace), drop the continue
     *  notice through the same path a restart uses. Persisted so a restart re-arms it. */
    armLimitWait(sessionId: string, resetAt: number, atLeastMs?: number): void;
    /** The wait fired. Two things may have changed meanwhile: the session may have been rerouted
     *  to another provider (then the notice would reach a model the limit never touched), and the
     *  account may still be capped (another window, another login, a moved reset). Check both
     *  before the notice goes out; a probe that cannot answer lets the wake try. Extra usage turned
     *  on meanwhile needs no detection: a prompt cancels the wait, and once Claude runs, its own
     *  rate_limit_event says whether credits cover the overflow. */
    continueAfterLimit(sessionId: string, probe?: typeof readUsage): Promise<void>;
    /** The provider a session last selected, from its own log; undefined when it never picked one
     *  (dsh's default applies) or the session cannot be read. */
    sessionProvider(sessionId: string): string | undefined;
    clearLimitWait(sessionId: string): void;
    /** Claude finished a turn of its own (a background task it launched completed) while dsh was
     *  idle. Drop a notice into the session's inbox so dsh opens a turn now and the reply shows,
     *  instead of riding on top of the user's next prompt. */
    wake(sessionId: string, proc: ClaudeProcess | undefined, text?: string): Promise<boolean>;
    /** Offer a dsh tool call from the MCP bridge to the session's live turn. Undefined when no turn
     *  can take it (idle process, a relay already pending); the bridge then executes it directly. */
    relay(sessionId: string, toolName: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<RelayResult> | undefined;
    /** Answer a CLI control request. Permission prompts and questions become dsh dialogs; the answer is written back on stdin. */
    handleControl(event: ControlRequestEvent, options: SessionOptions, prep: TurnPrep, proc: ClaudeProcess, pending: Map<string, AbortController>, tr: Translator): AsyncGenerator<StreamChunk, void, unknown>;
    /**
     * An MCP server's elicitation, shown through dsh's question UI: one question per top-level
     * schema property, the answers sent back as the accept content. A `url` mode (the server wants
     * a browser) and a schema dsh cannot present are declined with a reasoning line saying so.
     */
    elicit(request: NonNullable<ControlRequestEvent["request"]>, requestId: string, options: SessionOptions, proc: ClaudeProcess, pending: Map<string, AbortController>, tr: Translator): AsyncGenerator<StreamChunk, void, unknown>;
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
