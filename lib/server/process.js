// One long-lived `claude -p --input-format stream-json` process per dsh session, plus the control
// channel the Agent SDK uses over the same stream: `control_request` lines from the CLI (permission
// prompts, user questions) answered with `control_response` lines on stdin.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { createInterface } from "node:readline";
/** Errors reach us as `unknown`; this is the one place they become text. */
export const errorText = (e) => (e instanceof Error ? e.message : String(e));
/** Text of a Claude tool_result: a string, or the text blocks of a content array; other block
 *  kinds render as their bracketed type. */
export function toolResultText(block) {
    const c = block.content;
    if (typeof c === "string")
        return c;
    if (Array.isArray(c))
        return c.map(toolResultBlockText).join("\n");
    return "";
}
/** One block of a tool_result content array: its text, or its type in brackets. */
function toolResultBlockText(b) {
    if (typeof b !== "object" || b === null || !("type" in b))
        return "[unknown]";
    if (b.type === "text")
        return "text" in b ? String(b.text) : "undefined";
    return `[${typeof b.type === "string" ? b.type : "unknown"}]`;
}
/** Child env on top of the parent's: dsh subagents over MCP can outlive the CLI's default tool timeout. */
/** What every Claude child gets on top of dsh's environment: a long MCP tool timeout for relayed
 *  dsh tools, and file checkpointing, which stream-json runs leave off unless asked, so that the
 *  `rewind_files` control request has something to rewind to. */
export const CHILD_ENV = {
    MCP_TOOL_TIMEOUT: "3600000",
    CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1",
};
/**
 * Node's own spawn, shaped like a dsh `SubprocessHandle` so the process code has one shape to
 * talk to: `stdin`/`stdout`/`stderr` streams, `done` resolving with the exit code, `terminate()`.
 * `envOverride` is merged last so configured values win over the parent's environment.
 */
export function nodeSpawner(command, args, cwd, envOverride) {
    const child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...CHILD_ENV, ...process.env, ...envOverride },
    });
    return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        done: new Promise((resolve) => child.on("close", (exitCode, signal) => resolve({ exitCode, signal }))),
        terminate: () => child.kill(),
    };
}
/**
 * dsh's subprocess seam (`ctx.subprocess`). Same shape by definition. With a remote provider such
 * as a remote subprocess provider mounted, Claude Code runs on the remote machine for a remote workspace; the seam
 * scrubs credential-shaped env vars, so credentials come from the login on that machine.
 * `envOverride` is merged last so configured values win.
 */
export const seamSpawner = (subprocess) => (command, args, cwd, envOverride) => subprocess.spawn({
    argv: [command, ...args],
    cwd,
    env: { ...CHILD_ENV, ...envOverride },
    graceMs: 5000,
    stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
});
/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK writes. */
export function userTurnLine(content) {
    return `${JSON.stringify({ type: "user", session_id: "", message: { role: "user", content }, parent_tool_use_id: null })}\n`;
}
/**
 * Formats a successful control response as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID to respond to
 * @param {any} response - The response value
 * @returns {string} A JSON line ready for stdin
 */
export function controlResponseLine(requestId, response) {
    return `${JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: requestId, response } })}\n`;
}
/** stdin line asking the CLI to stop the current turn; it answers with a result and stays alive. */
export function interruptLine(requestId) {
    return `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "interrupt" } })}\n`;
}
/** A control response payload as JSON, or undefined when it is not representable. */
export function toJsonValue(v) {
    if (v === undefined)
        return undefined;
    try {
        // SAFETY: a JSON round trip yields JSON by construction
        return JSON.parse(JSON.stringify(v));
    }
    catch {
        return undefined;
    }
}
export function decodeRewindResult(v) {
    const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
    const out = { canRewind: r.canRewind === true };
    if (typeof r.error === "string")
        out.error = r.error;
    if (Array.isArray(r.filesChanged))
        out.filesChanged = r.filesChanged.filter((f) => typeof f === "string");
    if (typeof r.insertions === "number")
        out.insertions = r.insertions;
    if (typeof r.deletions === "number")
        out.deletions = r.deletions;
    return out;
}
export function decodeContextUsage(v) {
    const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
    const categories = [];
    if (Array.isArray(r.categories))
        for (const c of r.categories) {
            if (typeof c !== "object" || c === null || Array.isArray(c))
                continue;
            if (typeof c.name !== "string" || typeof c.tokens !== "number")
                continue;
            categories.push({ name: c.name, tokens: c.tokens, deferred: c.isDeferred === true });
        }
    const out = {
        categories,
        totalTokens: typeof r.totalTokens === "number" ? r.totalTokens : 0,
        maxTokens: typeof r.maxTokens === "number" ? r.maxTokens : 0,
        percentage: typeof r.percentage === "number" ? r.percentage : 0,
    };
    if (typeof r.model === "string")
        out.model = r.model;
    if (typeof r.autocompactSource === "string")
        out.autocompact = r.autocompactSource;
    return out;
}
/** The `title` of a `generate_session_title` answer, trimmed; undefined when absent or empty. */
export function decodeTitle(v) {
    const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
    const title = typeof r.title === "string" ? r.title.trim() : "";
    return title.length > 0 ? title : undefined;
}
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (x) => (typeof x === "number" ? x : 0);
export function decodeWorkspaceDiff(v) {
    const outer = isRecord(v) ? v : {};
    const d = isRecord(outer.diff) ? outer.diff : outer;
    const stats = isRecord(d.stats) ? d.stats : {};
    const hunksByPath = new Map();
    if (Array.isArray(d.hunks))
        for (const entry of d.hunks) {
            if (!isRecord(entry) || typeof entry.path !== "string" || !Array.isArray(entry.hunks))
                continue;
            const list = [];
            for (const h of entry.hunks) {
                if (!isRecord(h))
                    continue;
                const lines = Array.isArray(h.lines)
                    ? h.lines.filter((l) => typeof l === "string")
                    : [];
                list.push({ oldStart: num(h.oldStart), newStart: num(h.newStart), lines });
            }
            hunksByPath.set(entry.path, list);
        }
    const files = [];
    if (Array.isArray(d.perFileStats))
        for (const f of d.perFileStats) {
            if (!isRecord(f) || typeof f.path !== "string")
                continue;
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
export function decodeMcpStatus(v) {
    const r = isRecord(v) ? v : {};
    const out = [];
    if (Array.isArray(r.mcpServers))
        for (const m of r.mcpServers) {
            if (!isRecord(m) || typeof m.name !== "string")
                continue;
            const entry = {
                name: m.name,
                status: typeof m.status === "string" ? m.status : "unknown",
            };
            const info = isRecord(m.serverInfo) ? m.serverInfo : {};
            if (typeof info.version === "string")
                entry.version = info.version;
            out.push(entry);
        }
    return out;
}
export function decodeCliModels(v) {
    const r = isRecord(v) ? v : {};
    const out = [];
    if (Array.isArray(r.models))
        for (const m of r.models) {
            if (!isRecord(m) || typeof m.value !== "string")
                continue;
            out.push({
                value: m.value,
                resolvedModel: typeof m.resolvedModel === "string" ? m.resolvedModel : m.value,
                displayName: typeof m.displayName === "string" ? m.displayName : m.value,
                efforts: Array.isArray(m.supportedEffortLevels)
                    ? m.supportedEffortLevels.filter((e) => typeof e === "string")
                    : [],
            });
        }
    return out;
}
function schemaProps(schema) {
    const s = isRecord(schema) ? schema : {};
    const props = isRecord(s.properties) ? s.properties : undefined;
    if (!props)
        return undefined;
    const out = [];
    for (const [key, def] of Object.entries(props)) {
        if (!isRecord(def))
            return undefined;
        const type = typeof def.type === "string" ? def.type : "string";
        const prop = { key, type };
        if (Array.isArray(def.enum))
            prop.enum = def.enum.map((e) => String(e));
        if (typeof def.title === "string")
            prop.title = def.title;
        if (typeof def.description === "string")
            prop.description = def.description;
        out.push(prop);
    }
    return out.length > 0 && out.length <= 20 ? out : undefined;
}
/**
 * An MCP elicitation as dsh questions: one per top-level schema property. Enum and boolean
 * properties become choices, strings and numbers a custom answer. Undefined when the schema has
 * no usable properties, or the mode is not a form.
 */
export function elicitationQuestions(request, requestId) {
    if (request.mode === "url")
        return undefined;
    const props = schemaProps(request.requested_schema);
    if (!props)
        return undefined;
    const header = request.display_name ?? request.mcp_server_name ?? "MCP server";
    return props.map((p, index) => {
        const item = {
            id: `${requestId}:${p.key}`,
            header,
            question: p.title ?? p.description ?? p.key,
            options: p.type === "boolean"
                ? [{ label: "Yes" }, { label: "No" }]
                : (p.enum ?? []).map((label) => ({ label })),
            multiSelect: false,
        };
        if (index === 0 && request.message)
            item.detail = request.message;
        return item;
    });
}
/** dsh's answers → the elicitation result the CLI relays: accept with content, or cancel. */
export function elicitationResult(request, response, requestId) {
    const props = schemaProps(request.requested_schema) ?? [];
    const byId = new Map((response?.answers ?? []).map((a) => [a.id, a]));
    const content = {};
    for (const p of props) {
        const a = byId.get(`${requestId}:${p.key}`);
        const raw = (typeof a?.custom === "string" && a.custom) || a?.selected?.[0] || "";
        if (raw === "")
            continue;
        if (p.type === "boolean")
            content[p.key] = raw === "Yes";
        else if (p.type === "number" || p.type === "integer") {
            const n = Number(raw);
            if (Number.isFinite(n))
                content[p.key] = n;
        }
        else
            content[p.key] = raw;
    }
    return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "cancel" };
}
/** stdin line for any control request this plugin sends; the CLI answers with a `control_response`. */
export function controlRequestLine(requestId, request) {
    return `${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`;
}
/**
 * Formats a control response error as a stdin line for the Claude Code process.
 * @param {string} requestId - The request ID that caused the error
 * @param {any} error - The error value
 * @returns {string} A JSON line ready for stdin
 */
export function controlErrorLine(requestId, error) {
    return `${JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error } })}\n`;
}
/**
 * Creates an approval decision allowing a tool call to proceed with
 * optional input modifications.
 * @param {string} toolUseId - The tool call ID to approve
 * @param {any} input - The updated tool input
 * @returns {object} An approval decision object
 */
export const allowResult = (toolUseId, input) => ({
    behavior: "allow",
    updatedInput: input,
    toolUseID: toolUseId,
    decisionClassification: "user_temporary",
});
/**
 * Creates an approval decision denying a tool call from proceeding.
 * @param {string} toolUseId - The tool call ID to deny
 * @param {string} message - The reason for denial
 * @returns {object} A denial decision object
 */
export const denyResult = (toolUseId, message) => ({
    behavior: "deny",
    message,
    toolUseID: toolUseId,
    decisionClassification: "user_reject",
});
/** Claude's AskUserQuestion input → dsh question items. Undefined when the shape is not what the tool documents. */
export function parseQuestions(input, toolUseId) {
    const list = input?.questions;
    if (!Array.isArray(list) || list.length === 0 || list.length > 20)
        return undefined;
    const out = [];
    for (const [index, item] of list.entries()) {
        if (!item || typeof item !== "object" || typeof item.question !== "string" || !item.question)
            return undefined;
        const options = [];
        for (const o of Array.isArray(item.options) ? item.options : []) {
            if (!o || typeof o.label !== "string" || !o.label)
                return undefined;
            const optObj = {
                label: o.label,
            };
            if (typeof o.description === "string" && o.description)
                optObj.description = o.description;
            options.push(optObj);
        }
        const outItem = {
            id: `${toolUseId}:${index}`,
            question: item.question,
            options,
            multiSelect: item.multiSelect === true,
        };
        if (typeof item.header === "string" && item.header)
            outItem.header = item.header;
        out.push(outItem);
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
        if (!a)
            answers[q.question] = "";
        else if (!q.multiSelect && custom)
            answers[q.question] = custom;
        else
            answers[q.question] = [...(a.selected ?? []), ...(custom ? [custom] : [])].join(", ");
    }
    return answers;
}
/** One-line human reason for the approval dialog. */
export function permissionReason(toolName, input, request) {
    const head = request?.title ?? request?.description ?? "";
    let detail = "";
    if (toolName === "Bash" && typeof input?.command === "string")
        detail = input.command;
    else if (typeof input?.file_path === "string")
        detail = input.file_path;
    else if (typeof input?.url === "string")
        detail = input.url;
    else if (input && typeof input === "object")
        detail = JSON.stringify(input);
    const text = [head, detail].filter(Boolean).join(" — ");
    return text.length > 400 ? `${text.slice(0, 400)}…` : text || toolName;
}
/** Returned by `next(timeoutMs)` when nothing arrived in time; the waiter is withdrawn, no line is lost. */
export const TIMEOUT = Symbol("timeout");
/** Async line queue over a child's stdout: `next()` resolves with the next line, or null once the child is gone. */
export class LineQueue {
    lines;
    waiters;
    closed;
    constructor() {
        this.lines = [];
        this.waiters = [];
        this.closed = false;
    }
    /** Lines waiting with no turn reading them. */
    get size() {
        return this.lines.length;
    }
    push(line) {
        const w = this.waiters.shift();
        if (w && line !== null) {
            // SAFETY: TIMEOUT is never pushed; only strings or parsed objects reach here
            w(line);
        }
        else {
            this.lines.push(line);
        }
    }
    close() {
        this.closed = true;
        for (const w of this.waiters.splice(0))
            w(null);
    }
    next(timeoutMs) {
        if (this.lines.length > 0) {
            const line = this.lines.shift();
            // SAFETY: TIMEOUT sentinel is never stored in lines; only strings or objects arrive here
            return Promise.resolve((line ?? null));
        }
        if (this.closed)
            return Promise.resolve(null);
        return new Promise((resolve) => {
            const waiter = (line) => {
                clearTimeout(timer);
                resolve(line);
            };
            const timer = timeoutMs === undefined
                ? undefined
                : setTimeout(() => {
                    const i = this.waiters.indexOf(waiter);
                    if (i >= 0)
                        this.waiters.splice(i, 1);
                    resolve(TIMEOUT);
                }, timeoutMs);
            this.waiters.push(waiter);
        });
    }
}
const keeperPaths = (dir) => ({
    dir,
    sock: join(dir, "keeper.sock"),
    spec: join(dir, "spec.json"),
    info: join(dir, "keeper.json"),
});
export function readKeeperInfo(dir) {
    try {
        const parsed = JSON.parse(readFileSync(keeperPaths(dir).info, "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return undefined;
        // SAFETY: keeper.json is written by keeper.ts from a typed object; each field is re-checked below
        const p = parsed;
        if (typeof p.pid !== "number" || typeof p.sessionId !== "string")
            return undefined;
        return {
            pid: p.pid,
            claudePid: typeof p.claudePid === "number" ? p.claudePid : -1,
            sessionId: p.sessionId,
            startedAt: typeof p.startedAt === "number" ? p.startedAt : 0,
            exit: p.exit ?? null,
            endedBy: p.endedBy === "client" || p.endedBy === "child" || p.endedBy === "keeper-crash"
                ? p.endedBy
                : null,
        };
    }
    catch {
        return undefined;
    }
}
/** True when a pid is alive (signal 0). */
export const pidAlive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
};
/**
 * Attach to a keeper's socket and present it as a SubprocessHandle: stdin lines become `in`
 * messages, `out`/`err` lines feed the readable sides, `exit` settles `done`, terminate sends
 * `kill`. Rejects when the socket does not answer within `timeoutMs`.
 */
export function attachKeeper(dir, timeoutMs = 5000) {
    const paths = keeperPaths(dir);
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tryConnect = () => {
            const sock = connect(paths.sock);
            sock.once("error", () => {
                if (Date.now() - started > timeoutMs)
                    reject(new Error(`keeper at ${dir} did not answer`));
                else
                    setTimeout(tryConnect, 150);
            });
            sock.once("connect", () => {
                sock.removeAllListeners("error");
                sock.on("error", () => { });
                const stdout = new PassThrough();
                const stderr = new PassThrough();
                let resolveDone;
                const done = new Promise((r) => {
                    resolveDone = r;
                });
                let settled = false;
                const settle = (code, signal) => {
                    if (settled)
                        return;
                    settled = true;
                    stdout.end();
                    stderr.end();
                    resolveDone?.({ exitCode: code, signal });
                };
                createInterface({ input: sock, crlfDelay: Infinity }).on("line", (raw) => {
                    let msg;
                    try {
                        // SAFETY: the peer is this plugin's keeper.ts; fields are checked before use
                        msg = JSON.parse(raw);
                    }
                    catch {
                        return;
                    }
                    if (msg.t === "out" && typeof msg.line === "string")
                        stdout.write(`${msg.line}\n`);
                    else if (msg.t === "err" && typeof msg.line === "string")
                        stderr.write(`${msg.line}\n`);
                    else if (msg.t === "exit")
                        settle(msg.code ?? null, msg.signal ?? null);
                });
                // A closed socket with no `exit` first means the keeper is gone (crashed, or another dsh
                // took the connection); either way this handle's process is over for us.
                sock.on("close", () => settle(-1, "socket-closed"));
                const stdin = new Writable({
                    write(chunk, _enc, cb) {
                        const text = String(chunk);
                        for (const line of text.split("\n"))
                            if (line !== "")
                                sock.write(`${JSON.stringify({ t: "in", line: `${line}\n` })}\n`);
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
export function lazyHandle(pending) {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const queued = [];
    let real;
    let killed = false;
    const settled = pending.then((h) => {
        real = h;
        h.stdout.pipe(stdout);
        h.stderr.pipe(stderr);
        for (const line of queued)
            h.stdin.write(line);
        queued.length = 0;
        if (killed)
            h.terminate();
        return h.done;
    }, (error) => {
        stderr.write(`keeper: ${error.message}\n`);
        stdout.end();
        stderr.end();
        return { exitCode: -1, signal: null };
    });
    const stdin = new Writable({
        write(chunk, _enc, cb) {
            if (real)
                real.stdin.write(String(chunk));
            else
                queued.push(String(chunk));
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
export function readKeeperSpec(dir) {
    try {
        const parsed = JSON.parse(readFileSync(keeperPaths(dir).spec, "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return undefined;
        // SAFETY: spec.json is written by spawnKeeper from a KeeperSpec; the fields that matter are re-checked
        const s = parsed;
        if (typeof s.command !== "string" || !Array.isArray(s.args) || typeof s.sessionId !== "string")
            return undefined;
        return s;
    }
    catch {
        return undefined;
    }
}
/** Launch the keeper in its own systemd user scope when possible (a service restart's cgroup kill
 *  then misses it), else as a detached process with its own group. */
export function launchKeeper(argv, unit) {
    const detached = () => {
        const c = spawn(argv[0] ?? process.execPath, argv.slice(1), {
            detached: true,
            stdio: "ignore",
        });
        c.unref();
    };
    try {
        const c = spawn("systemd-run", ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, ...argv], { detached: true, stdio: "ignore" });
        c.on("error", detached);
        c.unref();
    }
    catch {
        detached();
    }
}
/**
 * Start a keeper for one Claude process and attach to it. `launch` runs the keeper command line
 * (plain detached spawn, or a systemd user scope so a service restart's cgroup kill misses it).
 */
export async function spawnKeeper(dir, spec, launch) {
    const paths = keeperPaths(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(paths.spec, JSON.stringify(spec));
    // A respawn reuses the session's directory while the previous keeper still listens for up to
    // 3 s after its Claude died. Left in place, that socket is what attachKeeper connects to first,
    // binding the new handle to the dying process (2026-09-06 21:27: "claude exited 143" on a model
    // switch, and the fresh Claude orphaned). Unlink it so only the new keeper can answer.
    try {
        unlinkSync(paths.sock);
    }
    catch {
        // no stale socket
    }
    const keeperJs = new URL("./keeper.js", import.meta.url).pathname;
    launch([process.execPath, keeperJs, dir]);
    return attachKeeper(dir, 8000);
}
/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export class ClaudeProcess {
    spec;
    args;
    cwd;
    busy;
    lastUsed;
    stderr;
    stray;
    sent;
    relays;
    exitCode;
    queue;
    child;
    key;
    resuming;
    dshIds;
    relayed;
    steerPending = false;
    parked = undefined;
    /** Set by the idle watchdog when it kills the process. */
    idleKilled = false;
    staleResults = 0;
    prep;
    /** Sees every `control_response` line as it arrives, even between turns; true means consumed. */
    controlListener;
    constructor({ args, cwd, spec, onExit, command = "claude", spawner = nodeSpawner, }) {
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
        this.child.stdin?.on("error", () => { });
        this.child.stderr?.on("data", (d) => {
            this.stderr = (this.stderr + d).slice(-2000);
        });
        const rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
        rl.on("line", (line) => {
            if (this.controlListener && line.includes('"control_response"')) {
                try {
                    // SAFETY: I/O boundary; the listener branches on `type` and ignores anything else
                    if (this.controlListener(JSON.parse(line)))
                        return;
                }
                catch {
                    // not JSON: queue it like any other line
                }
            }
            this.queue.push(line);
            this.noteIdleResult(line);
        });
        this.child.done.then((outcome) => this.closed(outcome?.exitCode ?? -1, onExit), () => this.closed(-1, onExit));
    }
    closed(code, onExit) {
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
    write(line) {
        if (!this.alive)
            return false;
        this.child.stdin.write(line);
        return true;
    }
    kill() {
        if (this.alive)
            this.child.terminate();
    }
    /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
    inject(event) {
        this.queue.push(event);
    }
    /** How many `result` events sit in the queue with no turn reading them. Claude Code runs a turn
     *  of its own when a background task it started finishes; with dsh idle, that whole turn is
     *  buffered here and the next prompt would end on its stale result, leaving every later reply
     *  one prompt behind. */
    /** A `result` line while no turn is reading: Claude just finished a turn of its own. Tell the
     *  adapter (`onIdleResult`) so it can open a dsh turn and show the reply now. */
    noteIdleResult(line) {
        if (this.busy || !this.onIdleResult || !line.includes('"result"'))
            return;
        let isResult = false;
        try {
            isResult = JSON.parse(line).type === "result";
        }
        catch {
            // not JSON: nextEvent() files it under `stray`
        }
        if (!isResult)
            return;
        try {
            // A throw here is inside readline's data handler: it would take the whole host down.
            // The adapter behind the callback may have been hot-reloaded away (dead cordis scope).
            const r = this.onIdleResult();
            if (typeof r === "object" && r !== null && "catch" in r && typeof r.catch === "function")
                r.catch(() => { });
        }
        catch {
            // logged by the adapter when it can; nothing else to do here
        }
    }
    countStaleResults() {
        let n = 0;
        for (const line of this.queue.lines) {
            if (typeof line !== "string" || !line.includes('"result"'))
                continue;
            try {
                if (JSON.parse(line).type === "result")
                    n++;
            }
            catch {
                // not JSON: nextEvent() files it under `stray`
            }
        }
        return n;
    }
    /** Next parsed JSON line; plain text lines are kept in `stray` for error messages. Null when the
     *  process ended, `{ type: "timeout" }` when `timeoutMs` passed first. */
    async nextEvent(timeoutMs) {
        for (;;) {
            const line = await this.queue.next(timeoutMs);
            if (line === null)
                return null;
            if (line === TIMEOUT)
                return { type: "timeout" };
            if (typeof line === "object")
                return line; // injected by inject()
            try {
                // SAFETY: this is the I/O boundary; a parsed line is treated as a CLI event and every
                // consumer branches on `type` with a logged fallback for shapes it does not know.
                return JSON.parse(line);
            }
            catch {
                this.stray = (this.stray + line + "\n").slice(-2000);
            }
        }
    }
}
//# sourceMappingURL=process.js.map