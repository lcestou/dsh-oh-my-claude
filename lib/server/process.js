// One long-lived `claude -p --input-format stream-json` process per dsh session, plus the control
// channel the Agent SDK uses over the same stream: `control_request` lines from the CLI (permission
// prompts, user questions) answered with `control_response` lines on stdin.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { STATE_DIR } from "./state.js";
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
 *  the caller passes. CHILD_ENV beats the inherited value on purpose. An `MCP_TOOL_TIMEOUT` that
 *  happens to be in dsh's environment would otherwise cut relayed dsh tools short in one spawn mode
 *  and not the other. A caller that means to override still wins, which is the escape hatch. */
export function childEnv(base, override) {
    const env = {};
    for (const [k, v] of Object.entries(base))
        if (v !== undefined)
            env[k] = v;
    if (process.platform !== "win32")
        env.PATH = withClaudeDirs(env.PATH);
    Object.assign(env, CHILD_ENV, override ?? {});
    return env;
}
/** Where Claude Code's installers put `claude` (the native installer, the old local install, Homebrew,
 *  npm and bun globals, Volta). An app started from the macOS Dock or Finder, DSH Desktop among
 *  them, gets a PATH of `/usr/bin:/bin:/usr/sbin:/sbin`, which holds none of these. */
export function claudeDirs(home = homedir()) {
    return [
        join(home, ".local", "bin"),
        join(home, ".claude", "local"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        join(home, ".npm-global", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".volta", "bin"),
    ];
}
/** `path` with every folder from `dirs` it lacks appended, so a name found on the caller's PATH
 *  keeps winning. Appending also lets an npm-installed `claude`, a `#!/usr/bin/env node` script,
 *  find the node that sits beside it. */
export function withClaudeDirs(path, dirs = claudeDirs()) {
    const have = (path ?? "").split(delimiter).filter(Boolean);
    return [...have, ...dirs.filter((d) => !have.includes(d))].join(delimiter);
}
/** The absolute path of `command` when it is a bare name found on `path` or in `dirs`, else
 *  `command` unchanged: a path is trusted as given, and a name found nowhere is left for spawn to
 *  fail on with the usual ENOENT. On Windows a bare name also matches `<name>.exe`. */
export function resolveCommand(command, path = process.env.PATH, dirs = claudeDirs(), exists = existsSync, platform = process.platform) {
    if (!command || command.includes("/") || command.includes(sep))
        return command;
    const names = platform === "win32" ? [command, `${command}.exe`] : [command];
    for (const dir of [...(path ?? "").split(delimiter).filter(Boolean), ...dirs])
        for (const name of names)
            if (exists(join(dir, name)))
                return join(dir, name);
    return command;
}
/**
 * Node's own spawn, shaped like a dsh `SubprocessHandle` so the process code has one shape to
 * talk to: `stdin`/`stdout`/`stderr` streams, `done` resolving with the exit code, `terminate()`.
 * `envOverride` is merged last so configured values win over the parent's environment.
 */
export function nodeSpawner(command, args, cwd, envOverride) {
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
            // `error` with no listener throws. A `claude` that is not on PATH would take the whole dsh
            // host down with it, every session, not just this one. It reads as an exit here instead.
            child.on("error", (e) => resolve({ exitCode: -1, signal: e.message }));
            child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
        }),
        // SIGTERM, then SIGKILL if it is still there. A claude inside an uninterruptible tool, or one
        // whose own child holds the process group, ignores the first and would otherwise outlive the
        // session that owned it: an orphan holding the session file and the MCP connections, invisible
        // to the panel. `unref` so the escalation never keeps this process alive on its own.
        terminate: () => {
            child.kill();
            setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null)
                    child.kill("SIGKILL");
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
export const seamSpawner = (subprocess) => (command, args, cwd, envOverride) => subprocess.spawn({
    argv: [command, ...args],
    cwd,
    env: { ...CHILD_ENV, ...envOverride },
    graceMs: 5000,
    stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
});
/** POSIX single-quote a string for a remote shell: wrap in `'...'`, escaping any embedded quote. */
export function shq(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
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
export function sshArgs(host, script) {
    if (!isSshHost(host))
        throw new Error(`not an ssh host: ${JSON.stringify(host.slice(0, 80))}`);
    return [...SSH_OPTS, "--", host, script];
}
/** A destination ssh can be given safely: `host`, `user@host` or `user@host:port`-free forms,
 *  and never anything ssh would read as an option or that carries whitespace or a control. */
export function isSshHost(host) {
    return host.length > 0 && host.length <= 253 && !host.startsWith("-") && !/[\s\0]/.test(host);
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
export function controlSocketDir(runtime, state, make) {
    const candidates = runtime === undefined ? [join(state, "ssh")] : [join(runtime, "omc-ssh"), join(state, "ssh")];
    for (const dir of candidates) {
        if (dir.length + 1 + CONTROL_NAME > SOCKET_PATH_MAX)
            continue;
        try {
            make(dir);
            return dir;
        }
        catch {
            // Unwritable: try the next one, and share nothing rather than fail every ssh.
        }
    }
    return undefined;
}
const SSH_CONTROL_DIR = controlSocketDir(process.env.XDG_RUNTIME_DIR, STATE_DIR, (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 }));
/**
 * The options every ssh in this plugin carries.
 *
 * BatchMode: key auth only, so a missing key or unknown host fails fast instead of hanging on a
 * prompt. ConnectTimeout bounds the handshake.
 *
 * ControlMaster shares one connection between all of them. Opening the panel on a box costs about
 * 33 remote reads. The CLAUDE.md walk alone is 25 of them, one probe per ancestor directory.
 * Without multiplexing each pays a full TCP connect, key exchange and auth: seconds of dead panel
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
export function sshInvocation(host, command, args, cwd, token) {
    // A fresh per-box token from `claude setup-token` is delivered as CLAUDE_CODE_OAUTH_TOKEN, not a
    // stored login, so it must be handed to the far claude at spawn. ponytail: it rides in the remote
    // env argv like the rest of CHILD_ENV, so it shows in the box's own `ps`; acceptable on a
    // single-user box, tighten with a remote env file if a box is shared.
    const envPairs = Object.entries(CHILD_ENV);
    if (token)
        envPairs.push(["CLAUDE_CODE_OAUTH_TOKEN", token]);
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
export const sshSpawner = (host, resolveCwd = (c) => c, token) => (command, args, cwd) => {
    const inv = sshInvocation(host, command, args, resolveCwd(cwd), token);
    return nodeSpawner(inv.command, inv.args, ".");
};
/** stdin line for one user turn. `session_id` empty and `parent_tool_use_id` null match what the SDK
 *  writes. `uuid` names the line for a later `cancel_async_message`; the CLI keeps it as the message's id. */
export function userTurnLine(content, uuid) {
    // Built in order, not spread: the key order is the byte order of the line, and the line without a
    // uuid must stay what it was before the steer card.
    const line = { type: "user" };
    if (uuid)
        line.uuid = uuid;
    line.session_id = "";
    line.message = { role: "user", content };
    line.parent_tool_use_id = null;
    return `${JSON.stringify(line)}\n`;
}
/** stdin line answering one of the CLI's control requests with a result. */
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
/** Whether a `cancel_async_message` reply says the CLI gave the message back. False for anything
 *  else, including a reply shape a newer CLI changed, so a doubt reads as "already sent". */
export function decodeCancelled(v) {
    return isRecord(v) && v.cancelled === true;
}
/** A `rewind_conversation` answer, keeping only the fields the panel shows. */
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
/**
 * A running total read as one turn's own share: the rise since the previous result, or the whole
 * figure when the total started over. `total_cost_usd` and `duration_api_ms` climb for the life of
 * a CLI process, and a new process, a resume or a mid-session `/clear` starts them
 * again from zero, which arrives here as a figure below the last one. Each result carries the
 * running total so far, so read the latest result rather than summing across results.
 */
export const turnDelta = (total, soFar) => total >= soFar ? total - soFar : Math.max(0, total);
const ROW_KINDS = ["used", "free", "buffer", "deferred"];
/** Decodes a `get_context_usage` answer, returning an all-zero report when the payload is missing
 *  or not an object rather than throwing. */
export function decodeContextUsage(v) {
    const r = typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
    const categories = [];
    if (Array.isArray(r.categories))
        for (const c of r.categories) {
            if (typeof c !== "object" || c === null || Array.isArray(c))
                continue;
            if (typeof c.name !== "string" || typeof c.tokens !== "number")
                continue;
            const row = {
                name: c.name,
                tokens: c.tokens,
                deferred: c.isDeferred === true,
            };
            const kind = ROW_KINDS.find((k) => k === c.kind);
            if (kind)
                row.kind = kind;
            categories.push(row);
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
/** True only for a non-null, non-array object, so a decoded CLI answer can be read by key without a
 *  guard on every field. */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** Return the number as-is, or 0 when the CLI omitted or mis-typed the field, so a missing count
 *  reads as zero rather than NaN. */
const num = (x) => (typeof x === "number" ? x : 0);
/** A `get_workspace_diff` answer as totals, per-file counts and hunks, skipping malformed entries. */
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
/** A `list_permission_rules` answer as rules, workspace directories and a managed-only flag,
 *  skipping malformed entries. */
export function decodePermissionRules(v) {
    const outer = isRecord(v) ? v : {};
    const state = isRecord(outer.state) ? outer.state : {};
    const rules = [];
    if (Array.isArray(state.rules))
        for (const r of state.rules) {
            if (!isRecord(r))
                continue;
            const behavior = typeof r.behavior === "string" ? r.behavior : "";
            const source = typeof r.source === "string" ? r.source : "";
            const rule = typeof r.rule === "string" ? r.rule : "";
            const desc = isRecord(r.description) ? r.description : {};
            const prefix = typeof desc.prefix === "string" ? desc.prefix : undefined;
            const emphasis = typeof desc.emphasis === "string" ? desc.emphasis : undefined;
            const text = prefix !== undefined && emphasis !== undefined ? `${prefix} ${emphasis}` : rule;
            rules.push({ behavior, source, rule, text });
        }
    const directories = [];
    if (Array.isArray(state.workspaceDirectories))
        for (const d of state.workspaceDirectories) {
            if (!isRecord(d) || typeof d.path !== "string")
                continue;
            const source = typeof d.source === "string" ? d.source : "";
            directories.push({ path: d.path, source });
        }
    return {
        rules,
        directories,
        managedOnly: state.managedOnly === true,
    };
}
/** A `get_hooks_listing` answer as per-hook rows, skipping malformed entries. */
export function decodeHooksListing(v) {
    const outer = isRecord(v) ? v : {};
    const hooks = [];
    if (Array.isArray(outer.hooks))
        for (const h of outer.hooks) {
            if (!isRecord(h) || typeof h.event !== "string")
                continue;
            const event = h.event;
            const matcher = typeof h.matcher === "string" ? h.matcher : "";
            const source = typeof h.sourceLabel === "string"
                ? h.sourceLabel
                : typeof h.source === "string"
                    ? h.source
                    : "";
            const text = typeof h.displayText === "string" && h.displayText.length > 0
                ? h.displayText
                : typeof h.commandText === "string"
                    ? h.commandText
                    : "";
            hooks.push({ event, matcher, source, text });
        }
    return { hooks };
}
/** An `mcp_status` answer as one row per server, with its own error kept when it is not connected. */
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
            // SAFETY: defensive typeof checks match I/O boundary style; keep error or message if present
            if (typeof m.error === "string") {
                entry.error = m.error;
            }
            else if (typeof m.message === "string") {
                entry.error = m.message;
            }
            out.push(entry);
        }
    return out;
}
/** The sign-in page from an `mcp_authenticate` reply, or undefined when the reply does not carry
 *  one. Probed against 2.1.278 on 2026-09-20. */
export function mcpAuthUrl(v) {
    const r = isRecord(v) ? v : {};
    return typeof r.authUrl === "string" && r.authUrl !== "" ? r.authUrl : undefined;
}
/** True when the CLI answered success with nothing for the person to do: the server's token is
 *  still good, so there is no page to open. Distinguishing this from a failure matters, because the
 *  panel would otherwise tell someone their login failed when they are already signed in. */
export function mcpAuthNeedsNothing(v) {
    const r = isRecord(v) ? v : {};
    return r.requiresUserAction === false;
}
/** A `list_models` answer: what `claude --model` accepts for this login, aliases included. */
export function decodeCliModels(v) {
    const r = isRecord(v) ? v : {};
    const out = [];
    if (Array.isArray(r.models))
        for (const m of r.models) {
            if (!isRecord(m) || typeof m.value !== "string")
                continue;
            const row = {
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
                        : []).filter((e) => typeof e === "string"),
            };
            if (typeof m.description === "string")
                row.description = m.description;
            out.push(row);
        }
    return out;
}
/** Pull a schema's top-level properties out of an MCP elicitation request, or undefined when it has
 *  no usable properties or more than 20. */
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
/**
 * A `result` line that arrived while no turn was reading, and that is worth a wake: a completed
 * reply. An error result is not: on a rate limit the CLI retries on its own and emits one error
 * result per attempt, and waking on each opened a rejected turn every 73 s until the limit reset
 * (2026-09-06 22:51 to 23:00, eight turns).
 */
export function isIdleReply(line) {
    try {
        const parsed = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null)
            return false;
        // SAFETY: a non-null object; each field is compared to a literal, never trusted as typed
        const r = parsed;
        return r.type === "result" && r.is_error !== true && r.subtype !== "error_during_execution";
    }
    catch {
        return false; // not JSON: nextEvent() files it under `stray`
    }
}
/** stdin line for any control request this plugin sends; the CLI answers with a `control_response`. */
export function controlRequestLine(requestId, request) {
    return `${JSON.stringify({ type: "control_request", request_id: requestId, request })}\n`;
}
/** stdin line answering one of the CLI's control requests with a failure. */
export function controlErrorLine(requestId, error) {
    return `${JSON.stringify({ type: "control_response", response: { subtype: "error", request_id: requestId, error } })}\n`;
}
/** Lets a tool call run, with the input dsh approved, which may differ from the one asked for. */
export const allowResult = (toolUseId, input) => ({
    behavior: "allow",
    updatedInput: input,
    toolUseID: toolUseId,
    decisionClassification: "user_temporary",
});
/** Refuses a tool call and tells Claude why; the CLI reads this as the user rejecting it. */
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
    const text = [head, detail].filter(Boolean).join(": ");
    return text.length > 400 ? `${text.slice(0, 400)}…` : text || toolName;
}
/** Returned by `next(timeoutMs)` when nothing arrived in time; the waiter is withdrawn, no line is lost. */
export const TIMEOUT = Symbol("timeout");
/** Async line queue over a child's stdout: `next()` resolves with the next line, or null once the child is gone. */
export class LineQueue {
    lines;
    waiters;
    closed;
    /** Start with no queued lines, no waiters and no close flag; every field stays empty until the
     *  first push. */
    constructor() {
        this.lines = [];
        this.waiters = [];
        this.closed = false;
    }
    /** Lines waiting with no turn reading them. */
    get size() {
        return this.lines.length;
    }
    /** Hand a line to the earliest waiter if one is waiting, else buffer it, so a line never arrives
     *  before its reader. */
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
    /** Mark the queue closed and resolve every pending waiter with null, so a stopped child's
     *  readers see the end. */
    close() {
        this.closed = true;
        for (const w of this.waiters.splice(0))
            w(null);
    }
    /** Resolve with the next queued line, a timeout after `timeoutMs` with nothing, or null once the
     *  queue is closed. */
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
/** The keeper's socket, spec and info files, all one level under the keeper's directory. */
const keeperPaths = (dir) => ({
    dir,
    sock: join(dir, "keeper.sock"),
    spec: join(dir, "spec.json"),
    info: join(dir, "keeper.json"),
});
/** The keeper record in a spawn directory, or undefined when it is missing or damaged. */
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
/** True when a pid is alive (signal 0). Only a positive pid is one process: `kill(0, …)` is the
 *  caller's own process group and `kill(-1, …)` is every process this user owns, so a record that
 *  lost its pid (a keeper whose spawn failed writes none, read back as -1) must answer "not
 *  alive" here, or the orphan kill that follows sends SIGTERM to the user's whole login session
 *  (2026-09-17: a dsh-web restart logged the owner out of the desktop). */
export const pidAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
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
/** The spawn arguments a keeper was started with, for adopting or respawning it after a restart. */
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
    /** Launch the keeper fully detached with stdio discarded, so it survives the parent that started
     *  it. */
    const detached = () => {
        const c = spawn(argv[0] ?? process.execPath, argv.slice(1), {
            detached: true,
            stdio: "ignore",
        });
        c.unref();
    };
    try {
        const started = Date.now();
        const c = spawn("systemd-run", ["--user", "--scope", "--quiet", "--collect", `--unit=${unit}`, ...argv], { detached: true, stdio: "ignore" });
        c.on("error", detached);
        // With --scope, systemd-run runs the keeper itself and lives as long as it does. One that exits
        // with an error straight away never started it: it is installed but cannot reach the user bus
        // (a container, WSL, an SSH login with no user manager, a launcher that clears the environment)
        // and printed "Failed to connect to bus". The spawn succeeded, so `error` never fires; without
        // this every turn died as "keeper did not answer" (found 2026-09-21 running dsh under Electron
        // with a cleared environment). Decided on exit, not by a probe up front, so nothing blocks.
        c.on("exit", (code) => {
            if (scopeFailed(code, Date.now() - started))
                detached();
        });
        c.unref();
    }
    catch {
        detached();
    }
}
/** Whether a `systemd-run --scope` that exited with `code` after `elapsedMs` failed to start the
 *  keeper rather than outliving it. A keeper stays up at least three seconds after its Claude dies,
 *  so a non-zero exit inside two seconds is systemd-run refusing, not the keeper ending. */
export function scopeFailed(code, elapsedMs) {
    return code !== 0 && code !== null && elapsedMs < 2000;
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
    // fileURLToPath, not `.pathname`: the pathname keeps %20 for a space and a leading slash before a
    // Windows drive letter, so the keeper script is not found under either.
    const keeperJs = fileURLToPath(new URL("./keeper.js", import.meta.url));
    launch([process.execPath, keeperJs, dir]);
    return attachKeeper(dir, 8000);
}
/**
 * A running Claude Code process bound to one dsh session. `spec` is what the process was spawned
 * with (cwd, model, effort, permission mode, session flags); a turn whose spec differs replaces it.
 */
export class ClaudeProcess {
    spec;
    /** The permission mode the CLI is running in right now: `spec.mode` at spawn, then whatever the
     *  last accepted `set_permission_mode` set. `spec.mode` stays the launch mode on purpose, since
     *  the CLI takes a live switch to bypassPermissions only from a process launched in it. */
    liveMode;
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
    /** Typed steers Claude has not read yet, by dsh message id: written to stdin during a native
     *  tool, or left in dsh's inbox during a dsh tool (`relayed`). Cleared at the park that absorbs
     *  them, at the relay result that carries them, at the turn's end and on interrupt; the steer
     *  card lists these. */
    steers = new Map();
    /** How many mid-turn messages (typed or not, and file steers waiting to park) the CLI still has to
     *  take. Holding a steer for an edit lowers it; at zero nothing is left to park on. */
    forwarded = 0;
    parked = undefined;
    /** The CLI's `dsh` MCP session belongs to a dsh that is gone (adopted after a restart) and the
     *  reconnect after adoption gave up, because dsh had no live agent for the session yet. The next
     *  turn, which implies one, asks once more before its prompt goes out. */
    bridgeStale = false;
    /** Set by the idle watchdog when it kills the process. */
    idleKilled = false;
    /** The silence it was allowed before that kill: longer while a tool call is out. */
    idleKilledAfterMs;
    /** MCP servers this process has been told to ask about, by name. The CLI holds the override in
     *  its own tool-permission context and offers no read-back, so the only record is the one kept
     *  where the override was sent from. It hangs off the process for the same reason the override
     *  does: both end when the process does, so nothing has to remember to clear it. */
    mcpAsking = new Set();
    staleResults = 0;
    /** When this turn's prompt was written, for time-to-first-token; 0 once a result has read it. */
    promptSentAt = 0;
    /** `total_cost_usd` and `duration_api_ms` as of the last result frame. Both are running totals
     *  for the life of the process, not this turn's figures, so each turn's own is the difference
     *  from here. They hang off the process because a Translator lives for one turn and the CLI's
     *  totals restart with the process. */
    costSoFar = 0;
    apiMsSoFar = 0;
    /** The model whose context window was last asked for, as `spec.model ?? ""`. A session started on
     *  the mount's default model names no model at all, so "asked" cannot be read off the bank alone. */
    windowAskedFor;
    prep;
    /** A terminal wrote turns into this session's transcript since this process last spoke, so its
     *  context is behind the file; the next prompt replaces it and resumes from the transcript. */
    staleContext = false;
    /** Sees every `control_response` line as it arrives, even between turns; true means consumed. */
    controlListener;
    /** Spawn the child Claude and feed its stdout into the line queue, noting idle completion replies
     *  so the adapter can open a dsh turn. */
    constructor({ args, cwd, spec, onExit, command = "claude", spawner = nodeSpawner, }) {
        this.spec = spec;
        this.liveMode = spec.mode;
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
    /** When the child ends, reject every relayed tool call as failed, close the queue and run the
     *  exit callback. */
    closed(code, onExit) {
        this.exitCode = code;
        this.queue.close();
        for (const r of this.relays.values())
            r.reject(new Error(`claude exited ${this.exitCode} while dsh ran its tool call`));
        this.relays.clear();
        onExit?.(this);
    }
    /** True while the child has not exited, so a write to a finished process is refused. */
    get alive() {
        return this.exitCode === undefined;
    }
    /** Write a stdin line to the child, returning false when it has exited, so a line to a dead
     *  process is not silently dropped. */
    write(line) {
        if (!this.alive)
            return false;
        this.child.stdin.write(line);
        return true;
    }
    /** Terminate the child while it is alive, so killing an already-dead process is a no-op. */
    kill() {
        if (this.alive)
            this.child.terminate();
    }
    /** Queue a synthetic event for the turn loop (the MCP bridge relaying a dsh tool call). */
    inject(event) {
        this.queue.push(event);
    }
    /** A `result` line while no turn is reading: Claude just finished a turn of its own. Tell the
     *  adapter (`onIdleResult`) so it can open a dsh turn and show the reply now. */
    noteIdleResult(line) {
        if (this.busy || !this.onIdleResult || !line.includes('"result"'))
            return;
        if (!isIdleReply(line))
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
    /** Count buffered `result` events with no turn reading them, so the loop can tell a real reply
     *  from a stale background-task completion. */
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
        // The deadline is fixed when the wait starts, not renewed per line: a child printing text that
        // is not JSON would otherwise hand this loop a fresh timeout on every line and hold a call
        // that is never going to answer open forever. A warning, a progress bar or a shell banner
        // would each do it.
        const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
        for (;;) {
            const left = deadline === undefined ? undefined : Math.max(0, deadline - Date.now());
            const line = await this.queue.next(left);
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