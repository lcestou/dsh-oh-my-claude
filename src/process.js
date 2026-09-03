// One long-lived `claude -p --input-format stream-json` process per dsh session, plus the control
// channel the Agent SDK uses over the same stream: `control_request` lines from the CLI (permission
// prompts, user questions) answered with `control_response` lines on stdin.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK writes. */
export function userTurnLine(content) {
  return `${JSON.stringify({ type: "user", session_id: "", message: { role: "user", content }, parent_tool_use_id: null })}\n`;
}

export function controlResponseLine(requestId, response) {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } })}\n`;
}

/** stdin line asking the CLI to stop the current turn; it answers with a result and stays alive. */
export function interruptLine(requestId) {
  return `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;
}

export function controlErrorLine(requestId, error) {
  return `${JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error } })}\n`;
}

export const allowResult = (toolUseId, input) => ({
  behavior: "allow",
  updatedInput: input,
  toolUseID: toolUseId,
  decisionClassification: "user_temporary",
});

export const denyResult = (toolUseId, message) => ({
  behavior: "deny",
  message,
  toolUseID: toolUseId,
  decisionClassification: "user_reject",
});

/** Claude's AskUserQuestion input → dsh question items. Undefined when the shape is not what the tool documents. */
export function parseQuestions(input, toolUseId) {
  const list = input?.questions;
  if (!Array.isArray(list) || list.length === 0 || list.length > 20) return undefined;
  const out = [];
  for (const [index, item] of list.entries()) {
    if (!item || typeof item !== "object" || typeof item.question !== "string" || !item.question)
      return undefined;
    const options = [];
    for (const o of Array.isArray(item.options) ? item.options : []) {
      if (!o || typeof o.label !== "string" || !o.label) return undefined;
      options.push({
        label: o.label,
        ...(typeof o.description === "string" && o.description
          ? { description: o.description }
          : {}),
      });
    }
    out.push({
      id: `${toolUseId}:${index}`,
      question: item.question,
      ...(typeof item.header === "string" && item.header ? { header: item.header } : {}),
      options,
      multiSelect: item.multiSelect === true,
    });
  }
  return out;
}

/** dsh answers → the `answers` map Claude expects back in updatedInput, keyed by question text. */
export function answersFor(questions, response) {
  const byId = new Map((response?.answers ?? []).map((a) => [a.id, a]));
  const answers = {};
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
export function permissionReason(toolName, input, request) {
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
  constructor() {
    this.lines = [];
    this.waiters = [];
    this.closed = false;
  }
  push(line) {
    const w = this.waiters.shift();
    if (w) w(line);
    else this.lines.push(line);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w(null);
  }
  next(timeoutMs) {
    if (this.lines.length > 0) return Promise.resolve(this.lines.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = (line) => {
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

/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export class ClaudeProcess {
  constructor({ args, cwd, spec, onExit }) {
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
    this.child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // dsh subagents proxied over MCP can run for a while; the CLI default tool timeout is shorter.
      env: { MCP_TOOL_TIMEOUT: "3600000", ...process.env },
    });
    this.child.stdin.on("error", () => {});
    this.child.stderr.on("data", (d) => {
      this.stderr = (this.stderr + d).slice(-2000);
    });
    const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.queue.push(line));
    this.child.on("close", (code) => {
      this.exitCode = code ?? -1;
      this.queue.close();
      for (const r of this.relays.values())
        r.reject(new Error(`claude exited ${this.exitCode} while dsh ran its tool call`));
      this.relays.clear();
      onExit?.(this);
    });
  }

  get alive() {
    return this.exitCode === undefined;
  }

  write(line) {
    if (!this.alive) return false;
    this.child.stdin.write(line);
    return true;
  }

  kill() {
    if (this.alive) this.child.kill();
  }

  /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
  inject(event) {
    this.queue.push(event);
  }

  /** Next parsed JSON line; plain text lines are kept in `stray` for error messages. Null when the
   *  process ended, `{ type: "timeout" }` when `timeoutMs` passed first. */
  async nextEvent(timeoutMs) {
    for (;;) {
      const line = await this.queue.next(timeoutMs);
      if (line === null) return null;
      if (line === TIMEOUT) return { type: "timeout" };
      if (typeof line === "object") return line; // injected by inject()
      try {
        return JSON.parse(line);
      } catch {
        this.stray = (this.stray + line + "\n").slice(-2000);
      }
    }
  }
}
