import type { AskUserQuestionItem, JsonValue, SubprocessRuntime } from "./dsh.js";
import type { ContextSizes, ContextSource } from "./context-sources.js";
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
 *  dsh tools; file checkpointing, which stream-json runs leave off unless asked, so that the
 *  `rewind_files` control request has something to rewind to; and an entrypoint of the plugin's
 *  own. Left alone, a print-mode CLI records `entrypoint: sdk-cli` in the transcript, and a
 *  terminal `claude --resume` hides every session recorded as sdk-cli, sdk-ts or sdk-py (checked
 *  in 2.1.268), so the dsh sessions never showed in the picker. The CLI keeps any other value as
 *  given, only `cli` is rewritten to sdk-cli in print mode, and an unknown one counts as `other` in
 *  its telemetry and as the plain CLI everywhere else. */
export declare const CHILD_ENV: {
    MCP_TOOL_TIMEOUT: string;
    CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: string;
    CLAUDE_CODE_ENTRYPOINT: string;
};
/** The environment a Claude child runs with: dsh's own, then the plugin's additions, then whatever
 *  the caller passes. CHILD_ENV beats the inherited value on purpose. An `MCP_TOOL_TIMEOUT` that
 *  happens to be in dsh's environment would otherwise cut relayed dsh tools short in one spawn mode
 *  and not the other. A caller that means to override still wins, which is the escape hatch. */
export declare function childEnv(base: NodeJS.ProcessEnv, override?: Record<string, string>): Record<string, string>;
/** Where Claude Code's installers put `claude` (the native installer, the old local install, Homebrew,
 *  npm and bun globals, Volta). An app started from the macOS Dock or Finder, DSH Desktop among
 *  them, gets a PATH of `/usr/bin:/bin:/usr/sbin:/sbin`, which holds none of these. */
export declare function claudeDirs(home?: string): string[];
/** `path` with every folder from `dirs` it lacks appended, so a name found on the caller's PATH
 *  keeps winning. Appending also lets an npm-installed `claude`, a `#!/usr/bin/env node` script,
 *  find the node that sits beside it. */
export declare function withClaudeDirs(path: string | undefined, dirs?: string[]): string;
/** The absolute path of `command` when it is a bare name found on `path` or in `dirs`, else
 *  `command` unchanged: a path is trusted as given, and a name found nowhere is left for spawn to
 *  fail on with the usual ENOENT. On Windows a bare name also matches `<name>.exe`. */
export declare function resolveCommand(command: string, path?: string | undefined, dirs?: string[], exists?: (p: string) => boolean, platform?: NodeJS.Platform): string;
/** The child process seam this plugin uses: dsh's own spawner and the node one both answer it. */
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
/** One line of the CLI's stream-json stdout, in the shapes this plugin reads. */
export type ClaudeEvent = {
    type: "system";
    subtype?: string;
    /** subtype "init": the CLI's slash-command catalog (skills, custom commands, built-ins). */
    slash_commands?: JsonValue;
    /** subtype "init": every tool name the session has; MCP ones read `mcp__<server>__<tool>`. */
    tools?: JsonValue;
    /** subtype "init": plugins the CLI could not load, `{plugin,type,message}` each. Present only
     *  when there are errors; a clean load omits the key. */
    plugin_errors?: JsonValue;
    /** subtype "init": plugins the CLI loaded with a complaint, `{plugin,type,message}` each
     *  (a shadowed default folder, a suppressed server). Present only when there are warnings. */
    plugin_warnings?: JsonValue;
    /** subtype "compact_boundary": `trigger` and `pre_tokens` always, `post_tokens` and
     *  `duration_ms` when the CLI chose to fill them in. */
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
    last_tool_name?: string;
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    };
    workflow_progress?: unknown;
    patch?: {
        status?: string;
        error?: string;
        end_time?: number;
        is_backgrounded?: boolean;
    };
    commands?: JsonValue;
    content?: string;
    level?: string;
    trigger?: string;
    original_model?: string;
    fallback_model?: string;
    direction?: "retry" | "revert" | "sticky";
    scope?: "session" | "local";
    api_refusal_category?: string | null;
    api_refusal_explanation?: string | null;
    original_model_name?: string;
    persisted_as_default?: boolean;
    choice?: "consent" | "switch_default" | "cancelled";
    prevent_continuation?: boolean;
    tool_name?: string;
    message?: string;
    decision_reason?: unknown;
    decision_reason_type?: string;
    tasks?: unknown;
    estimated_tokens?: number;
    estimated_tokens_delta?: number;
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
        /** subtype "api_error": set when the failure was the connection itself, not a response. */
        connection?: string;
        is_network_down?: boolean;
    };
} | {
    /** Top-level frame, not a `system` subtype: the CLI emits one per running tool call every 30
     *  seconds with `heartbeat: true`, and one without it when a subagent retries an API failure. */
    type: "tool_progress";
    tool_use_id?: string;
    tool_name?: string;
    parent_tool_use_id?: string | null;
    elapsed_time_seconds?: number;
    heartbeat?: boolean;
    task_id?: string;
    subagent_type?: string;
    subagent_retry?: {
        agent_id?: string;
        attempt?: number;
        max_retries?: number;
        retry_delay_ms?: number;
        error_status?: number;
        error_category?: string;
    };
} | {
    type: "stream_event";
    event?: ClaudeStreamPartial;
    /** Set when the frame belongs to a nested agent, as on `assistant` and `user` frames. */
    parent_tool_use_id?: string | null;
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
        rateLimitType?: string;
        overageStatus?: string;
        overageResetsAt?: number;
        isUsingOverage?: boolean;
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
/** The `message` of an assistant event: the model that wrote it and its content blocks. */
export interface ClaudeAssistantMessage {
    id?: string;
    model?: string;
    role?: string;
    content?: ClaudeContentBlock[];
}
/** One block of an assistant message; the translator draws a lane for each of these four. */
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
    /** `message_start` only: the message these deltas belong to. */
    message?: {
        id?: string;
    };
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
 * dsh's subprocess seam (`ctx.subprocess`). Same shape by definition. With a remote provider
 * mounted, Claude Code runs on the remote machine for a remote workspace; the seam
 * scrubs credential-shaped env vars, so credentials come from the login on that machine.
 * `envOverride` is merged last so configured values win.
 */
export declare const seamSpawner: (subprocess: Pick<SubprocessRuntime, "spawn">) => Spawner;
/** POSIX single-quote a string for a remote shell: wrap in `'...'`, escaping any embedded quote. */
export declare function shq(value: string): string;
/** The local `ssh` argv that runs `script` on `host`. BatchMode: key auth only, so a missing key or
 * unknown host fails fast instead of hanging on a prompt. */
/**
 * The argument list for `ssh <host> <script>`.
 *
 * `--` ends ssh's own option parsing, so the host is always a destination and never an option.
 * Without it, a host that starts with a dash is read as a flag: `-oProxyCommand=<cmd>` makes ssh
 * run `<cmd>` on this machine before it connects anywhere, which is a local command run by anyone
 * who can pass dsh's login, outside every permission mode Claude has. Two routes took the host
 * straight from the request. The check below refuses such a host outright rather than relying on
 * `--` alone, because a refused request says what went wrong and a quietly failed connect does not.
 * Found by a security review, 2026-09-21.
 */
export declare function sshArgs(host: string, script: string): string[];
/** A destination ssh can be given safely: `host`, `user@host` or `user@host:port`-free forms,
 *  and never anything ssh would read as an option or that carries whitespace or a control. */
export declare function isSshHost(host: string): boolean;
/**
 * Where the multiplex sockets live, or nothing when no directory can hold one.
 *
 * The state dir is one byte too long for a `%C` socket (`~/.local/state/dsh-oh-my-claude/ssh/`
 * plus the name is 108), so every connection through it failed with "too long for Unix domain
 * socket" and the panel showed that instead of the box. The runtime dir is short, is on tmpfs and
 * is cleared at logout, which is where a socket belongs; the state dir stays as the fallback for a
 * session without one, and is skipped when it does not fit.
 */
export declare function controlSocketDir(runtime: string | undefined, state: string, make: (dir: string) => void): string | undefined;
/**
 * The local `ssh` argv that runs `command args` on `host` in `cwd`. The remote shell inherits none
 * of this box's environment or working directory, so the command carries both: `cd` into `cwd`, then
 * `exec env` with CHILD_ENV (file checkpointing for rewind, the long MCP timeout). `cwd` is this
 * box's workspace path and usually does not exist on the remote, so fall back to the remote `$HOME`
 * rather than let `cd` fail the whole spawn. A remote workspace redirects `cwd` to its real remote
 * path before it reaches here (see `sshSpawner`), so that fallback is only for a plain local path.
 */
export declare function sshInvocation(host: string, command: string, args: string[], cwd: string, token?: string): {
    command: string;
    args: string[];
};
/**
 * Spawner that runs Claude Code on a remote host over SSH: this box's harness drives the far `claude`,
 * nothing runs there but the CLI itself. The stream-json wire flows through the ssh pipe unchanged, so
 * the translator, approvals and control requests are untouched. The remote uses its own `~/.claude`
 * login; the dsh MCP bridge points at this box's port and does not reach it, so `dshTools` is best off.
 */
export declare const sshSpawner: (host: string, resolveCwd?: (cwd: string) => string, token?: string) => Spawner;
/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK
 *  writes. `uuid` names the line for a later `cancel_async_message`; the CLI keeps it as the message's id. */
export declare function userTurnLine(content: unknown, uuid?: string): string;
/** stdin line answering one of the CLI's control requests with a result. */
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
/** Whether a `cancel_async_message` reply says the CLI gave the message back. False for anything
 *  else, including a reply shape a newer CLI changed, so a doubt reads as "already sent". */
export declare function decodeCancelled(v: JsonValue | undefined): boolean;
/** A `rewind_conversation` answer, keeping only the fields the panel shows. */
export declare function decodeRewindResult(v: JsonValue | undefined): RewindResult;
/**
 * A running total read as one turn's own share: the rise since the previous result, or the whole
 * figure when the total started over. `total_cost_usd` and `duration_api_ms` climb for the life of
 * a CLI process, and a new process, a resume or a mid-session `/clear` starts them
 * again from zero, which arrives here as a figure below the last one. Each result carries the
 * running total so far, so read the latest result rather than summing across results.
 */
export declare const turnDelta: (total: number, soFar: number) => number;
/** What a breakdown row is. The CLI's own words for the field: "'used' content occupies the window;
 *  'free' is the remaining window; 'buffer' is the compaction reserve; 'deferred' rows are
 *  out-of-window tool schemas. Classify on this, never on the English name." Absent from a CLI
 *  older than 2.1, where the name and `isDeferred` are all there is. */
export type ContextRowKind = "used" | "free" | "buffer" | "deferred";
/** The slice of a `get_context_usage` answer this plugin reports: the CLI's own token count per category. */
export interface ContextUsage {
    categories: Array<{
        name: string;
        tokens: number;
        deferred: boolean;
        kind?: ContextRowKind;
    }>;
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model?: string;
    autocompact?: string;
    /** Set when the CLI's window is below the plugin's table for this model while
     *  `ANTHROPIC_BASE_URL` points off api.anthropic.com: the base URL, for the popover's notice. */
    assumedBehind?: string;
    /** With `assumedBehind`: the Proxy reaches Anthropic switch is on and this process predates it,
     *  so the session's next turn replaces the process and the guess ends there. */
    followsNext?: true;
}
/** Decodes a `get_context_usage` answer, returning an all-zero report when the payload is missing
 *  or not an object rather than throwing. */
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
/** A `get_workspace_diff` answer as totals, per-file counts and hunks, skipping malformed entries. */
export declare function decodeWorkspaceDiff(v: JsonValue | undefined): WorkspaceDiff;
/** The slice of a `list_permission_rules` answer this plugin reports. `text` is the CLI's own
 *  display line, which is why nothing here re-words a rule. */
export interface PermissionRules {
    rules: Array<{
        behavior: string;
        source: string;
        rule: string;
        text: string;
    }>;
    directories: Array<{
        path: string;
        source: string;
    }>;
    managedOnly: boolean;
}
/** A `list_permission_rules` answer as rules, workspace directories and a managed-only flag,
 *  skipping malformed entries. */
export declare function decodePermissionRules(v: JsonValue | undefined): PermissionRules;
/** The slice of a `get_hooks_listing` answer this plugin reports, one row per configured hook. */
export interface HooksListing {
    hooks: Array<{
        event: string;
        matcher: string;
        source: string;
        text: string;
    }>;
}
/** A `get_hooks_listing` answer as per-hook rows, skipping malformed entries. */
export declare function decodeHooksListing(v: JsonValue | undefined): HooksListing;
/** One MCP server as `mcp_status` reports it. */
export interface McpServerStatus {
    name: string;
    status: string;
    version?: string;
    error?: string;
    /** Bare tool names this server contributes. Filled from the init frame by the adapter, not by
     *  `mcp_status`, which does not report tools; absent when no init frame has been seen. */
    tools?: string[];
    /** This server's tools have been pinned back to asking on the live process. The adapter's own
     *  record, not the CLI's: `mcp_status` reports connection and nothing about permissions. */
    asking?: boolean;
}
/** An `mcp_status` answer as one row per server, with its own error kept when it is not connected. */
export declare function decodeMcpStatus(v: JsonValue | undefined): McpServerStatus[];
/** The sign-in page from an `mcp_authenticate` reply, or undefined when the reply does not carry
 *  one. Probed against 2.1.278 on 2026-09-20. */
export declare function mcpAuthUrl(v: JsonValue | undefined): string | undefined;
/** True when the CLI answered success with nothing for the person to do: the server's token is
 *  still good, so there is no page to open. Distinguishing this from a failure matters, because the
 *  panel would otherwise tell someone their login failed when they are already signed in. */
export declare function mcpAuthNeedsNothing(v: JsonValue | undefined): boolean;
/** One entry of the CLI's own model picker, as `list_models` reports it. */
export interface CliModel {
    value: string;
    resolvedModel: string;
    displayName: string;
    /** The CLI picker's one-line blurb ("Opus 5 with 1M context · Best for everyday, complex tasks"). */
    description?: string;
    efforts: string[];
}
/** A `list_models` answer: what `claude --model` accepts for this login, aliases included. */
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
/** stdin line answering one of the CLI's control requests with a failure. */
export declare function controlErrorLine(requestId: string, error: unknown): string;
/** Lets a tool call run, with the input dsh approved, which may differ from the one asked for. */
export declare const allowResult: (toolUseId: string, input: unknown) => {
    behavior: "allow";
    updatedInput: unknown;
    toolUseID: string;
    decisionClassification: "user_temporary";
};
/** Refuses a tool call and tells Claude why; the CLI reads this as the user rejecting it. */
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
    /** Start with no queued lines, no waiters and no close flag; every field stays empty until the
     *  first push. */
    constructor();
    /** Lines waiting with no turn reading them. */
    get size(): number;
    /** Hand a line to the earliest waiter if one is waiting, else buffer it, so a line never arrives
     *  before its reader. */
    push(line: string | ClaudeEvent | Record<string, unknown>): void;
    /** Mark the queue closed and resolve every pending waiter with null, so a stopped child's
     *  readers see the end. */
    close(): void;
    /** Resolve with the next queued line, a timeout after `timeoutMs` with nothing, or null once the
     *  queue is closed. */
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
    /** The context blocks the Settings switches withhold, read once when this turn was assembled. */
    drops?: ReadonlySet<ContextSource>;
    /** What each of those blocks cost this turn in characters, before any of them were withheld.
     *  Absent on a side call, which has no workspace to record a number against. */
    sizes?: ContextSizes;
}
/** Everything a Claude process needs at spawn: where it runs, how it is reached, what it may do. */
export interface ClaudeProcessSpec {
    cwd: string;
    model: string | undefined;
    effort: string | null;
    mode: string;
    sessionId: string | null;
    /** Launched with --no-session-persistence: Claude keeps no transcript for this session. */
    temporary: boolean;
    /** Spawned with the CLI's "the proxy is Anthropic" flag (the Proxy reaches Anthropic switch).
     *  Present only when on, so a spec saved before the switch existed still keys the same; a flip
     *  changes the key, and the session's next turn replaces the process, as an effort change does. */
    firstParty?: true;
}
/** What the caller wants to know when a Claude process ends, live or after a restart. */
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
/** The keeper record in a spawn directory, or undefined when it is missing or damaged. */
export declare function readKeeperInfo(dir: string): KeeperInfo | undefined;
/** True when a pid is alive (signal 0). Only a positive pid is one process: `kill(0, …)` is the
 *  caller's own process group and `kill(-1, …)` is every process this user owns, so a record that
 *  lost its pid (a keeper whose spawn failed writes none, read back as -1) must answer "not
 *  alive" here, or the orphan kill that follows sends SIGTERM to the user's whole login session
 *  (2026-09-17: a dsh-web restart logged the owner out of the desktop). */
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
/** The keeper's record of the process it babysits, written at spawn and read after a restart. */
export interface KeeperSpec {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    sessionId: string;
    /** The adapter's process spec, so an adopted keeper matches the next request's spec. */
    procSpec?: ClaudeProcessSpec;
}
/** The spawn arguments a keeper was started with, for adopting or respawning it after a restart. */
export declare function readKeeperSpec(dir: string): KeeperSpec | undefined;
/** Launch the keeper in its own systemd user scope when possible (a service restart's cgroup kill
 *  then misses it), else as a detached process with its own group. */
export declare function launchKeeper(argv: string[], unit: string): void;
/** Whether a `systemd-run --scope` that exited with `code` after `elapsedMs` failed to start the
 *  keeper rather than outliving it. A keeper stays up at least three seconds after its Claude dies,
 *  so a non-zero exit inside two seconds is systemd-run refusing, not the keeper ending. */
export declare function scopeFailed(code: number | null, elapsedMs: number): boolean;
/**
 * Start a keeper for one Claude process and attach to it. `launch` runs the keeper command line
 * (plain detached spawn, or a systemd user scope so a service restart's cgroup kill misses it).
 */
export declare function spawnKeeper(dir: string, spec: KeeperSpec, launch: (argv: string[]) => void): Promise<SubprocessHandle>;
/** How a child is started: locally, or on a box over ssh. The adapter holds one per provider. */
export type Spawner = (command: string, args: string[], cwd: string, envOverride?: Record<string, string>) => SubprocessHandle;
/** A typed steer written to the CLI and not yet absorbed, keyed by its dsh message id in `steers`. */
export interface WaitingSteer {
    /** The stdin line's uuid, which `cancel_async_message` names. */
    uuid: string;
    /** Its steerKey, the entry in the process's `sent` set. */
    key: string;
    /** What Claude will read: the latest edit. */
    text: string;
    /** Epoch ms of the first write, for ordering. */
    at: number;
}
/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export declare class ClaudeProcess {
    spec: ClaudeProcessSpec;
    /** The permission mode the CLI is running in right now: `spec.mode` at spawn, then whatever the
     *  last accepted `set_permission_mode` set. `spec.mode` stays the launch mode on purpose, since
     *  the CLI takes a live switch to bypassPermissions only from a process launched in it. */
    liveMode: string;
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
    /** Typed steers written to stdin that the CLI has not taken yet, by dsh message id. Cleared at the
     *  park that absorbs them, at the turn's end and on interrupt; the steer card lists these. */
    steers: Map<string, WaitingSteer>;
    /** How many mid-turn messages (typed or not, and file steers waiting to park) the CLI still has to
     *  take. Holding a steer for an edit lowers it; at zero nothing is left to park on. */
    forwarded: number;
    parked: "steer" | undefined;
    /** The CLI's `dsh` MCP session belongs to a dsh that is gone (adopted after a restart) and the
     *  reconnect after adoption gave up, because dsh had no live agent for the session yet. The next
     *  turn, which implies one, asks once more before its prompt goes out. */
    bridgeStale: boolean;
    /** Set by the idle watchdog when it kills the process. */
    idleKilled: boolean;
    /** The silence it was allowed before that kill: longer while a tool call is out. */
    idleKilledAfterMs?: number;
    /** MCP servers this process has been told to ask about, by name. The CLI holds the override in
     *  its own tool-permission context and offers no read-back, so the only record is the one kept
     *  where the override was sent from. It hangs off the process for the same reason the override
     *  does: both end when the process does, so nothing has to remember to clear it. */
    mcpAsking: Set<string>;
    staleResults: number;
    /** When this turn's prompt was written, for time-to-first-token; 0 once a result has read it. */
    promptSentAt: number;
    /** `total_cost_usd` and `duration_api_ms` as of the last result frame. Both are running totals
     *  for the life of the process, not this turn's figures, so each turn's own is the difference
     *  from here. They hang off the process because a Translator lives for one turn and the CLI's
     *  totals restart with the process. */
    costSoFar: number;
    apiMsSoFar: number;
    /** The model whose context window was last asked for, as `spec.model ?? ""`. A session started on
     *  the mount's default model names no model at all, so "asked" cannot be read off the bank alone. */
    windowAskedFor?: string;
    prep?: TurnPrep;
    /** A terminal wrote turns into this session's transcript since this process last spoke, so its
     *  context is behind the file; the next prompt replaces it and resumes from the transcript. */
    staleContext: boolean;
    /** Sees every `control_response` line as it arrives, even between turns; true means consumed. */
    controlListener?: (event: ClaudeEvent) => boolean;
    /** Spawn the child Claude and feed its stdout into the line queue, noting idle completion replies
     *  so the adapter can open a dsh turn. */
    constructor({ args, cwd, spec, onExit, command, spawner, }: {
        args: string[];
        cwd: string;
        spec: ClaudeProcessSpec;
        onExit?: ClaudeProcessOnExit;
        command?: string;
        spawner?: Spawner;
    });
    /** When the child ends, reject every relayed tool call as failed, close the queue and run the
     *  exit callback. */
    closed(code: number, onExit: ClaudeProcessOnExit | undefined): void;
    /** True while the child has not exited, so a write to a finished process is refused. */
    get alive(): boolean;
    /** Write a stdin line to the child, returning false when it has exited, so a line to a dead
     *  process is not silently dropped. */
    write(line: string): boolean;
    /** Terminate the child while it is alive, so killing an already-dead process is a no-op. */
    kill(): void;
    /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
    inject(event: ClaudeEvent): void;
    /** A `result` line while no turn is reading: Claude just finished a turn of its own. Tell the
     *  adapter (`onIdleResult`) so it can open a dsh turn and show the reply now. */
    noteIdleResult(line: string): void;
    /** Count buffered `result` events with no turn reading them, so the loop can tell a real reply
     *  from a stale background-task completion. */
    countStaleResults(): number;
    /** Next parsed JSON line; plain text lines are kept in `stray` for error messages. Null when the
     *  process ended, `{ type: "timeout" }` when `timeoutMs` passed first. */
    nextEvent(timeoutMs?: number): Promise<ClaudeEvent | null>;
}
