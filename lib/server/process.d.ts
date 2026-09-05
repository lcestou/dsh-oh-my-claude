import type { AskUserQuestionItem, JsonValue, SubprocessRuntime } from "./dsh.js";
export type { JsonValue } from "./dsh.js";
/** Errors reach us as `unknown`; this is the one place they become text. */
export declare const errorText: (e: unknown) => string;
/** Text of a Claude tool_result: a string, or the text blocks of a content array; other block
 *  kinds render as their bracketed type. */
export declare function toolResultText(block: {
    content?: unknown;
}): string;
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
    compact_metadata?: Record<string, unknown>;
    status?: string | null;
    compact_result?: string;
    compact_error?: string;
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
/** Decoded control_request event from Claude Code stream-json output. */
export interface ClaudeControlRequest {
    type: "control_request";
    request_id: string;
    request?: {
        subtype?: string;
        tool_name?: string;
        input?: unknown;
        tool_use_id?: string;
        title?: string;
        description?: string;
    };
}
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
export interface TranslatedBlock {
    index: number;
    blockType: string;
    text?: string;
    started?: boolean;
    tool?: boolean;
}
export interface TranslatedEvent {
    type: string;
    index?: number;
    blockType?: string;
    text?: string;
    block?: Record<string, unknown>;
    usage?: Record<string, unknown>;
    reason?: Record<string, unknown>;
    id?: string;
    name?: string;
    argumentsDelta?: string;
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
}
export interface ClaudeProcessOnExit {
    (proc: ClaudeProcess): void;
}
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
    staleResults: number;
    prep?: TurnPrep;
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
