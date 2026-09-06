// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-oh-my-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
// This is an I/O boundary: HTTP bodies, probe output and JSON files are decoded here.
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { readdir, readFile, writeFile, rename, copyFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { listTranscripts, readTranscript, toSessionEvents } from "./transcript.js";
import { deleteMemory, isMemoryName, listMemory } from "./memory.js";
import { asSessionId } from "./dsh.js";
import { errorText } from "./process.js";
import { PERMISSION_MODES, isPermissionMode } from "./state.js";
const ROUTE_PREFIX = "/dsh-oh-my-claude";
const BODY_LIMIT = 64 * 1024;
const json = (res, status, value) => {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
};
const isJsonObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** Parse a JSON request body, capped at `limit` bytes. A non-object body reads as an empty object. */
export const readBody = (req, limit = BODY_LIMIT) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
        size += c.length;
        if (size <= limit)
            return chunks.push(c);
        reject(new Error("body too large"));
        req.destroy();
    });
    req.on("end", () => {
        try {
            const parsed = chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
                : {};
            resolve(isJsonObject(parsed) ? parsed : {});
        }
        catch (e) {
            reject(e);
        }
    });
    req.on("error", reject);
});
const validMemoryName = (name) => typeof name === "string" && isMemoryName(name);
const validId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
/** settings.json must be one JSON object; anything else Claude Code would reject or ignore. */
export function parseSettingsText(text) {
    if (typeof text !== "string")
        return { error: "text must be a string" };
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (e) {
        return { error: e instanceof Error ? e.message : "invalid JSON" };
    }
    if (!isJsonObject(value))
        return { error: "settings.json must be a JSON object" };
    return { value };
}
/** Output of a probe command, or "" plus the failure text so the panel can show why. */
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 8000, windowsHide: true }, (e, out, err) => resolve(e
    ? {
        out: "",
        error: String(err || e.message)
            .trim()
            .slice(0, 300),
    }
    : { out: String(out) })));
// Source runs from src/, the tsc build from lib/server/: the plugin's package.json is one or
// two levels up, so try the nearer one first and fall back to the farther.
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8").catch(() => readFile(new URL("../../package.json", import.meta.url), "utf8")));
const PLUGIN_VERSION = isJsonObject(packageJson) && typeof packageJson.version === "string" ? packageJson.version : "";
const MAX_BOXES = 20;
/**
 * The saved list of other dsh servers ("boxes"), each running this plugin with its own Claude
 * Code login. The browser hops between them; nothing is proxied. `token` is that box's dsh launch
 * token, kept so a browser without its cookie can still open it (same trick as the NPM proxy).
 */
export function validateBoxes(input) {
    if (!Array.isArray(input))
        return { error: "boxes must be an array" };
    if (input.length > MAX_BOXES)
        return { error: `at most ${MAX_BOXES} boxes` };
    const boxes = [];
    const seen = new Set();
    for (const raw of input) {
        const b = isJsonObject(raw) ? raw : {};
        const name = String(b.name ?? "").trim();
        const url = String(b.url ?? "")
            .trim()
            .replace(/\/+$/, "");
        const token = b.token === undefined || b.token === null ? "" : String(b.token).trim();
        if (!name || name.length > 40)
            return { error: "each box needs a name (1-40 chars)" };
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            return { error: `"${name}": url must be absolute http(s)` };
        }
        if (!/^https?:$/.test(parsed.protocol))
            return { error: `"${name}": url must be http(s)` };
        if (token.length > 200)
            return { error: `"${name}": token too long` };
        if (seen.has(url))
            return { error: `"${name}": duplicate url` };
        seen.add(url);
        const box = { name, url };
        if (token)
            box.token = token;
        boxes.push(box);
    }
    return { boxes };
}
async function readBoxes(path) {
    try {
        const v = validateBoxes(JSON.parse(await readFile(path, "utf8")));
        return v.boxes ?? [];
    }
    catch {
        return [];
    }
}
const cookieOf = (r) => (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
/**
 * Log into a box like a browser would (dsh's `/?token=` sets the auth cookie; an NPM-style proxy
 * redirects to that URL by itself) and read its plugin status. Never throws: the panel shows why.
 */
export async function probeBox(box, fetchImpl = fetch, path = "status", init) {
    const { url, token } = box;
    const signal = AbortSignal.timeout(path === "status" ? 6000 : 12000);
    const status = (cookie) => {
        const fetchHeaders = {};
        if (cookie)
            fetchHeaders.cookie = cookie;
        if (init?.body !== undefined)
            fetchHeaders["content-type"] = "application/json";
        const opts = { redirect: "manual", signal };
        if (Object.keys(fetchHeaders).length)
            opts.headers = fetchHeaders;
        if (init?.method !== undefined)
            opts.method = init.method;
        if (init?.body !== undefined)
            opts.body = init.body;
        return fetchImpl(`${url}/dsh-oh-my-claude/${path}`, opts);
    };
    try {
        let cookie = "";
        if (token) {
            cookie = cookieOf(await fetchImpl(`${url}/?token=${encodeURIComponent(token)}`, {
                redirect: "manual",
                signal,
            }));
        }
        let r = await status(cookie);
        if (!cookie && (r.status === 401 || (r.status >= 300 && r.status < 400))) {
            // A token-injecting proxy answers the front page with a redirect or a tiny page whose
            // only job is to navigate to /?token=…; take the token from either and log in with it.
            const front = await fetchImpl(`${url}/`, { redirect: "manual", signal });
            const hint = (front.headers.get("location") ?? "") +
                (front.status === 200 ? (await front.text()).slice(0, 4000) : "");
            const found = /[?&]token=([A-Za-z0-9_.~-]+)/.exec(hint);
            if (found) {
                cookie = cookieOf(await fetchImpl(`${url}/?token=${found[1]}`, { redirect: "manual", signal }));
                r = await status(cookie);
            }
        }
        if (r.status === 401 || r.status === 403)
            return { ok: false, error: "login required: add this box's dsh token" };
        if (r.status === 404)
            return { ok: false, error: "dsh-oh-my-claude missing or too old on this box" };
        if (!r.ok)
            return { ok: false, error: `HTTP ${r.status}` };
        // SAFETY: the body is another instance of this plugin answering the same route; the caller
        // names which route it asked and only reads the fields that route publishes
        return { ok: true, status: (await r.json()) };
    }
    catch (e) {
        const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : undefined;
        return { ok: false, error: String(cause ?? errorText(e)).slice(0, 200) };
    }
}
/** The login half of `claude auth status` output, tolerant of an older CLI printing prose. */
export function authFromStatus(text) {
    try {
        const parsed = JSON.parse(text);
        const j = isJsonObject(parsed) ? parsed : {};
        return {
            loggedIn: j.loggedIn === true,
            authMethod: typeof j.authMethod === "string" ? j.authMethod : null,
            email: typeof j.email === "string" ? j.email : null,
            projectsDirectory: typeof j.projectsDirectory === "string" ? j.projectsDirectory : null,
        };
    }
    catch {
        return { loggedIn: /logged in/i.test(text) && !/not logged in/i.test(text), authMethod: null };
    }
}
let identityCache;
export async function accountIdentity(command = "claude") {
    if (identityCache && Date.now() - identityCache.at < 10 * 60_000)
        return identityCache.value;
    const status = await run(command, ["auth", "status"]);
    const value = { host: hostname(), email: authFromStatus(status.out).email ?? null };
    identityCache = { at: Date.now(), value };
    return value;
}
/**
 * What the panel needs to answer "is this the right machine and account": which `claude` dsh
 * spawns, its version, the config dir it will read, and who is logged in. Same-box by design:
 * the plugin runs Claude Code as a child process, never over ssh.
 */
async function runtimeStatus(configDir, command = "claude") {
    const [which, version, status] = await Promise.all([
        run(process.platform === "win32" ? "where" : "sh", process.platform === "win32" ? [command] : ["-c", `command -v ${command}`]),
        run(command, ["--version"]),
        run(command, ["auth", "status"]),
    ]);
    const out = {
        host: hostname(),
        plugin: PLUGIN_VERSION,
        binary: which.out.trim().split(/\r?\n/)[0] || null,
        version: version.out.trim() || null,
        configDir,
        ...authFromStatus(status.out),
    };
    if (version.error)
        out.error = version.error;
    return out;
}
/** Every transcript under the Claude projects dir, each with the cwd its records name. */
async function listAllTranscripts(projectsDir, hidden) {
    let dirs = [];
    try {
        dirs = (await readdir(projectsDir, { withFileTypes: true }))
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
    catch {
        return [];
    }
    const lists = await Promise.all(dirs.map((name) => listTranscripts(join(projectsDir, name), hidden).catch(() => [])));
    return lists.flat();
}
const isEnoent = (e) => typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";
/** Read Claude Code's settings file; a missing file reads as an empty object. */
async function readSettings(path) {
    try {
        const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        return { path, exists: true, text, mtime: info.mtimeMs };
    }
    catch (e) {
        if (isEnoent(e))
            return { path, exists: false, text: "{}\n", mtime: 0 };
        throw e;
    }
}
/** Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file. */
async function writeSettings(path, text) {
    const backup = `${path}.bak`;
    await copyFile(path, backup).catch((e) => {
        if (!isEnoent(e))
            throw e;
    });
    const tmp = `${path}.tmp-${process.pid}`;
    await writeFile(tmp, text.endsWith("\n") ? text : `${text}\n`, "utf8");
    await rename(tmp, path);
    return { path, backup, mtime: (await stat(path)).mtimeMs };
}
/**
 * Claude transcript id → the dsh session it belongs to, for the dsh sessions of one workspace.
 * A session this plugin started keeps its Claude transcript under `claudeIdOf(dsh id)`; one opened
 * from this panel shares the id. Archived sessions are included so the panel can bring them back
 * without any archive plugin.
 */
export function dshSessionsFor(headers, cwd, claudeIdOf, archived = new Set()) {
    const map = new Map();
    for (const h of headers) {
        if (cwd !== null && h.cwd !== cwd)
            continue;
        const id = String(h.id);
        const entry = { id, archived: archived.has(id) };
        map.set(id, entry);
        map.set(claudeIdOf(id), entry);
    }
    return map;
}
const validCwd = (cwd) => typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes("\0");
/**
 * Create the dsh session for one transcript: seed with the converted history, flush to disk,
 * leave. The client then adopts it through the normal `sessions.create({ sessionId })` path,
 * which attaches it to the workspace and makes it live.
 */
const opening = new Map();
/** Same id opened twice at once (double click, two tabs) shares one creation. */
function openTranscript(ctx, projectDir, cwd, id, claudeIdOf, registry) {
    let job = opening.get(id);
    if (!job) {
        job = openTranscriptOnce(ctx, projectDir, cwd, id, claudeIdOf, registry).finally(() => opening.delete(id));
        opening.set(id, job);
    }
    return job;
}
/**
 * Loads a Claude Code transcript and creates a dsh session from it, or
 * returns the existing session if one with this id is already live.
 */
async function openTranscriptOnce(ctx, projectDir, cwd, id, claudeIdOf, registry) {
    if (ctx.sessions.get(asSessionId(id)))
        return { id, existed: true };
    const owned = dshSessionsFor(await ctx.sessionPersistence.list(), cwd, claudeIdOf, new Set(registry?.archivedSessionIds ?? [])).get(id);
    if (owned) {
        // ponytail: unarchive through the registry's own operation queue; dsh core has archiveSession
        // but no inverse, and the another plugin plugin does exactly this.
        if (owned.archived && registry?.enqueueOperation)
            await registry.enqueueOperation(async () => {
                const state = registry.requireState();
                await registry.setState({
                    ...state,
                    archivedSessionIds: state.archivedSessionIds.filter((x) => x !== owned.id),
                });
            });
        return { id: owned.id, existed: true };
    }
    const folded = await readTranscript(join(projectDir(cwd), `${id}.jsonl`));
    if (folded.turns.length === 0)
        throw new Error("transcript has no completed turn");
    const seed = toSessionEvents(folded);
    const session = ctx.sessions.prepare(asSessionId(id), {
        seed,
        meta: { cwd, createdAt: folded.createdAt },
    });
    const leave = ctx.sessions.enter(session);
    try {
        ctx.sessions.announce(session);
        await ctx.sessions.flush(session);
    }
    finally {
        leave();
    }
    return { id, existed: false, turns: folded.turns.length, events: seed.length };
}
/** The transcript file of a dsh session: under its Claude id (sessions the adapter started) or
 *  its own id (sessions restored from a transcript), whichever exists. */
async function transcriptPathFor(dir, sessionId, claudeIdOf) {
    for (const id of [claudeIdOf(sessionId), sessionId]) {
        const path = join(dir, `${id}.jsonl`);
        if (await stat(path).then(() => true, () => false))
            return path;
    }
    return undefined;
}
/** `projectDir(cwd)` → Claude Code project dir; `startedIds()` → ids the adapter started itself. */
export function registerSessionRoutes(ctx, { log, projectDir, projectsDir, startedIds, claudeIdOf, settingsPath, configDir, boxesPath, command, turnRecords, idle, permissionModes, rewind, contextUsage, workspaceDiff, mcp, }) {
    // Optional: stock dsh has it; without it archived sessions list but cannot be restored.
    let registry;
    ctx.inject?.(["workspaceRegistry"], (host) => {
        registry = host.workspaceRegistry;
    });
    ctx.inject?.(["webServer", "connection", "sessions", "sessionPersistence"], (host) => {
        const { webServer, connection, sessions, sessionPersistence } = host;
        if (!webServer || !connection || !sessionPersistence)
            return;
        const routeHost = { webServer, connection, sessions, sessionPersistence };
        host.effect?.(() => webServer.register({
            kind: "prefix",
            path: ROUTE_PREFIX,
            handler: async (req, res) => {
                const rejection = connection.requestRejection(req);
                if (rejection !== undefined)
                    return json(res, rejection, { error: "forbidden" });
                const url = new URL(req.url ?? "/", "http://dsh");
                try {
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/sessions`) {
                        const cwd = url.searchParams.get("cwd") ?? "";
                        const all = url.searchParams.get("all") === "1";
                        if (!all && !validCwd(cwd))
                            return json(res, 400, { error: "cwd must be an absolute path" });
                        if (all) {
                            const owned = dshSessionsFor(await sessionPersistence.list(), null, claudeIdOf, new Set(registry?.archivedSessionIds ?? []));
                            const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                            const items = (await listAllTranscripts(projectsDir, hidden)).map((s) => {
                                const d = owned.get(s.id);
                                return d ? { ...s, dsh: d } : s;
                            });
                            return json(res, 200, { host: hostname(), sessions: items });
                        }
                        // Transcripts of dsh sessions (started here or opened from here) are listed with
                        // their dsh id so the panel opens the existing session. Ones the adapter started
                        // for a dsh session that no longer exists are hidden.
                        const owned = dshSessionsFor(await sessionPersistence.list(), cwd, claudeIdOf, new Set(registry?.archivedSessionIds ?? []));
                        const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
                        const items = (await listTranscripts(projectDir(cwd), hidden)).map((s) => {
                            const d = owned.get(s.id);
                            return d ? { ...s, dsh: d } : s;
                        });
                        return json(res, 200, { sessions: items });
                    }
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
                        const { cwd, id } = await readBody(req);
                        if (!validCwd(cwd) || !validId(id))
                            return json(res, 400, { error: "cwd and id required" });
                        return json(res, 200, await openTranscript(routeHost, projectDir, cwd, id, claudeIdOf, registry));
                    }
                    // Claude's auto-memory for a workspace: list, read, write, delete one file.
                    if (url.pathname === `${ROUTE_PREFIX}/memory`) {
                        const body = req.method === "GET" ? {} : await readBody(req, 1024 * 1024);
                        const cwd = url.searchParams.get("cwd") ?? body.cwd;
                        if (!validCwd(cwd))
                            return json(res, 400, { error: "cwd must be an absolute path" });
                        const dir = join(projectDir(cwd), "memory");
                        const name = url.searchParams.get("name") ?? body.name;
                        if (req.method === "GET" && name === undefined)
                            return json(res, 200, { dir, files: await listMemory(dir) });
                        if (!validMemoryName(name))
                            return json(res, 400, { error: "name must be a .md file" });
                        const path = join(dir, name);
                        if (req.method === "GET") {
                            const text = await readFile(path, "utf8").catch(() => null);
                            return text === null
                                ? json(res, 404, { error: "not found" })
                                : json(res, 200, { text });
                        }
                        if (req.method === "PUT") {
                            if (typeof body.text !== "string")
                                return json(res, 400, { error: "text required" });
                            await mkdir(dir, { recursive: true });
                            await writeFile(path, body.text, "utf8");
                            log("info", `memory ${name} saved (${body.text.length} chars)`);
                            return json(res, 200, { ok: true });
                        }
                        if (req.method === "DELETE") {
                            await deleteMemory(dir, name);
                            log("info", `memory ${name} deleted`);
                            return json(res, 200, { ok: true });
                        }
                        return json(res, 405, { error: "method not allowed" });
                    }
                    if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
                        if (req.method === "GET")
                            return json(res, 200, await readSettings(settingsPath));
                        if (req.method === "PUT") {
                            const { text } = await readBody(req, 1024 * 1024);
                            const parsed = parseSettingsText(text);
                            if (parsed.error !== undefined)
                                return json(res, 400, { error: parsed.error });
                            const body = typeof text === "string" ? text : "";
                            const written = await writeSettings(settingsPath, body);
                            log("info", `settings.json saved (${body.length} chars)`);
                            return json(res, 200, written);
                        }
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/status`)
                        return json(res, 200, await runtimeStatus(configDir, command));
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/turns`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        const turns = turnRecords?.get(sid) ?? [];
                        const total = {
                            costUsd: 0,
                            durationMs: 0,
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            count: 0,
                        };
                        for (const t of turns) {
                            total.costUsd += t.costUsd;
                            total.durationMs += t.durationMs;
                            total.input += t.input;
                            total.output += t.output;
                            total.cacheRead += t.cacheRead;
                            total.cacheWrite += t.cacheWrite;
                            total.count += 1;
                        }
                        return json(res, 200, { turns, total });
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/context`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        if (!contextUsage)
                            return json(res, 404, { error: "context usage not available" });
                        const reply = await contextUsage(sid);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diff`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        if (!workspaceDiff)
                            return json(res, 404, { error: "workspace diff not available" });
                        const reply = await workspaceDiff(sid);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    if (mcp && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/mcp`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        const reply = await mcp.status(sid);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    if (mcp &&
                        req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/mcp/reconnect`) {
                        const { session, name } = await readBody(req);
                        if (typeof session !== "string" || typeof name !== "string")
                            return json(res, 400, { error: "session and name required" });
                        const reply = await mcp.reconnect(session, name);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/idle`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        if (!idle)
                            return json(res, 404, { error: "idle tracking not available" });
                        return json(res, 200, {
                            deadline: idle.deadlineFor(sid),
                            timeoutMs: idle.timeoutMs,
                        });
                    }
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/idle/extend`) {
                        const { session } = await readBody(req);
                        if (!session)
                            return json(res, 400, { error: "session param required" });
                        if (!idle)
                            return json(res, 404, { error: "idle tracking not available" });
                        const sid = typeof session === "string" ? session : "";
                        const ok = sid ? idle.extend(sid) : false;
                        return json(res, ok ? 200 : 404, ok ? { extended: true } : { error: "unknown session" });
                    }
                    // Rewind: the session's user prompts (from Claude's transcript), then the rewind itself.
                    if (rewind && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
                        const sid = url.searchParams.get("session");
                        const cwd = url.searchParams.get("cwd") ?? "";
                        if (!sid || !validCwd(cwd))
                            return json(res, 400, { error: "session and an absolute cwd required" });
                        const path = await transcriptPathFor(projectDir(cwd), sid, claudeIdOf);
                        if (!path)
                            return json(res, 200, { prompts: [] });
                        const folded = await readTranscript(path);
                        const prompts = folded.turns
                            .map((t) => ({
                            id: t.id,
                            time: t.time,
                            text: t.content
                                .map((c) => c.text)
                                .join("\n")
                                .slice(0, 200),
                        }))
                            .toReversed()
                            .slice(0, 20);
                        return json(res, 200, { prompts });
                    }
                    if (rewind && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
                        const { session: sid, uuid, dryRun } = await readBody(req);
                        if (typeof sid !== "string" || !sid || !validId(uuid))
                            return json(res, 400, { error: "session and uuid required" });
                        return json(res, 200, await rewind(sid, uuid, dryRun === true));
                    }
                    if (permissionModes && url.pathname === `${ROUTE_PREFIX}/permission-mode`) {
                        if (req.method === "GET") {
                            const sid = url.searchParams.get("session");
                            if (!sid)
                                return json(res, 400, { error: "session param required" });
                            return json(res, 200, { ...permissionModes.info(sid), modes: PERMISSION_MODES });
                        }
                        if (req.method === "PUT") {
                            const { session: sid, mode } = await readBody(req);
                            if (typeof sid !== "string" || !sid)
                                return json(res, 400, { error: "session required" });
                            if (mode !== null && (typeof mode !== "string" || !isPermissionMode(mode)))
                                return json(res, 400, {
                                    error: `mode must be one of ${PERMISSION_MODES.join(", ")} or null`,
                                });
                            return json(res, 200, await permissionModes.set(sid, mode));
                        }
                        return json(res, 405, { error: "method not allowed" });
                    }
                    if (boxesPath && url.pathname === `${ROUTE_PREFIX}/boxes`) {
                        if (req.method === "GET")
                            return json(res, 200, { boxes: await readBoxes(boxesPath) });
                        if (req.method === "PUT") {
                            const v = validateBoxes((await readBody(req)).boxes);
                            if (v.error !== undefined)
                                return json(res, 400, { error: v.error });
                            await writeFile(boxesPath, `${JSON.stringify(v.boxes, null, 2)}\n`, "utf8");
                            return json(res, 200, { boxes: v.boxes });
                        }
                    }
                    if (boxesPath &&
                        req.method === "GET" &&
                        url.pathname === `${ROUTE_PREFIX}/boxes/sessions`) {
                        const boxes = await readBoxes(boxesPath);
                        const probed = await Promise.all(boxes.map((b) => probeBox(b, fetch, "sessions?all=1")));
                        return json(res, 200, {
                            boxes: boxes.map((b, i) => {
                                const p = probed[i];
                                if (!p)
                                    return { name: b.name, url: b.url, ok: false, error: "not probed" };
                                return p.ok
                                    ? {
                                        name: b.name,
                                        url: b.url,
                                        ok: true,
                                        host: p.status.host,
                                        sessions: p.status.sessions ?? [],
                                    }
                                    : { name: b.name, url: b.url, ok: false, error: p.error };
                            }),
                        });
                    }
                    if (boxesPath &&
                        req.method === "GET" &&
                        url.pathname === `${ROUTE_PREFIX}/boxes/status`) {
                        const boxes = await readBoxes(boxesPath);
                        const probed = await Promise.all(boxes.map((b) => probeBox(b)));
                        return json(res, 200, {
                            self: { plugin: PLUGIN_VERSION, host: hostname() },
                            boxes: boxes.map((b, i) => ({ name: b.name, url: b.url, ...probed[i] })),
                        });
                    }
                    if (boxesPath && url.pathname === `${ROUTE_PREFIX}/boxes/settings`) {
                        const urlParam = url.searchParams.get("url");
                        if (!urlParam)
                            return json(res, 400, { error: "url parameter required" });
                        const boxes = await readBoxes(boxesPath);
                        const box = boxes.find((b) => b.url === urlParam);
                        if (!box)
                            return json(res, 404, { error: "unknown box" });
                        if (req.method === "GET") {
                            const p = await probeBox(box, fetch, "settings", { method: "GET" });
                            if (!p.ok)
                                return json(res, 502, { error: p.error });
                            return json(res, 200, p.status);
                        }
                        if (req.method === "PUT") {
                            const { text } = await readBody(req, 1024 * 1024);
                            const parsed = parseSettingsText(text);
                            if (parsed.error !== undefined)
                                return json(res, 400, { error: parsed.error });
                            const p = await probeBox(box, fetch, "settings", {
                                method: "PUT",
                                body: JSON.stringify({ text }),
                            });
                            if (!p.ok)
                                return json(res, 502, { error: p.error });
                            return json(res, 200, p.status);
                        }
                        return json(res, 405, { error: "method not allowed" });
                    }
                    return json(res, 404, { error: "not found" });
                }
                catch (e) {
                    log("warn", `session route failed: ${errorText(e)}`);
                    return json(res, 500, { error: errorText(e) });
                }
            },
        }), "dsh-oh-my-claude session routes");
    });
}
//# sourceMappingURL=sessions.js.map