// Reply shapes, event shapes and the shared types behind the server's control surface.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { LlmError, type GenerateOptions, type Message } from "@deepseek-ai/dsh-llm";
import type { Agent, JsonValue, SessionId } from "../dsh.js";
import type {
  ClaudeEvent,
  ClaudeProcess,
  ContextUsage,
  HooksListing,
  McpServerStatus,
  PermissionRules,
  RelayResult,
  RewindResult,
  SteerAttachment,
  TurnPrep,
  WorkspaceDiff,
} from "../process.js";
import type { FallbackRecord, LiveMode, SuggestionRow } from "../translator.js";

/** A dsh request that belongs to a session; everything on the persistent path has one. */
export type SessionOptions = GenerateOptions & { sessionId: SessionId };
/** The CLI asking for a permission or a question. */
export type ControlRequestEvent = Extract<ClaudeEvent, { type: "control_request" }>;
/** How a turn ended, as the turn loop tracks it. */
export type Outcome =
  | "continue"
  | "finished"
  | "parked"
  | "retry"
  | "relayed"
  | "ended"
  | undefined;
/** Whether a step's end keeps the status row's live figures: only when the step parked the CLI
 *  mid-turn (on a dsh tool dsh is running, or on a steer), since dsh calls back within the same
 *  turn. Every other outcome is the turn ending. */
export const keepsLiveTurn = (outcome: string | undefined): boolean =>
  outcome === "relayed" || outcome === "parked";
/** How this request continues the session's Claude process; see continuationFor(). */
export type Continuation =
  | { mode: "abandon" | "steer"; proc: ClaudeProcess; options: SessionOptions }
  | { mode: "relay"; proc: ClaudeProcess; options: SessionOptions; results: RelayResult[] }
  | { mode: "prompt"; proc?: undefined; options: SessionOptions };

/** The permission decision inputs, one control request's worth. */
export interface Decision {
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
export const isSettled = (p: ClaudeProcess) => !p.busy && p.relays.size === 0 && !p.parked;

/** Throw rather than return a null prep: a process is assumed to carry the turn state acquire() set, so a missing one means it was used out of order. */
export function requirePrep(proc: ClaudeProcess): TurnPrep {
  if (!proc.prep) throw new LlmError("claude process has no turn state", "PROVIDER_ERROR");
  return proc.prep;
}

/** A session whose last turn wanted a login: the box it ran on (empty for this box) and its name. */
export interface LoginNeed {
  host: string;
  label: string;
}

/** Keys the shared process registry by instance so two mounts never see each other's processes. */
/** Outcome of a control request this plugin sent to the CLI; `response` is the CLI's payload. */
export type ControlReply =
  | { ok: true; error?: undefined; response?: JsonValue }
  | { ok: false; error: string; response?: undefined };
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
  /** The selected passage this aside asked about, its first ASIDE_QUOTE_KEEP characters, shown above
   *  the answer. Absent for `/btw` and the Changes tab's Ask. With a blank `question` it means "explain". */
  quote?: string;
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
/** What the steer card's route answers. `sent`: Claude already has it (or it was never waiting);
 *  `gone`: no live process; `error`: the CLI did not answer the cancel. */
/** Whether the CLI is inside a dsh tool right now: a live process with a relay pending. Reads the
 *  relay map as optional because the test fakes build processes field by field, and the ones that
 *  never relay carry no map. */
export const inRelay = (
  proc: { alive?: boolean; relays?: Map<string, unknown> } | undefined,
): boolean => proc?.alive === true && (proc.relays?.size ?? 0) > 0;

/** `relayed`: Send now was asked while the CLI is inside a dsh tool, which cannot be cut short
 *  without killing the tool; the card says to wait or edit instead. */
export type SteerEditReply =
  | { ok: true }
  | { ok: false; reason: "sent" | "gone" | "error" | "relayed"; error?: string };
/** What taking steers back answers: the hold to end later and the text the editor starts from. */
export type HoldReply =
  | { ok: true; holdId: string; text: string }
  | { ok: false; reason: "sent" | "gone" | "error"; error?: string };
/** The steer card's poll: steers still waiting in the CLI, and holds open for an edit. */
export interface SteerCardState {
  /** The CLI is inside a dsh tool, so Send now is refused for every row; present only when true. */
  inTool?: true;
  /** `relayed` is present only while dsh holds the message (typed during a dsh tool): a hold skips
   *  the CLI cancel and leaves dsh's inbox directly, as it does for a row carrying a file or
   *  image. `attachments` is present only when the message carries one; a save keeps them. */
  waiting: Array<{
    id: string;
    text: string;
    at: number;
    relayed?: true;
    attachments?: SteerAttachment[];
  }>;
  held: Array<{ id: string; text: string; attachments?: SteerAttachment[] }>;
}
/** Steers taken back from Claude while someone edits them. */
export interface HeldSteer {
  /** The dsh messages, oldest first, as they left the inbox; a restore puts these back unchanged. */
  messages: Message[];
  /** Their texts one per line, what the editor starts from. */
  text: string;
  /** Restores the hold when its card stops polling, so an abandoned edit never loses a message. */
  timer: ReturnType<typeof setTimeout>;
}
/** How long a hold waits for a poll before it goes back to Claude unchanged. The card polls every
 *  3 s while its tab is visible; a minute covers a tab switch mid-edit without leaving a closed
 *  tab's message stranded for long. */
export const HOLD_IDLE_MS = 60_000;
/** What the context route reports: the CLI's own context breakdown for a live session. */
export type ContextUsageReply =
  | ({ ok: true; error?: undefined } & ContextUsage)
  | { ok: false; error: string };
/** What the skill-report route answers. A decline (the CLI's own `no_user_skills` or
 *  `scan_policy_denied`) and a failure (spawn, timeout, missing binary) both leave `ok` false, but
 *  the card shows a decline verbatim and wraps a failure, so `declined` tells them apart. `partial`
 *  is set when the one-shot ran in a scratch cwd (a CLI too old for `--no-session-persistence`), so
 *  the report lists user skills only. */
export type SkillDoctorReply = {
  ok: boolean;
  report?: string;
  declined?: boolean;
  error?: string;
  partial?: boolean;
};

/** The CLI's `result` frame (or its absence) as a reply. Pulled out of the spawn so the mapping is
 *  unit-tested without a process: a decline keeps its text for the card to show verbatim, a missing
 *  frame is a start failure, and `partial` marks a user-skills-only fallback run. */
export function skillDoctorReply(
  result: { is_error?: boolean; result?: unknown } | null,
  partial: boolean,
  failure: string,
): SkillDoctorReply {
  if (result === null) return { ok: false, error: failure };
  const report = String(result.result ?? "");
  if (result.is_error) return { ok: false, declined: true, error: report };
  return partial ? { ok: true, report, partial: true } : { ok: true, report };
}
/** What the diff route reports: the CLI's working-tree diff for a live session. */
export type WorkspaceDiffReply =
  | ({ ok: true; error?: undefined } & WorkspaceDiff)
  | { ok: false; error: string };
/** What `/permissions` answers: both lists, or the reason there are none. */
export type PermissionReadoutReply =
  | ({ ok: true } & PermissionRules & HooksListing)
  | { ok: false; error: string };
/** What the MCP route reports: the servers Claude's process has, as `mcp_status` lists them. */
export type McpStatusReply =
  | { ok: true; error?: undefined; servers: McpServerStatus[] }
  | { ok: false; error: string };
/** What the MCP login route reports: the sign-in page to open, an already-signed-in success with
 *  no page, or the reason the CLI refused. */
export type McpAuthReply = { ok: true; authUrl?: string } | { ok: false; error: string };
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
  /** The mode the session's running Claude process is in, or null when no process is alive. It
   *  lags `mode` after a pick the CLI could not take live; the next turn spawns with `mode`. */
  liveMode: string | null;
}
export interface PermissionModeReply extends PermissionModeInfo {
  /** A live process was told; false when the override only applies at the next spawn. */
  live: boolean;
  error?: string;
}
/** `GET /awaiting` and the `awaiting` event: the open prompts keyed by dsh session id. */
export interface AwaitingRow {
  kind: "approval" | "question" | "plan";
  id: string;
  since: number;
}
/** `GET /live-turn` and the `live-turn` event while a turn runs; the empty object once it ends.
 *  The ages are computed when the body is built; the tab adds the time since it received it. */
export interface LiveTurnReply {
  tokens: number;
  elapsedMs: number;
  thinkingMs?: number;
  idleMs?: number;
  tool: boolean;
  /** Which way the line's shimmer runs; see LiveMode in translator.ts. The builder always sets
   *  it; optional on the type because the no-hub route fallback and the hand-built fakes in the
   *  route tests do not, and the row reads an absent mode as no change. */
  mode?: LiveMode;
  thoughtMs?: number;
  thoughtAgoMs?: number;
  effort?: string;
  relayName?: string;
  relayMs?: number;
}
/** The sums over a session's turn records, with how many records were summed. */
export interface TurnTotals {
  costUsd: number;
  durationMs: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  count: number;
}

/** The `asides` event: the aside ring, the login card, the model fallback note and the steer card
 *  for one session. `GET /side-questions` answers these plus `claudeUpdate`, which the updater's
 *  own tick in sessions.ts adds and which no event carries. */
export interface AsidesReply {
  items: AsideEntry[];
  loginNeeded: LoginNeed | null;
  fallback: FallbackRecord | null;
  steers: SteerCardState;
  /** The CLI's guess at the next prompt, or null: none yet, the process is gone, or a prompt went
   *  out since. */
  suggestion: SuggestionRow | null;
}
/** `GET /idle` and the `idle` event: when the idle watchdog would end the process, or null. */
export interface IdleReply {
  deadline: number | null;
  timeoutMs: number;
}
/** `GET /permission-mode` and the `permission-mode` event: the info plus the modes the client may
 *  pick, under the name the client already reads (`modes`). */
export interface PermissionModeState extends PermissionModeInfo {
  modes: readonly string[];
}

/** The key every live process is stored under, `providerId` then `sessionId`; a session id must not contain a colon or it would collide with this separator. */
export function registryKey(providerId: string, sessionId: string): string {
  return `${providerId}:${sessionId}`;
}
