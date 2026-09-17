import { type FSWatcher } from "node:fs";
import type { Spawner, SubprocessHandle, ContextUsage, WorkspaceDiff, McpServerStatus, CliModel, PermissionRules, HooksListing } from "./process.js";
import { LlmAdapter, type ContentBlock, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { type ContextSizes, type ContextSource } from "./context-sources.js";
import { type PickerSettings, type RemoteWorkspace } from "./sessions.js";
import { readUsage } from "./usage.js";
import { type ClaudeEvent, ClaudeProcess } from "./process.js";
import type { Agent, ImageAttachmentRef, JsonValue, PluginContext, SessionController, SessionId, SubprocessRuntime } from "./dsh.js";
import { ADAPTER_CURRENT } from "./dsh.js";
import { type ToolMode, type ToolModeInfo } from "./rows-probe.js";
import { type FsBox } from "./remote-fs.js";
import type { FoldedTurn } from "./transcript.js";
import { sshRunner, type HoldRecord } from "./hold.js";
import type { RewindResult } from "./process.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
import { Translator } from "./translator.js";
export { Translator, type TranslatorBlock } from "./translator.js";
import type { FinishReason } from "@deepseek-ai/dsh-llm";
import type { ClaudeProcessSpec, RelayEvent, RelayResult, TurnPrep } from "./process.js";
/** Replace the redirect map: the boot read and every panel edit land here. Exported so the offline
 * suite can drive the two lookups below without a dsh mount. */
export declare function setRemoteWorkspaces(workspaces: RemoteWorkspace[]): void;
/** The real remote path for a placeholder workspace on `host`, or `cwd` unchanged. */
export declare function remoteCwdFor(host: string, cwd: string): string;
/** The box a turn runs on: this instance's own host when it has one, else the box a remote-workspace
 * cwd belongs to. The choice is by truthiness because `sshHost` defaults to `""`, not undefined —
 * `??` treats that empty string as an answer, which is how a local provider's turn came to probe the
 * local binary for flags while its spawn ran on the box (2026-09-09: `--forward-subagent-text`, a
 * flag this box's CLI has and the box's 2.1.123 does not). */
export declare const boxFor: (sshHost: string | undefined, workspaceHost: string | undefined) => string | undefined;
/** The remote workspace whose local placeholder is `cwd`, if any. A session opened on this cwd must
 * run over SSH on that box regardless of the provider chosen, so a local provider does not sit in the
 * empty placeholder dir. */
export declare function remoteWorkspaceFor(cwd: string): RemoteWorkspace | undefined;
/** A dsh request that belongs to a session; everything on the persistent path has one. */
type SessionOptions = GenerateOptions & {
    sessionId: SessionId;
};
/** The CLI asking for a permission or a question. */
type ControlRequestEvent = Extract<ClaudeEvent, {
    type: "control_request";
}>;
/** Whether a step's end keeps the status row's live figures: only when the step parked the CLI
 *  mid-turn (on a dsh tool dsh is running, or on a steer), since dsh calls back within the same
 *  turn. Every other outcome is the turn ending. */
export declare const keepsLiveTurn: (outcome: string | undefined) => boolean;
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
    sshHost: string;
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
    toolsInline: boolean;
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
    sshHost: z<string, string>;
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
    toolsInline: z<boolean, boolean>;
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
    ownTranscripts: z<boolean, boolean>;
    providerId: z<string, string>;
    providerName: z<string, string>;
}>, Schemastery.ObjectT<{
    command: z<string, string>;
    spawn: z<"dsh" | "keeper" | "node", "dsh" | "keeper" | "node">;
    sshHost: z<string, string>;
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
    toolsInline: z<boolean, boolean>;
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
    ownTranscripts: z<boolean, boolean>;
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
    /** Set when the user closes the card. The entry stays in the ring so the panel's Asides tab can
     *  still show the answer; only the docked bubble filters these out. */
    dismissed?: boolean;
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
/** What `/permissions` answers: both lists, or the reason there are none. */
export type PermissionReadoutReply = ({
    ok: true;
} & PermissionRules & HooksListing) | {
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
/** One picker row. `description` is dsh's own optional field, drawn under the name; only the CLI's
 *  rows carry one, and a row without one has no key, since dsh validates the shape it is given. */
interface CatalogModel {
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    efforts: readonly string[];
    description?: string;
}
declare const M: (id: string, label: string, contextWindow: number, efforts: readonly string[], description?: string) => CatalogModel;
export declare const KNOWN_MODELS: CatalogModel[];
/**
 * The Models API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone
 * (`claude-opus-5`), while the list above and the CLI's own picker use the undated form. The CLI
 * takes either, but dsh keys a model by its id: a lineup that spells the same model one way from
 * the API and another from this list retires the enabled one and offers a fresh unselected copy
 * every time the source changes. So an API id whose undated form is one we know is advertised
 * undated, and an id we do not know keeps whatever the API called it.
 */
export declare const stableModelId: (id: string) => string;
/** A session whose last turn wanted a login: the box it ran on (empty for this box) and its name. */
export interface LoginNeed {
    host: string;
    label: string;
}
/**
 * Pull the answer text out of a `side_question` control response. The CLI answers with
 * `{ response: string }` (or a bare string on some paths, or null when it declined), so both shapes
 * are parsed at this I/O boundary and blank or absent answers report as none.
 */
export declare function asideAnswerText(response: JsonValue | undefined): string | undefined;
/** Parse a persisted catalog file. Anything malformed reads as empty, so the caller falls back. */
export declare function parseCatalogCache(text: string): ReturnType<typeof M>[];
/** One entry of the Anthropic Models API list, in the shape the picker uses. */
export declare function modelFromApi(m: {
    id?: string;
    display_name?: string;
    max_input_tokens?: number;
    capabilities?: {
        effort?: EffortCaps;
    };
}): LlmModelInfo;
/** The base URL when it names a host the CLI does not treat as first-party, else undefined. The
 *  test is the CLI's own (`av()` in 2.1.274: `new URL(e).host` against `["api.anthropic.com"]`),
 *  `host` with its port included, so this fires exactly when the CLI demotes. */
export declare const proxyBaseUrl: (raw: string | undefined) => string | undefined;
/** Record what a session answered. A missing or nonsense figure leaves the last good one standing. */
export declare const noteLiveWindow: (modelId: string | undefined, maxTokens: number | undefined) => void;
export declare const liveWindowFor: (modelId: string) => number | undefined;
export declare function mergeCatalog(cli: CliModel[], base: ReturnType<typeof M>[], picker?: PickerSettings): CatalogModel[];
export declare function getCatalog(fetchImpl?: typeof fetch, cli?: CliModel[], picker?: PickerSettings): Promise<CatalogModel[]>;
/** Exact model metadata. `id` must echo the requested id: dsh-llm normalizeModelInfo rejects mismatches. */
export declare function resolveModelInfo(provider: string, modelId: string, models?: ReturnType<typeof M>[]): LlmResolvedModelInfo;
/** Deterministic UUID for a dsh session id, so a reopened dsh session resumes the same Claude session. */
/** Terminal exchanges waiting to be shown in a dsh session, and the one whose turn is open. */
interface MirrorQueue {
    queue: FoldedTurn[];
    inFlight?: {
        id: string;
        turn: FoldedTurn;
        at: number;
    };
}
/** A terminal turn being streamed live into one open dsh turn. `id` matches the followup that
 *  opened the turn; the render loop reads the exchange from `start`, renders its blocks, and yields
 *  the ones past `shown`, waking on `wake` when a scan sees new rows and settling when `done`. */
interface StreamState {
    id: string;
    path: string;
    box: FsBox;
    start: number;
    shown: number;
    done: boolean;
    startedAt: number;
    wake?: () => void;
}
/** A session's transcript under watch: the file, the byte its settled rows end at, the watcher. */
interface TranscriptWatch {
    path: string;
    seen: number;
    claudeId: string;
    /** The box the file is on; a remote one has no inotify and is polled by the sweep instead. */
    box: FsBox;
    fw?: FSWatcher;
    timer?: NodeJS.Timeout;
    /** A scan is reading the file; one asked for meanwhile runs after it, never alongside it. */
    scanning?: boolean;
    again?: boolean;
}
export declare function claudeSessionId(sessionId: string): string;
/** Claude Code stores transcripts under ~/.claude/projects/<cwd with non-alphanumerics as '-'>/<id>.jsonl */
export declare function projectDirName(cwd: string): string;
/** The slice of a dsh message this adapter reads; dsh's own Message type is wider. */
/** The slice of a dsh message this adapter reads; exported for test fixtures. */
export type LooseMessage = {
    id?: string;
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
/** The key a message dsh delivered mid-step is marked under once it went over stdin: the prompt's
 *  rpcId for a typed steer, the message id for anything dsh sends on its own behalf (a child's
 *  send_message, a settlement notice, a job's finish line). Undefined for what never goes over
 *  stdin on its own: an assistant turn, a tool result. */
export declare const steerKey: (m: LooseMessage) => string | undefined;
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
/** Which withheld block a message is, if any. The chat row mask classifies the same sources from
 *  the client side, so the rule itself lives in `context-sources.ts` and both read it there. */
export declare const contextSourceOf: (m: LooseMessage) => ContextSource | undefined;
/** What each dsh block cost this turn, in characters, measured before any switch removed it: a
 *  cleared checkbox still has to show its number or the owner cannot tell whether to put it back.
 *  `instructions` counts what survives the CLAUDE.md filter and `claudemd` counts what the filter
 *  took, so the two together are the bundle dsh handed over. A key is absent when this turn carried
 *  nothing of that kind, which is not the same as zero and must not be flattened into one. */
export declare function contextSizes(turns: LooseMessage[]): ContextSizes;
/**
 * The turn's text as one stdin prompt. A turn with assistant text in it is labelled by role so the
 * history stays legible; a plain user turn is sent as it was typed, with no label. A turn that
 * carries only an image has no text to send, so it becomes `(see attached)` and the image rides
 * along in `imageRefs`.
 */
export declare function buildPrompt(turns: LooseMessage[], drops?: ReadonlySet<ContextSource>): string;
/** An image loaded from dsh's attachment store, ready for the stdin line, plus the path of the
 *  copy kept for Claude's tools when one could be written. */
type LoadedImage = {
    mediaType: string;
    data: string;
    attachmentId?: string;
    path?: string;
};
/**
 * Where each image of the turn lives on disk, told to the model after the prompt. The image rides
 * inline on the stdin line, which lets Claude see it and nothing more: no path, so no Read, no
 * edit, no handing it to a subagent. dsh's own store names an image by hash with no extension, so
 * the note points at the copy `keepImageCopy` wrote. Files need nothing here: dsh replaces a file
 * block with a line naming its stored path before any provider sees the turn.
 */
export declare function attachmentNotes(turns: LooseMessage[], images: readonly LoadedImage[]): string;
/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export declare function accessModeOf(messages: LooseMessage[] | undefined): string | undefined;
/** The CLI's permission mode for a turn: the configured one, or the one dsh's access mode maps to. */
export declare function permissionModeFor(config: Schemastery.TypeT<typeof Config>, accessMode: string | undefined): string;
/** Forget what was probed on `host` ("" for this box): after `claude update` there, the flag set
 *  and the denials belong to a binary that is gone, and the next spawn probes the new one. */
export declare function forgetCliProbe(host: string): void;
/** The flag in `error: unknown option '--x'`, however the CLI wrapped the line. */
export declare function unknownFlagIn(text: string): string | undefined;
/** Record a flag the target's CLI refused. False when it was already known bad, which is what stops
 * a retry loop: the second refusal of the same flag is a real failure, not something to retry. */
export declare function denyCliFlag(command: string, host: string | undefined, flag: string): boolean;
/** The slice of node's execFile the probe uses; tests hand in a fake with this shape. */
export type ExecLike = (cmd: string, args: string[], opts: {
    timeout: number;
}, cb: (err: Error | null, stdout: string | Buffer) => void) => void;
/** The target binary's version and the flags its `--help` lists, probed once per binary. */
export declare function probeCli(exec?: ExecLike, command?: string, host?: string): Promise<{
    flags: Set<string> | null;
    version: string;
}>;
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
    readonly TodoWrite: "todo_write";
    readonly Task: "task";
    readonly NotebookEdit: "notebook_edit";
    readonly BashOutput: "bash_output";
    readonly KillShell: "kill_shell";
    readonly ExitPlanMode: "exit_plan_mode";
    readonly EnterPlanMode: "enter_plan_mode";
    readonly SlashCommand: "slash_command";
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
    /** How long the silence that killed it was allowed to run, so the error can name that number. */
    idleKilledAfterMs?: number;
    kill(): void;
    inject(event: ClaudeEvent): void;
}
/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export declare function isStaleResume(event: ClaudeEvent): boolean;
/** The shape of a CLI `result` frame the login checks read. */
export interface ResultFrame {
    is_error?: boolean;
    stop_reason?: string;
    result?: unknown;
    errors?: unknown[];
    api_error_status?: number;
    subtype?: string;
}
/** A turn that failed because the box's Claude has no usable login: the CLI's own wording, or the
 *  API's 401 once a stored token has been revoked. The one test both the error text and the login
 *  card key on, so they cannot disagree about what counts. */
export declare function isLoginFailure(result: ResultFrame): boolean;
export declare function finishReason(result: ResultFrame, hostLabel?: string): FinishReason;
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
/** Drop messages Claude already received live on stdin (matched by `steerKey`). */
export declare function dropSent<T extends LooseMessage>(messages: T[] | undefined, sent: Set<string> | undefined): T[];
/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. A message already written live to stdin is
 *  skipped, so Claude reads it once. */
export declare function stepContextFor(messages: LooseMessage[] | undefined, drops?: ReadonlySet<ContextSource>, sent?: ReadonlySet<string>): string;
/** A fresh user message that is nothing but `/btw <question>`, and the question it carries. */
export interface SideQuestion {
    message: LooseMessage;
    question: string;
}
/**
 * The `/btw` messages in a batch dsh is about to send as prose. The command works when it is typed
 * between turns: dsh dispatches it to the handler. Typed while a turn runs, dsh's composer queues
 * the raw text and delivers it as an ordinary message, the handler never runs, and the CLI answers
 * "/btw isn't available in this environment". Catching them here routes both paths to the same
 * place. Only a message that is the command and nothing else counts, so prose quoting `/btw` is
 * still prose.
 */
export declare function sideQuestionsIn(messages: LooseMessage[] | undefined): SideQuestion[];
export { ADAPTER_CURRENT };
/**
 * Whether Claude's own tool calls may be appended as raw `tool/call`/`tool/result` rows. Only a
 * format-0 session (dsh before 0.1.5) takes them: from 0.1.5 the session format is versioned and
 * its migration refuses any `tool/call` no `assistant/message` advertised, so such rows would make
 * the whole log unloadable on the next upgrade. Inline rendering has no such row.
 */
export declare function nativeToolRows(config: {
    toolActivity: boolean;
    toolsInline: boolean;
}, formatVersion: number, rawRowsLoad?: boolean): {
    rows: boolean;
    refused: boolean;
};
/** Count the human prompts dsh has in a transcript (context injections and tool results excluded). */
export declare function userPromptCount(messages: LooseMessage[] | undefined): number;
/** The stream chunks that make one relayed dsh tool call a native tool-call block. */
export declare function relayBlocks(tr: Translator, call: RelayEvent): IterableIterator<StreamChunk>;
/** Whether a todo list still has work on it. A list of nothing but completed items is finished,
 *  and a finished list is not worth painting over a fresh message. */
export declare function hasPendingTodo(todos: JsonValue[]): boolean;
/**
 * The provider dsh talks to. It owns one Claude Code process per session, converts a dsh turn
 * into stdin lines and the CLI's stream-json back into dsh events, and keeps the state — turn
 * records, permission modes, keepers — that has to survive a restart.
 */
/** The running turn's figures for the status row; see `TurnProgress` in translator.ts. */
export interface LiveTurn {
    thinking?: number;
    thinkingOpen?: boolean;
    thinkingAt?: number;
    output?: number;
    tool?: boolean;
    /** When the last frame of model output arrived; the stall clock. */
    frameAt?: number;
    /** How long the last thinking burst ran and when it closed, for the CLI's "thought for Ns". */
    thoughtMs?: number;
    thoughtAt?: number;
    /** The effort dsh asked for this turn, when it asked for one: the CLI's line names it. */
    effort?: string;
    /** The dsh tool dsh is running for this parked turn, and when the relay went out. */
    relay?: {
        name: string;
        at: number;
    };
    at: number;
}
/** A `get_workspace_diff` answer as the text a side question carries. Hunk headers and raw lines,
 *  nothing invented; a file with no hunks is named with why, so the reply does not guess. Whole files
 *  only, in the CLI's own order, up to the cap; the first file always goes even if it alone is over,
 *  because a context with no diff in it is worse than a long one. */
export declare const diffContext: (diff: WorkspaceDiff, path: string) => string;
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
    /** Set once a session read has thrown, so the line lands one time and not per routed message. */
    warnedNoSessionRead: boolean;
    loggedVersion: boolean;
    /** Probe targets already written to resume.log, so the line lands once per binary, not per turn. */
    probeTraced: Set<string>;
    sessionController?: SessionController;
    /** Masks secret env values in tool results; undefined when `redactSecrets` is off. */
    readonly redact: ((s: string) => string) | undefined;
    /** dsh sessions marked temporary with /temporary; on globalThis so a reload keeps them. */
    readonly temporary: Set<string>;
    /** Per-session turn accounting buffer (last 50 turns); keyed by dsh sessionId. Lives on
     *  globalThis so the route registered at boot reads what a hot-reloaded adapter fills. */
    readonly turnBuffer: Map<string, TurnRecord[]>;
    /** What the running turn has done so far, per session, for the status row: output tokens across
     *  the finished assistant messages, plus the thinking estimate for the block the model is in now.
     *  The estimate is cleared when the next usage frame lands, since that frame counts the same
     *  tokens for real. Set by the live translator, cleared when the turn ends; a session with no entry
     *  has no turn running. */
    readonly liveTurn: Map<string, LiveTurn>;
    /** The model last written to workspace-models.json per cwd, so a turn on the same model writes nothing. */
    readonly workspaceModelWritten: Map<string, string>;
    /** The sizes last written to context-sizes.json per cwd, as `key:value` pairs in a fixed order,
     *  so a workspace whose blocks did not change writes nothing. */
    readonly contextSizesWritten: Map<string, string>;
    /** Per-session idle watchdog deadline in epoch ms; null means no active arm. */
    readonly idleDeadlineMap: Map<string, number | null>;
    /** Per-session kill and warning timers, keyed by session id. */
    readonly idleKillTimers: Map<string, NodeJS.Timeout>;
    readonly idleWarnTimers: Map<string, NodeJS.Timeout>;
    /** What each armed key watches, so a route can re-arm it. */
    readonly idleTargets: Map<string, {
        proc: IdleTarget;
        warn: boolean;
        timeoutMs: number;
    }>;
    /** Per-session permission mode overrides; loaded from disk at init, saved on change. */
    permissionModes: Map<string, string | null>;
    /** dsh access mode seen on each session's last turn, so the effective mode can be reported. */
    accessModes: Map<string, string | undefined>;
    /** Callers waiting for the CLI's `control_response` to a request this plugin sent, by request id. */
    controlWaiters: Map<string, (reply: ControlReply) => void>;
    /** The rules recent approval requests suggest, newest last, per session. */
    readonly permissionAsks: Map<string, string[]>;
    /** rpcIds of messages already routed to `askSideQuestion`, so a re-sent batch asks once. */
    readonly asked: Set<string>;
    /** `/btw` side questions and their answers, newest last, per session; kept in memory only. */
    readonly sideQuestions: Map<string, AsideEntry[]>;
    /** Sessions whose last turn failed for want of a login, and the box that turn ran on. The composer
     *  card reads this beside the asides; a turn that succeeds, or a panel login on that box, clears it.
     *  Memory only: after a restart the next failed turn writes it again. */
    readonly loginNeeded: Map<string, LoginNeed>;
    /** Saved opening prompts: one per session id, plus `default` for the one a session without its own
     *  is offered. Loaded from disk on construct and written through on every save. */
    readonly starters: Map<string, string>;
    /** The live thinking budget this plugin last set per session (null = session default, 0 = off);
     *  memory only, since a respawn resets it and the CLI has no flag to carry it. */
    readonly thinkingBudgets: Map<string, number | null>;
    /** Tool activity as the Tune switch set it; undefined = the config's `toolsInline`. Loaded from
     *  disk on construct, written through on every set, and read fresh at the start of each turn. */
    toolMode: ToolMode | undefined;
    cliModels: CliModel[];
    claudeHome: string;
    /** `~/.claude` itself, which stays the box's login and settings even when transcripts move. */
    realClaudeHome: string;
    providerId: string;
    displayName: string;
    settingsNs: string;
    stateDir: string;
    constructor(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>);
    /** dsh's handle for this instance's route. `replace` re-reads `providerInfo`, which is how a
     *  name change reaches the picker without a restart. */
    registration?: {
        replace: (providers: string[]) => void;
    };
    private loggedOut;
    /** "(not logged in)" after the provider name while the box's claude has no login: dsh copies the
     *  name at registration, so the route is registered again under the new one. Fed by the mount-time
     *  probe and by every login probe the panel runs, so the picker names a dead box at a glance. */
    setLoggedIn(loggedIn: boolean): void;
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    /** Read on every listing rather than cached: an edit to settings.json takes effect at once. */
    private pickerSettings;
    /** A box without a login lists nothing: dsh's catalog drops a provider whose listing throws into
     *  its "could not load" row with a Retry, which is the honest picker for a box no turn can use.
     *  The row names the fix; Retry after the login brings the models back. */
    listModels(provider: string): Promise<LlmModelInfo[]>;
    /** After a `result` frame: remember a login failure for the card, and name the box's providers
     *  logged out so the picker stops offering them; a turn that succeeded clears both. */
    noteTurnLogin(sessionId: string, result: ResultFrame): void;
    /** Log out on `host` (this box when empty) cuts the cord: every live Claude on that box is killed,
     *  so nothing keeps answering on a login that is gone. A process that loaded the login at start
     *  would otherwise carry it in memory until it exited. Each session resumes from its transcript on
     *  its next message, which then fails for want of a login and shows the card. */
    logoutBox(host: string): void;
    /** Live Claude processes on `host` (this box when empty), across every mount there. The row shows
     *  the count when the box reads logged out: those still answer on the login they loaded at start. */
    liveCount(host: string): number;
    /** A panel login on `host` (this box when empty) succeeded: its providers list models again and
     *  the cards for sessions on that box read done. */
    loginDone(host: string): void;
    /** Every mounted instance, this one included: at boot or in a test it may not be in the shared
     *  registry yet. */
    private static mounts;
    /** No picker filter here: the allowlist curates what the picker offers, and the CLI keeps a
     *  session's own model when the allowlist excludes it rather than failing to resolve it.
     *
     *  The missing `context` is deliberate; see `prepareCall` below for why.
     */
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<{
        provider: string;
        id: string;
        name: string;
        description?: string;
        inputModalities?: readonly import("@deepseek-ai/dsh-llm").ModelModality[];
        defaultMaxTokens?: number;
        reasoning?: import("@deepseek-ai/dsh-llm").LlmModelReasoningInfo;
        systemPromptUpdate?: import("@deepseek-ai/dsh-llm").SystemPromptUpdate;
    }>;
    /** Capacity, reported here and only here.
     *
     *  dsh reads a model's context window through two different methods and uses each answer for a
     *  different job. `prepareCall` feeds the context ring: `request/context` carries the window to
     *  the token meter, and this plugin's own readouts are injected into that ring. `resolveModel`
     *  feeds `llm.resolveModelInfo()`, which is what `@deepseek-ai/dsh-compaction-basic` multiplies
     *  by its threshold ratio to decide whether to compact before a step. Answering the first and
     *  staying quiet on the second turns dsh's automatic compaction off for this plugin's routes
     *  while the ring keeps working.
     *
     *  That is worth doing because dsh's pressure number is not measuring the thing it thinks it is.
     *  Claude Code compacts its own context (169,490 tokens before the boundary, in a session logged
     *  2026-09-14) and dsh cannot see it: dsh measures its own session surface, which keeps growing
     *  because `resume` sends the CLI only the tail after the last assistant message. Two sessions
     *  that day declared a 1,000,000-token window and dsh still compacted 22 times, spending ~100 s
     *  of Opus per trigger on a summary `selectTurns` slices off before the prompt is built. So the
     *  compaction runs on top of the CLI's own, off a number that does not describe the CLI's
     *  context, and throws the result away.
     *
     *  What this costs, measured against every reader of `resolveModelInfo(...).context` in installed
     *  dsh: `dsh-session-reference` falls back from a 160,000-byte reference budget to its 65,536-byte
     *  default on these routes, and automatic overflow recovery goes with automatic compaction, which
     *  is free here because this plugin never reports CONTEXT_WINDOW_EXCEEDED. `/compact` still works:
     *  `compactNow` never reads capacity. `dsh-acp` reads modalities and reasoning, not context, and
     *  `buildModelCatalog` does not read context at all, so the model picker is unaffected.
     *
     *  Compaction's own `agent/pre-step` handler catches the resulting `TargetPressureConfigError`,
     *  warns once per target and calls `next()`, so a turn is never failed by the silence.
     */
    prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<{
        model: LlmResolvedModelInfo;
        stream: (options: GenerateOptions) => AsyncGenerator<StreamChunk, any, any>;
    }>;
    /** Full metadata for one model, capacity included: the single source both methods above narrow. */
    private fullModelInfo;
    /** Get the effective permission mode for a session, checking for an override first. */
    getPermissionMode(sessionId: string, accessMode: string | undefined): string;
    sessionCwd(sessionId: string): string | undefined;
    log(level: string, message: string): void;
    /** A copy of the image under the plugin's state dir, named by attachment id with the extension
     *  its media type calls for: dsh's own stored object has no extension, and Claude Code's Read
     *  decides image-or-text by the name. Written once per attachment; a failure just leaves the
     *  image inline-only, as before. */
    keepImageCopy(ref: ImageAttachmentRef, data: ArrayBuffer): Promise<string | undefined>;
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
    /** Sessions already warned that `toolsInline: false` is ignored on a versioned session format. */
    readonly rowsRefused: Set<string>;
    /** Terminal exchanges the watcher found, by dsh session, each shown as one turn of its own. */
    readonly mirrors: Map<string, MirrorQueue>;
    /** Terminal turns being streamed live into an open dsh turn, by dsh session. */
    readonly streaming: Map<string, StreamState>;
    /** Whether terminal exchanges are mirrored into dsh at all; the owner's switch, on by default. */
    terminalSync: boolean;
    /** One transcript watcher per dsh session that finished a turn on this box, by dsh session. */
    readonly watchers: Map<string, TranscriptWatch>;
    /**
     * This plugin's own commands, which share the `bridged` map so one disposer list covers all of
     * them. They are never Claude's, so the bridge must not register them as passthroughs and the
     * catalog file must not carry them: the catalog is the union of what it held and what was
     * bridged, so once they slipped in, every later boot bridged `/btw` to Claude first and the real
     * handler saw the name taken and stood down (2026-09-08: "/btw isn't available in this environment").
     */
    static readonly OWN_COMMANDS: Set<string>;
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
    /** The Settings control "Proxy reaches Anthropic" (the `proxyFirstParty` pair in the hints
     *  store) resolved against what the endpoint answered, read with the other hints before each
     *  spawn. On auto, which is the default, the endpoint decides; a chosen setting outranks it. */
    proxyFirstParty: boolean;
    /** The disk seed, awaited by the first listing so a boot never answers from the floor by a race. */
    private cliSeed;
    refreshCliModels(proc: ClaudeProcess): Promise<boolean>;
    /**
     * The CLI's lineup is kept on disk, per box, so a fresh dsh-web lists the same rows before any
     * process has answered `list_models`. Without it the first listing lacks every `[1m]` alias, and
     * dsh loads one catalog per host generation: a session bound to `claude-fable-5-1[1m]` then shows
     * the raw id in the composer seat and stays that way until the page reloads.
     */
    private cliModelsPath;
    private persistCliModels;
    /** Seed from the last answer, unless a process has already answered this boot. */
    seedCliModels(): Promise<void>;
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
    /** Pin one MCP server's tools back to asking, or clear the pin
     *  (`set_mcp_permission_mode_override`). Tighten-only over this channel: the CLI accepts
     *  `default`, `auto` and null and rejects the rest without changing state, so this offers the two
     *  ends. It lives in the process's own tool-permission context, so it dies with the process, and
     *  it is read only when the session's mode would otherwise auto-allow. */
    setMcpAsk(sessionId: string, serverName: string, ask: boolean): Promise<{
        ok: boolean;
        error?: string;
    }>;
    /** Ask a session's live process to re-read plugins, commands, agents and their MCP servers from
     *  disk (`reload_plugins`), so an enable, uninstall or marketplace change the CLI just wrote to
     *  settings takes effect now instead of at the next spawn. No live process is not a failure: the
     *  write landed and the next spawn will read it, so `live` is false and there is nothing to say. */
    reloadPlugins(sessionId: string): Promise<{
        ok: boolean;
        live: boolean;
        error?: string;
    }>;
    /** The CLI's working-tree diff (`get_workspace_diff`) for a session with a live process. */
    workspaceDiff(sessionId: string): Promise<WorkspaceDiffReply>;
    /** The permission rules and hooks a session's live process actually loaded
     *  (`list_permission_rules`, `get_hooks_listing`), read-only. Both or neither: the readout is one
     *  section pair and a half-answer would read as an empty half. */
    permissionReadout(sessionId: string): Promise<PermissionReadoutReply>;
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
    /**
     * The live process behind a dsh session, whichever mount spawned it. The registry is shared by
     * every instance and keyed by provider, and `/btw` is registered once, on the main mount: a
     * session on an SSH box lives under that box's provider id, so the main mount's own key misses it.
     */
    /** The instance whose aside ring the route and the bubble read: the main mount, else this one. */
    asideOwner(): ClaudeCodeAdapter;
    processFor(sessionId: string): ClaudeProcess | undefined;
    /**
     * The mount a session belongs to: the one whose live process it is, else the one its selected
     * model names, else this one.
     *
     * The panel's routes are registered once, by the default mount, but a session on an SSH box's
     * model runs under that box's instance. A control request written from the wrong instance is
     * never answered — `resolveControl` only knows the waiters of the adapter whose stream loop reads
     * that process — so every route that asks a session's process something has to be dispatched
     * here first, or the panel reports "no live Claude process" for a session that has one.
     */
    ownerFor(sessionId: string): ClaudeCodeAdapter;
    askSideQuestion(sessionId: string, question: string, context?: string): void;
    /** Save (or clear, when the text is blank) an opening prompt for a session or for `default`. */
    setStarter(key: string, text: string | undefined): void;
    /** Persist a session's aside ring to disk so an answer survives a restart, eviction or hot reload. */
    persistAsides(sessionId: string): void;
    /** Inline tool text unless the Tune switch, or failing that the config, asks for rows. */
    toolsInline(): boolean;
    /** What the Tune switch shows: the mode in force, and whether rows are open to it at all. */
    toolModeInfo(): Promise<ToolModeInfo>;
    /** Set the mode on every mount at once, so a session on a box's model follows the same switch. */
    setToolMode(mode: ToolMode): Promise<ToolModeInfo>;
    terminalSyncInfo(): {
        enabled: boolean;
    };
    /** Turn terminal sync on or off for every mount. Off stops each mount's watchers and drops any
     *  queued mirror; on lets the next sweep pick loaded sessions back up. */
    setTerminalSync(enabled: boolean): Promise<{
        enabled: boolean;
    }>;
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
    /**
     * What this instance adds to a local Claude's environment: its config dir when it has one, and
     * this box's panel login as CLAUDE_CODE_OAUTH_TOKEN for the default instance. A second instance
     * keeps its own login, which is what a second instance is for.
     */
    localEnvOverride(firstParty?: boolean): Record<string, string> | undefined;
    /** The child env a keeper hands Claude: dsh's environment plus the plugin's additions. */
    keeperEnv(firstParty?: boolean): Record<string, string>;
    /** Spawner for one session: keeper mode needs the session to place and name the keeper. */
    spawnerFor(sessionId: string | undefined, spec: ClaudeProcessSpec): Spawner;
    /**
     * Start the far `claude` in a hold on `host` (see hold.ts) and attach to it. The record is what a
     * restart reattaches from, so it is written before the first byte is read; a failed start ends the
     * handle through its stderr and exit, as a local spawn error would.
     */
    holdOn(host: string, cwd: string, sessionId: string, spec: ClaudeProcessSpec, command: string, args: string[]): SubprocessHandle;
    /** Attach to a hold and keep its record's offset current (at most once a second). */
    attachHold(run: ReturnType<typeof sshRunner>, record: HoldRecord): SubprocessHandle;
    /**
     * At boot, reattach to the holds this instance left on SSH boxes. A hold whose cli has ended
     * delivers its exit line at once and drops itself; one still running is registered like an
     * adopted keeper, with the same wake and bridge reconnect.
     */
    adoptHolds(): Promise<void>;
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
    /** A stale bridge gets one more reconnect, at a turn boundary, when dsh does have the agent. */
    reconnectIfStale(proc: ClaudeProcess, sessionId: string): Promise<void>;
    /** The box a session's turn runs on (an SSH box, or a remote workspace's host), or undefined for a
     * local turn. Mirrors prepare()'s targetHost so a logged-out error names the right machine: a
     * purpose one-shot (title/compaction) always runs on the local claude for the default provider. */
    hostLabelFor(sessionId: string | undefined, purpose?: string): string | undefined;
    spawner(firstParty?: boolean): Spawner;
    /** Kill this instance's live processes and drop them from the shared registry: called when an SSH
     * box is removed from the panel, so its remote `claude` sessions do not outlive the mount. */
    disposeProcesses(): void;
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
    /** Reuse the session's process when its spec still matches; otherwise replace it. */
    acquire(options: SessionOptions, forceFresh?: boolean): Promise<{
        prep: TurnPrep;
        proc: null;
    } | {
        prep: TurnPrep;
        proc: ClaudeProcess;
    }>;
    /** Where a session's Claude transcript is: on this box under `claudeHome`, or on the SSH box the
     *  turn runs on under that account's `~/.claude`, at the cwd the box really uses. Undefined
     *  without a Claude id or when the box's home cannot be read. */
    transcriptLocation(cwd: string, id: string | undefined): Promise<{
        box: FsBox;
        path: string;
    } | undefined>;
    /** Put every loaded session this instance has run under watch, and poll the ones already
     *  watched, so a session that sits in a tab is followed without having spoken in dsh since dsh
     *  started. The record a turn's end saved says which instance ran it: only that one watches, since
     *  the mirror turns it opens are recognised by that instance alone. A session with no record yet
     *  is watched from its first turn's end. The list is in memory; a watched session costs one
     *  `stat` per sweep, on an SSH box over the shared connection, which is how a box is followed at
     *  all, there being no inotify across ssh. */
    watchLoadedSessions(): Promise<void>;
    /** One sweep's look at a watched transcript: scan when it grew past the baseline. This is the
     *  only way a remote one is read, and for a local one it catches what inotify could not deliver
     *  (a scan that stood down because the session was archived). */
    pollTranscript(sessionId: string): Promise<void>;
    /** Watch the session's transcript from the end of this turn on, so a terminal that picks the
     *  session up (`claude /resume`) is noticed while dsh sits idle. One watcher per session; the
     *  baseline moves only by scans. */
    watchTranscript(sessionId: string, cwd: string, claudeId: string | undefined): Promise<void>;
    /** Byte offset where the newest foreign exchange begins (its prompt), or the end of the file when
     *  the tail holds no foreign prompt. Reading from here re-scans the latest exchange, which is how
     *  opening a session catches its tab up to the latest. */
    latestExchangeStart(box: FsBox, path: string, size: number): Promise<number>;
    /** The text of the last few assistant messages the dsh log holds, joined, so a mirror candidate
     *  whose signature is already in it is not shown twice. Only the tail is read: a re-shown exchange
     *  is always among the most recent, and scanning the whole log on every scan would not scale. */
    dshRecentText(sessionId: string): string;
    /** The transcript settled after a write: read what landed past the baseline, and when a terminal
     *  finished a turn there, mark the live process stale and open a turn that shows the exchange.
     *  Measured 2026-09-10 on 2.1.268: `--resume` follows the chain the last row belongs to and drops
     *  the other, so once dsh respawns behind a terminal turn its own rows extend that chain; a
     *  terminal that keeps typing forks again, and the next dsh turn takes that fork as the truth. */
    scanTranscript(sessionId: string): Promise<void>;
    scanOnce(sessionId: string, w: TranscriptWatch): Promise<void>;
    /** Open one dsh turn that streams a still-running terminal exchange live: the prompt goes out as a
     *  user message through the followup seam, and the turn loop's `streamMirror` fills its reply as
     *  the transcript grows. One stream per session; the running exchange begins at `w.seen`. */
    openStream(sessionId: string, w: TranscriptWatch): Promise<void>;
    /** The reply half of a streamed mirror turn: re-read the exchange, render its blocks, yield the
     *  ones past what has been shown, then wait for a scan to wake it. Ends when the exchange settles
     *  (`done`, set by `scanOnce`) or the hung-turn guard fires. */
    streamMirror(sessionId: string, stream: StreamState): AsyncGenerator<StreamChunk>;
    /** Whether dsh's workspace registry lists the session as archived; false when there is no such
     *  service, so a dsh without one behaves as before. Read through `ctx.get`: the service is not in
     *  `inject`, and a direct property read would throw. */
    isArchived(sessionId: string): boolean;
    /** Open the next mirror turn of a session: one terminal exchange, its prompt as a user message of
     *  its own through the followup seam the wake uses, answered by the turn loop with the reply the
     *  terminal got. One at a time, so each turn is one prompt and one reply; the loop's `finally`
     *  pumps the next. While a turn runs, the exchange waits for that `finally`. */
    pumpMirror(sessionId: string): Promise<void>;
    /** The session's Agent, live or resumed the way a typed prompt resumes it; undefined with a note
     *  in resume.log when neither is possible. */
    agentFor(sessionId: string): Promise<{
        agent: Agent;
        how: string;
    } | undefined>;
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
    openTurn(cont: Continuation, proc: ClaudeProcess, prep: TurnPrep): Promise<void>;
    /**
     * Arm the idle watchdog for a stream: `proc` is killed after `timeoutMs` of silence, which
     * defaults to the configured one. Every event re-arms. Shortly before the kill (60 s, or half the
     * timeout when it is under 120 s) a warning event is queued on the process so the turn loop draws
     * a countdown row; `warn: false` skips that for the aux stream, whose loop has no reasoning lane.
     */
    armIdle(key: string, proc: IdleTarget, warn?: boolean, timeoutMs?: number): void;
    /** Stop the watchdog for a stream: the turn ended, or a tool is running and silence is expected. */
    clearIdle(key: string): void;
    /** Push a stream's deadline out by one full timeout; false when nothing is armed under `key`. */
    extendIdle(key: string): boolean;
    /** Take a flag the target's CLI rejected out of every later spawn for that binary. True when this
     * is the first refusal of that flag, which is the only time a retry can help: the box the turn
     * ran on is the one whose probe was wrong, so the denial is recorded against that box. */
    dropRejectedFlag(proc: ClaudeProcess, options: SessionOptions): boolean;
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
     *  (dsh's default applies) or the session cannot be read. The read is deprecated in dsh 0.1.6, and
     *  a dsh that drops it would answer undefined for every session, which routes remote workspaces to
     *  the local mount instead of failing. Too quiet to debug from the symptom, so it says so once. */
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
