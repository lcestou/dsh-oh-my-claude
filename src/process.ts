// One long-lived `claude -p --input-format stream-json` process per dsh session, plus the control
// channel the Agent SDK uses over the same stream: `control_request` lines from the CLI (permission
// prompts, user questions) answered with `control_response` lines on stdin.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { createInterface } from "node:readline";
import type { AskUserQuestionItem, JsonValue, SubprocessRuntime } from "./dsh.js";
import type { ContextSizes, ContextSource } from "./context-sources.js";
import { STATE_DIR } from "./state.js";
export type { JsonValue } from "./dsh.js";

/** Errors reach us as `unknown`; this is the one place they become text. */
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Text of a Claude tool_result: a string, or the text blocks of a content array; other block
 *  kinds render as their bracketed type. */
export function toolResultText(block: { content?: unknown }): string {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(toolResultBlockText).join("\n");
  return "";
}

/** One block of a tool_result content array: its text, or its type in brackets. */
function toolResultBlockText(b: unknown): string {
  if (typeof b !== "object" || b === null || !("type" in b)) return "[unknown]";
  if (b.type === "text") return "text" in b ? String(b.text) : "undefined";
  return `[${typeof b.type === "string" ? b.type : "unknown"}]`;
}

/** Child env on top of the parent's: dsh subagents over MCP can outlive the CLI's default tool timeout. */
/** What every Claude child gets on top of dsh's environment: a long MCP tool timeout for relayed
 *  dsh tools; file checkpointing, which stream-json runs leave off unless asked, so that the
 *  `rewind_files` control request has something to rewind to; and an entrypoint of the plugin's
 *  own. Left alone, a print-mode CLI records `entrypoint: sdk-cli` in the transcript, and a
 *  terminal `claude --resume` hides every session recorded as sdk-cli, sdk-ts or sdk-py (checked
 *  in 2.1.268), so the dsh sessions never showed in the picker. The CLI keeps any other value as
 *  given, only `cli` is rewritten to sdk-cli in print mode, and an unknown one counts as `other` in
 *  its telemetry and as the plain CLI everywhere else. */
export const CHILD_ENV = {
  MCP_TOOL_TIMEOUT: "3600000",
  CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
  CLAUDE_CODE_ENTRYPOINT: "dsh-oh-my-claude",
};

/** The environment a Claude child runs with: dsh's own, then the plugin's additions, then whatever
 *  the caller passes. CHILD_ENV beats the inherited value on purpose — an `MCP_TOOL_TIMEOUT` that
 *  happens to be in dsh's environment would otherwise cut relayed dsh tools short in one spawn mode
 *  and not the other. A caller that means to override still wins, which is the escape hatch. */
export function childEnv(base: NodeJS.ProcessEnv, override?: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  Object.assign(env, CHILD_ENV, override ?? {});
  return env;
}

/** The child process seam this plugin uses: dsh's own spawner and the node one both answer it. */
export interface SubprocessHandle {
  stdin: import("node:stream").Writable;
  stdout: import("node:stream").Readable;
  stderr: import("node:stream").Readable;
  done: Promise<{ exitCode: number | null; signal: string | null }>;
  terminate(): void;
}

/** One line of the CLI's stream-json stdout, in the shapes this plugin reads. */
export type ClaudeEvent =
  | {
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
      // subtype "status": `status:"compacting"` opens the silent summarize stretch; a later frame
      // with `status:null` carries `compact_result` ("success"|"failed") and, on failure, `compact_error`.
      status?: string | null;
      compact_result?: string;
      compact_error?: string;
      // subtype "memory_saved": the auto-memory files Claude just wrote; "memory_recall": the ones
      // it pulled into context at the start of a turn.
      written_paths?: string[];
      verb?: string;
      memories?: Array<{ path?: string; scope?: string }>;
      // subtype "hook_started" / "hook_response": hook lifecycle events, only emitted when
      // the process runs with --include-hook-events (SessionStart and Setup always emit).
      hook_name?: string;
      hook_event?: string;
      output?: string;
      stdout?: string;
      stderr?: string;
      exit_code?: number;
      outcome?: string;
      // subtype "task_started" / "task_notification": subagent task lifecycle frames emitted by the CLI.
      task_id?: string;
      description?: string;
      subagent_type?: string;
      is_backgrounded?: boolean;
      summary?: string;
      // subtype "task_progress": progress update for a running task, carries usage, last_tool_name, summary and workflow_progress.
      // subtype "task_notification": carries status.
      last_tool_name?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      workflow_progress?: unknown;
      // subtype "task_updated": the fields of a task that changed. `status` moves through pending,
      // running, completed, failed, killed and paused; the terminal ones are what a task that dies
      // without a notification reports.
      patch?: {
        status?: string;
        error?: string;
        end_time?: number;
        is_backgrounded?: boolean;
      };
      // subtype "commands_changed": the whole slash-command catalog again, after a skill or custom
      // command appeared mid-session. Same shape as init's `slash_commands`.
      commands?: JsonValue;
      // subtype "model_fallback": the CLI dropped to a weaker model. `content` is display-ready.
      content?: string;
      level?: string;
      trigger?: string;
      original_model?: string;
      fallback_model?: string;
      // subtype "model_refusal_fallback": the safety classifier flagged the message and the turn
      // fell back to a safer model. `direction` "sticky" = the session model swapped for the rest of
      // the conversation; "retry"/"revert" are one-off. `scope` "local" = a subagent, a /btw
      // side-question or a background fork fell back, and the session model is unchanged.
      direction?: "retry" | "revert" | "sticky";
      scope?: "session" | "local";
      // The refusal category ("cyber", "bio", …), an open string; null when neither the API response
      // nor the fallback block carried one. `api_refusal_explanation` is the model_refusal_no_fallback
      // sibling's human reason.
      api_refusal_category?: string | null;
      api_refusal_explanation?: string | null;
      // subtype "model_consent_fallback": the usage-credit / switch-default gate (secondary to the
      // refusal frames). `persisted_as_default` true = the switch became the saved default model.
      original_model_name?: string;
      persisted_as_default?: boolean;
      choice?: "consent" | "switch_default" | "cancelled";
      // subtype "informational": a loop banner. `prevent_continuation` marks the ones that ended
      // the turn early (a Stop hook denying continuation).
      prevent_continuation?: boolean;
      // subtype "permission_denied": the tool the CLI refused, and why, at the moment of refusal.
      tool_name?: string;
      message?: string;
      decision_reason?: unknown;
      decision_reason_type?: string;
      // subtype "background_tasks_changed": list of running background tasks.
      tasks?: unknown;
      // subtype "thinking_tokens": one frame per thinking delta, so the estimate is unthrottled.
      // `estimated_tokens` is the running total for the *current* thinking block and resets at the
      // next content_block_start; it is a spinner estimate, not the billed output_tokens.
      estimated_tokens?: number;
      estimated_tokens_delta?: number;
      // subtype "api_retry": the CLI is retrying a failed API call (a 429 while a limit holds, a
      // 5xx, a dropped connection). `error.rate_limits` is set only for a quota 429.
      attempt?: number;
      max_retries?: number;
      retry_delay_ms?: number;
      error?: {
        message?: string;
        status?: number;
        formatted?: string;
        rate_limits?: { resets_at?: number; rate_limit_type?: string } | null;
        /** subtype "api_error": set when the failure was the connection itself, not a response. */
        connection?: string;
        is_network_down?: boolean;
      };
    }
  | {
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
    }
  | {
      type: "stream_event";
      event?: ClaudeStreamPartial;
      /** Set when the frame belongs to a nested agent, as on `assistant` and `user` frames. */
      parent_tool_use_id?: string | null;
    }
  | { type: "assistant"; message?: ClaudeAssistantMessage; parent_tool_use_id?: string | null }
  | {
      type: "user";
      message?: { content?: ClaudeContentBlock[] };
      parent_tool_use_id?: string | null;
    }
  | {
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
    }
  | {
      type: "rate_limit_event";
      // status "rejected" with overageStatus "allowed" means paid extra usage covers the overflow:
      // the CLI's own banner shows no limit then (its isUsingOverage), and the turn goes on.
      rate_limit_info?: {
        status?: string;
        resetsAt?: number;
        rateLimitType?: string;
        overageStatus?: string;
        overageResetsAt?: number;
        isUsingOverage?: boolean;
      };
    }
  | {
      type: "control_request";
      request_id: string;
      request?: {
        subtype?: string;
        tool_name?: string;
        input?: Record<string, JsonValue>;
        tool_use_id?: string;
        title?: string;
        description?: string;
        // subtype "elicitation": an MCP server asks the user for structured input.
        mcp_server_name?: string;
        display_name?: string;
        message?: string;
        mode?: string;
        url?: string;
        elicitation_id?: string;
        requested_schema?: JsonValue;
      };
    }
  | { type: "control_cancel_request"; request_id: string }
  | {
      type: "control_response";
      request_id: string;
      response?: { subtype?: string; request_id?: string; response?: unknown; error?: unknown };
    }
  | { type: "timeout" }
  /** Queued by the adapter's idle watchdog shortly before it stops a silent process. */
  | { type: "idle_warning"; silentSeconds: number; leftSeconds: number }
  | RelayEvent;

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
export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean };

/** One Anthropic streaming event as Claude Code forwards it. Untyped past `type`: only the three
 *  content-block events carry fields the translator reads, and unknown types are logged once. */
export interface ClaudeStreamPartial {
  type: string;
  index?: number;
  /** `message_start` only: the message these deltas belong to. */
  message?: { id?: string };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { text?: string; thinking?: string; partial_json?: string; signature?: string };
}

/**
 * Node's own spawn, shaped like a dsh `SubprocessHandle` so the process code has one shape to
 * talk to: `stdin`/`stdout`/`stderr` streams, `done` resolving with the exit code, `terminate()`.
 * `envOverride` is merged last so configured values win over the parent's environment.
 */
export function nodeSpawner(
  command: string,
  args: string[],
  cwd: string,
  envOverride?: Record<string, string>,
): SubprocessHandle {
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv(process.env, envOverride),
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done: new Promise((resolve) => {
      // Node emits `error` on the child for ENOENT, EACCES and a failed fork, and an EventEmitter
      // `error` with no listener throws — a `claude` that is not on PATH would take the whole dsh
      // host down with it, every session, not just this one. It reads as an exit here instead.
      child.on("error", (e: Error) => resolve({ exitCode: -1, signal: e.message }));
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    }),
    // SIGTERM, then SIGKILL if it is still there. A claude inside an uninterruptible tool, or one
    // whose own child holds the process group, ignores the first and would otherwise outlive the
    // session that owned it: an orphan holding the session file and the MCP connections, invisible
    // to the panel. `unref` so the escalation never keeps this process alive on its own.
    terminate: () => {
      child.kill();
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 5000).unref();
    },
  };
}

/**
 * dsh's subprocess seam (`ctx.subprocess`). Same shape by definition. With a remote provider
 * mounted, Claude Code runs on the remote machine for a remote workspace; the seam
 * scrubs credential-shaped env vars, so credentials come from the login on that machine.
 * `envOverride` is merged last so configured values win.
 */
export const seamSpawner =
  (subprocess: Pick<SubprocessRuntime, "spawn">): Spawner =>
  (command, args, cwd, envOverride) =>
    subprocess.spawn({
      argv: [command, ...args],
      cwd,
      env: { ...CHILD_ENV, ...envOverride },
      graceMs: 5000,
      stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    });

/** POSIX single-quote a string for a remote shell: wrap in `'...'`, escaping any embedded quote. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** The local `ssh` argv that runs `script` on `host`. BatchMode: key auth only, so a missing key or
 * unknown host fails fast instead of hanging on a prompt. */
export function sshArgs(host: string, script: string) {
  return [...SSH_OPTS, host, script];
}

/** A Unix socket path holds 108 bytes on Linux, and the last one is the terminator. */
const SOCKET_PATH_MAX = 107;
/** `%C` is a SHA-1 in hex, and ssh appends `.` plus 16 random characters while it builds the master. */
const CONTROL_NAME = "cm-".length + 40 + ".XXXXXXXXXXXXXXXX".length;

/**
 * Where the multiplex sockets live, or nothing when no directory can hold one.
 *
 * The state dir is one byte too long for a `%C` socket (`~/.local/state/dsh-oh-my-claude/ssh/`
 * plus the name is 108), so every connection through it failed with "too long for Unix domain
 * socket" and the panel showed that instead of the box. The runtime dir is short, is on tmpfs and
 * is cleared at logout, which is where a socket belongs; the state dir stays as the fallback for a
 * session without one, and is skipped when it does not fit.
 */
export function controlSocketDir(
  runtime: string | undefined,
  state: string,
  make: (dir: string) => void,
): string | undefined {
  const candidates =
    runtime === undefined ? [join(state, "ssh")] : [join(runtime, "omc-ssh"), join(state, "ssh")];
  for (const dir of candidates) {
    if (dir.length + 1 + CONTROL_NAME > SOCKET_PATH_MAX) continue;
    try {
      make(dir);
      return dir;
    } catch {
      // Unwritable: try the next one, and share nothing rather than fail every ssh.
    }
  }
  return undefined;
}
const SSH_CONTROL_DIR = controlSocketDir(process.env.XDG_RUNTIME_DIR, STATE_DIR, (dir) =>
  mkdirSync(dir, { recursive: true, mode: 0o700 }),
);

/**
 * The options every ssh in this plugin carries.
 *
 * BatchMode: key auth only, so a missing key or unknown host fails fast instead of hanging on a
 * prompt. ConnectTimeout bounds the handshake.
 *
 * ControlMaster shares one connection between all of them. Opening the panel on a box costs about
 * 33 remote reads — 25 of them the CLAUDE.md walk alone, one per ancestor directory probe — and
 * without multiplexing each pays a full TCP connect, key exchange and auth: seconds of dead panel
 * on a LAN, more over a WAN. With it the first read pays that once and the rest reuse the socket,
 * which ControlPersist keeps for a minute after the last one closes.
 *
 * ServerAlive turns a dead network into an error. The session pipe is a long-lived ssh, and a
 * suspend, a Wi-Fi switch or a NAT timeout leaves it blocked on a socket TCP will not give up on
 * for hours; the session sits thinking with nothing to report because the child never exits.
 */
const SSH_OPTS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  ...(SSH_CONTROL_DIR === undefined
    ? []
    : [
        "-o",
        "ControlMaster=auto",
        "-o",
        `ControlPath=${join(SSH_CONTROL_DIR, "cm-%C")}`,
        "-o",
        "ControlPersist=60",
      ]),
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=4",
];

/**
 * The local `ssh` argv that runs `command args` on `host` in `cwd`. The remote shell inherits none
 * of this box's environment or working directory, so the command carries both: `cd` into `cwd`, then
 * `exec env` with CHILD_ENV (file checkpointing for rewind, the long MCP timeout). `cwd` is this
 * box's workspace path and usually does not exist on the remote, so fall back to the remote `$HOME`
 * rather than let `cd` fail the whole spawn. A remote workspace redirects `cwd` to its real remote
 * path before it reaches here (see `sshSpawner`), so that fallback is only for a plain local path.
 */
export function sshInvocation(
  host: string,
  command: string,
  args: string[],
  cwd: string,
  token?: string,
) {
  // A fresh per-box token from `claude setup-token` is delivered as CLAUDE_CODE_OAUTH_TOKEN, not a
  // stored login, so it must be handed to the far claude at spawn. ponytail: it rides in the remote
  // env argv like the rest of CHILD_ENV, so it shows in the box's own `ps`; acceptable on a
  // single-user box, tighten with a remote env file if a box is shared.
  const envPairs = Object.entries(CHILD_ENV);
  if (token) envPairs.push(["CLAUDE_CODE_OAUTH_TOKEN", token]);
  const env = envPairs.map(([key, val]) => `${key}=${shq(val)}`).join(" ");
  const remote = [command, ...args].map(shq).join(" ");
  const script = `cd ${shq(cwd)} 2>/dev/null || cd "$HOME"; exec env ${env} ${remote}`;
  return { command: "ssh", args: sshArgs(host, script) };
}

/**
 * Spawner that runs Claude Code on a remote host over SSH: this box's harness drives the far `claude`,
 * nothing runs there but the CLI itself. The stream-json wire flows through the ssh pipe unchanged, so
 * the translator, approvals and control requests are untouched. The remote uses its own `~/.claude`
 * login; the dsh MCP bridge points at this box's port and does not reach it, so `dshTools` is best off.
 */
export const sshSpawner =
  (host: string, resolveCwd: (cwd: string) => string = (c) => c, token?: string): Spawner =>
  (command, args, cwd) => {
    const inv = sshInvocation(host, command, args, resolveCwd(cwd), token);
    return nodeSpawner(inv.command, inv.args, ".");
  };

/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK writes. */
export function userTurnLine(content: unknown): string {
  return `${JSON.stringify({ type: "user", session_id: "", message: { role: "user", content }, parent_tool_use_id: null })}\n`;
}

/** stdin line answering one of the CLI's control requests with a result. */
export function controlResponseLine(requestId: string, response: unknown): string {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } })}\n`;
}

/** stdin line asking the CLI to stop the current turn; it answers with a result and stays alive. */
export function interruptLine(requestId: string): string {
  return `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;
}

/** A control response payload as JSON, or undefined when it is not representable. */
export function toJsonValue(v: unknown): JsonValue | undefined {
  if (v === undefined) return undefined;
  try {
    // SAFETY: a JSON round trip yields JSON by construction
    return JSON.parse(JSON.stringify(v)) as JsonValue;
  } catch {
    return undefined;
  }
}

/** The fields of a `rewind_files` answer this plugin reports. */
export interface RewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}
/** A `rewind_conversation` answer, keeping only the fields the panel shows. */
export function decodeRewindResult(v: JsonValue | undefined): RewindResult {
  const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  const out: RewindResult = { canRewind: r.canRewind === true };
  if (typeof r.error === "string") out.error = r.error;
  if (Array.isArray(r.filesChanged))
    out.filesChanged = r.filesChanged.filter((f): f is string => typeof f === "string");
  if (typeof r.insertions === "number") out.insertions = r.insertions;
  if (typeof r.deletions === "number") out.deletions = r.deletions;
  return out;
}

/**
 * A running total read as one turn's own share: the rise since the previous result, or the whole
 * figure when the total started over. `total_cost_usd` and `duration_api_ms` climb for the life of
 * a CLI process — "each result carries the running total so far, so read the latest result rather
 * than summing across results" — and a new process, a resume or a mid-session `/clear` starts them
 * again from zero, which arrives here as a figure below the last one.
 */
export const turnDelta = (total: number, soFar: number): number =>
  total >= soFar ? total - soFar : Math.max(0, total);

/** What a breakdown row is. The CLI's own words for the field: "'used' content occupies the window;
 *  'free' is the remaining window; 'buffer' is the compaction reserve; 'deferred' rows are
 *  out-of-window tool schemas. Classify on this, never on the English name." Absent from a CLI
 *  older than 2.1, where the name and `isDeferred` are all there is. */
export type ContextRowKind = "used" | "free" | "buffer" | "deferred";
const ROW_KINDS: ContextRowKind[] = ["used", "free", "buffer", "deferred"];

/** The slice of a `get_context_usage` answer this plugin reports: the CLI's own token count per category. */
export interface ContextUsage {
  categories: Array<{ name: string; tokens: number; deferred: boolean; kind?: ContextRowKind }>;
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
export function decodeContextUsage(v: JsonValue | undefined): ContextUsage {
  const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  const categories: ContextUsage["categories"] = [];
  if (Array.isArray(r.categories))
    for (const c of r.categories) {
      if (typeof c !== "object" || c === null || Array.isArray(c)) continue;
      if (typeof c.name !== "string" || typeof c.tokens !== "number") continue;
      const row: ContextUsage["categories"][number] = {
        name: c.name,
        tokens: c.tokens,
        deferred: c.isDeferred === true,
      };
      const kind = ROW_KINDS.find((k) => k === c.kind);
      if (kind) row.kind = kind;
      categories.push(row);
    }
  const out: ContextUsage = {
    categories,
    totalTokens: typeof r.totalTokens === "number" ? r.totalTokens : 0,
    maxTokens: typeof r.maxTokens === "number" ? r.maxTokens : 0,
    percentage: typeof r.percentage === "number" ? r.percentage : 0,
  };
  if (typeof r.model === "string") out.model = r.model;
  if (typeof r.autocompactSource === "string") out.autocompact = r.autocompactSource;
  return out;
}

/** The `title` of a `generate_session_title` answer, trimmed; undefined when absent or empty. */
export function decodeTitle(v: JsonValue | undefined): string | undefined {
  const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
  const title = typeof r.title === "string" ? r.title.trim() : "";
  return title.length > 0 ? title : undefined;
}

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
    hunks: Array<{ oldStart: number; newStart: number; lines: string[] }>;
  }>;
}
const isRecord = (v: JsonValue | undefined): v is Record<string, JsonValue> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const num = (x: JsonValue | undefined) => (typeof x === "number" ? x : 0);
/** A `get_workspace_diff` answer as totals, per-file counts and hunks, skipping malformed entries. */
export function decodeWorkspaceDiff(v: JsonValue | undefined): WorkspaceDiff {
  const outer = isRecord(v) ? v : {};
  const d = isRecord(outer.diff) ? outer.diff : outer;
  const stats = isRecord(d.stats) ? d.stats : {};
  const hunksByPath = new Map<string, WorkspaceDiff["files"][number]["hunks"]>();
  if (Array.isArray(d.hunks))
    for (const entry of d.hunks) {
      if (!isRecord(entry) || typeof entry.path !== "string" || !Array.isArray(entry.hunks))
        continue;
      const list: WorkspaceDiff["files"][number]["hunks"] = [];
      for (const h of entry.hunks) {
        if (!isRecord(h)) continue;
        const lines = Array.isArray(h.lines)
          ? h.lines.filter((l): l is string => typeof l === "string")
          : [];
        list.push({ oldStart: num(h.oldStart), newStart: num(h.newStart), lines });
      }
      hunksByPath.set(entry.path, list);
    }
  const files: WorkspaceDiff["files"] = [];
  if (Array.isArray(d.perFileStats))
    for (const f of d.perFileStats) {
      if (!isRecord(f) || typeof f.path !== "string") continue;
      files.push({
        path: f.path,
        added: num(f.added),
        removed: num(f.removed),
        binary: f.isBinary === true,
        untracked: f.isUntracked === true,
        hunks: hunksByPath.get(f.path) ?? [],
      });
    }
  return {
    filesCount: num(stats.filesCount),
    linesAdded: num(stats.linesAdded),
    linesRemoved: num(stats.linesRemoved),
    files,
  };
}

/** The slice of a `list_permission_rules` answer this plugin reports. `text` is the CLI's own
 *  display line, which is why nothing here re-words a rule. */
export interface PermissionRules {
  rules: Array<{ behavior: string; source: string; rule: string; text: string }>;
  directories: Array<{ path: string; source: string }>;
  managedOnly: boolean;
}
/** A `list_permission_rules` answer as rules, workspace directories and a managed-only flag,
 *  skipping malformed entries. */
export function decodePermissionRules(v: JsonValue | undefined): PermissionRules {
  const outer = isRecord(v) ? v : {};
  const state = isRecord(outer.state) ? outer.state : {};
  const rules: PermissionRules["rules"] = [];
  if (Array.isArray(state.rules))
    for (const r of state.rules) {
      if (!isRecord(r)) continue;
      const behavior = typeof r.behavior === "string" ? r.behavior : "";
      const source = typeof r.source === "string" ? r.source : "";
      const rule = typeof r.rule === "string" ? r.rule : "";
      const desc = isRecord(r.description) ? r.description : {};
      const prefix = typeof desc.prefix === "string" ? desc.prefix : undefined;
      const emphasis = typeof desc.emphasis === "string" ? desc.emphasis : undefined;
      const text = prefix !== undefined && emphasis !== undefined ? `${prefix} ${emphasis}` : rule;
      rules.push({ behavior, source, rule, text });
    }
  const directories: PermissionRules["directories"] = [];
  if (Array.isArray(state.workspaceDirectories))
    for (const d of state.workspaceDirectories) {
      if (!isRecord(d) || typeof d.path !== "string") continue;
      const source = typeof d.source === "string" ? d.source : "";
      directories.push({ path: d.path, source });
    }
  return {
    rules,
    directories,
    managedOnly: state.managedOnly === true,
  };
}

/** The slice of a `get_hooks_listing` answer this plugin reports, one row per configured hook. */
export interface HooksListing {
  hooks: Array<{ event: string; matcher: string; source: string; text: string }>;
}
/** A `get_hooks_listing` answer as per-hook rows, skipping malformed entries. */
export function decodeHooksListing(v: JsonValue | undefined): HooksListing {
  const outer = isRecord(v) ? v : {};
  const hooks: HooksListing["hooks"] = [];
  if (Array.isArray(outer.hooks))
    for (const h of outer.hooks) {
      if (!isRecord(h) || typeof h.event !== "string") continue;
      const event = h.event;
      const matcher = typeof h.matcher === "string" ? h.matcher : "";
      const source =
        typeof h.sourceLabel === "string"
          ? h.sourceLabel
          : typeof h.source === "string"
            ? h.source
            : "";
      const text =
        typeof h.displayText === "string" && h.displayText.length > 0
          ? h.displayText
          : typeof h.commandText === "string"
            ? h.commandText
            : "";
      hooks.push({ event, matcher, source, text });
    }
  return { hooks };
}

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
export function decodeMcpStatus(v: JsonValue | undefined): McpServerStatus[] {
  const r = isRecord(v) ? v : {};
  const out: McpServerStatus[] = [];
  if (Array.isArray(r.mcpServers))
    for (const m of r.mcpServers) {
      if (!isRecord(m) || typeof m.name !== "string") continue;
      const entry: McpServerStatus = {
        name: m.name,
        status: typeof m.status === "string" ? m.status : "unknown",
      };
      const info = isRecord(m.serverInfo) ? m.serverInfo : {};
      if (typeof info.version === "string") entry.version = info.version;
      // SAFETY: defensive typeof checks match I/O boundary style; keep error or message if present
      if (typeof m.error === "string") {
        entry.error = m.error;
      } else if (typeof m.message === "string") {
        entry.error = m.message;
      }
      out.push(entry);
    }
  return out;
}

/** The sign-in page from an `mcp_authenticate` reply, or undefined when the reply does not carry
 *  one. Probed against 2.1.278 on 2026-09-20. */
export function mcpAuthUrl(v: JsonValue | undefined): string | undefined {
  const r = isRecord(v) ? v : {};
  return typeof r.authUrl === "string" && r.authUrl !== "" ? r.authUrl : undefined;
}

/** True when the CLI answered success with nothing for the person to do: the server's token is
 *  still good, so there is no page to open. Distinguishing this from a failure matters, because the
 *  panel would otherwise tell someone their login failed when they are already signed in. */
export function mcpAuthNeedsNothing(v: JsonValue | undefined): boolean {
  const r = isRecord(v) ? v : {};
  return r.requiresUserAction === false;
}

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
export function decodeCliModels(v: JsonValue | undefined): CliModel[] {
  const r = isRecord(v) ? v : {};
  const out: CliModel[] = [];
  if (Array.isArray(r.models))
    for (const m of r.models) {
      if (!isRecord(m) || typeof m.value !== "string") continue;
      const row: CliModel = {
        value: m.value,
        resolvedModel: typeof m.resolvedModel === "string" ? m.resolvedModel : m.value,
        displayName: typeof m.displayName === "string" ? m.displayName : m.value,
        // The CLI answers `supportedEffortLevels`; the on-disk seed (`cli-models.json`) holds this
        // row shape back, keyed `efforts`. Read both, or a restart seeds every row with no efforts
        // and dsh refuses the effort a session still carries (2026-09-18).
        efforts: (Array.isArray(m.supportedEffortLevels)
          ? m.supportedEffortLevels
          : Array.isArray(m.efforts)
            ? m.efforts
            : []
        ).filter((e): e is string => typeof e === "string"),
      };
      if (typeof m.description === "string") row.description = m.description;
      out.push(row);
    }
  return out;
}

/** The request fields of an `elicitation` control request this plugin reads. */
export interface ElicitationRequest {
  mcp_server_name?: string;
  display_name?: string;
  message?: string;
  mode?: string;
  url?: string;
  requested_schema?: JsonValue;
}
type SchemaProp = {
  key: string;
  type: string;
  enum?: string[];
  title?: string;
  description?: string;
};
function schemaProps(schema: JsonValue | undefined): SchemaProp[] | undefined {
  const s = isRecord(schema) ? schema : {};
  const props = isRecord(s.properties) ? s.properties : undefined;
  if (!props) return undefined;
  const out: SchemaProp[] = [];
  for (const [key, def] of Object.entries(props)) {
    if (!isRecord(def)) return undefined;
    const type = typeof def.type === "string" ? def.type : "string";
    const prop: SchemaProp = { key, type };
    if (Array.isArray(def.enum)) prop.enum = def.enum.map((e) => String(e));
    if (typeof def.title === "string") prop.title = def.title;
    if (typeof def.description === "string") prop.description = def.description;
    out.push(prop);
  }
  return out.length > 0 && out.length <= 20 ? out : undefined;
}
/**
 * An MCP elicitation as dsh questions: one per top-level schema property. Enum and boolean
 * properties become choices, strings and numbers a custom answer. Undefined when the schema has
 * no usable properties, or the mode is not a form.
 */
export function elicitationQuestions(
  request: ElicitationRequest,
  requestId: string,
): AskUserQuestionItem[] | undefined {
  if (request.mode === "url") return undefined;
  const props = schemaProps(request.requested_schema);
  if (!props) return undefined;
  const header = request.display_name ?? request.mcp_server_name ?? "MCP server";
  return props.map((p, index) => {
    const item: AskUserQuestionItem = {
      id: `${requestId}:${p.key}`,
      header,
      question: p.title ?? p.description ?? p.key,
      options:
        p.type === "boolean"
          ? [{ label: "Yes" }, { label: "No" }]
          : (p.enum ?? []).map((label) => ({ label })),
      multiSelect: false,
    };
    if (index === 0 && request.message) item.detail = request.message;
    return item;
  });
}
/** dsh's answers → the elicitation result the CLI relays: accept with content, or cancel. */
export function elicitationResult(
  request: ElicitationRequest,
  response: { answers?: Array<{ id: string; custom?: string; selected?: string[] }> },
  requestId: string,
): Record<string, JsonValue> {
  const props = schemaProps(request.requested_schema) ?? [];
  const byId = new Map((response?.answers ?? []).map((a) => [a.id, a]));
  const content: Record<string, JsonValue> = {};
  for (const p of props) {
    const a = byId.get(`${requestId}:${p.key}`);
    const raw = (typeof a?.custom === "string" && a.custom) || a?.selected?.[0] || "";
    if (raw === "") continue;
    if (p.type === "boolean") content[p.key] = raw === "Yes";
    else if (p.type === "number" || p.type === "integer") {
      const n = Number(raw);
      if (Number.isFinite(n)) content[p.key] = n;
    } else content[p.key] = raw;
  }
  return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "cancel" };
}

/**
 * A `result` line that arrived while no turn was reading, and that is worth a wake: a completed
 * reply. An error result is not: on a rate limit the CLI retries on its own and emits one error
 * result per attempt, and waking on each opened a rejected turn every 73 s until the limit reset
 * (2026-09-06 22:51 to 23:00, eight turns).
 */
export function isIdleReply(line: string): boolean {
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return false;
    // SAFETY: a non-null object; each field is compared to a literal, never trusted as typed
    const r = parsed as { type?: unknown; is_error?: unknown; subtype?: unknown };
    return r.type === "result" && r.is_error !== true && r.subtype !== "error_during_execution";
  } catch {
    return false; // not JSON: nextEvent() files it under `stray`
  }
}

/** stdin line for any control request this plugin sends; the CLI answers with a `control_response`. */
export function controlRequestLine(requestId: string, request: Record<string, JsonValue>): string {
  return `${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`;
}

/** stdin line answering one of the CLI's control requests with a failure. */
export function controlErrorLine(requestId: string, error: unknown): string {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error } })}\n`;
}

/** Lets a tool call run, with the input dsh approved, which may differ from the one asked for. */
export const allowResult = (toolUseId: string, input: unknown) => ({
  behavior: "allow" as const,
  updatedInput: input,
  toolUseID: toolUseId,
  decisionClassification: "user_temporary" as const,
});

/** Refuses a tool call and tells Claude why; the CLI reads this as the user rejecting it. */
export const denyResult = (toolUseId: string, message: string) => ({
  behavior: "deny" as const,
  message,
  toolUseID: toolUseId,
  decisionClassification: "user_reject" as const,
});

/** Claude's AskUserQuestion input → dsh question items. Undefined when the shape is not what the tool documents. */
export function parseQuestions(
  input: Record<string, unknown>,
  toolUseId: string,
): AskUserQuestionItem[] | undefined {
  const list = input?.questions;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) return undefined;
  const out: AskUserQuestionItem[] = [];
  for (const [index, item] of list.entries()) {
    if (!item || typeof item !== "object" || typeof item.question !== "string" || !item.question)
      return undefined;
    const options: AskUserQuestionItem["options"] = [];
    for (const o of Array.isArray(item.options) ? item.options : []) {
      if (!o || typeof o.label !== "string" || !o.label) return undefined;
      const optObj: AskUserQuestionItem["options"][number] = {
        label: o.label,
      };
      if (typeof o.description === "string" && o.description) optObj.description = o.description;
      options.push(optObj);
    }
    const outItem: AskUserQuestionItem = {
      id: `${toolUseId}:${index}`,
      question: item.question,
      options,
      multiSelect: item.multiSelect === true,
    };
    if (typeof item.header === "string" && item.header) outItem.header = item.header;
    out.push(outItem);
  }
  return out;
}

/** dsh answers → the `answers` map Claude expects back in updatedInput, keyed by question text. */
export function answersFor(
  questions: Array<{ id: string; question: string; multiSelect?: boolean }>,
  response: { answers?: Array<{ id: string; custom?: string; selected?: string[] }> },
) {
  const byId = new Map((response?.answers ?? []).map((a) => [a.id, a]));
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const a = byId.get(q.id);
    const custom = typeof a?.custom === "string" && a.custom ? a.custom : undefined;
    if (!a) answers[q.question] = "";
    else if (!q.multiSelect && custom) answers[q.question] = custom;
    else answers[q.question] = [...(a.selected ?? []), ...(custom ? [custom] : [])].join(", ");
  }
  return answers;
}

/** One-line human reason for the approval dialog. */
export function permissionReason(
  toolName: string,
  input: Record<string, unknown>,
  request: Record<string, unknown>,
): string {
  const head = request?.title ?? request?.description ?? "";
  let detail = "";
  if (toolName === "Bash" && typeof input?.command === "string") detail = input.command;
  else if (typeof input?.file_path === "string") detail = input.file_path;
  else if (typeof input?.url === "string") detail = input.url;
  else if (input && typeof input === "object") detail = JSON.stringify(input);
  const text = [head, detail].filter(Boolean).join(": ");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text || toolName;
}

/** Returned by `next(timeoutMs)` when nothing arrived in time; the waiter is withdrawn, no line is lost. */
export const TIMEOUT = Symbol("timeout");

/** Async line queue over a child's stdout: `next()` resolves with the next line, or null once the child is gone. */
export class LineQueue {
  lines: (string | ClaudeEvent | Record<string, unknown>)[];
  waiters: Array<(line: string | typeof TIMEOUT | null) => void>;
  closed: boolean;

  constructor() {
    this.lines = [];
    this.waiters = [];
    this.closed = false;
  }
  /** Lines waiting with no turn reading them. */
  get size(): number {
    return this.lines.length;
  }
  push(line: string | ClaudeEvent | Record<string, unknown>) {
    const w = this.waiters.shift();
    if (w && line !== null) {
      // SAFETY: TIMEOUT is never pushed; only strings or parsed objects reach here
      w(line as string);
    } else {
      this.lines.push(line);
    }
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w(null);
  }
  next(timeoutMs?: number): Promise<string | typeof TIMEOUT | null> {
    if (this.lines.length > 0) {
      const line = this.lines.shift();
      // SAFETY: TIMEOUT sentinel is never stored in lines; only strings or objects arrive here
      return Promise.resolve((line ?? null) as string | typeof TIMEOUT | null);
    }
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (line: string | typeof TIMEOUT | null) => {
        clearTimeout(timer);
        resolve(line);
      };
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              const i = this.waiters.indexOf(waiter);
              if (i >= 0) this.waiters.splice(i, 1);
              resolve(TIMEOUT);
            }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

/** Everything one turn needs, as `prepare()` returns it; the process keeps the last one. */
export interface TurnPrep {
  cwd: string;
  args: string[];
  session?: { id: string; resuming: boolean };
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
const keeperPaths = (dir: string): KeeperPaths => ({
  dir,
  sock: join(dir, "keeper.sock"),
  spec: join(dir, "spec.json"),
  info: join(dir, "keeper.json"),
});

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
export function readKeeperInfo(dir: string): KeeperInfo | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(keeperPaths(dir).info, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    // SAFETY: keeper.json is written by keeper.ts from a typed object; each field is re-checked below
    const p = parsed as Partial<KeeperInfo>;
    if (typeof p.pid !== "number" || typeof p.sessionId !== "string") return undefined;
    return {
      pid: p.pid,
      claudePid: typeof p.claudePid === "number" ? p.claudePid : -1,
      sessionId: p.sessionId,
      startedAt: typeof p.startedAt === "number" ? p.startedAt : 0,
      exit: p.exit ?? null,
      endedBy:
        p.endedBy === "client" || p.endedBy === "child" || p.endedBy === "keeper-crash"
          ? p.endedBy
          : null,
    };
  } catch {
    return undefined;
  }
}

/** True when a pid is alive (signal 0). Only a positive pid is one process: `kill(0, …)` is the
 *  caller's own process group and `kill(-1, …)` is every process this user owns, so a record that
 *  lost its pid (a keeper whose spawn failed writes none, read back as -1) must answer "not
 *  alive" here, or the orphan kill that follows sends SIGTERM to the user's whole login session
 *  (2026-09-17: a dsh-web restart logged the owner out of the desktop). */
export const pidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Attach to a keeper's socket and present it as a SubprocessHandle: stdin lines become `in`
 * messages, `out`/`err` lines feed the readable sides, `exit` settles `done`, terminate sends
 * `kill`. Rejects when the socket does not answer within `timeoutMs`.
 */
export function attachKeeper(dir: string, timeoutMs = 5000): Promise<SubprocessHandle> {
  const paths = keeperPaths(dir);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tryConnect = () => {
      const sock = connect(paths.sock);
      sock.once("error", () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`keeper at ${dir} did not answer`));
        else setTimeout(tryConnect, 150);
      });
      sock.once("connect", () => {
        sock.removeAllListeners("error");
        sock.on("error", () => {});
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        let resolveDone:
          | ((v: { exitCode: number | null; signal: string | null }) => void)
          | undefined;
        const done = new Promise<{ exitCode: number | null; signal: string | null }>((r) => {
          resolveDone = r;
        });
        let settled = false;
        const settle = (code: number | null, signal: string | null) => {
          if (settled) return;
          settled = true;
          stdout.end();
          stderr.end();
          resolveDone?.({ exitCode: code, signal });
        };
        createInterface({ input: sock, crlfDelay: Infinity }).on("line", (raw) => {
          let msg: { t?: string; line?: string; code?: number | null; signal?: string | null };
          try {
            // SAFETY: the peer is this plugin's keeper.ts; fields are checked before use
            msg = JSON.parse(raw) as typeof msg;
          } catch {
            return;
          }
          if (msg.t === "out" && typeof msg.line === "string") stdout.write(`${msg.line}\n`);
          else if (msg.t === "err" && typeof msg.line === "string") stderr.write(`${msg.line}\n`);
          else if (msg.t === "exit") settle(msg.code ?? null, msg.signal ?? null);
        });
        // A closed socket with no `exit` first means the keeper is gone (crashed, or another dsh
        // took the connection); either way this handle's process is over for us.
        sock.on("close", () => settle(-1, "socket-closed"));
        const stdin = new Writable({
          write(chunk, _enc, cb) {
            const text = String(chunk);
            for (const line of text.split("\n"))
              if (line !== "") sock.write(`${JSON.stringify({ t: "in", line: `${line}\n` })}\n`);
            cb();
          },
        });
        sock.write(`${JSON.stringify({ t: "hello" })}\n`);
        resolve({
          stdin,
          stdout,
          stderr,
          done,
          terminate: () => {
            sock.write(`${JSON.stringify({ t: "kill" })}\n`);
          },
        });
      });
    };
    tryConnect();
  });
}

/**
 * A SubprocessHandle that is usable at once while the real one is still being attached: stdin
 * writes queue until then, stdout/stderr are piped through, done and terminate follow the real one.
 */
export function lazyHandle(pending: Promise<SubprocessHandle>): SubprocessHandle {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const queued: string[] = [];
  let real: SubprocessHandle | undefined;
  let killed = false;
  const settled = pending.then(
    (h) => {
      real = h;
      h.stdout.pipe(stdout);
      h.stderr.pipe(stderr);
      for (const line of queued) h.stdin.write(line);
      queued.length = 0;
      if (killed) h.terminate();
      return h.done;
    },
    (error: Error) => {
      stderr.write(`keeper: ${error.message}\n`);
      stdout.end();
      stderr.end();
      return { exitCode: -1, signal: null };
    },
  );
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      if (real) real.stdin.write(String(chunk));
      else queued.push(String(chunk));
      cb();
    },
  });
  return {
    stdin,
    stdout,
    stderr,
    done: settled,
    terminate: () => {
      killed = true;
      real?.terminate();
    },
  };
}

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
export function readKeeperSpec(dir: string): KeeperSpec | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(keeperPaths(dir).spec, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    // SAFETY: spec.json is written by spawnKeeper from a KeeperSpec; the fields that matter are re-checked
    const s = parsed as KeeperSpec;
    if (typeof s.command !== "string" || !Array.isArray(s.args) || typeof s.sessionId !== "string")
      return undefined;
    return s;
  } catch {
    return undefined;
  }
}

/** Launch the keeper in its own systemd user scope when possible (a service restart's cgroup kill
 *  then misses it), else as a detached process with its own group. */
export function launchKeeper(argv: string[], unit: string): void {
  const detached = () => {
    const c = spawn(argv[0] ?? process.execPath, argv.slice(1), {
      detached: true,
      stdio: "ignore",
    });
    c.unref();
  };
  try {
    const c = spawn(
      "systemd-run",
      ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, ...argv],
      { detached: true, stdio: "ignore" },
    );
    c.on("error", detached);
    c.unref();
  } catch {
    detached();
  }
}

/**
 * Start a keeper for one Claude process and attach to it. `launch` runs the keeper command line
 * (plain detached spawn, or a systemd user scope so a service restart's cgroup kill misses it).
 */
export async function spawnKeeper(
  dir: string,
  spec: KeeperSpec,
  launch: (argv: string[]) => void,
): Promise<SubprocessHandle> {
  const paths = keeperPaths(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(paths.spec, JSON.stringify(spec));
  // A respawn reuses the session's directory while the previous keeper still listens for up to
  // 3 s after its Claude died. Left in place, that socket is what attachKeeper connects to first,
  // binding the new handle to the dying process (2026-09-06 21:27: "claude exited 143" on a model
  // switch, and the fresh Claude orphaned). Unlink it so only the new keeper can answer.
  try {
    unlinkSync(paths.sock);
  } catch {
    // no stale socket
  }
  const keeperJs = new URL("./keeper.js", import.meta.url).pathname;
  launch([process.execPath, keeperJs, dir]);
  return attachKeeper(dir, 8000);
}

/** How a child is started: locally, or on a box over ssh. The adapter holds one per provider. */
export type Spawner = (
  command: string,
  args: string[],
  cwd: string,
  envOverride?: Record<string, string>,
) => SubprocessHandle;

/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export class ClaudeProcess {
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
  steerPending: boolean = false;
  parked: "steer" | undefined = undefined;
  /** The CLI's `dsh` MCP session belongs to a dsh that is gone (adopted after a restart) and the
   *  reconnect after adoption gave up, because dsh had no live agent for the session yet. The next
   *  turn, which implies one, asks once more before its prompt goes out. */
  bridgeStale: boolean = false;
  /** Set by the idle watchdog when it kills the process. */
  idleKilled: boolean = false;
  /** The silence it was allowed before that kill: longer while a tool call is out. */
  idleKilledAfterMs?: number;
  /** MCP servers this process has been told to ask about, by name. The CLI holds the override in
   *  its own tool-permission context and offers no read-back, so the only record is the one kept
   *  where the override was sent from. It hangs off the process for the same reason the override
   *  does: both end when the process does, so nothing has to remember to clear it. */
  mcpAsking: Set<string> = new Set();
  staleResults: number = 0;
  /** When this turn's prompt was written, for time-to-first-token; 0 once a result has read it. */
  promptSentAt: number = 0;
  /** `total_cost_usd` and `duration_api_ms` as of the last result frame. Both are running totals
   *  for the life of the process, not this turn's figures, so each turn's own is the difference
   *  from here. They hang off the process because a Translator lives for one turn and the CLI's
   *  totals restart with the process. */
  costSoFar: number = 0;
  apiMsSoFar: number = 0;
  /** The model whose context window was last asked for, as `spec.model ?? ""`. A session started on
   *  the mount's default model names no model at all, so "asked" cannot be read off the bank alone. */
  windowAskedFor?: string;
  prep?: TurnPrep;
  /** A terminal wrote turns into this session's transcript since this process last spoke, so its
   *  context is behind the file; the next prompt replaces it and resumes from the transcript. */
  staleContext: boolean = false;
  /** Sees every `control_response` line as it arrives, even between turns; true means consumed. */
  controlListener?: (event: ClaudeEvent) => boolean;

  constructor({
    args,
    cwd,
    spec,
    onExit,
    command = "claude",
    spawner = nodeSpawner,
  }: {
    args: string[];
    cwd: string;
    spec: ClaudeProcessSpec;
    onExit?: ClaudeProcessOnExit;
    command?: string;
    spawner?: Spawner;
  }) {
    this.spec = spec;
    this.args = args;
    this.cwd = cwd;
    this.busy = false;
    this.lastUsed = Date.now();
    this.stderr = "";
    this.stray = "";
    this.sent = new Set(); // steerKeys of messages already forwarded to Claude mid-turn (a typed steer's rpcId, a dsh message's id)
    this.relays = new Map(); // relayed dsh tool call id → { resolve, reject, ... } awaiting dsh's result
    this.exitCode = undefined;
    this.queue = new LineQueue();
    this.child = spawner(command, args, cwd);
    this.child.stdin?.on("error", () => {});
    this.child.stderr?.on("data", (d) => {
      this.stderr = (this.stderr + d).slice(-2000);
    });
    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (this.controlListener && line.includes('"control_response"')) {
        try {
          // SAFETY: I/O boundary; the listener branches on `type` and ignores anything else
          if (this.controlListener(JSON.parse(line) as ClaudeEvent)) return;
        } catch {
          // not JSON: queue it like any other line
        }
      }
      this.queue.push(line);
      this.noteIdleResult(line);
    });
    this.child.done.then(
      (outcome) => this.closed(outcome?.exitCode ?? -1, onExit),
      () => this.closed(-1, onExit),
    );
  }

  closed(code: number, onExit: ClaudeProcessOnExit | undefined) {
    this.exitCode = code;
    this.queue.close();
    for (const r of this.relays.values())
      r.reject(new Error(`claude exited ${this.exitCode} while dsh ran its tool call`));
    this.relays.clear();
    onExit?.(this);
  }

  get alive() {
    return this.exitCode === undefined;
  }

  write(line: string): boolean {
    if (!this.alive) return false;
    this.child.stdin.write(line);
    return true;
  }

  kill() {
    if (this.alive) this.child.terminate();
  }

  /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
  inject(event: ClaudeEvent) {
    this.queue.push(event);
  }

  /** How many `result` events sit in the queue with no turn reading them. Claude Code runs a turn
   *  of its own when a background task it started finishes; with dsh idle, that whole turn is
   *  buffered here and the next prompt would end on its stale result, leaving every later reply
   *  one prompt behind. */
  /** A `result` line while no turn is reading: Claude just finished a turn of its own. Tell the
   *  adapter (`onIdleResult`) so it can open a dsh turn and show the reply now. */
  noteIdleResult(line: string) {
    if (this.busy || !this.onIdleResult || !line.includes('"result"')) return;
    if (!isIdleReply(line)) return;
    try {
      // A throw here is inside readline's data handler: it would take the whole host down.
      // The adapter behind the callback may have been hot-reloaded away (dead cordis scope).
      const r: unknown = this.onIdleResult();
      if (typeof r === "object" && r !== null && "catch" in r && typeof r.catch === "function")
        r.catch(() => {});
    } catch {
      // logged by the adapter when it can; nothing else to do here
    }
  }

  countStaleResults() {
    let n = 0;
    for (const line of this.queue.lines) {
      if (typeof line !== "string" || !line.includes('"result"')) continue;
      try {
        if (JSON.parse(line).type === "result") n++;
      } catch {
        // not JSON: nextEvent() files it under `stray`
      }
    }
    return n;
  }

  /** Next parsed JSON line; plain text lines are kept in `stray` for error messages. Null when the
   *  process ended, `{ type: "timeout" }` when `timeoutMs` passed first. */
  async nextEvent(timeoutMs?: number): Promise<ClaudeEvent | null> {
    // The deadline is fixed when the wait starts, not renewed per line: a child printing text that
    // is not JSON — a warning, a progress bar, a shell banner — would otherwise hand this loop a
    // fresh timeout on every line and hold a call that is never going to answer open forever.
    const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
    for (;;) {
      const left = deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
      const line = await this.queue.next(left);
      if (line === null) return null;
      if (line === TIMEOUT) return { type: "timeout" };
      if (typeof line === "object") return line; // injected by inject()
      try {
        // SAFETY: this is the I/O boundary; a parsed line is treated as a CLI event and every
        // consumer branches on `type` with a logged fallback for shapes it does not know.
        return JSON.parse(line) as ClaudeEvent;
      } catch {
        this.stray = (this.stray + line + "\n").slice(-2000);
      }
    }
  }
}
