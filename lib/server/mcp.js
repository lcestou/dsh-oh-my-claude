// MCP bridge: exposes the dsh tools visible to a session's agent (subagents, jobs, skills, ...) to
// the Claude Code process of that session over MCP Streamable HTTP, so a Claude parent can fan out
// to dsh subagents and they show up under the session like any other child. Shell and file tools are
// left out: Claude Code has its own. Guarded by a per-process key that only the adapter knows.
// This is an I/O boundary: JSON-RPC bodies are decoded here.
//
// On DSH Desktop the bridge listens on its own loopback port rather than only on dsh's web server:
// Desktop wraps every web server route in a browser-access gate (403 for anything without the
// Electron renderer's capability header), which the CLI's MCP client has no way to present, so a
// bridge served only there is unreachable and Claude sees zero dsh tools. Plain `dsh web` has no
// gate and keeps the web server route alone, whose port is the one dsh was started on. The web
// server route is registered either way, and is the fallback when the listener cannot start.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { readBody } from "./sessions.js";
import { errorText } from "./process.js";
import { asSessionId } from "./dsh.js";
/** HTTP endpoint path for the MCP bridge handler. */
export const MCP_PATH = "/dsh-oh-my-claude/mcp";
/** HTTP header name for the MCP bridge authentication key. */
export const KEY_HEADER = "x-dsh-oh-my-claude-key";
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 1024 * 1024;
/** dsh tools Claude Code already has natively; proxying them would only confuse the model.
 *  `str_replace_editor` is the file editor some presets offer in place of `edit`. */
export const HIDDEN = new Set([
    "read",
    "write",
    "edit",
    "multi_edit",
    "str_replace_editor",
    "glob",
    "grep",
    "ls",
    "run_code",
]);
/** The dsh tools the bridge offers `agent`: what dsh shows that agent, minus the ones Claude Code
 *  has natively. `open_session` is the bridge's own and is added by the callers that offer it. */
const bridgedSchemas = (tools, agent) => tools.schemas(agent).filter((t) => !HIDDEN.has(t.name));
/** Bridge-only tool: a new top-level dsh session (sidebar row), not a child of the caller. */
const OPEN_SESSION = {
    name: "open_session",
    description: "Start a new top-level dsh session in a workspace and send it a first prompt. It appears in the sidebar as its own session, not under this one, and runs independently; nothing comes back here. Omit provider and model for the dsh default. Returns the new session id.",
    parameters: {
        type: "object",
        properties: {
            prompt: { type: "string", description: "The complete first message for the new session." },
            workspaceId: {
                type: "string",
                description: "Workspace id to open it in. Default: the workspace of this session.",
            },
            provider: { type: "string", description: "LLM provider id, e.g. claude-code." },
            model: { type: "string", description: "Model id for that provider." },
            agentPreset: { type: "string", description: "Agent preset id. Default: the dsh default." },
        },
        required: ["prompt"],
    },
};
/** The value when it is a string, else undefined; never a coerced value. */
const str = (v) => typeof v === "string" ? v : undefined;
/**
 * Creates and initializes a new top-level dsh session with an initial prompt.
 * Used by the MCP bridge to fan out sessions from Claude Code to dsh.
 */
async function openSession(ctx, agent, args, signal) {
    const sessionOf = agent.session;
    const cwd = sessionOf?.header?.cwd ?? (sessionOf ? ctx.sessions.get(sessionOf.id)?.header?.cwd : undefined);
    const workspaceId = str(args.workspaceId) ?? ctx.workspaceRegistry.list().find((w) => w.path === cwd)?.id;
    const agentPreset = str(args.agentPreset);
    const create = workspaceId
        ? { workspaceId }
        : { cwd };
    if (agentPreset)
        create.agentPreset = agentPreset;
    const { sessionId } = await ctx.sessionController.create(create);
    const provider = str(args.provider);
    const model = str(args.model);
    if (provider && model) {
        const child = ctx.agents.get(sessionId);
        ctx.sessionController.agents.selectForNextRequest(child, { provider, model });
    }
    await ctx.sessionController.prompt({
        sessionId,
        requestId: randomUUID(),
        // Required from dsh 0.1.7: a prompt says whether it queues behind the running turn or
        // steers into it. A fresh child session has no turn to steer, so it queues.
        mode: "queue",
        content: [{ type: "text", text: String(args.prompt) }],
    }, signal);
    return `opened session ${sessionId}${workspaceId ? ` in workspace ${workspaceId}` : ` at ${cwd}`}`;
}
/** Text of a tool's rendered output: text blocks read as text, anything else as JSON. */
const textOf = (blocks) => (Array.isArray(blocks) ? blocks : [blocks])
    .map((b) => b && typeof b === "object" && !Array.isArray(b) && typeof b.text === "string"
    ? b.text
    : JSON.stringify(b))
    .join("\n");
/** The JSON-RPC reply for a failed call: a result with `isError` set and the error's text, under
 *  the request's own id. */
const errorReply = (id, e) => ({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: errorText(e) }], isError: true },
});
/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export async function handleRpc(msg, { tools, agent, signal, version, open, relay, log }) {
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    const failed = (e) => {
        const stack = e instanceof Error ? (e.stack ?? e.message) : String(e);
        log?.("warn", `mcp bridge: ${str(msg.params?.name) ?? msg.method} failed: ${stack}`);
        return errorReply(msg.id, stack);
    };
    if (msg.id === undefined)
        return null;
    switch (msg.method) {
        case "initialize":
            return reply({
                protocolVersion: str(msg.params?.protocolVersion) ?? PROTOCOL,
                capabilities: { tools: {} },
                serverInfo: { name: "dsh", version },
            });
        case "ping":
            return reply({});
        case "tools/list":
            return reply({
                tools: bridgedSchemas(tools, agent)
                    // readOnlyHint is what Claude Code keys concurrency on: without it every MCP call runs
                    // one after another, so parallel subagents would serialize. dsh's own permission
                    // presets still govern what a child may do.
                    .map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.parameters,
                    annotations: { readOnlyHint: true },
                }))
                    .concat(open
                    ? [
                        {
                            name: OPEN_SESSION.name,
                            description: OPEN_SESSION.description,
                            inputSchema: OPEN_SESSION.parameters,
                            annotations: { readOnlyHint: true },
                        },
                    ]
                    : []),
            });
        case "tools/call": {
            const name = str(msg.params?.name) ?? "";
            const rawArgs = msg.params?.arguments;
            const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
            if (name === OPEN_SESSION.name && open) {
                try {
                    return reply({ content: [{ type: "text", text: await open(args) }] });
                }
                catch (e) {
                    return failed(e);
                }
            }
            const tool = HIDDEN.has(name) ? undefined : tools.get(name, agent);
            if (!tool)
                return errorReply(msg.id, `unknown tool ${name}`);
            try {
                // A live Claude turn takes the call first: dsh then runs the tool itself and renders it
                // natively (subagent cards, counts, notices). Otherwise execute it here.
                const relayed = relay ? await relay(name, args, signal) : undefined;
                if (relayed) {
                    const result = {
                        content: [{ type: "text", text: relayed.text }],
                    };
                    if (relayed.isError)
                        result.isError = true;
                    return reply(result);
                }
                const exec = { agent, signal, name, arguments: args, callId: randomUUID() };
                const returned = await tool.execute(args, exec);
                const rendered = tool.output?.render ? tool.output.render(args, returned) : returned;
                return reply({ content: [{ type: "text", text: textOf(rendered) }] });
            }
            catch (e) {
                return failed(e);
            }
        }
        default:
            return {
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: `unknown method ${msg.method}` },
            };
    }
}
/** Write a JSON response. An undefined value ends with an empty body rather than the text
 *  `null`. */
const send = (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(value === undefined ? "" : JSON.stringify(value));
};
/** The bridge key outlives a plugin hot reload: running Claude processes were spawned with it. */
const KEY_REGISTRY = Symbol.for("dsh-oh-my-claude.mcpKey");
/** A JSON-RPC body is any JSON object; the bridge reads three fields off it. */
const asRpc = (body) => ({
    jsonrpc: str(body.jsonrpc),
    id: body.id,
    method: str(body.method),
    params: body.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? body.params
        : undefined,
});
/**
 * The bridge key: the file's contents when they are a valid key, else a fresh key written to the
 * file, so the key survives a restart.
 */
function stableKey(file) {
    try {
        const k = readFileSync(file, "utf8").trim();
        if (/^[0-9a-f-]{36}$/.test(k))
            return k;
    }
    catch { }
    const k = randomUUID();
    try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, k, { mode: 0o600 });
    }
    catch { }
    return k;
}
/** The loopback port remembered from the previous mount, else undefined. */
function readPortFile(file) {
    try {
        const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
        if (Number.isInteger(n) && n > 0 && n <= 65535)
            return n;
    }
    catch { }
    return undefined;
}
/** Remember the loopback port for the next mount; failures only lose the reuse, never the mount. */
function writePortFile(file, port) {
    try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${port}\n`);
    }
    catch { }
}
/** One listen attempt against 127.0.0.1. */
function listenOnce(handler, port) {
    return new Promise((resolve, reject) => {
        const server = createServer(handler);
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            resolve(server);
        });
    });
}
/**
 * The bridge's own listener on 127.0.0.1. The remembered port is tried first so a restart rebinds
 * the same port; when it is taken (a previous generation still holds it, or anything else does),
 * an ephemeral port is taken instead and remembered. Resolves undefined when nothing listens, in
 * which case the caller falls back to the dsh web server route.
 */
async function startLoopback(log, handler, portFile) {
    const wanted = portFile ? readPortFile(portFile) : undefined;
    const attempts = wanted === undefined ? [0] : [wanted, 0];
    for (const port of attempts) {
        try {
            const server = await listenOnce(handler, port);
            // SAFETY: a TCP listener bound to 127.0.0.1 reports AddressInfo; string is Unix sockets only
            const address = server.address();
            const actual = typeof address === "object" && address !== null ? address.port : undefined;
            if (actual === undefined) {
                server.close();
                continue;
            }
            if (portFile)
                writePortFile(portFile, actual);
            server.on("error", (e) => log("warn", `mcp bridge loopback: ${errorText(e)}`));
            return { url: `http://127.0.0.1:${actual}`, close: () => server.close() };
        }
        catch (e) {
            log("warn", `mcp bridge: loopback listen on ${port === 0 ? "an ephemeral port" : `port ${port}`} failed: ${errorText(e)}`);
        }
    }
    return undefined;
}
/** Wires the MCP bridge up once the required services are injected, and keeps the bridge key
 *  stable across dsh restarts so a keeper-mode claude that outlived dsh still authenticates.
 *  Under DSH Desktop, new Claude processes are pointed at the bridge's own loopback listener,
 *  which answers on 127.0.0.1 regardless of the browser-access gate Desktop puts on web server
 *  routes. Everywhere else they get the web server route as before, and no listener is started:
 *  a process that outlives a restart can only reconnect to the URL it was started with, and the
 *  web port is the one address that is fixed by configuration. */
export function registerMcpBridge(ctx, { log, version, relay, keyFile, portFile }) {
    // SAFETY: the key symbol is this plugin's own key on globalThis, typed here once
    const g = globalThis;
    // A key file keeps the bridge key stable across dsh restarts, so a Claude process that outlived
    // dsh (keeper mode) still authenticates against the new bridge.
    const key = (g[KEY_REGISTRY] ??= keyFile ? stableKey(keyFile) : randomUUID());
    const loopPortFile = portFile === null
        ? undefined
        : (portFile ?? (keyFile ? join(dirname(keyFile), "mcp-port") : undefined));
    return new Promise((resolve, reject) => {
        ctx.inject?.(["webServer", "tools", "agents", "sessions", "sessionController", "workspaceRegistry"], 
        // The body runs async (the loopback listen) but inject takes a sync callback.
        (host) => void (async () => {
            const { webServer, tools, agents, sessions, sessionController, workspaceRegistry } = host;
            if (!webServer || !tools || !sessionController)
                return;
            const openHost = { sessions, workspaceRegistry, sessionController, agents };
            const serve = async (req, res) => {
                if (req.headers[KEY_HEADER] !== key)
                    return send(res, 403, { error: "forbidden" });
                if (req.method !== "POST")
                    return send(res, 405, { error: "POST only" });
                const sessionId = decodeURIComponent((req.url ?? "").slice(MCP_PATH.length + 1).split("?")[0] ?? "");
                const agent = agents.get(asSessionId(sessionId));
                if (!agent)
                    return send(res, 404, { error: `no live agent for session ${sessionId}` });
                const controller = new AbortController();
                // Node fires the request's own "close" once the body is consumed; the response's
                // fires when the client actually goes away.
                res.on("close", () => {
                    if (!res.writableFinished)
                        controller.abort();
                });
                try {
                    const msg = asRpc(await readBody(req, BODY_LIMIT));
                    const out = await handleRpc(msg, {
                        tools,
                        agent,
                        signal: controller.signal,
                        version,
                        open: (args) => openSession(openHost, agent, args, controller.signal),
                        relay: relay
                            ? (name, args, signal) => relay(sessionId, name, args, signal)
                            : undefined,
                        log,
                    });
                    return out === null ? send(res, 202) : send(res, 200, out);
                }
                catch (e) {
                    log("warn", `mcp bridge: ${errorText(e)}`);
                    return send(res, 400, { error: errorText(e) });
                }
            };
            // Desktop provides this service from its launcher, before any profile plugin loads, and
            // gates on it per request; its presence is the gate. Read by name so a host without it
            // (every plain `dsh web`) answers undefined and runs exactly the path it always has.
            const gated = host.get?.("desktopBrowserAccess") !== undefined;
            // The loopback listener is what new Claude processes get there: it answers on 127.0.0.1
            // no matter what gate sits on the web server routes.
            const loopback = gated
                ? await startLoopback(log, (req, res) => {
                    serve(req, res).catch((e) => log("warn", `mcp bridge loopback: ${errorText(e)}`));
                }, loopPortFile)
                : undefined;
            if (loopback)
                log("info", `mcp bridge: loopback listener on ${loopback.url}`);
            else if (gated)
                log("warn", "mcp bridge: no loopback listener, falling back to the web server route");
            // The listen above is awaited, so the scope may be gone by now (a reload mid-mount). An
            // effect that cannot register would leave the listener holding the port with no owner.
            try {
                host.effect?.(() => {
                    const off = webServer.register({ kind: "prefix", path: MCP_PATH, handler: serve });
                    return () => {
                        loopback?.close();
                        if (typeof off === "function")
                            off();
                    };
                });
            }
            catch (e) {
                // Rejecting hands the caller its "bridge unavailable" path instead of a promise that
                // never settles.
                loopback?.close();
                reject(e instanceof Error ? e : new Error(errorText(e)));
                return;
            }
            resolve({
                base: loopback?.url ?? `http://127.0.0.1:${webServer.port}`,
                via: loopback ? "loopback" : "webserver",
                key,
                toolsFor: (sessionId) => {
                    try {
                        const agent = agents.get(asSessionId(sessionId));
                        return agent ? [...bridgedSchemas(tools, agent), OPEN_SESSION] : undefined;
                    }
                    catch {
                        return undefined;
                    }
                },
            });
        })());
    });
}
//# sourceMappingURL=mcp.js.map