// Host half of "open a Claude Code session in dsh": lists the transcripts of a workspace and turns
// one into a cold dsh session whose id is the Claude session id, so the adapter resumes it as-is.
// Served under /dsh-oh-my-claude/*, guarded by dsh's own request policy (trusted host + login cookie).
// This is an I/O boundary: HTTP bodies, probe output and JSON files are decoded here.
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { readdir, readFile, writeFile, rename, copyFile, stat, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listTranscripts, readTranscript, toSessionEvents } from "./transcript.js";
import { shq, sshArgs } from "./process.js";
import { homeAt, isEnoent, readAt, writeAt } from "./remote-fs.js";
import { deleteMemory, isMemoryName, listMemory } from "./memory.js";
import { listInstructions } from "./instructions.js";
import { durableTasksPath, goalFrom, readDurableTasks, sessionTasksFrom, } from "./scheduled-tasks.js";
import { asSessionId } from "./dsh.js";
import { buildAddServer, isMcpName, scopeNeedsCwd } from "./mcp-add-remove.js";
import { deleteSshToken, readSshToken, startSshLogin, submitSshLoginCode, writeSshToken, } from "./ssh-login.js";
import { errorText } from "./process.js";
import { featureSwitches } from "./switches.js";
import { isMarketplaceSource, isPluginId, isPluginScope, pluginRoster, pluginScopeNeedsCwd, } from "./plugins.js";
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
const run = (cmd, args, env, cwd, timeout = 8000) => new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, env, cwd }, (e, out, err) => resolve(e
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
/** The provider id a box mounts under: `claude-code-<slug of name>`, so each box is an independent
 * instance with its own login, state and process registry, the way a hand-written mount would be. */
export function sshBoxProviderId(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `claude-code-${slug}`;
}
export function validateSshBoxes(input) {
    if (!Array.isArray(input))
        return { error: "ssh boxes must be an array" };
    if (input.length > MAX_BOXES)
        return { error: `at most ${MAX_BOXES} ssh boxes` };
    const boxes = [];
    const ids = new Set();
    const hosts = new Set();
    for (const raw of input) {
        const b = isJsonObject(raw) ? raw : {};
        const name = String(b.name ?? "").trim();
        const host = String(b.host ?? "").trim();
        if (!name || name.length > 40)
            return { error: "each ssh box needs a name (1-40 chars)" };
        // The name has to slug to a non-empty, unique provider id, else two boxes would collide on one
        // instance. `[user@]host[:port]` and config aliases only; no shell metacharacters near ssh.
        const id = sshBoxProviderId(name);
        if (id === "claude-code-")
            return { error: `"${name}": name needs a letter or digit` };
        if (ids.has(id))
            return { error: `"${name}": another box already uses that name` };
        if (!host || host.length > 200)
            return { error: `"${name}": host is required (1-200 chars)` };
        if (!/^[A-Za-z0-9._@:%+-]+$/.test(host))
            return { error: `"${name}": host has invalid characters` };
        if (hosts.has(host))
            return { error: `"${name}": duplicate host ${host}` };
        ids.add(id);
        hosts.add(host);
        boxes.push({ name, host });
    }
    return { boxes };
}
export async function readSshBoxes(path) {
    try {
        const v = validateSshBoxes(JSON.parse(await readFile(path, "utf8")));
        return v.boxes ?? [];
    }
    catch {
        return [];
    }
}
/** A slug safe as one path segment: lowercase alnum, other runs to one dash, bounded. */
export const slugForDir = (s) => {
    const base = s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "x";
    // Two long cwds sharing a 48-char prefix would collide onto one workspace dir; when the slug
    // was actually truncated, suffix a hash of the full string so distinct inputs stay distinct.
    if (base.length < 48)
        return base;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return `${base}-${(h >>> 0).toString(36)}`;
};
export function validateRemoteWorkspaceInput(input) {
    const b = isJsonObject(input) ? input : {};
    const name = String(b.name ?? "").trim();
    const host = String(b.host ?? "").trim();
    const remoteCwd = String(b.remoteCwd ?? "").trim();
    if (!name || name.length > 40)
        return { error: "name is required (1-40 chars)" };
    if (!host || host.length > 200 || !/^[A-Za-z0-9._@:%+-]+$/.test(host))
        return { error: "a valid ssh host is required" };
    // remoteCwd is single-quoted into a remote `cd`, so a newline or NUL is the only break-out risk;
    // require an absolute path since a quoted `~` does not expand.
    if (!remoteCwd || remoteCwd.length > 4096)
        return { error: "remote path is required" };
    if (/[\n\r\0]/.test(remoteCwd))
        return { error: "remote path has invalid characters" };
    if (!remoteCwd.startsWith("/"))
        return { error: "remote path must be absolute (start with /)" };
    return { value: { name, host, remoteCwd } };
}
export async function readRemoteWorkspaces(path) {
    try {
        const raw = JSON.parse(await readFile(path, "utf8"));
        if (!Array.isArray(raw))
            return [];
        const out = [];
        for (const r of raw) {
            const b = isJsonObject(r) ? r : {};
            const name = String(b.name ?? "");
            const host = String(b.host ?? "");
            const remoteCwd = String(b.remoteCwd ?? "");
            const p = String(b.path ?? "");
            const workspaceId = String(b.workspaceId ?? "");
            if (name && host && remoteCwd && p && workspaceId)
                out.push({ name, host, remoteCwd, path: p, workspaceId });
        }
        return out;
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
/** Per config dir: a second plugin instance has its own login, so its own answer. */
const identityCache = new Map();
export async function accountIdentity(command = "claude", configDir, sshHost = "") {
    const key = `${sshHost}\0${configDir ?? ""}`;
    const hit = identityCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000)
        return hit.value;
    // A remote box reports its own login over ssh (its own `~/.claude`); a local configDir would be
    // meaningless there, so it is never sent.
    const status = sshHost
        ? await run("ssh", sshArgs(sshHost, `${shq(command)} auth status`))
        : await run(command, ["auth", "status"], configDir ? { ...process.env, CLAUDE_CONFIG_DIR: configDir } : undefined);
    const value = { host: sshHost || hostname(), email: authFromStatus(status.out).email ?? null };
    identityCache.set(key, { at: Date.now(), value });
    return value;
}
/**
 * What the panel needs to answer "is this the right machine and account": which `claude` dsh
 * spawns, its version, the config dir it will read, and who is logged in. When `sshHost` is set the
 * instance drives Claude Code on that box, so every probe runs there over ssh and reports the remote
 * binary, version and login rather than this box's.
 */
async function runtimeStatus(configDir, command = "claude", sshHost = "") {
    const remote = (args) => run("ssh", sshArgs(sshHost, `${shq(command)} ${args.map(shq).join(" ")}`));
    const [which, version, status] = await Promise.all([
        sshHost
            ? run("ssh", sshArgs(sshHost, `command -v ${shq(command)}`))
            : run(process.platform === "win32" ? "where" : "sh", process.platform === "win32" ? [command] : ["-c", `command -v ${command}`]),
        sshHost ? remote(["--version"]) : run(command, ["--version"]),
        sshHost ? remote(["auth", "status"]) : run(command, ["auth", "status"]),
    ]);
    const out = {
        host: sshHost || hostname(),
        plugin: PLUGIN_VERSION,
        binary: which.out.trim().split(/\r?\n/)[0] || null,
        version: version.out.trim() || null,
        configDir: sshHost ? "(remote ~/.claude)" : configDir,
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
// A self-contained lister that runs on an SSH box over `node -e`: walk `~/.claude/projects`, peek the
// head of each transcript (bounded to 256 KB so only metadata crosses the wire, never a whole pasted
// image) and emit `TranscriptListItem[]` as JSON — the same shape `listTranscripts` builds locally, so
// a box's rows read like this box's. Double quotes only, so `shq` wraps it in single quotes without
// escaping. Node is present wherever `claude` runs, so no extra install; a box without it just errors.
const SSH_TRANSCRIPT_LISTER = `(function(){
const fs=require("fs"),os=require("os"),p=require("path");
const root=p.join(os.homedir(),".claude","projects");
let dirs=[];try{dirs=fs.readdirSync(root)}catch(e){process.stdout.write("[]");return}
const out=[];
for(const d of dirs){
 const dir=p.join(root,d);let names;
 try{names=fs.readdirSync(dir)}catch(e){continue}
 for(const n of names){
  const m=/^([0-9a-f-]{36})\\.jsonl$/.exec(n);if(!m)continue;
  const fp=p.join(dir,n);let st;
  try{st=fs.statSync(fp)}catch(e){continue}
  const cap=262144;const buf=Buffer.alloc(cap);let bytes=0,fd;
  try{fd=fs.openSync(fp,"r");bytes=fs.readSync(fd,buf,0,cap,0);fs.closeSync(fd)}catch(e){continue}
  const head=buf.slice(0,bytes).toString("utf8");
  let cwd,summary,title="",turns=0;
  for(const line of head.split("\\n")){
   if(!line)continue;let r;
   try{r=JSON.parse(line)}catch(e){continue}
   if(cwd===undefined&&typeof r.cwd==="string")cwd=r.cwd;
   if(r.type==="summary"&&typeof r.summary==="string")summary=r.summary;
   if(r.type!=="user"||r.isSidechain||r.isMeta)continue;
   const c=r.message&&r.message.content;let t="";
   if(typeof c==="string")t=c;
   else if(Array.isArray(c)){const a=[];for(const b of c){if(b&&b.type==="text"&&typeof b.text==="string")a.push(b.text)}t=a.join("\\n")}
   if(!t)continue;
   if(turns===0&&t.indexOf("Generate the session title")===0)break;
   turns++;
   if(!title&&!/^\\s*<(command-|local-command|system-reminder)/.test(t))
    title=(t.replace(/<system-reminder>[\\s\\S]*?<\\/system-reminder>/g,"").trim().split("\\n")[0]||"").replace(/\\s+/g," ").slice(0,120);
  }
  if(turns===0)continue;
  const item={id:m[1],title:summary||title,createdAt:st.mtimeMs,modifiedAt:st.mtimeMs,bytes:st.size,turns:turns,turnsPartial:bytes>=cap};
  if(cwd)item.cwd=cwd;
  out.push(item);
 }
}
out.sort(function(a,b){return b.modifiedAt-a.modifiedAt});
process.stdout.write(JSON.stringify(out));
})();`;
/** List an SSH box's Claude transcripts by running {@link SSH_TRANSCRIPT_LISTER} on it over ssh. */
async function sshTranscripts(host) {
    const r = await run("ssh", sshArgs(host, `node -e ${shq(SSH_TRANSCRIPT_LISTER)}`), undefined, undefined, 15000);
    if (r.error)
        return { ok: false, error: r.error };
    try {
        const parsed = JSON.parse(r.out);
        if (!Array.isArray(parsed))
            return { ok: false, error: "unexpected remote output" };
        // SAFETY: our own lister prints TranscriptListItem[]; the client re-reads each field defensively.
        return { ok: true, sessions: parsed };
    }
    catch {
        return { ok: false, error: "unparseable remote output" };
    }
}
/** Read Claude Code's settings file on the session's own box; a missing file reads as an empty object. */
async function readSettings(box, path) {
    const file = await readAt(box, path);
    return file === null
        ? { path, exists: false, text: "{}\n", mtime: 0 }
        : { path, exists: true, text: file.text, mtime: file.mtimeMs };
}
/**
 * Every settings file that exists for a cwd, highest precedence first, which is the order the
 * per-key merges in `switches.ts` and `plugins.ts` expect.
 */
async function settingsTexts(box, userPath, cwd) {
    const texts = [];
    for (const scope of SETTINGS_SCOPES) {
        const path = settingsScopePath(scope, userPath, cwd);
        if (path === undefined)
            continue;
        const file = await readSettings(box, path).catch(() => null);
        if (file?.exists === true)
            texts.push({ scope, text: file.text });
    }
    return texts;
}
/**
 * Read what settings.json says about the picker. Anything the CLI would ignore is dropped here,
 * and a file that is missing, unreadable or silent on both keys reads as undefined, so a settings
 * file someone is halfway through editing can never empty the picker.
 */
export async function readPickerSettings(path) {
    const file = await readSettings({}, path).catch(() => undefined);
    if (!file?.exists)
        return undefined;
    const { value } = parseSettingsText(file.text);
    if (!value)
        return undefined;
    const picker = value.modelPicker;
    const allowed = value.availableModels;
    if (!Array.isArray(allowed) && !isJsonObject(picker))
        return undefined;
    const out = { options: [], replaceBuiltInOptions: false };
    if (Array.isArray(allowed))
        out.availableModels = allowed.filter((m) => typeof m === "string");
    if (isJsonObject(picker)) {
        out.replaceBuiltInOptions = picker.replaceBuiltInOptions === true;
        if (Array.isArray(picker.options))
            for (const row of picker.options) {
                if (!isJsonObject(row) || typeof row.model !== "string")
                    continue;
                const option = { model: row.model };
                if (typeof row.label === "string")
                    option.label = row.label;
                out.options.push(option);
            }
    }
    return out;
}
/** Keep the previous copy as .bak, write to a temp file, rename over: never a half-written file. */
async function writeWithBackup(box, path, text) {
    // A box's file is written by the same script that reads it, backup and temp file included, so a
    // dropped connection cannot leave half a settings file behind.
    if (box.sshHost)
        return { path, backup: `${path}.bak`, mtime: await writeAt(box, path, text) };
    // A project that has never had settings has no `.claude/` yet; every other target dir exists.
    await mkdir(dirname(path), { recursive: true });
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
        if (h.origin === "subagent")
            entry.subagent = true;
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
    // Owned by id across every workspace, not just this `cwd`: an SSH-box session is stored under a
    // local placeholder cwd, not the transcript's own path, so filtering by `cwd` would miss it and
    // fall through to a local transcript read that ENOENTs (the body lives on the box). `cwd` is only
    // needed for the non-owned read below, where the transcript really is on this box's disk.
    const owned = dshSessionsFor(await ctx.sessionPersistence.list(), null, claudeIdOf, new Set(registry?.archivedSessionIds ?? [])).get(id);
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
/**
 * That box's `~/.claude`, where its user-scope CLAUDE.md and settings both live. A mount's
 * `configDir` is resolved against this PC's home, so a remote box's path has to come from its own
 * `$HOME`, which `homeAt` asks once per host.
 */
const claudeHomeOf = async (box) => box.sshHost ? `${await homeAt(box)}/.claude` : box.configDir;
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
export function registerSessionRoutes(ctx, { log, projectDir, projectsDir, startedIds, claudeIdOf, settingsPath, configDir, boxesPath, sshBoxesPath, onSshBoxes, remoteWorkspacesPath, onRemoteWorkspaces, command, sshHost, turnRecords, idle, permissionModes, thinking, rewind, contextUsage, workspaceDiff, mcp, permissionAsks, sideQuestions, persistAsides, starters, setStarter, models, reloadPlugins, continueAfterLimit, instanceFor, }) {
    /** The box a request is about: the session's own mount when it named one, else this instance. */
    const boxOf = (url) => instanceFor?.(url.searchParams.get("provider")) ?? { configDir, command, sshHost };
    /**
     * Where that box keeps the user-scope settings file. A mount's `configDir` is resolved against
     * this PC's home, so a remote box's path has to come from its own `$HOME` (asked once per host);
     * the project and local scopes hang off the session's cwd, which is already the remote path.
     */
    const userSettingsPathOf = async (box) => box.sshHost ? `${await claudeHomeOf(box)}/settings.json` : settingsPath;
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
        // Shared by the plugin-manager routes: check the scope and resolve the session's directory,
        // which is where a `project` or `local` write lands (a `user` write goes to configDir).
        const pluginScopeCwd = async (scope, session) => {
            if (!isPluginScope(scope))
                return { error: "scope is user, project or local" };
            const cwd = await sessionCwd(session, sessionPersistence);
            if (pluginScopeNeedsCwd(scope) && cwd === null)
                return { error: `${scope} scope needs a session open in a directory` };
            return { cwd: cwd ?? undefined };
        };
        // The CLI wrote the plugin change to settings; ask this session's live process to re-read it so
        // it applies now. Returns whether a live process took it — false (next spawn) when none is up.
        const applyReload = async (session) => {
            if (!reloadPlugins || typeof session !== "string")
                return false;
            return (await reloadPlugins(session)).live;
        };
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
                        const items = (await listTranscripts(projectDir(cwd), hidden))
                            .map((s) => {
                            const d = owned.get(s.id);
                            return d ? { ...s, dsh: d } : s;
                        })
                            // A dsh subagent run lives inside its parent conversation; dsh refuses to open it
                            // standalone ("subagent Sessions require their durable parent address"), so it has
                            // no working row here.
                            .filter((s) => !("dsh" in s && s.dsh?.subagent));
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
                    // Instructions: the CLAUDE.md files the CLI loads for this workspace. The list is
                    // recomputed per request and is the allowlist: a path it does not name is refused,
                    // so the browser cannot read or write a file outside the hierarchy.
                    if (url.pathname === `${ROUTE_PREFIX}/instructions` ||
                        url.pathname === `${ROUTE_PREFIX}/instructions/file`) {
                        const body = req.method === "GET" ? {} : await readBody(req);
                        const cwd = await knownCwd(url.searchParams.get("cwd") ?? body.cwd, sessionPersistence);
                        if (cwd === null)
                            return json(res, 400, {
                                error: "cwd must be a directory a dsh session is open in",
                            });
                        const box = boxOf(url);
                        const files = await listInstructions(cwd, await claudeHomeOf(box), box);
                        if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/instructions`)
                            return json(res, 200, { files });
                        const path = req.method === "GET" ? url.searchParams.get("path") : body.path;
                        const file = files.find((f) => f.path === path);
                        if (file === undefined)
                            return json(res, 400, { error: "not a loaded instructions file" });
                        if (req.method === "GET") {
                            const read = await readAt(box, file.path).catch(() => null);
                            return read === null
                                ? json(res, 404, { error: "not found" })
                                : json(res, 200, { path: file.path, text: read.text });
                        }
                        if (req.method === "PUT") {
                            if (file.kind === "Managed")
                                return json(res, 403, { error: "the managed file is read-only" });
                            if (typeof body.text !== "string")
                                return json(res, 400, { error: "text required" });
                            const written = await writeWithBackup(box, file.path, body.text);
                            log("info", `instructions ${file.path} saved (${body.text.length} chars)`);
                            return json(res, 200, written);
                        }
                        return json(res, 405, { error: "method not allowed" });
                    }
                    if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
                        const box = boxOf(url);
                        const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
                        if (req.method === "GET")
                            return json(res, 200, await readSettings(box, userPath));
                        if (req.method === "PUT") {
                            const body = await readBody(req, 1024 * 1024);
                            const text = body.text;
                            const scope = body.scope ?? "user";
                            if (!isSettingsScope(scope))
                                return json(res, 400, { error: "unknown settings scope" });
                            if (scope === "managed")
                                return json(res, 400, { error: "managed settings are read-only" });
                            const cwd = await knownCwd(body.cwd, sessionPersistence);
                            const path = settingsScopePath(scope, userPath, cwd);
                            if (path === undefined)
                                return json(res, 400, {
                                    error: "project and local settings need a directory a dsh session is open in",
                                });
                            const parsed = parseSettingsText(text);
                            if (parsed.error !== undefined)
                                return json(res, 400, { error: parsed.error });
                            const settingsText = typeof text === "string" ? text : "";
                            const written = await writeWithBackup(box, path, settingsText);
                            log("info", `${scope} settings saved (${settingsText.length} chars)`);
                            return json(res, 200, written);
                        }
                    }
                    // Every scope the CLI merges, in one payload: the editor picks which to show and
                    // works out from the rest which keys a higher-precedence file overrides.
                    if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings/scopes`) {
                        if (req.method !== "GET")
                            return json(res, 405, { error: "method not allowed" });
                        const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                        const box = boxOf(url);
                        const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
                        const scopes = [];
                        for (const scope of SETTINGS_SCOPES) {
                            const path = settingsScopePath(scope, userPath, cwd);
                            if (path === undefined)
                                continue;
                            // An unreadable managed file (root-owned, or a directory) reads as absent
                            // rather than failing the whole payload.
                            const file = await readSettings(box, path).catch(() => ({
                                path,
                                exists: false,
                                text: "{}\n",
                                mtime: 0,
                            }));
                            scopes.push({ ...file, scope, readOnly: scope === "managed" });
                        }
                        return json(res, 200, { scopes });
                    }
                    // Which plugins and marketplaces the session's settings load. Beside Instructions in
                    // the panel: same question as the CLAUDE.md list, a different set of files.
                    if (settingsPath && url.pathname === `${ROUTE_PREFIX}/plugins`) {
                        if (req.method !== "GET")
                            return json(res, 405, { error: "method not allowed" });
                        const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                        const box = boxOf(url);
                        return json(res, 200, {
                            ok: true,
                            ...pluginRoster(await settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, cwd)),
                        });
                    }
                    // Turn the roster into a manager. The CLI owns the mutation end to end (it resolves
                    // the marketplace, writes both the settings key and the install lock, and validates
                    // the plugin), the same way the MCP tab shells out per session cwd with a scope. Each
                    // write targets the scope the roster row named, then `applyReload` asks the session's
                    // live process to re-read plugins so the change applies now instead of at next spawn.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/toggle`) {
                        const body = await readBody(req);
                        if (!isPluginId(body.key))
                            return json(res, 400, { error: "plugin id required" });
                        const target = await pluginScopeCwd(body.scope, body.session);
                        if ("error" in target)
                            return json(res, 400, { error: target.error });
                        const verb = body.enable === false ? "disable" : "enable";
                        const result = await run(command || "claude", ["plugin", verb, body.key, "--scope", String(body.scope)], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, target.cwd);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `plugin ${body.key} ${verb}d (${String(body.scope)})`);
                        return json(res, 200, { ok: true, live: await applyReload(body.session) });
                    }
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/uninstall`) {
                        const body = await readBody(req);
                        if (!isPluginId(body.key))
                            return json(res, 400, { error: "plugin id required" });
                        const target = await pluginScopeCwd(body.scope, body.session);
                        if ("error" in target)
                            return json(res, 400, { error: target.error });
                        // -y is required when stdout is not a TTY, which it never is here.
                        const result = await run(command || "claude", ["plugin", "uninstall", body.key, "--scope", String(body.scope), "-y"], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, target.cwd);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `plugin ${body.key} uninstalled (${String(body.scope)})`);
                        return json(res, 200, { ok: true, live: await applyReload(body.session) });
                    }
                    // Marketplace add resolves a URL, path or GitHub repo, which can clone over the
                    // network, so it gets a longer timeout than the local settings writes.
                    if (req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/add`) {
                        const body = await readBody(req);
                        if (!isMarketplaceSource(body.source))
                            return json(res, 400, {
                                error: "a source is a URL, a path or a GitHub owner/repo",
                            });
                        const target = await pluginScopeCwd(body.scope, body.session);
                        if ("error" in target)
                            return json(res, 400, { error: target.error });
                        const result = await run(command || "claude", [
                            "plugin",
                            "marketplace",
                            "add",
                            body.source.trim(),
                            "--scope",
                            String(body.scope),
                        ], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, target.cwd, 60000);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `marketplace added (${String(body.scope)})`);
                        return json(res, 200, { ok: true, live: await applyReload(body.session) });
                    }
                    if (req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/remove`) {
                        const body = await readBody(req);
                        if (!isPluginId(body.name))
                            return json(res, 400, { error: "marketplace name required" });
                        const target = await pluginScopeCwd(body.scope, body.session);
                        if ("error" in target)
                            return json(res, 400, { error: target.error });
                        const result = await run(command || "claude", ["plugin", "marketplace", "remove", body.name, "--scope", String(body.scope)], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, target.cwd);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `marketplace ${body.name} removed (${String(body.scope)})`);
                        return json(res, 200, { ok: true, live: await applyReload(body.session) });
                    }
                    // The settings and environment that turn off something the panel offers. Its own
                    // route rather than a field on diagnostics: the shield and Rewind ask for it on
                    // every open, and diagnostics runs the binary.
                    if (settingsPath && url.pathname === `${ROUTE_PREFIX}/feature-switches`) {
                        if (req.method !== "GET")
                            return json(res, 405, { error: "method not allowed" });
                        const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                        const box = boxOf(url);
                        const texts = await settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, cwd);
                        // The child inherits dsh's environment, so dsh's is where the disable would be.
                        // An absent option means an adapter that did not pass one, so read the config
                        // default rather than reporting the feature off.
                        return json(res, 200, {
                            ok: true,
                            ...featureSwitches(texts, process.env, continueAfterLimit ?? true),
                        });
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/status`) {
                        const box = boxOf(url);
                        return json(res, 200, await runtimeStatus(box.configDir, box.command, box.sshHost));
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/models`) {
                        if (!models)
                            return json(res, 404, { error: "models not available" });
                        try {
                            const modelList = await models();
                            return json(res, 200, { models: modelList });
                        }
                        catch (e) {
                            return json(res, 500, { error: errorText(e) });
                        }
                    }
                    // Diagnostics: how this instance is running, and which of the files the CLI merges
                    // it would refuse to start on. The MCP servers and the denied calls are read from
                    // the routes that already serve them, so nothing is answered twice.
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diagnostics`) {
                        const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
                        const box = boxOf(url);
                        const runtime = await runtimeStatus(box.configDir, box.command, box.sshHost);
                        const configFiles = [];
                        const userPath = await userSettingsPathOf(box);
                        for (const scope of SETTINGS_SCOPES) {
                            const path = userPath ? settingsScopePath(scope, userPath, cwd) : undefined;
                            if (path === undefined)
                                continue;
                            // A file that cannot be read at all reads as absent, the way the scopes route
                            // treats a root-owned managed file: the payload is a report, not a failure.
                            const file = await readSettings(box, path).catch(() => null);
                            const entry = { scope, path, exists: file?.exists ?? false };
                            const parsed = file?.exists === true ? parseSettingsText(file.text) : undefined;
                            if (parsed?.error !== undefined)
                                entry.parseError = parsed.error;
                            configFiles.push(entry);
                        }
                        // `ok` is what the tab keys its render on; without it the reply reads as the
                        // failure shape and the tab draws an empty error line instead of the report.
                        return json(res, 200, { ok: true, runtime, configFiles });
                    }
                    // `claude doctor` runs a process and takes a second, so it is its own route and
                    // nothing runs it until the button is pressed.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/diagnostics/doctor`) {
                        const box = boxOf(url);
                        const bin = box.command || "claude";
                        // The doctor belongs to the box the session runs on, the same as the status probe:
                        // this PC's answer says nothing about a remote box's install.
                        return json(res, 200, box.sshHost
                            ? await run("ssh", sshArgs(box.sshHost, `${shq(bin)} doctor`))
                            : await run(bin, ["doctor"], {
                                ...process.env,
                                CLAUDE_CONFIG_DIR: box.configDir,
                            }));
                    }
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
                    // The starter card's store: a session's own opening prompt and the `default` one it
                    // falls back to. A POST with blank text clears the key, which is how the card's
                    // "forget" works.
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/starter`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        return json(res, 200, {
                            session: starters?.get(sid) ?? "",
                            fallback: starters?.get("default") ?? "",
                        });
                    }
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/starter`) {
                        const body = await readBody(req);
                        const sid = String(body.session ?? "");
                        if (!sid)
                            return json(res, 400, { error: "session required" });
                        const text = String(body.text ?? "");
                        setStarter?.(sid, text);
                        // A saved opener is also the default for the next new session; that is what makes a
                        // brand-new tab, which has no key of its own yet, show anything at all.
                        if (body.asDefault !== false)
                            setStarter?.("default", text);
                        return json(res, 200, { ok: true });
                    }
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/side-questions`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        const items = sideQuestions?.get(sid) ?? [];
                        return json(res, 200, { items });
                    }
                    // Dismiss is server-side so a closed card stays closed: a client-only hide is lost on the
                    // next remount and the entry, still in the ring, would poll back into view. It marks
                    // rather than deletes — the answer stays readable in the panel's Asides tab, which is
                    // the point of persisting asides at all; the bubble is what the user closed, not the
                    // record.
                    if (req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/side-questions/dismiss`) {
                        const body = await readBody(req);
                        const sid = String(body.session ?? "");
                        const id = String(body.id ?? "");
                        if (!sid || !id)
                            return json(res, 400, { error: "session and id required" });
                        const entry = sideQuestions?.get(sid)?.find((e) => e.id === id);
                        if (entry) {
                            entry.dismissed = true;
                            persistAsides?.(sid);
                        }
                        return json(res, 200, { ok: true });
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
                    if (mcp && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/mcp-servers`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        const reply = await mcp.status(sid);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    if (mcp &&
                        req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/mcp-servers/reconnect`) {
                        const { session, name } = await readBody(req);
                        if (typeof session !== "string" || typeof name !== "string")
                            return json(res, 400, { error: "session and name required" });
                        const reply = await mcp.reconnect(session, name);
                        return json(res, reply.ok ? 200 : 409, reply);
                    }
                    // Add a server: `claude mcp add-json`, run in the session's own directory so a
                    // `local` or `project` scope writes into the project on screen and nowhere else.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/add`) {
                        const body = await readBody(req);
                        const built = buildAddServer(body);
                        if ("error" in built)
                            return json(res, 400, { error: built.error });
                        const cwd = await sessionCwd(body.session, sessionPersistence);
                        if (scopeNeedsCwd(built.scope) && cwd === null)
                            return json(res, 400, {
                                error: `${built.scope} scope needs a session open in a directory`,
                            });
                        const result = await run(command || "claude", ["mcp", "add-json", built.name, JSON.stringify(built.json), "-s", built.scope], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, cwd ?? undefined);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `mcp server ${built.name} added (${built.scope})`);
                        return json(res, 200, { ok: true });
                    }
                    // Remove a server. Without `-s` the CLI takes it out of whichever scope has it, and
                    // the session's directory is what decides which project that is.
                    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/remove`) {
                        const body = await readBody(req);
                        if (!isMcpName(body.name))
                            return json(res, 400, { error: "name required" });
                        const cwd = await sessionCwd(body.session, sessionPersistence);
                        if (cwd === null)
                            return json(res, 400, { error: "no session open in a directory" });
                        const result = await run(command || "claude", ["mcp", "remove", body.name], { ...process.env, CLAUDE_CONFIG_DIR: configDir }, cwd);
                        if (result.error)
                            return json(res, 400, { error: result.error });
                        log("info", `mcp server ${body.name} removed`);
                        return json(res, 200, { ok: true });
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
                            const info = permissionModes.info(sid);
                            return json(res, 200, { ...info, modes: info.allowed });
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
                    if (thinking && url.pathname === `${ROUTE_PREFIX}/thinking`) {
                        if (req.method === "GET") {
                            const sid = url.searchParams.get("session");
                            if (!sid)
                                return json(res, 400, { error: "session param required" });
                            return json(res, 200, thinking.info(sid));
                        }
                        if (req.method === "PUT") {
                            const { session: sid, tokens } = await readBody(req);
                            if (typeof sid !== "string" || !sid)
                                return json(res, 400, { error: "session required" });
                            if (tokens !== null &&
                                (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0))
                                return json(res, 400, {
                                    error: "tokens must be a non-negative integer or null",
                                });
                            return json(res, 200, await thinking.set(sid, tokens));
                        }
                        return json(res, 405, { error: "method not allowed" });
                    }
                    if (url.pathname === `${ROUTE_PREFIX}/permission-asks`) {
                        if (req.method !== "GET")
                            return json(res, 405, { error: "method not allowed" });
                        const session = url.searchParams.get("session");
                        if (!session)
                            return json(res, 400, { error: "session required" });
                        return json(res, 200, { asks: permissionAsks?.get(session) ?? [] });
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
                    if (sshBoxesPath && url.pathname === `${ROUTE_PREFIX}/ssh-boxes`) {
                        if (req.method === "GET")
                            return json(res, 200, { boxes: await readSshBoxes(sshBoxesPath) });
                        if (req.method === "PUT") {
                            const v = validateSshBoxes((await readBody(req)).boxes);
                            if (v.error !== undefined)
                                return json(res, 400, { error: v.error });
                            await writeFile(sshBoxesPath, `${JSON.stringify(v.boxes, null, 2)}\n`, "utf8");
                            // Mount or withdraw the provider instances so the picker matches the saved list
                            // without a dsh restart; a mount failure is reported, the file already saved.
                            let live = true;
                            try {
                                await onSshBoxes?.(v.boxes);
                            }
                            catch (e) {
                                live = false;
                                log("warn", `ssh-boxes reconcile: ${errorText(e)}`);
                            }
                            return json(res, 200, { boxes: v.boxes, live });
                        }
                    }
                    // Probe each ssh box's `claude` over ssh so the panel shows its login without leaving.
                    if (sshBoxesPath &&
                        req.method === "GET" &&
                        url.pathname === `${ROUTE_PREFIX}/ssh-boxes/status`) {
                        const boxes = await readSshBoxes(sshBoxesPath);
                        const probed = await Promise.all(boxes.map((b) => runtimeStatus("", command, b.host)));
                        // A panel login stores a CLAUDE_CODE_OAUTH_TOKEN the plugin injects at spawn; the box's
                        // own `claude auth status` can't see it, so a stored token counts as logged in here.
                        return json(res, 200, {
                            boxes: boxes.map((b, i) => {
                                const tokenLogin = !!readSshToken(dirname(sshBoxesPath), b.host);
                                const status = tokenLogin ? { ...probed[i], loggedIn: true } : probed[i];
                                return { name: b.name, host: b.host, status };
                            }),
                        });
                    }
                    // A workspace pinned to a directory on an SSH box: dsh adopts a local placeholder, the
                    // ssh spawner runs the far claude in the real remote path (see sshSpawner).
                    if (remoteWorkspacesPath && url.pathname === `${ROUTE_PREFIX}/remote-workspaces`) {
                        if (req.method === "GET")
                            return json(res, 200, {
                                workspaces: await readRemoteWorkspaces(remoteWorkspacesPath),
                            });
                        if (req.method === "POST") {
                            if (!registry)
                                return json(res, 501, {
                                    error: "workspaceRegistry is not available on this host",
                                });
                            const v = validateRemoteWorkspaceInput(await readBody(req));
                            if (v.error !== undefined)
                                return json(res, 400, { error: v.error });
                            const { name, host: boxHost, remoteCwd } = v.value;
                            // Empty local placeholder dsh stat-checks and adopts; the far claude never sees it.
                            const base = join(dirname(remoteWorkspacesPath), "remote-workspaces");
                            const dir = join(base, `${slugForDir(boxHost)}__${slugForDir(remoteCwd)}`);
                            await mkdir(dir, { recursive: true });
                            let ws;
                            try {
                                ws = await registry.create(dir, `${name} · ${boxHost}`);
                            }
                            catch (e) {
                                return json(res, 500, { error: `create workspace: ${errorText(e)}` });
                            }
                            const existing = await readRemoteWorkspaces(remoteWorkspacesPath);
                            const entry = {
                                name,
                                host: boxHost,
                                remoteCwd,
                                path: ws.path,
                                workspaceId: ws.id,
                            };
                            const next = [...existing.filter((w) => w.path !== ws.path), entry];
                            await writeFile(remoteWorkspacesPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
                            await onRemoteWorkspaces?.(next);
                            return json(res, 200, { workspace: entry });
                        }
                        if (req.method === "DELETE") {
                            const target = String((await readBody(req)).path ?? "");
                            const existing = await readRemoteWorkspaces(remoteWorkspacesPath);
                            const entry = existing.find((w) => w.path === target);
                            if (entry) {
                                try {
                                    // SAFETY: workspaceId was returned by registry.create as a WorkspaceId and
                                    // stored verbatim; delete ignores an unknown id, so a stale value is harmless.
                                    await registry?.delete(entry.workspaceId);
                                }
                                catch (e) {
                                    log("warn", `remote-workspace delete: ${errorText(e)}`);
                                }
                                await rm(entry.path, { recursive: true, force: true }).catch(() => { });
                            }
                            const next = existing.filter((w) => w.path !== target);
                            await writeFile(remoteWorkspacesPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
                            await onRemoteWorkspaces?.(next);
                            return json(res, 200, { workspaces: next });
                        }
                    }
                    // Log an SSH box in from the panel: start relays `claude auth login` and returns the
                    // OAuth URL the box prints; code writes the pasted code back to the same process and
                    // re-probes auth status. The host must be a saved box, so this cannot ssh elsewhere.
                    if (sshBoxesPath &&
                        req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/start`) {
                        const loginHost = String((await readBody(req)).host ?? "");
                        const loginBoxes = await readSshBoxes(sshBoxesPath);
                        if (!loginBoxes.some((b) => b.host === loginHost))
                            return json(res, 400, { error: "unknown box" });
                        return json(res, 200, await startSshLogin(loginHost));
                    }
                    if (sshBoxesPath &&
                        req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/code`) {
                        const body = await readBody(req);
                        const loginHost = String(body.host ?? "");
                        const loginBoxes = await readSshBoxes(sshBoxesPath);
                        if (!loginBoxes.some((b) => b.host === loginHost))
                            return json(res, 400, { error: "unknown box" });
                        const submit = await submitSshLoginCode(loginHost, String(body.code ?? ""));
                        if (!submit.done || !submit.token)
                            return json(res, 200, { done: false, error: submit.error });
                        writeSshToken(dirname(sshBoxesPath), loginHost, submit.token);
                        return json(res, 200, { done: true, loggedIn: true });
                    }
                    // Drop a box's stored login token. Local only: the plugin forgets the token so it stops
                    // injecting it; the token stays valid on Anthropic's side until revoked in the account.
                    if (sshBoxesPath &&
                        req.method === "POST" &&
                        url.pathname === `${ROUTE_PREFIX}/ssh-boxes/login/logout`) {
                        const logoutHost = String((await readBody(req)).host ?? "");
                        const logoutBoxes = await readSshBoxes(sshBoxesPath);
                        if (!logoutBoxes.some((b) => b.host === logoutHost))
                            return json(res, 400, { error: "unknown box" });
                        deleteSshToken(dirname(sshBoxesPath), logoutHost);
                        return json(res, 200, { loggedIn: false });
                    }
                    // SSH boxes list their transcripts over ssh, not HTTP: they run `claude` on their host
                    // and their `~/.claude/projects` never reaches this box's disk. One group per box so
                    // each appears as its own filter chip alongside the HTTP boxes.
                    if (sshBoxesPath &&
                        req.method === "GET" &&
                        url.pathname === `${ROUTE_PREFIX}/boxes/ssh-sessions`) {
                        const boxes = await readSshBoxes(sshBoxesPath);
                        const listed = await Promise.all(boxes.map((b) => sshTranscripts(b.host)));
                        const owned = dshSessionsFor(await sessionPersistence.list(), null, claudeIdOf, new Set(registry?.archivedSessionIds ?? []));
                        return json(res, 200, {
                            boxes: boxes.map((b, i) => {
                                const r = listed[i];
                                // The box's provider id lets the client bind a resumed transcript to this box's
                                // model directory, so opening one runs it back on the box, not the local claude.
                                const provider = sshBoxProviderId(b.name);
                                if (!r || !r.ok)
                                    return {
                                        name: b.name,
                                        host: b.host,
                                        provider,
                                        ok: false,
                                        error: r?.error ?? "no reply",
                                    };
                                const items = r.sessions
                                    .map((s) => {
                                    const d = owned.get(s.id);
                                    return d ? { ...s, dsh: d } : s;
                                })
                                    .filter((s) => !("dsh" in s && s.dsh?.subagent));
                                return { name: b.name, host: b.host, provider, ok: true, sessions: items };
                            }),
                        });
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
                    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/scheduled-tasks`) {
                        const sid = url.searchParams.get("session");
                        if (!sid)
                            return json(res, 400, { error: "session param required" });
                        const cwd = await sessionCwd(sid, sessionPersistence);
                        if (!cwd)
                            return json(res, 404, { error: "session not found" });
                        try {
                            // The durable file and the transcript answer different halves: the file holds
                            // what survives a restart, the transcript is the only record of the rest.
                            const durable = await readDurableTasks(cwd);
                            const path = await transcriptPathFor(projectDir(cwd), sid, claudeIdOf);
                            const folded = path ? await readTranscript(path) : undefined;
                            const reply = {
                                ok: true,
                                durable,
                                session: folded ? sessionTasksFrom(folded) : [],
                                goal: folded ? goalFrom(folded) : null,
                                path: durableTasksPath(cwd),
                            };
                            return json(res, 200, reply);
                        }
                        catch (e) {
                            const reply = { ok: false, error: errorText(e) };
                            return json(res, 500, reply);
                        }
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
export const SETTINGS_SCOPES = ["managed", "local", "project", "user"];
export function isSettingsScope(value) {
    // SAFETY: the includes() call narrows nothing on its own; the signature is the narrowing.
    return SETTINGS_SCOPES.includes(value);
}
/** Where the CLI's policy layer lives on Linux; the plugin never writes it. */
const MANAGED_SETTINGS_PATH = "/etc/claude-code/managed-settings.json";
/**
 * The file a scope names. Paths are derived here and never taken from the client: the request
 * carries a scope and a directory, not a path. Project and local have no file without a
 * directory, and answer undefined so the caller can refuse the request.
 */
export function settingsScopePath(scope, userPath, cwd) {
    if (scope === "user")
        return userPath;
    if (scope === "managed")
        return MANAGED_SETTINGS_PATH;
    if (cwd === null)
        return undefined;
    return join(cwd, ".claude", scope === "local" ? "settings.local.json" : "settings.json");
}
/**
 * A directory only counts when a dsh session is open in it. Without this a browser could name
 * any directory on the box and have `.claude/settings.json` written into it.
 */
async function knownCwd(cwd, sessions) {
    if (!validCwd(cwd))
        return null;
    const headers = await sessions.list().catch(() => []);
    return headers.some((h) => h.cwd === cwd) ? cwd : null;
}
/**
 * The directory a session is open in, from dsh's own record of it. The browser names the session,
 * never the directory, so nothing it posts can point the CLI at a project it has no session in.
 */
async function sessionCwd(session, sessions) {
    if (typeof session !== "string" || !session)
        return null;
    const headers = await sessions.list().catch(() => []);
    return headers.find((h) => h.id === session)?.cwd ?? null;
}
//# sourceMappingURL=sessions.js.map