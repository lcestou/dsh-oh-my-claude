import { type FinishReason, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { type ContextSource } from "../context-sources.js";
import { type Agent, type JsonValue, type ResolvedAgent } from "../dsh.js";
import { type ClaudeEvent, type ClaudeProcessSpec, type RelayEvent, type WorkspaceDiff } from "../process.js";
import { type FsBox } from "../remote-fs.js";
import { type LiveMode, type Translator } from "../translator.js";
import { type LooseMessage } from "./prompt.js";
import { type TurnTotals } from "./types.js";
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
    /** The CLI's running totals as this turn's result reported them, kept so a handle attached to
     *  the same process after a dsh restart knows where to count from. Absent on older records. */
    costTotal?: number;
    apiTotal?: number;
}
/** dsh splicing messages into a session's inbox mid-turn; the steers this adapter forwards live. */
export type SpliceEvent = {
    type?: string;
    data?: {
        target?: string;
        inserted?: LooseMessage[];
        removedCount?: number;
    };
};
/** `GET /turns` and the `turns` event. */
export interface TurnsReply {
    turns: TurnRecord[];
    total: TurnTotals;
}
/** One session's ultracode: what `/ultracode` asked for, and the CLI's last read-back of it. */
export interface UltracodeState {
    wanted: boolean;
    confirmed?: {
        on: boolean;
        available: boolean;
    };
}
/** What each session asked for, as stored. Off is kept as well as on: a session whose own Claude
 *  Code settings turn ultracode on has to be told off again by every process started for it. */
export declare const wantedUltracode: (states: ReadonlyMap<string, UltracodeState>) => Record<string, boolean>;
/** What `/ultracode status` answers for a session's state; undefined is a session never set. */
export declare const ultracodeStatus: (state: UltracodeState | undefined) => string;
/** The slice of a Claude process the idle watchdog needs. */
export interface IdleTarget {
    idleKilled: boolean;
    /** How long the silence that killed it was allowed to run, so the error can name that number. */
    idleKilledAfterMs?: number;
    /** Stop the process. The idle watchdog calls this once a turn has been silent past its limit. */
    kill(): void;
    /** The idle watchdog feeds a stream event through here so it can measure how long the silence has run. */
    inject(event: ClaudeEvent): void;
}
/**
 * How much longer than the configured idle timeout a turn may be silent while a tool call is out.
 * A `Bash` step running a test suite is legitimately quiet for a long time; a call that never comes
 * back should still end rather than hold the session open until dsh restarts.
 */
export declare const TOOL_IDLE_FACTOR = 2;
/** Per-session ring buffer (last 50 turns) keyed by dsh sessionId, on the adapter instance. */
export declare const TURN_RING = 50;
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
/** On an error result it builds the message a person sees: it names the box the turn ran on and,
 *  for a 5xx, appends the incident the status page reports so the failure reads as the provider's. */
export declare function finishReason(result: ResultFrame, hostLabel?: string): FinishReason;
/**
 * Incremental translator from Claude Code stream-json lines to dsh StreamChunks.
 * Prefers partial `stream_event`s; falls back to whole `assistant` messages when no partials arrived.
 * Tool calls and results are shown as reasoning blocks: the CLI runs its own tools, dsh only watches.
 */
/** The `kind` dsh's loop puts on an abort reason ("disposed" on shutdown), else undefined. */
/** The producer-owned source kind dsh's session format v4 gives this plugin's own messages. v4
 *  (`dsh-session-format-v3-to-v4`, `source()`) refuses any appended message whose `kind` is the
 *  retired `"plugin"` wrapper with "format v4 message requires a producer-owned source kind"; its
 *  migrator lifts `{ kind: "plugin", plugin: X }` to `{ kind: "plugin:X" }`, and a native v4 append
 *  must already carry that shape. */
export declare const OWN_SOURCE_KIND = "plugin:dsh-oh-my-claude";
/** Whether a logged source is one of this plugin's own, in either the v3 wrapper or the v4 kind. */
export declare const isOwnSource: (source: {
    kind?: string;
    plugin?: string;
} | undefined) => boolean;
/** The source a wake notice carries: user only when a restart notice must rearm an active goal.
 *  `logVersion` is the session log's `header.version`; from 4 up the notice carries the
 *  producer-owned kind, since the v3 wrapper fails the turn it is appended to (seen 2026-09-23 on
 *  dsh 0.1.7-alpha.2: the restart notice itself was the turn that died). */
export declare function noticeSource(text: string, goalActive: boolean, logVersion?: number): {
    readonly kind: "user";
} | {
    readonly form: "notice";
    readonly summary: string;
    readonly kind: "plugin:dsh-oh-my-claude";
} | {
    readonly form: "notice";
    readonly summary: string;
    readonly kind: "plugin";
    readonly plugin: "dsh-oh-my-claude";
};
/** After an interrupt, kill a process that did not finish in time: only when no keeper owns it. */
export declare const killAfterGrace: (spawn: string) => boolean;
/** What an interrupt does to the process's steer state: a steer forwarded before the Stop was
 *  already handed to the CLI, which runs it as a turn of its own once the interrupt lands (seen
 *  2026-09-18: `queue-operation dequeue` 7 ms after `[Request interrupted by user]`). Nothing is
 *  left to park on, and a park flag left set would read the CLI's interrupt echo (a `user` frame)
 *  as the tool-result boundary, exit the step as parked, and leave the interrupted turn's error
 *  `result` in the queue for the next prompt to die on. The waiting steers go too: the CLI dequeues them the moment the interrupt lands. */
export declare function noteInterrupt(proc: {
    steerPending: boolean;
    steers?: Map<string, unknown>;
    forwarded?: number;
}): void;
/** Forget the steers a process had waiting: the CLI has taken them or they went with the turn. Tolerates
 *  a process object without the map (the test fakes, a process from before this field existed). */
export declare function forgetSteers(proc: {
    steers?: Map<string, unknown>;
    forwarded?: number;
}): void;
/** Whether an aborted stream should interrupt Claude: always, except a dsh shutdown under a keeper. */
export declare function interruptOnAbort(kind: string | undefined, spawn: string): boolean;
/** The `kind` in an abort signal's `{ kind }` reason, which is disposed, aborted or cancelled, or
 * undefined for a plain abort, so a caller can tell a dispose from a user cancel. */
export declare function abortKind(signal: AbortSignal | undefined): string | undefined;
/** dsh's tool-result for a relayed call, searched from the newest message back. */
export declare function toolResultFor(messages: LooseMessage[] | undefined, id: string): {
    text: string;
    isError?: boolean;
} | undefined;
/** Messages dsh delivered after the last assistant step. */
export declare function afterLastAssistant(messages: LooseMessage[] | undefined): LooseMessage[];
/** The Agent inside what dsh's session controller answered for a cold resume: `{ agent }`, or
 *  `{ error }` when the session cannot be resumed. Read as the Agent, the wrapper has no
 *  `followup`, and every wake of an unloaded session fails on it. The controller's error is thrown
 *  so the caller reports it like any other failed resume. */
export declare function resolvedAgent(found: ResolvedAgent): Agent;
/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export declare const WAKE_TEXT = "Claude Code finished a background task and replied.";
/** A mirror turn whose followup never opened a turn (the agent went away) is put back after this. */
export declare const MIRROR_TURN_TIMEOUT_MS = 120000;
/** How long the transcript must stay still before the watcher reads it: the CLI writes a reply as
 *  several rows, and a turn mirrored between two of them would show half of it. */
export declare const TRANSCRIPT_SETTLE_MS = 250;
/** How often loaded sessions are checked for a transcript not yet under watch. */
export declare const WATCH_SWEEP_MS = 30000;
/** How far back a first watch looks for a terminal prompt still being answered. */
export declare const WATCH_LOOKBACK_BYTES: number;
/** How far back a watch starts when no baseline was ever saved for this transcript. Starting at the
 *  end of the file instead, which is what it did, meant every exchange already in it was skipped for
 *  good: turning the mirror on, or a transcript whose path changed under a new Claude id, left the
 *  tab holding only whatever landed next. Bounded rather than the whole file so enabling it on a long
 *  session does not replay a day of terminal work into the tab. */
export declare const FIRST_WATCH_BYTES: number;
/** How long a terminal turn must run before it streams live rather than landing whole at its end:
 *  below this, the turn completes fast enough that one push reads cleaner than a live fill. */
export declare const STREAM_THRESHOLD_MS = 1000;
/** How long the stream waits idle before settling: longer for a remote box, where a blank costs a round trip, than for a local one. */
export declare const idleFor: (box: FsBox) => number;
/** A terminal turn that never ends (an abandoned or crashed `claude`) would hold its dsh turn open
 *  forever; after this the render settles what it has and closes. */
export declare const STREAM_MAX_MS: number;
/** Sent as a real prompt after dsh restarts mid-turn: the process is gone, Claude must carry on. */
/** Sent when a restarted dsh reattaches to a Claude process that kept running meanwhile. */
export declare const RECONNECT_TEXT = "[Oh My Claude] dsh restarted and reattached to your still-running Claude Code process; what you did meanwhile is shown above. Continue where you are.";
/** Sent when a usage limit that ended a turn has reset, so Claude picks the task back up. */
export declare const LIMIT_TEXT = "[Oh My Claude] your usage limit has reset. Continue the task where the limit stopped you.";
export declare const RESTART_TEXT = "[Oh My Claude] dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task. If this session has an active goal, dsh disarmed it on resume: call get_goal, then update_goal with action resume, so the goal rounds keep driving the work without anyone typing.";
/** How long after boot to nudge interrupted sessions; dsh needs its sessions and agents loaded. */
export declare const RESUME_DELAY_MS = 10000;
/** Slack after a usage limit's reset instant before the continue notice goes out. */
export declare const LIMIT_GRACE_MS = 5000;
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
/** How long to wait for the rest of a parallel dsh tool-call batch after the first one arrives. */
export declare const RELAY_BATCH_MS = 1500;
/** How long a step handing dsh a relay waits for Claude's own tool results still in flight.
 *  Its Read, Grep and short Bash land in milliseconds; a longer Bash gets a placeholder row. */
export declare const NATIVE_RESULT_WAIT_MS = 10000;
/** After asking the CLI to interrupt, how long before falling back to killing the process. */
export declare const INTERRUPT_GRACE_MS = 5000;
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
/** A process spec as a string, so two specs compare by content when deciding to reuse a process. */
export declare const specKey: (spec: ClaudeProcessSpec) => string;
/** Whether a todo list still has work on it. A list of nothing but completed items is finished,
 *  and a finished list is not worth painting over a fresh message. */
export declare function hasPendingTodo(todos: JsonValue[]): boolean;
/**
 * The provider dsh talks to. It owns one Claude Code process per session, converts a dsh turn
 * into stdin lines and the CLI's stream-json back into dsh events, and keeps the state that has to
 * survive a restart, the turn records, permission modes and keepers.
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
    /** The CLI's spinner mode for this turn; absent until the first frame names one, which the reply
     *  reads as `requesting` (the CLI's own state between the request and the first block). */
    mode?: LiveMode;
    at: number;
}
/** A `get_workspace_diff` answer as the text a side question carries. Hunk headers and raw lines,
 *  nothing invented; a file with no hunks is named with why, so the reply does not guess. Whole files
 *  only, in the CLI's own order, up to the cap; the first file always goes even if it alone is over,
 *  because a context with no diff in it is worse than a long one. */
export declare const diffContext: (diff: WorkspaceDiff, path: string) => string;
/**
 * What Claude reads when dsh answers an approval without allowing it. "unavailable" and
 * "cancelled" used to reach it as the bare words `approval unavailable`, which say nothing: in one
 * reported session Claude retried seven times over half an hour, then told the user to reopen the
 * session elsewhere (#170). dsh answers "unavailable" when no approver is reachable or the one it
 * has failed, so nobody was asked; a retry loop cannot fix that, and the person can.
 */
export declare const OUTCOME_MESSAGE: {
    rejected: string;
    unavailable: string;
    cancelled: string;
};
