import type { AskUserQuestionItem, JsonValue, SubprocessRuntime } from "./dsh.js";
export type { JsonValue } from "./dsh.js";
/** Errors reach us as `unknown`; this is the one place they become text. */
export declare const errorText: (e: unknown) => string;
/** Text of a Claude tool_result: a string, or the text blocks of a content array; other block
 *  kinds render as their bracketed type. */
export declare function toolResultText(block: {
    content?: unknown;
}): string;
/** Child env on top of the parent's: dsh subagents over MCP can outlive the CLI's default tool timeout. */
/** What every Claude child gets on top of dsh's environment: a long MCP tool timeout for relayed
 *  dsh tools, and file checkpointing, which stream-json runs leave off unless asked, so that the
 *  `rewind_files` control request has something to rewind to. */
export declare const CHILD_ENV: {
    MCP_TOOL_TIMEOUT: string;
    CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: string;
};
export interface SubprocessHandle {
    stdin: import("node:stream").Writable;
    stdout: import("node:stream").Readable;
    stderr: import("node:stream").Readable;
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    terminate(): void;
}
export type ClaudeEvent = {
    type: "system";
    subtype?: string;
    /** subtype "init": the CLI's slash-command catalog (skills, custom commands, built-ins). */
    slash_commands?: JsonValue;
    compact_metadata?: Record<string, unknown>;
    status?: string | null;
    compact_result?: string;
    compact_error?: string;
    written_paths?: string[];
    verb?: string;
    memories?: Array<{
        path?: string;
        scope?: string;
    }>;
    hook_name?: string;
    hook_event?: string;
    output?: string;
    stdout?: string;
    stderr?: string;
    exit_code?: number;
    outcome?: string;
    task_id?: string;
    description?: string;
    subagent_type?: string;
    is_backgrounded?: boolean;
    summary?: string;
    attempt?: number;
    max_retries?: number;
    retry_delay_ms?: number;
    error?: {
        message?: string;
        status?: number;
        formatted?: string;
        rate_limits?: {
            resets_at?: number;
            rate_limit_type?: string;
        } | null;
    };
} | {
    type: "stream_event";
    event?: ClaudeStreamPartial;
} | {
    type: "assistant";
    message?: ClaudeAssistantMessage;
    parent_tool_use_id?: string | null;
} | {
    type: "user";
    message?: {
        content?: ClaudeContentBlock[];
    };
    parent_tool_use_id?: string | null;
} | {
    type: "result";
    is_error?: boolean;
    stop_reason?: string;
    result?: unknown;
    errors?: unknown[];
    api_error_status?: number;
    subtype?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    };
} | {
    type: "rate_limit_event";
    rate_limit_info?: {
        status?: string;
        resetsAt?: number;
    };
} | {
    type: "control_request";
    request_id: string;
    request?: {
        subtype?: string;
        tool_name?: string;
        input?: Record<string, JsonValue>;
        tool_use_id?: string;
        title?: string;
        description?: string;
        mcp_server_name?: string;
        display_name?: string;
        message?: string;
        mode?: string;
        url?: string;
        elicitation_id?: string;
        requested_schema?: JsonValue;
    };
} | {
    type: "control_cancel_request";
    request_id: string;
} | {
    type: "control_response";
    request_id: string;
    response?: {
        subtype?: string;
        request_id?: string;
        response?: unknown;
        error?: unknown;
    };
} | {
    type: "timeout";
}
/** Queued by the adapter's idle watchdog shortly before it stops a silent process. */
 | {
    type: "idle_warning";
    silentSeconds: number;
    leftSeconds: number;
} | RelayEvent;
/** What dsh hands back for a relayed tool call: the text Claude gets, and whether it failed. */
export interface RelayResult {
    text: string;
    isError?: boolean;
}
/** A dsh tool call the MCP bridge parks on the live turn; settled when dsh returns its result. */
export interface RelayEvent {
    type: "dsh_relay";
    id: string;
    name: string;
    args: Record<string, JsonValue>;
    resolve: (v: RelayResult) => void;
    reject: (e: Error) => void;
}
export interface ClaudeAssistantMessage {
    id?: string;
    model?: string;
    role?: string;
    content?: ClaudeContentBlock[];
}
export type ClaudeContentBlock = {
    type: "text";
    text: string;
} | {
    type: "thinking";
    thinking: string;
} | {
    type: "tool_use";
    id: string;
    name?: string;
    input?: Record<string, unknown>;
} | {
    type: "tool_result";
    tool_use_id?: string;
    content?: unknown;
    is_error?: boolean;
};
/** One Anthropic streaming event as Claude Code forwards it. Untyped past `type`: only the three
 *  content-block events carry fields the translator reads, and unknown types are logged once. */
export interface ClaudeStreamPartial {
    type: string;
    index?: number;
    content_block?: {
        type?: string;
        id?: string;
        name?: string;
    };
    delta?: {
        text?: string;
        thinking?: string;
        partial_json?: string;
        signature?: string;
    };
}
/**
 * Node's own spawn, shaped like a dsh `SubprocessHandle` so the process code has one shape to
 * talk to: `stdin`/`stdout`/`stderr` streams, `done` resolving with the exit code, `terminate()`.
 * `envOverride` is merged last so configured values win over the parent's environment.
 */
export declare function nodeSpawner(command: string, args: string[], cwd: string, envOverride?: Record<string, string>): SubprocessHandle;
/**
 * dsh's subprocess seam (`ctx.subprocess`). Same shape by definition. With a remote provider such
 * as a remote subprocess provider mounted, Claude Code runs on the remote machine for a remote workspace; the seam
 * scrubs credential-shaped env vars, so credentials come from the login on that machine.
 * `envOverride` is merged last so configured values win.
 */
export declare const seamSpawner: (subprocess: Pick<SubprocessRuntime, "spawn">) => Spawner;
/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK writes. */
export declare function userTurnLine(content: unknown): string;
/**
 * Formats a successful control response as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID to respond to
 * @param {any} response - The response value
 * @returns {string} A JSON line ready for stdin
 */
export declare function controlResponseLine(requestId: string, response: unknown): string;
/** stdin line asking the CLI to stop the current turn; it answers with a result and stays alive. */
export declare function interruptLine(requestId: string): string;
/** A control response payload as JSON, or undefined when it is not representable. */
export declare function toJsonValue(v: unknown): JsonValue | undefined;
/** The fields of a `rewind_files` answer this plugin reports. */
export interface RewindResult {
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
}
export declare function decodeRewindResult(v: JsonValue | undefined): RewindResult;
/** The slice of a `get_context_usage` answer this plugin reports: the CLI's own token count per category. */
export interface ContextUsage {
    categories: Array<{
        name: string;
        tokens: number;
        deferred: boolean;
    }>;
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model?: string;
    autocompact?: string;
}
export declare function decodeContextUsage(v: JsonValue | undefined): ContextUsage;
/** The `title` of a `generate_session_title` answer, trimmed; undefined when absent or empty. */
export declare function decodeTitle(v: JsonValue | undefined): string | undefined;
/** The slice of a `get_workspace_diff` answer this plugin reports. */
export interface WorkspaceDiff {
    filesCount: number;
    linesAdded: number;
    linesRemoved: number;
    files: Array<{
        path: string;
        added: number;
        removed: number;
        binary: boolean;
        untracked: boolean;
        hunks: Array<{
            oldStart: number;
            newStart: number;
            lines: string[];
        }>;
    }>;
}
export declare function decodeWorkspaceDiff(v: JsonValue | undefined): WorkspaceDiff;
/** One MCP server as `mcp_status` reports it. */
export interface McpServerStatus {
    name: string;
    status: string;
    version?: string;
}
export declare function decodeMcpStatus(v: JsonValue | undefined): McpServerStatus[];
/** One entry of the CLI's own model picker, as `list_models` reports it. */
export interface CliModel {
    value: string;
    resolvedModel: string;
    displayName: string;
    efforts: string[];
}
export declare function decodeCliModels(v: JsonValue | undefined): CliModel[];
/** The request fields of an `elicitation` control request this plugin reads. */
export interface ElicitationRequest {
    mcp_server_name?: string;
    display_name?: string;
    message?: string;
    mode?: string;
    url?: string;
    requested_schema?: JsonValue;
}
/**
 * An MCP elicitation as dsh questions: one per top-level schema property. Enum and boolean
 * properties become choices, strings and numbers a custom answer. Undefined when the schema has
 * no usable properties, or the mode is not a form.
 */
export declare function elicitationQuestions(request: ElicitationRequest, requestId: string): AskUserQuestionItem[] | undefined;
/** dsh's answers → the elicitation result the CLI relays: accept with content, or cancel. */
export declare function elicitationResult(request: ElicitationRequest, response: {
    answers?: Array<{
        id: string;
        custom?: string;
        selected?: string[];
    }>;
}, requestId: string): Record<string, JsonValue>;
/**
 * A `result` line that arrived while no turn was reading, and that is worth a wake: a completed
 * reply. An error result is not: on a rate limit the CLI retries on its own and emits one error
 * result per attempt, and waking on each opened a rejected turn every 73 s until the limit reset
 * (2026-09-06 22:51 to 23:00, eight turns).
 */
export declare function isIdleReply(line: string): boolean;
/** stdin line for any control request this plugin sends; the CLI answers with a `control_response`. */
export declare function controlRequestLine(requestId: string, request: Record<string, JsonValue>): string;
/**
 * Formats a control response error as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID that caused the error
 * @param {any} error - The error value
 * @returns {string} A JSON line ready for stdin
 */
export declare function controlErrorLine(requestId: string, error: unknown): string;
/**
 * Creates an approval decision allowing a tool call to proceed with
 * optional input modifications.
 * @param {string} toolUseId - The tool call ID to approve
 * @param {any} input - The updated tool input
 * @returns {object} An approval decision object
 */
export declare const allowResult: (toolUseId: string, input: unknown) => {
    behavior: "allow";
    updatedInput: unknown;
    toolUseID: string;
    decisionClassification: "user_temporary";
};
/**
 * Creates an approval decision denying a tool call from proceeding.
 * @param {string} toolUseId - The tool call ID to deny
 * @param {string} message - The reason for denial
 * @returns {object} A denial decision object
 */
export declare const denyResult: (toolUseId: string, message: string) => {
    behavior: "deny";
    message: string;
    toolUseID: string;
    decisionClassification: "user_reject";
};
/** Claude's AskUserQuestion input → dsh question items. Undefined when the shape is not what the tool documents. */
export declare function parseQuestions(input: Record<string, unknown>, toolUseId: string): AskUserQuestionItem[] | undefined;
/** dsh answers → the `answers` map Claude expects back in updatedInput, keyed by question text. */
export declare function answersFor(questions: Array<{
    id: string;
    question: string;
    multiSelect?: boolean;
}>, response: {
    answers?: Array<{
        id: string;
        custom?: string;
        selected?: string[];
    }>;
}): Record<string, string>;
/** One-line human reason for the approval dialog. */
export declare function permissionReason(toolName: string, input: Record<string, unknown>, request: Record<string, unknown>): string;
/** Returned by `next(timeoutMs)` when nothing arrived in time; the waiter is withdrawn, no line is lost. */
export declare const TIMEOUT: unique symbol;
/** Async line queue over a child's stdout: `next()` resolves with the next line, or null once the child is gone. */
export declare class LineQueue {
    lines: (string | ClaudeEvent | Record<string, unknown>)[];
    waiters: Array<(line: string | typeof TIMEOUT | null) => void>;
    closed: boolean;
    constructor();
    /** Lines waiting with no turn reading them. */
    get size(): number;
    push(line: string | ClaudeEvent | Record<string, unknown>): void;
    close(): void;
    next(timeoutMs?: number): Promise<string | typeof TIMEOUT | null>;
}
/** Everything one turn needs, as `prepare()` returns it; the process keeps the last one. */
export interface TurnPrep {
    cwd: string;
    args: string[];
    session?: {
        id: string;
        resuming: boolean;
    };
    spec: ClaudeProcessSpec;
    accessMode?: string;
    input: string | null;
}
export interface ClaudeProcessSpec {
    cwd: string;
    model: string | undefined;
    effort: string | null;
    mode: string;
    sessionId: string | null;
    /** Launched with --no-session-persistence: Claude keeps no transcript for this session. */
    temporary: boolean;
}
export interface ClaudeProcessOnExit {
    (proc: ClaudeProcess): void;
}
/** Where a keeper lives: its socket, spec, info and the Claude process it owns. */
export interface KeeperPaths {
    dir: string;
    sock: string;
    spec: string;
    info: string;
}
/** What `keeper.json` says about a keeper; `exit` is set once Claude has left. */
export interface KeeperInfo {
    pid: number;
    claudePid: number;
    sessionId: string;
    startedAt: number;
    exit: {
        code: number | null;
        signal: string | null;
    } | null;
    /** Who ended Claude: a kill message from dsh, Claude itself, or the keeper crashing; null while it runs. */
    endedBy: "client" | "child" | "keeper-crash" | null;
}
export declare function readKeeperInfo(dir: string): KeeperInfo | undefined;
/** True when a pid is alive (signal 0). */
export declare const pidAlive: (pid: number) => boolean;
/**
 * Attach to a keeper's socket and present it as a SubprocessHandle: stdin lines become `in`
 * messages, `out`/`err` lines feed the readable sides, `exit` settles `done`, terminate sends
 * `kill`. Rejects when the socket does not answer within `timeoutMs`.
 */
export declare function attachKeeper(dir: string, timeoutMs?: number): Promise<SubprocessHandle>;
/**
 * A SubprocessHandle that is usable at once while the real one is still being attached: stdin
 * writes queue until then, stdout/stderr are piped through, done and terminate follow the real one.
 */
export declare function lazyHandle(pending: Promise<SubprocessHandle>): SubprocessHandle;
export interface KeeperSpec {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    sessionId: string;
    /** The adapter's process spec, so an adopted keeper matches the next request's spec. */
    procSpec?: ClaudeProcessSpec;
}
export declare function readKeeperSpec(dir: string): KeeperSpec | undefined;
/** Launch the keeper in its own systemd user scope when possible (a service restart's cgroup kill
 *  then misses it), else as a detached process with its own group. */
export declare function launchKeeper(argv: string[], unit: string): void;
/**
 * Start a keeper for one Claude process and attach to it. `launch` runs the keeper command line
 * (plain detached spawn, or a systemd user scope so a service restart's cgroup kill misses it).
 */
export declare function spawnKeeper(dir: string, spec: KeeperSpec, launch: (argv: string[]) => void): Promise<SubprocessHandle>;
export type Spawner = (command: string, args: string[], cwd: string, envOverride?: Record<string, string>) => SubprocessHandle;
/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export declare class ClaudeProcess {
    spec: ClaudeProcessSpec;
    args: string[];
    cwd: string;
    busy: boolean;
    lastUsed: number;
    stderr: string;
    stray: string;
    sent: Set<string>;
    relays: Map<string, RelayEvent>;
    exitCode: number | undefined;
    queue: LineQueue;
    child: SubprocessHandle;
    key?: string;
    resuming?: boolean;
    onIdleResult?(): void;
    dshIds?: Set<string>;
    relayed?: Set<string>;
    steerPending: boolean;
    parked: "steer" | undefined;
    /** Set by the idle watchdog when it kills the process. */
    idleKilled: boolean;
    staleResults: number;
    prep?: TurnPrep;
    /** Sees every `control_response` line as it arrives, even between turns; true means consumed. */
    controlListener?: (event: ClaudeEvent) => boolean;
    constructor({ args, cwd, spec, onExit, command, spawner, }: {
        args: string[];
        cwd: string;
        spec: ClaudeProcessSpec;
        onExit?: ClaudeProcessOnExit;
        command?: string;
        spawner?: Spawner;
    });
    closed(code: number, onExit: ClaudeProcessOnExit | undefined): void;
    get alive(): boolean;
    write(line: string): boolean;
    kill(): void;
    /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
    inject(event: ClaudeEvent): void;
    /** How many `result` events sit in the queue with no turn reading them. Claude Code runs a turn
     *  of its own when a background task it started finishes; with dsh idle, that whole turn is
     *  buffered here and the next prompt would end on its stale result, leaving every later reply
     *  one prompt behind. */
    /** A `result` line while no turn is reading: Claude just finished a turn of its own. Tell the
     *  adapter (`onIdleResult`) so it can open a dsh turn and show the reply now. */
    noteIdleResult(line: string): void;
    countStaleResults(): number;
    /** Next parsed JSON line; plain text lines are kept in `stray` for error messages. Null when the
     *  process ended, `{ type: "timeout" }` when `timeoutMs` passed first. */
    nextEvent(timeoutMs?: number): Promise<ClaudeEvent | null>;
}
