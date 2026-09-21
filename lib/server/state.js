// Files this plugin keeps on disk, and the one Claude Code file it reads: session ids it started,
// sessions with a turn in flight, the resume trace, the aux scratch dir, and the stored OAuth
// token for the Models API. This is an I/O boundary: JSON from disk is decoded here and typed
// values leave.
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
// `DSH_OMC_STATE_DIR` is for the test suite: every store below is read-modify-write into this dir,
// and a test that exercised one against the real path rewrote the running plugin's files (found
// 2026-09-08: a test session id in permission-modes.json, two days of test lines in resume.log).
export const STATE_DIR = process.env.DSH_OMC_STATE_DIR || join(homedir(), ".local", "state", "dsh-oh-my-claude");
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
/**
 * Write JSON so a crash mid-write cannot leave half a file behind: into a temp name in the same
 * directory, then rename over, which is atomic on one filesystem.
 *
 * Every store in this module is read-modify-write, and every reader treats an unparseable file as
 * empty. A truncated write is therefore not the loss of one entry but of the whole ledger: the next
 * save reads nothing and writes the map back from nothing. The temp name carries a uuid because two
 * writers to one path would otherwise share it, and the loser's rename would find the file the
 * winner already moved.
 */
export async function writeJson(file, value) {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${randomUUID()}`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
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
        await writeJson(path, [...set]);
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
    await writeJson(path, []).catch(() => { });
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}
/** The provider of the last `model/selection` event in a session log, if any. Read from the tail,
 *  so a long log costs the events after its last selection, not all of them. */
export function lastSelectedProvider(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.type !== "model/selection" || typeof e.data !== "object" || e.data === null)
            continue;
        // SAFETY: a non-null object; the one field read is checked for string before use
        const p = e.data.provider;
        if (typeof p === "string")
            return p;
    }
    return undefined;
}
/**
 * The Claude Code slash commands the CLI's last init frame named, kept so a dsh restart can put
 * them back. The catalog arrives once per spawned process, and a restart adopts the running Claude
 * rather than spawning a new one — so without this file every bridged command (`/claude-llama` and
 * the rest) vanished from the menu until the next cold start.
 */
const COMMANDS_FILE = (dir) => join(dir, "commands.json");
export async function loadCommandCatalog(dir) {
    try {
        const parsed = JSON.parse(await readFile(COMMANDS_FILE(dir), "utf8"));
        return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string") : [];
    }
    catch {
        return [];
    }
}
/** Remember the catalog; a write that fails leaves the menu to the next init frame, not an error. */
export function saveCommandCatalog(dir, names) {
    return writeJson(COMMANDS_FILE(dir), names).catch(() => { });
}
/**
 * Holds: the Claude processes this instance left running on SSH boxes, keyed by dsh session id,
 * with the log offset each was read to. A restart reattaches from here (see `hold.ts`). The shape
 * is `hold.ts`'s `HoldRecord`; it is kept loose here so this module does not import the process one.
 */
const HOLDS_FILE = (dir) => join(dir, "holds.json");
let holdsChain = Promise.resolve();
export async function loadHolds(dir) {
    try {
        const parsed = JSON.parse(await readFile(HOLDS_FILE(dir), "utf8"));
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
            return {};
        // SAFETY: a plain object read from this module's own file; callers validate each value
        return parsed;
    }
    catch {
        return {};
    }
}
/** Set one session's hold; serialized read-modify-write. */
export function saveHold(dir, sessionId, record) {
    const run = holdsChain.then(async () => {
        const all = await loadHolds(dir);
        all[sessionId] = record;
        await writeJson(HOLDS_FILE(dir), all);
    });
    holdsChain = run.catch(() => { });
    return run;
}
/**
 * Drop a session's hold, but only the one named: a respawn writes the new hold's record before the
 * old hold's exit arrives, and that exit must not take the new record with it.
 */
export function dropHold(dir, sessionId, name) {
    const run = holdsChain.then(async () => {
        const all = await loadHolds(dir);
        const held = all[sessionId];
        if (held === undefined)
            return;
        if (name !== undefined) {
            if (typeof held !== "object" || held === null)
                return;
            // SAFETY: a non-null object from this module's own file; the one field read is checked
            if (held.name !== name)
                return;
        }
        delete all[sessionId];
        await writeJson(HOLDS_FILE(dir), all);
    });
    holdsChain = run.catch(() => { });
    return run;
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
        await writeJson(LIMIT_WAITS_FILE(dir), Object.fromEntries(map));
    });
    limitChain = run.catch(() => { });
    return run;
}
const AUX_DIR = join(STATE_DIR, "aux");
let auxReady;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export const auxCwd = () => (auxReady ??= mkdir(AUX_DIR, { recursive: true }).then(() => AUX_DIR));
let startedChain = Promise.resolve();
/**
 * The Claude session IDs this plugin has started.
 *
 * Read from disk every time rather than cached for the life of the process: the state directory is
 * shared, so a second dsh over the same one — or a hand edit — is invisible to a cache that was
 * filled at startup, and the sessions it started would stay hidden from this one's list until a
 * restart. The file holds a few hundred ids at most and is read once per request.
 */
export async function loadStarted(stateFile = STATE_FILE) {
    try {
        const ids = JSON.parse(await readFile(stateFile, "utf8"));
        return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
    }
    catch {
        return new Set();
    }
}
/**
 * Records or removes a Claude session ID from the known sessions list.
 *
 * The whole set is written back, so it is re-read inside the same serialized step: writing a set
 * that was loaded earlier would erase every id another writer added in between.
 */
export function rememberStarted(id, keep = true, stateFile = STATE_FILE) {
    startedChain = startedChain.then(async () => {
        const set = await loadStarted(stateFile);
        if (keep ? set.has(id) : !set.has(id))
            return;
        if (keep)
            set.add(id);
        else
            set.delete(id);
        try {
            await writeJson(stateFile, [...set]);
        }
        catch {
            /* state is an optimization only */
        }
    }, () => { });
    return startedChain;
}
/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export async function authHeaders(home = CLAUDE_HOME) {
    if (process.env.ANTHROPIC_API_KEY)
        return { "x-api-key": process.env.ANTHROPIC_API_KEY };
    return authHeadersFrom(await readFile(join(home, ".credentials.json"), "utf8").catch(() => null));
}
/** The same read from the text of a credentials file already in hand: a remote box's, fetched
 *  over ssh, decodes here the way this box's does. */
export function authHeadersFrom(raw) {
    if (raw === null)
        return null;
    try {
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
        await writeJson(file, { at: now });
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
        await writeJson(file, obj);
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
                    const record = {
                        at,
                        costUsd,
                        durationMs,
                        input,
                        output,
                        cacheRead,
                        cacheWrite,
                        apiMs: num("apiMs") ?? 0,
                        turns: num("turns") ?? 0,
                    };
                    // ttftMs is optional and absent from older files; carry it only when it was written.
                    const ttftMs = num("ttftMs");
                    if (ttftMs !== undefined)
                        record.ttftMs = ttftMs;
                    records.push(record);
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
        await writeJson(file, obj);
    });
    turnsChain = run.catch(() => { });
    return run;
}
/** Per-session `/btw` asides; keyed by dsh session id; value is the session's aside ring. */
export const ASIDES_FILE = (d) => join(d, "asides.json");
let asidesChain = Promise.resolve();
/**
 * Load the persisted `/btw` asides. Pending entries are dropped: a pending aside never got its
 * answer, and the process that would have delivered it is gone after a restart, so restoring a
 * forever-spinner would be a lie. Entries missing the required fields are skipped.
 */
export async function loadAsides(dir) {
    const file = ASIDES_FILE(dir);
    try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
                if (!Array.isArray(v))
                    continue;
                const entries = [];
                for (const raw of v) {
                    if (typeof raw !== "object" || raw === null)
                        continue;
                    // SAFETY: a non-null object; each field is checked for its type before use.
                    const r = raw;
                    if (typeof r.id !== "string" || typeof r.question !== "string")
                        continue;
                    if (typeof r.at !== "number")
                        continue;
                    if (r.pending === true)
                        continue;
                    const entry = { id: r.id, question: r.question, pending: false, at: r.at };
                    if (typeof r.answer === "string")
                        entry.answer = r.answer;
                    if (typeof r.error === "string")
                        entry.error = r.error;
                    if (r.dismissed === true)
                        entry.dismissed = true;
                    entries.push(entry);
                }
                if (entries.length > 0)
                    map.set(k, entries);
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Save one session's aside ring (already capped by the caller); serialized read-modify-write. */
export function saveAsides(dir, sessionId, entries) {
    const run = asidesChain.then(async () => {
        const file = ASIDES_FILE(dir);
        let obj = {};
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            if (typeof parsed === "object" && parsed !== null) {
                // SAFETY: top-level JSON object with string keys maps to a record of arrays.
                obj = parsed;
            }
        }
        catch { }
        obj[sessionId] = entries;
        await writeJson(file, obj);
    });
    asidesChain = run.catch(() => { });
    return run;
}
/** Per-session opening prompt, keyed by dsh session id, plus the shared `default` key the starter card
 *  offers a session that has none of its own. */
const STARTERS_FILE = (d) => join(d, "starters.json");
let startersChain = Promise.resolve();
/** Load the saved openers. A non-string or blank value is skipped, so a hand-edited file cannot put a
 *  card on screen with nothing in it. */
export async function loadStarters(dir) {
    try {
        const parsed = JSON.parse(await readFile(STARTERS_FILE(dir), "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === "string" && v.trim() !== "")
                    map.set(k, v);
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Save one opener, or drop it when the text is blank; serialized read-modify-write. */
export function saveStarter(dir, key, text) {
    const run = startersChain.then(async () => {
        const file = STARTERS_FILE(dir);
        let obj = {};
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            if (typeof parsed === "object" && parsed !== null) {
                // SAFETY: a top-level JSON object with string keys.
                obj = parsed;
            }
        }
        catch { }
        if (text === undefined || text.trim() === "")
            delete obj[key];
        else
            obj[key] = text;
        await writeJson(file, obj);
    });
    startersChain = run.catch(() => { });
    return run;
}
/** Per-workspace last Claude model, keyed by workspace cwd. Read by the client on a blank session. */
const WORKSPACE_MODELS_FILE = (d) => join(d, "workspace-models.json");
let workspaceModelsChain = Promise.resolve();
/** `{ [cwd]: { model, at } }`; a row whose model is not a non-empty string is skipped. */
export async function loadWorkspaceModels(dir) {
    try {
        const parsed = JSON.parse(await readFile(WORKSPACE_MODELS_FILE(dir), "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [cwd, v] of Object.entries(parsed)) {
                if (typeof v !== "object" || v === null)
                    continue;
                // SAFETY: workspace-models.json rows have model (string) and at (number) fields.
                const row = v;
                if (typeof row.model !== "string" || row.model.trim() === "")
                    continue;
                map.set(cwd, {
                    model: row.model,
                    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
                });
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Save the model for one cwd, or forget it when `model` is undefined or blank. */
export function saveWorkspaceModel(dir, cwd, model, at = Date.now()) {
    const run = workspaceModelsChain.then(async () => {
        const file = WORKSPACE_MODELS_FILE(dir);
        let obj = {};
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            if (typeof parsed === "object" && parsed !== null) {
                // SAFETY: a top-level JSON object with string keys.
                obj = parsed;
            }
        }
        catch { }
        if (model === undefined || model.trim() === "")
            delete obj[cwd];
        else
            obj[cwd] = { model, at };
        await writeJson(file, obj);
    });
    workspaceModelsChain = run.catch(() => { });
    return run;
}
/** Per-workspace character cost of each dsh context block, keyed by workspace cwd, read by the
 *  Settings card. Its own file rather than a field on `workspace-models.json`: that loader skips
 *  any row without a non-empty model, and its writer replaces the row whole, so sizes parked next
 *  to a model would be lost on read and again on the next model change. */
const CONTEXT_SIZES_FILE = (d) => join(d, "context-sizes.json");
let contextSizesChain = Promise.resolve();
/** `{ [cwd]: { sizes, at } }`; a row without a sizes object is skipped, and a size that is not a
 *  finite number is dropped rather than shown as a wrong figure. */
export async function loadContextSizes(dir) {
    try {
        const parsed = JSON.parse(await readFile(CONTEXT_SIZES_FILE(dir), "utf8"));
        const map = new Map();
        if (typeof parsed === "object" && parsed !== null) {
            for (const [cwd, v] of Object.entries(parsed)) {
                if (typeof v !== "object" || v === null)
                    continue;
                // SAFETY: context-sizes.json rows have sizes (object of numbers) and at (number) fields.
                const row = v;
                if (typeof row.sizes !== "object" || row.sizes === null)
                    continue;
                const sizes = {};
                // SAFETY: checked as a non-null object on the line above.
                for (const [key, n] of Object.entries(row.sizes)) {
                    if (typeof n === "number" && Number.isFinite(n))
                        sizes[key] = n;
                }
                map.set(cwd, {
                    sizes,
                    at: typeof row.at === "number" && Number.isFinite(row.at) ? row.at : 0,
                });
            }
        }
        return map;
    }
    catch {
        return new Map();
    }
}
/** Merge one turn's measurements into the row for `cwd`, or forget the row when `sizes` is
 *  undefined. Merged, not replaced: a resumed turn carries no instruction bundle and no skill
 *  catalog, and overwriting the row with what that one turn happened to contain would show the
 *  owner a zero for a block dsh really did send at the start of the session. */
export function saveContextSizes(dir, cwd, sizes, at = Date.now()) {
    const run = contextSizesChain.then(async () => {
        const file = CONTEXT_SIZES_FILE(dir);
        let obj = {};
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            if (typeof parsed === "object" && parsed !== null) {
                // SAFETY: a top-level JSON object with string keys.
                obj = parsed;
            }
        }
        catch { }
        if (sizes === undefined)
            delete obj[cwd];
        else {
            const before = (await loadContextSizes(dir)).get(cwd)?.sizes ?? {};
            obj[cwd] = { sizes: { ...before, ...sizes }, at };
        }
        await writeJson(file, obj);
    });
    contextSizesChain = run.catch(() => { });
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
/** Tool activity as the Tune switch last set it; absent means the config default. */
export const TOOL_MODE_FILE = (d) => join(d, "tool-mode.json");
export async function loadToolMode(dir) {
    try {
        const parsed = JSON.parse(await readFile(TOOL_MODE_FILE(dir), "utf8"));
        // SAFETY: a top-level JSON object; the one key read is checked against its two values below.
        const mode = typeof parsed === "object" && parsed !== null
            ? parsed.mode
            : undefined;
        return mode === "inline" || mode === "rows" ? mode : undefined;
    }
    catch {
        return undefined;
    }
}
export const saveToolMode = (dir, mode) => writeJson(TOOL_MODE_FILE(dir), { mode });
/** Where each watched session's transcript stood when it was last read: `{ [dshSessionId]:
 *  { path, seen } }`, so a restart carries on where the watch left off instead of re-showing or
 *  skipping what landed meanwhile. */
export const WATCH_FILE = (d) => join(d, "watch.json");
/** Every watch record saved under `dir`, keyed by dsh session id. Waits for any save still queued
 *  for that directory first, so a reader never sees a baseline older than one already handed to
 *  `saveWatch`. */
export async function loadWatches(dir) {
    await watchWrites.get(dir);
    return readWatches(dir);
}
/** The pending save per state directory. `saveWatch` reads the whole file, changes one entry and
 *  writes it back, so two saves in flight at once raced: the one that read first could write last
 *  and put an older baseline back, and the next dsh start re-mirrored exchanges it had already
 *  shown. Chaining the saves makes the last one called the last one written. */
const watchWrites = new Map();
async function readWatches(dir) {
    const out = new Map();
    try {
        const parsed = JSON.parse(await readFile(WATCH_FILE(dir), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return out;
        for (const [id, v] of Object.entries(parsed)) {
            // SAFETY: each value is checked field by field before it is kept
            const r = v;
            if (typeof r?.path !== "string" || typeof r.seen !== "number")
                continue;
            const record = { path: r.path, seen: r.seen };
            if (typeof r.host === "string")
                record.host = r.host;
            if (typeof r.provider === "string")
                record.provider = r.provider;
            if (typeof r.claudeId === "string")
                record.claudeId = r.claudeId;
            out.set(id, record);
        }
    }
    catch {
        // no file yet, or unreadable: every watch starts from its own baseline
    }
    return out;
}
export async function saveWatch(dir, sessionId, record) {
    const next = (watchWrites.get(dir) ?? Promise.resolve()).then(async () => {
        const all = await readWatches(dir);
        all.set(sessionId, record);
        await writeJson(WATCH_FILE(dir), Object.fromEntries(all));
    });
    // A failed save must not stall the ones behind it; its caller still sees the rejection.
    watchWrites.set(dir, next.catch(() => { }));
    return next;
}
/** The terminal mirror: whether the plugin copies exchanges from a terminal that picked this session
 *  up with `claude /resume` into the dsh session as they land. Off unless the owner turned it on,
 *  and a missing or unreadable file reads as off, so a fresh box does not get it by surprise: the
 *  mirror holds a dsh turn open while it fills, which can leave a typed prompt queued behind it.
 *  Carrying a session between dsh and a terminal does not depend on this and never did — Claude Code
 *  writes the transcript itself, so `/resume` sees dsh's turns, and opening a terminal session in dsh
 *  seeds it from that transcript. This flag only governs the live copy in one direction. */
export const TERMINAL_SYNC_FILE = (d) => join(d, "terminal-sync.json");
/** The saved choice, or undefined when there is none to read. Undefined rather than a value on a
 *  missing or corrupt file so the caller keeps its own default instead of having one asserted over
 *  it: the read is asynchronous, and answering `false` here overwrote a value set meanwhile. */
export async function loadTerminalSync(dir) {
    try {
        const parsed = JSON.parse(await readFile(TERMINAL_SYNC_FILE(dir), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return undefined;
        // SAFETY: parsed is a non-null object; the one key read is compared, not trusted as a type.
        const enabled = parsed.enabled;
        return typeof enabled === "boolean" ? enabled : undefined;
    }
    catch {
        return undefined;
    }
}
export const saveTerminalSync = (dir, enabled) => writeJson(TERMINAL_SYNC_FILE(dir), { enabled });
//# sourceMappingURL=state.js.map