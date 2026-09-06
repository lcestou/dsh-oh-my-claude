// Files this plugin keeps on disk, and the one Claude Code file it reads: session ids it started,
// sessions with a turn in flight, the resume trace, the aux scratch dir, and the stored OAuth
// token for the Models API. This is an I/O boundary: JSON from disk is decoded here and typed
// values leave.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
/** Claude Code's config dir: transcripts, settings.json. Honors CLAUDE_CONFIG_DIR like the CLI. */
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
/** Resolve a raw configDir value to an absolute path for this plugin instance.
 * Non-empty → expanded absolute path; empty → falls through to CLAUDE_HOME. */
export function resolveClaudeHome(dir) {
    if (!dir)
        return CLAUDE_HOME;
    const expanded = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
    return expanded.startsWith("/") ? expanded : join(process.cwd(), expanded);
}
// Session state: which Claude sessions this plugin started, so resume does not depend on guessing
// where Claude Code keeps its transcripts. A wrong guess still degrades to a fresh full-transcript run.
export const STATE_DIR = join(homedir(), ".local", "state", "dsh-oh-my-claude");
const STATE_FILE = join(STATE_DIR, "sessions.json");
/** Derive per-instance state dir from a provider id; default id uses the shared top-level path. */
export function stateDir(providerId) {
    return providerId === "claude-code" ? STATE_DIR : join(STATE_DIR, providerId);
}
/** Sessions with a turn in flight. Survives a dsh restart so those sessions can be nudged back. */
const BUSY_FILE = join(STATE_DIR, "busy.json");
/** Plugin info logs never reach dsh's web.log; the resume path keeps its own trace file. */
const RESUME_LOG = join(STATE_DIR, "resume.log");
let busyChain = Promise.resolve();
/** Append one line to the resume trace; best effort, never throws. */
export async function trace(fileOrLine, maybeLine) {
    const file = maybeLine === undefined ? RESUME_LOG : fileOrLine;
    const line = maybeLine ?? fileOrLine;
    try {
        await mkdir(dirname(file), { recursive: true });
        await appendFile(file, `${new Date().toISOString()} ${line}\n`);
    }
    catch { }
}
/** Record (or clear) that a session's turn is running; serialized read-modify-write. */
export function markBusy(id, on, path = BUSY_FILE) {
    busyChain = busyChain.then(async () => {
        let ids = [];
        try {
            ids = JSON.parse(await readFile(path, "utf8"));
        }
        catch { }
        const set = new Set(Array.isArray(ids) ? ids : []);
        if (on ? set.has(id) : !set.has(id))
            return;
        if (on)
            set.add(id);
        else
            set.delete(id);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify([...set]));
    }, () => { });
    return busyChain;
}
/** Sessions whose turn the previous dsh process left unfinished; cleared on read. */
export async function takeInterrupted(path = BUSY_FILE) {
    let ids = [];
    try {
        ids = JSON.parse(await readFile(path, "utf8"));
    }
    catch {
        return [];
    }
    await writeFile(path, "[]").catch(() => { });
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}
/** The provider of the last `model/selection` event in a session log, if any. */
export function lastSelectedProvider(events) {
    let provider;
    for (const e of events) {
        if (e.type !== "model/selection" || typeof e.data !== "object" || e.data === null)
            continue;
        // SAFETY: a non-null object; the one field read is checked for string before use
        const p = e.data.provider;
        if (typeof p === "string")
            provider = p;
    }
    return provider;
}
/** Sessions waiting for a usage limit to reset: session id to reset instant (ms since epoch). */
const LIMIT_WAITS_FILE = (dir) => join(dir, "limit-waits.json");
let limitChain = Promise.resolve();
export async function loadLimitWaits(dir) {
    const map = new Map();
    try {
        const parsed = JSON.parse(await readFile(LIMIT_WAITS_FILE(dir), "utf8"));
        if (typeof parsed === "object" && parsed !== null)
            for (const [k, v] of Object.entries(parsed))
                if (typeof v === "number")
                    map.set(k, v);
    }
    catch { }
    return map;
}
/** Record (or with `resetAt` undefined, forget) a session's wait; saves serialize. */
export function saveLimitWait(dir, sessionId, resetAt) {
    const run = limitChain.then(async () => {
        const map = await loadLimitWaits(dir);
        if (resetAt === undefined)
            map.delete(sessionId);
        else
            map.set(sessionId, resetAt);
        await mkdir(dir, { recursive: true });
        await writeFile(LIMIT_WAITS_FILE(dir), JSON.stringify(Object.fromEntries(map)));
    });
    limitChain = run.catch(() => { });
    return run;
}
const AUX_DIR = join(STATE_DIR, "aux");
let auxReady;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export const auxCwd = () => (auxReady ??= mkdir(AUX_DIR, { recursive: true }).then(() => AUX_DIR));
const startedCache = new Map(); // per-stateFile cache for known sessions
/**
 * Loads the set of Claude session IDs that this plugin has started.
 * Cached after the first call; per-instance when a state file is given.
 */
export async function loadStarted(stateFile = STATE_FILE) {
    const cached = startedCache.get(stateFile);
    if (cached)
        return cached;
    try {
        const ids = JSON.parse(await readFile(stateFile, "utf8"));
        const set = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
        startedCache.set(stateFile, set);
        return set;
    }
    catch {
        const empty = new Set();
        startedCache.set(stateFile, empty);
        return empty;
    }
}
/**
 * Records or removes a Claude session ID from the known sessions list.
 */
export async function rememberStarted(id, keep = true, stateFile = STATE_FILE) {
    const set = await loadStarted(stateFile);
    if (keep ? set.has(id) : !set.has(id))
        return;
    if (keep)
        set.add(id);
    else
        set.delete(id);
    try {
        await mkdir(dirname(stateFile), { recursive: true });
        await writeFile(stateFile, JSON.stringify([...set]));
    }
    catch {
        /* state is an optimization only */
    }
}
/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export async function authHeaders(home = CLAUDE_HOME) {
    if (process.env.ANTHROPIC_API_KEY)
        return { "x-api-key": process.env.ANTHROPIC_API_KEY };
    try {
        const raw = await readFile(join(home, ".credentials.json"), "utf8");
        const parsed = JSON.parse(raw);
        const oauth = typeof parsed === "object" && parsed !== null && "claudeAiOauth" in parsed
            ? parsed.claudeAiOauth
            : undefined;
        if (typeof oauth === "object" && oauth !== null && "accessToken" in oauth) {
            const token = oauth.accessToken;
            const expiresAt = "expiresAt" in oauth && typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0;
            if (typeof token === "string" && token && expiresAt > Date.now()) {
                return { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" };
            }
        }
    }
    catch {
        /* no stored credential */
    }
    return null;
}
/**
 * Record this boot's time in `file` and return how long ago the previous boot was, or undefined
 * when there was none (or the file is unreadable). Best effort, never throws.
 */
export async function noteBoot(file, now = Date.now()) {
    let previous;
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        if (typeof parsed === "object" &&
            parsed !== null &&
            "at" in parsed &&
            typeof parsed.at === "number")
            previous = parsed.at;
    }
    catch { }
    try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ at: now }));
    }
    catch { }
    return previous === undefined ? undefined : now - previous;
}
/**
 * True when the session log already holds a next-turn inbox message from `plugin` that no turn
 * has consumed yet (an `agent/inbox/spliced` after the last `turn/start`). dsh restores the inbox
 * from the log on resume, so nudging again would queue a duplicate notice (14 of them on
 * 2026-09-05 after a crash loop).
 */
export function hasPendingNotice(events, plugin, texts = []) {
    let pending = false;
    for (const e of events) {
        if (e.type === "turn/start") {
            pending = false;
            continue;
        }
        if (e.type !== "agent/inbox/spliced")
            continue;
        const d = e.data;
        if (typeof d !== "object" || d === null || !("inserted" in d) || !Array.isArray(d.inserted))
            continue;
        const target = "target" in d ? d.target : undefined;
        if (target !== "next-turn")
            continue;
        for (const m of d.inserted) {
            if (typeof m !== "object" || m === null)
                continue;
            const src = "source" in m ? m.source : undefined;
            if (typeof src === "object" && src !== null && "plugin" in src && src.plugin === plugin)
                pending = true;
            // Notices sent on the owner's behalf carry the user source; match them by their text.
            const content = "content" in m && Array.isArray(m.content) ? m.content : [];
            for (const block of content) {
                if (typeof block !== "object" || block === null || !("text" in block))
                    continue;
                if (typeof block.text === "string" && texts.includes(block.text))
                    pending = true;
            }
        }
    }
    return pending;
}
/** Claude Code permission modes the CLI accepts for `--permission-mode` and `set_permission_mode`. */
export const PERMISSION_MODES = [
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "dontAsk",
    "bypassPermissions",
];
export const isPermissionMode = (v) => PERMISSION_MODES.some((m) => m === v);
/** Rank by loosening: plan (strictest) through bypassPermissions (loosest). */
const PERMISSION_RANK = {
    plan: 0,
    default: 1,
    acceptEdits: 2,
    auto: 3,
    dontAsk: 3,
    bypassPermissions: 4,
};
/** Modes at or below the given ceiling, in table order. */
export const modesUpTo = (ceiling) => PERMISSION_MODES.filter((m) => PERMISSION_RANK[m] <= PERMISSION_RANK[ceiling]);
/** Per-session permission mode overrides. Keyed by dsh session id; null means unset. */
export const PERMISSION_MODES_FILE = (d) => join(d, "permission-modes.json");
let permissionModesChain = Promise.resolve();
/** Per-session turn cost records; keyed by dsh session id; value is a ring buffer of last 50. */
export const TURNS_FILE = (d) => join(d, "turns.json");
let turnsChain = Promise.resolve();
/** Load the per-session permission mode overrides from disk. */
export async function loadPermissionModes(dir) {
    const file = PERMISSION_MODES_FILE(dir);
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === "string" || v === null) {
                    map.set(k, v);
                }
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Save a session's permission mode override (or clear it with null); serialized read-modify-write. */
export function savePermissionMode(dir, sessionId, mode) {
    const run = permissionModesChain.then(async () => {
        const file = PERMISSION_MODES_FILE(dir);
        const map = await loadPermissionModes(dir);
        if (mode === null)
            map.delete(sessionId);
        else
            map.set(sessionId, mode);
        const obj = {};
        for (const [k, v] of map)
            obj[k] = v;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(obj));
    });
    // The caller sees a failed write; the chain itself carries on for the next save.
    permissionModesChain = run.catch(() => { });
    return run;
}
/** Load the per-session turn cost records from disk. Drops entries with missing or non-numeric fields; missing apiMs/turns default to 0 for backward compat. */
export async function loadTurnRecords(dir) {
    const file = TURNS_FILE(dir);
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
                if (!Array.isArray(v))
                    continue;
                const records = [];
                for (const entry of v) {
                    if (typeof entry !== "object" || entry === null)
                        continue;
                    // SAFETY: a non-null object; every field is re-checked as a number below
                    const r = entry;
                    const num = (key) => typeof r[key] === "number" ? r[key] : undefined;
                    const at = num("at");
                    const costUsd = num("costUsd");
                    const durationMs = num("durationMs");
                    const input = num("input");
                    const output = num("output");
                    const cacheRead = num("cacheRead");
                    const cacheWrite = num("cacheWrite");
                    if (at === undefined ||
                        costUsd === undefined ||
                        durationMs === undefined ||
                        input === undefined ||
                        output === undefined ||
                        cacheRead === undefined ||
                        cacheWrite === undefined)
                        continue;
                    // apiMs and turns were not always written; older files read as 0.
                    records.push({
                        at,
                        costUsd,
                        durationMs,
                        input,
                        output,
                        cacheRead,
                        cacheWrite,
                        apiMs: num("apiMs") ?? 0,
                        turns: num("turns") ?? 0,
                    });
                }
                if (records.length > 0)
                    map.set(k, records);
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Save a session's turn cost records (already capped at 50); serialized read-modify-write. */
export function saveTurnRecords(dir, sessionId, records) {
    const run = turnsChain.then(async () => {
        const file = TURNS_FILE(dir);
        let obj = {};
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            if (typeof parsed === "object" && parsed !== null) {
                // SAFETY: top-level JSON object with string keys maps to a record of arrays.
                obj = parsed;
            }
        }
        catch { }
        obj[sessionId] = records;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(obj));
    });
    turnsChain = run.catch(() => { });
    return run;
}
/** Whole name segments only: `GH_TOKEN`, `DB_PASSWORD`, `API_KEY` match; `SECRETARY` does not. */
const SECRET_NAME = /(^|_)(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)(_|$)/i;
/**
 * A replacer that masks the values of secret-looking environment variables (`*KEY`, `*TOKEN`,
 * `*SECRET`, `*PASSWORD`, `*CREDENTIAL`, eight characters or longer) as `[redacted:NAME]`.
 * Built once per adapter from its own environment; the Claude CLI inherits that environment, so a
 * `cat .env` or an echoed header would otherwise land verbatim in the session log.
 */
export function buildRedactor(env) {
    const secrets = [];
    for (const [name, value] of Object.entries(env)) {
        if (typeof value !== "string" || value.length < 8 || !SECRET_NAME.test(name))
            continue;
        secrets.push([name, value]);
    }
    secrets.sort((a, b) => b[1].length - a[1].length); // longest first, so a prefix never masks part
    return (s) => {
        let out = s;
        for (const [name, value] of secrets)
            if (out.includes(value))
                out = out.split(value).join(`[redacted:${name}]`);
        return out;
    };
}
//# sourceMappingURL=state.js.map