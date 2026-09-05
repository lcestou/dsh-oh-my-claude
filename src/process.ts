// One long-lived `claude -p --input-format stream-json` process per dsh session, plus the control
// channel the Agent SDK uses over the same stream: `control_request` lines from the CLI (permission
// prompts, user questions) answered with `control_response` lines on stdin.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AskUserQuestionItem, JsonValue, SubprocessRuntime } from "./dsh.js";
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
const CHILD_ENV = { MCP_TOOL_TIMEOUT: "3600000" };

export interface SubprocessHandle {
  stdin: import("node:stream").Writable;
  stdout: import("node:stream").Readable;
  stderr: import("node:stream").Readable;
  done: Promise<{ exitCode: number | null; signal: string | null }>;
  terminate(): void;
}

export type ClaudeEvent =
  | {
      type: "system";
      subtype?: string;
      /** subtype "init": the CLI's slash-command catalog (skills, custom commands, built-ins). */
      slash_commands?: JsonValue;
      compact_metadata?: Record<string, unknown>;
      // subtype "status": `status:"compacting"` opens the silent summarize stretch; a later frame
      // with `status:null` carries `compact_result` ("success"|"failed") and, on failure, `compact_error`.
      status?: string | null;
      compact_result?: string;
      compact_error?: string;
    }
  | { type: "stream_event"; event?: ClaudeStreamPartial }
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
  | { type: "rate_limit_event"; rate_limit_info?: { status?: string; resetsAt?: number } }
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
      };
    }
  | { type: "control_cancel_request"; request_id: string }
  | {
      type: "control_response";
      request_id: string;
      response?: { subtype?: string; request_id?: string; response?: unknown; error?: unknown };
    }
  | { type: "timeout" }
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

export interface ClaudeAssistantMessage {
  id?: string;
  model?: string;
  role?: string;
  content?: ClaudeContentBlock[];
}

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean };

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
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { text?: string; thinking?: string; partial_json?: string; signature?: string };
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
export function nodeSpawner(
  command: string,
  args: string[],
  cwd: string,
  envOverride?: Record<string, string>,
): SubprocessHandle {
  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...CHILD_ENV, ...process.env, ...envOverride },
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done: new Promise((resolve) =>
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal })),
    ),
    terminate: () => child.kill(),
  };
}

/**
 * dsh's subprocess seam (`ctx.subprocess`). Same shape by definition. With a remote provider such
 * as a remote subprocess provider mounted, Claude Code runs on the remote machine for a remote workspace; the seam
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

/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK writes. */
export function userTurnLine(content: unknown): string {
  return `${JSON.stringify({ type: "user", session_id: "", message: { role: "user", content }, parent_tool_use_id: null })}\n`;
}

/**
 * Formats a successful control response as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID to respond to
 * @param {any} response - The response value
 * @returns {string} A JSON line ready for stdin
 */
export function controlResponseLine(requestId: string, response: unknown): string {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } })}\n`;
}

/** stdin line asking the CLI to stop the current turn; it answers with a result and stays alive. */
export function interruptLine(requestId: string): string {
  return `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;
}

/**
 * Formats a control response error as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID that caused the error
 * @param {any} error - The error value
 * @returns {string} A JSON line ready for stdin
 */
export function controlErrorLine(requestId: string, error: unknown): string {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error } })}\n`;
}

/**
 * Creates an approval decision allowing a tool call to proceed with
 * optional input modifications.
 * @param {string} toolUseId - The tool call ID to approve
 * @param {any} input - The updated tool input
 * @returns {object} An approval decision object
 */
export const allowResult = (toolUseId: string, input: unknown) => ({
  behavior: "allow" as const,
  updatedInput: input,
  toolUseID: toolUseId,
  decisionClassification: "user_temporary" as const,
});

/**
 * Creates an approval decision denying a tool call from proceeding.
 * @param {string} toolUseId - The tool call ID to deny
 * @param {string} message - The reason for denial
 * @returns {object} A denial decision object
 */
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
  const text = [head, detail].filter(Boolean).join(" — ");
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
  staleResults: number = 0;
  prep?: TurnPrep;

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
    this.sent = new Set(); // rpcIds of steers already forwarded to Claude mid-turn
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
    let isResult = false;
    try {
      isResult = JSON.parse(line).type === "result";
    } catch {
      // not JSON: nextEvent() files it under `stray`
    }
    if (!isResult) return;
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
    for (;;) {
      const line = await this.queue.next(timeoutMs);
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
