// The turn record, the ultracode state, the result and login parses, the notice texts and the live-turn shape.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { hostname } from "node:os";
import {
  boundContextSummary,
  type ContentBlockType,
  type FinishReason,
  type StreamChunk,
  type ToolCallId,
} from "@deepseek-ai/dsh-llm";
import { degradedNote, peekStatus } from "../anthropic-status.js";
import { type ContextSource } from "../context-sources.js";
import { type Agent, type ApprovalOutcome, type JsonValue, type ResolvedAgent } from "../dsh.js";
import { serverText } from "../locale.js";
import {
  type ClaudeEvent,
  type ClaudeProcessSpec,
  type RelayEvent,
  type WorkspaceDiff,
} from "../process.js";
import { type FsBox } from "../remote-fs.js";
import { type LiveMode, type Translator } from "../translator.js";
import { promptTextOf, steerKey, textOf, type LooseMessage } from "./prompt.js";
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
  data?: { target?: string; inserted?: LooseMessage[]; removedCount?: number };
};

/** `GET /turns` and the `turns` event. */
export interface TurnsReply {
  turns: TurnRecord[];
  total: TurnTotals;
}

/** One session's ultracode: what `/ultracode` asked for, and the CLI's last read-back of it. */
export interface UltracodeState {
  wanted: boolean;
  confirmed?: { on: boolean; available: boolean };
}

/** What each session asked for, as stored. Off is kept as well as on: a session whose own Claude
 *  Code settings turn ultracode on has to be told off again by every process started for it. */
export const wantedUltracode = (
  states: ReadonlyMap<string, UltracodeState>,
): Record<string, boolean> => Object.fromEntries([...states].map(([id, s]) => [id, s.wanted]));

/** What `/ultracode status` answers for a session's state; undefined is a session never set. */
export const ultracodeStatus = (state: UltracodeState | undefined): string => {
  if (state === undefined) return serverText("ultracodeStatusUnset");
  const { wanted, confirmed } = state;
  if (confirmed === undefined)
    return serverText("ultracodeStatusUnknown", {
      state: serverText(wanted ? "ultracodeStateOn" : "ultracodeStateOff"),
    });
  if (wanted && !confirmed.available) return serverText("ultracodeStatusUnavailable");
  return serverText(confirmed.on ? "ultracodeStatusOn" : "ultracodeStatusOff");
};

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
export const TOOL_IDLE_FACTOR = 2;

/** Per-session ring buffer (last 50 turns) keyed by dsh sessionId, on the adapter instance. */
export const TURN_RING = 50;

/** `--resume` of a session Claude Code no longer has: a result whose errors name the missing conversation. */
export function isStaleResume(event: ClaudeEvent): boolean {
  if (event?.type !== "result" || !event.is_error) return false;
  return /No conversation found/i.test(JSON.stringify(event.errors ?? event.result ?? ""));
}

/** A logged-out CLI: the -p mode text, or the API's 401 once a stored token has expired. */
const NOT_LOGGED_IN_RE =
  /not logged in|authentication_error|failed to authenticate|oauth .*invalid/i;

/** The shape of a CLI `result` frame the login checks read. */
export interface ResultFrame {
  is_error?: boolean;
  stop_reason?: string;
  result?: unknown;
  errors?: unknown[];
  api_error_status?: number;
  subtype?: string;
}

/** The result's own words, for the error text and the login match. */
const resultMessage = (result: ResultFrame): string => {
  const errors = Array.isArray(result.errors) ? result.errors.join("; ") : "";
  return String(result.result ?? errors ?? result.subtype ?? "claude error");
};

/** A turn that failed because the box's Claude has no usable login: the CLI's own wording, or the
 *  API's 401 once a stored token has been revoked. The one test both the error text and the login
 *  card key on, so they cannot disagree about what counts. */
export function isLoginFailure(result: ResultFrame): boolean {
  return (
    result.is_error === true &&
    (result.api_error_status === 401 || NOT_LOGGED_IN_RE.test(resultMessage(result)))
  );
}

/** On an error result it builds the message a person sees: it names the box the turn ran on and,
 *  for a 5xx, appends the incident the status page reports so the failure reads as the provider's. */
export function finishReason(result: ResultFrame, hostLabel?: string): FinishReason {
  if (result.is_error) {
    let message = resultMessage(result);
    // Name the box the turn actually ran on: an SSH box or a remote workspace runs the far claude, so
    // the local hostname would point the user at the wrong machine to run `claude auth login` on.
    if (isLoginFailure(result))
      message = serverText("loginFailure", { host: hostLabel ?? hostname(), detail: message });
    // The retries before this result already asked the status page; a 5xx that gave up names
    // the incident the page reports, if any, so the failure reads as theirs rather than ours.
    if ((result.api_error_status ?? 0) >= 500) message += degradedNote(peekStatus());
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
/** The producer-owned source kind dsh's session format v4 gives this plugin's own messages. v4
 *  (`dsh-session-format-v3-to-v4`, `source()`) refuses any appended message whose `kind` is the
 *  retired `"plugin"` wrapper with "format v4 message requires a producer-owned source kind"; its
 *  migrator lifts `{ kind: "plugin", plugin: X }` to `{ kind: "plugin:X" }`, and a native v4 append
 *  must already carry that shape. */
export const OWN_SOURCE_KIND = "plugin:dsh-oh-my-claude";
/** Whether a logged source is one of this plugin's own, in either the v3 wrapper or the v4 kind. */
export const isOwnSource = (source: { kind?: string; plugin?: string } | undefined): boolean =>
  source?.kind === OWN_SOURCE_KIND ||
  (source?.kind === "plugin" && source.plugin === "dsh-oh-my-claude");
/** The source a wake notice carries: user only when a restart notice must rearm an active goal.
 *  `logVersion` is the session log's `header.version`; from 4 up the notice carries the
 *  producer-owned kind, since the v3 wrapper fails the turn it is appended to (seen 2026-09-23 on
 *  dsh 0.1.7-alpha.2: the restart notice itself was the turn that died). */
export function noticeSource(text: string, goalActive: boolean, logVersion = 3) {
  const restart = text === RESTART_TEXT || text === RECONNECT_TEXT || text === LIMIT_TEXT;
  if (restart && goalActive) return { kind: "user" } as const;
  const rest = { form: "notice", summary: boundContextSummary(text) } as const;
  return logVersion >= 4
    ? ({ kind: OWN_SOURCE_KIND, ...rest } as const)
    : ({ kind: "plugin", plugin: "dsh-oh-my-claude", ...rest } as const);
}
/** After an interrupt, kill a process that did not finish in time: only when no keeper owns it. */
export const killAfterGrace = (spawn: string): boolean => spawn !== "keeper";
/** What an interrupt does to the process's steer state: a steer forwarded before the Stop was
 *  already handed to the CLI, which runs it as a turn of its own once the interrupt lands (seen
 *  2026-09-18: `queue-operation dequeue` 7 ms after `[Request interrupted by user]`). Nothing is
 *  left to park on, and a park flag left set would read the CLI's interrupt echo (a `user` frame)
 *  as the tool-result boundary, exit the step as parked, and leave the interrupted turn's error
 *  `result` in the queue for the next prompt to die on. The waiting steers go too: the CLI dequeues them the moment the interrupt lands. */
export function noteInterrupt(proc: {
  steerPending: boolean;
  steers?: Map<string, unknown>;
  forwarded?: number;
}): void {
  proc.steerPending = false;
  forgetSteers(proc);
}
/** Forget the steers a process had waiting: the CLI has taken them or they went with the turn. Tolerates
 *  a process object without the map (the test fakes, a process from before this field existed). */
export function forgetSteers(proc: { steers?: Map<string, unknown>; forwarded?: number }): void {
  proc.steers?.clear();
  if (proc.forwarded !== undefined) proc.forwarded = 0;
}
/** Whether an aborted stream should interrupt Claude: always, except a dsh shutdown under a keeper. */
export function interruptOnAbort(kind: string | undefined, spawn: string): boolean {
  return !(kind === "disposed" && spawn === "keeper");
}

/** The `kind` in an abort signal's `{ kind }` reason, which is disposed, aborted or cancelled, or
 * undefined for a plain abort, so a caller can tell a dispose from a user cancel. */
export function abortKind(signal: AbortSignal | undefined): string | undefined {
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
    if (!m) continue;
    // The result is a message of its own, `role: "tool"`, with the call id on it and the text in
    // its blocks.
    if (m.role === "tool" && m.toolCallId === id)
      return { text: textOf(m.content), isError: m.isError === true };
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

/** The Agent inside what dsh's session controller answered for a cold resume: `{ agent }`, or
 *  `{ error }` when the session cannot be resumed. Read as the Agent, the wrapper has no
 *  `followup`, and every wake of an unloaded session fails on it. The controller's error is thrown
 *  so the caller reports it like any other failed resume. */
export function resolvedAgent(found: ResolvedAgent): Agent {
  if ("error" in found)
    throw found.error instanceof Error ? found.error : new Error(String(found.error));
  return found.agent;
}

/** Notice this plugin drops into a session's inbox to open a turn after Claude replied on its own. */
export const WAKE_TEXT = "Claude Code finished a background task and replied.";
/** A mirror turn whose followup never opened a turn (the agent went away) is put back after this. */
export const MIRROR_TURN_TIMEOUT_MS = 120_000;
/** How long the transcript must stay still before the watcher reads it: the CLI writes a reply as
 *  several rows, and a turn mirrored between two of them would show half of it. */
export const TRANSCRIPT_SETTLE_MS = 250;
/** How often loaded sessions are checked for a transcript not yet under watch. */
export const WATCH_SWEEP_MS = 30_000;
/** How far back a first watch looks for a terminal prompt still being answered. */
export const WATCH_LOOKBACK_BYTES = 4 * 1024 * 1024;
/** How far back a watch starts when no baseline was ever saved for this transcript. Starting at the
 *  end of the file instead, which is what it did, meant every exchange already in it was skipped for
 *  good: turning the mirror on, or a transcript whose path changed under a new Claude id, left the
 *  tab holding only whatever landed next. Bounded rather than the whole file so enabling it on a long
 *  session does not replay a day of terminal work into the tab. */
export const FIRST_WATCH_BYTES = 256 * 1024;
/** How long a terminal turn must run before it streams live rather than landing whole at its end:
 *  below this, the turn completes fast enough that one push reads cleaner than a live fill. */
export const STREAM_THRESHOLD_MS = 1000;
/** The render loop re-reads the exchange at least this often even without a scan waking it, so a
 *  write the watcher's debounce has not delivered yet still reaches the open turn promptly. This is
 *  the interval for a transcript on this PC, where a read is a file handle and a parse of a few
 *  milliseconds: measured 2026-09-11, folding a 1 MB tail costs 5.4ms, and 64 KB costs 0.7ms, so
 *  reading often is far cheaper than the delay it saves. */
const STREAM_IDLE_MS = 500;
/** The same interval for a box reached over ssh, which pays a process per read and has no inotify to
 *  wake the render in between, so it trades a slower fill for a fraction of the round trips. */
const STREAM_IDLE_REMOTE_MS = 1500;

/** How long the stream waits idle before settling: longer for a remote box, where a blank costs a round trip, than for a local one. */
export const idleFor = (box: FsBox): number =>
  box.sshHost ? STREAM_IDLE_REMOTE_MS : STREAM_IDLE_MS;
/** A terminal turn that never ends (an abandoned or crashed `claude`) would hold its dsh turn open
 *  forever; after this the render settles what it has and closes. */
export const STREAM_MAX_MS = 10 * 60_000;
/** Sent as a real prompt after dsh restarts mid-turn: the process is gone, Claude must carry on. */
/** Sent when a restarted dsh reattaches to a Claude process that kept running meanwhile. */
export const RECONNECT_TEXT =
  "[Oh My Claude] dsh restarted and reattached to your still-running Claude Code process; what you did meanwhile is shown above. Continue where you are.";
/** Sent when a usage limit that ended a turn has reset, so Claude picks the task back up. */
export const LIMIT_TEXT =
  "[Oh My Claude] your usage limit has reset. Continue the task where the limit stopped you.";
export const RESTART_TEXT =
  "[Oh My Claude] dsh restarted while this turn was in progress and the Claude Code process was replaced. Pick up where the transcript stops and finish the task. If this session has an active goal, dsh disarmed it on resume: call get_goal, then update_goal with action resume, so the goal rounds keep driving the work without anyone typing.";
/** How long after boot to nudge interrupted sessions; dsh needs its sessions and agents loaded. */
export const RESUME_DELAY_MS = 10_000;
/** Slack after a usage limit's reset instant before the continue notice goes out. */
export const LIMIT_GRACE_MS = 5_000;

/** A message that is our own wake notice, a plugin user message whose text is exactly WAKE_TEXT,
 * so wakeOnlyTurn can treat it apart from a real user prompt. */
const isWake = (m: LooseMessage) =>
  m.role === "user" && isOwnSource(m.source) && textOf(m.content) === WAKE_TEXT;
/** A turn opened by our own wake notice, with no user prompt to send: only drain what Claude
 *  already wrote. A user prompt in the same batch takes precedence and is sent normally. */
export function wakeOnlyTurn(messages: LooseMessage[] | undefined): boolean {
  const fresh = afterLastAssistant(messages);
  return fresh.some(isWake) && !fresh.some((m) => m.source?.kind === "user");
}

/** Drop messages Claude already received live on stdin (matched by `steerKey`). */
export function dropSent<T extends LooseMessage>(
  messages: T[] | undefined,
  sent: Set<string> | undefined,
): T[] {
  if (!sent || sent.size === 0) return messages ?? [];
  return (messages ?? []).filter((m) => {
    const key = steerKey(m);
    return !(key && sent.has(key));
  });
}

/** What dsh delivered at this step boundary besides the tool result: steers the user sent while
 *  the tool ran, subagent notices, other injections. Claude only sees the tool result, so they
 *  ride along with it. Empty when there is nothing. A message already written live to stdin is
 *  skipped, so Claude reads it once. */
export function stepContextFor(
  messages: LooseMessage[] | undefined,
  drops: ReadonlySet<ContextSource> = new Set(),
  sent: ReadonlySet<string> = new Set(),
): string {
  const parts = [];
  for (const m of afterLastAssistant(messages)) {
    if (m.role !== "user") continue;
    if (m.source?.kind === "tool") continue;
    if (sent.has(steerKey(m) ?? "")) continue;
    const text = promptTextOf(m, drops);
    if (text) parts.push(text);
  }
  return parts.length === 0
    ? ""
    : `\n\n<user_messages_during_tool_call>\n${parts.join("\n\n")}\n</user_messages_during_tool_call>`;
}

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
export function sideQuestionsIn(messages: LooseMessage[] | undefined): SideQuestion[] {
  const found: SideQuestion[] = [];
  for (const m of afterLastAssistant(messages)) {
    if (m.role !== "user" || m.source?.kind !== "user") continue;
    const question = /^\/btw[ \t]+([\s\S]+)$/.exec(textOf(m.content).trim())?.[1]?.trim();
    if (question) found.push({ message: m, question });
  }
  return found;
}

/** How long to wait for the rest of a parallel dsh tool-call batch after the first one arrives. */
export const RELAY_BATCH_MS = 1500;
/** How long a step handing dsh a relay waits for Claude's own tool results still in flight.
 *  Its Read, Grep and short Bash land in milliseconds; a longer Bash gets a placeholder row. */
export const NATIVE_RESULT_WAIT_MS = 10_000;
/** After asking the CLI to interrupt, how long before falling back to killing the process. */
export const INTERRUPT_GRACE_MS = 5000;

/**
 * Whether Claude's own tool calls may be appended as raw `tool/call`/`tool/result` rows. Only a
 * format-0 session (dsh before 0.1.5) takes them: from 0.1.5 the session format is versioned and
 * its migration refuses any `tool/call` no `assistant/message` advertised, so such rows would make
 * the whole log unloadable on the next upgrade. Inline rendering has no such row.
 */
export function nativeToolRows(
  config: { toolActivity: boolean; toolsInline: boolean },
  formatVersion: number,
  rawRowsLoad = false,
) {
  const wanted = config.toolActivity && !config.toolsInline;
  // A format-0 log predates the rule; a later one takes rows only when the probe says its dsh does.
  const fits = formatVersion === 0 || rawRowsLoad;
  return { rows: wanted && fits, refused: wanted && !fits };
}
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

// ---------------------------------------------------------------------------
// Adapter

/** A process spec as a string, so two specs compare by content when deciding to reuse a process. */
export const specKey = (spec: ClaudeProcessSpec) => JSON.stringify(spec);

/** Whether a todo list still has work on it. A list of nothing but completed items is finished,
 *  and a finished list is not worth painting over a fresh message. */
export function hasPendingTodo(todos: JsonValue[]): boolean {
  return todos.some((todo) => {
    // The list is off dsh's event log, so an item of another shape counts as unfinished rather
    // than being read as done and dropped.
    if (todo === null || !(todo instanceof Object) || Array.isArray(todo)) return true;
    return todo.status !== "completed";
  });
}

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
  relay?: { name: string; at: number };
  /** The CLI's spinner mode for this turn; absent until the first frame names one, which the reply
   *  reads as `requesting` (the CLI's own state between the request and the first block). */
  mode?: LiveMode;
  at: number;
}

/** Past this the model reads the tree faster than it reads a paste, and the whole context goes out as
 *  one stdin write with no backpressure guard: `write` (`src/process.ts:1312`) returns true either
 *  way, so a 200-file tree would ship megabytes on one line and bill a call that overruns the window. */
const DIFF_CONTEXT_CAP = 32_000;

/** A `get_workspace_diff` answer as the text a side question carries. Hunk headers and raw lines,
 *  nothing invented; a file with no hunks is named with why, so the reply does not guess. Whole files
 *  only, in the CLI's own order, up to the cap; the first file always goes even if it alone is over,
 *  because a context with no diff in it is worse than a long one. */
export const diffContext = (diff: WorkspaceDiff, path: string): string => {
  const files = path === "" ? diff.files : diff.files.filter((f) => f.path === path);
  const parts: string[] = [];
  let size = 0;
  for (const f of files) {
    const body =
      f.hunks.length === 0
        ? f.binary
          ? "binary file"
          : f.untracked
            ? "untracked file"
            : "no hunks"
        : f.hunks
            .map((h) => `@@ -${h.oldStart} +${h.newStart} @@\n${h.lines.join("\n")}`)
            .join("\n");
    const part = `--- ${f.path}\n${body}`;
    if (parts.length > 0 && size + part.length > DIFF_CONTEXT_CAP) break;
    parts.push(part);
    size += part.length + 2;
  }
  if (parts.length < files.length)
    parts.push(`… diff truncated (${parts.length} of ${files.length} files)`);
  return parts.join("\n\n");
};

/**
 * What Claude reads when dsh answers an approval without allowing it. "unavailable" and
 * "cancelled" used to reach it as the bare words `approval unavailable`, which say nothing: in one
 * reported session Claude retried seven times over half an hour, then told the user to reopen the
 * session elsewhere (#170). dsh answers "unavailable" when no approver is reachable or the one it
 * has failed, so nobody was asked; a retry loop cannot fix that, and the person can.
 */
export const OUTCOME_MESSAGE = {
  rejected: "The user denied this action in dsh.",
  unavailable:
    "dsh could not ask anyone to approve this action: no approver is reachable for this session, so nobody was asked and this is not a refusal. Do not retry it in a loop. Tell the user approvals are not reaching anyone; they can answer from the dsh web UI, fix the approver, or pick a permission mode that does not ask.",
  cancelled:
    "The approval request was cancelled before anyone answered (the turn was stopped or the request withdrawn). Nobody refused it.",
} satisfies Record<Exclude<ApprovalOutcome, "allowed-once">, string>;
