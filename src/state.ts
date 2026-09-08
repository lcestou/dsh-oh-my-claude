// Files this plugin keeps on disk, and the one Claude Code file it reads: session ids it started,
// sessions with a turn in flight, the resume trace, the aux scratch dir, and the stored OAuth
// token for the Models API. This is an I/O boundary: JSON from disk is decoded here and typed
// values leave.
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AsideEntry, TurnRecord } from "./adapter.js";

/** Claude Code's config dir: transcripts, settings.json. Honors CLAUDE_CONFIG_DIR like the CLI. */
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

/** Resolve a raw configDir value to an absolute path for this plugin instance.
 * Non-empty → expanded absolute path; empty → falls through to CLAUDE_HOME. */
export function resolveClaudeHome(dir: string): string {
  if (!dir) return CLAUDE_HOME;
  const expanded = dir.startsWith("~") ? join(homedir(), dir.slice(1)) : dir;
  return expanded.startsWith("/") ? expanded : join(process.cwd(), expanded);
}

// Session state: which Claude sessions this plugin started, so resume does not depend on guessing
// where Claude Code keeps its transcripts. A wrong guess still degrades to a fresh full-transcript run.
export const STATE_DIR = join(homedir(), ".local", "state", "dsh-oh-my-claude");
const STATE_FILE = join(STATE_DIR, "sessions.json");
/** Derive per-instance state dir from a provider id; default id uses the shared top-level path. */
export function stateDir(providerId: string): string {
  return providerId === "claude-code" ? STATE_DIR : join(STATE_DIR, providerId);
}

/** Sessions with a turn in flight. Survives a dsh restart so those sessions can be nudged back. */
const BUSY_FILE = join(STATE_DIR, "busy.json");
/** Plugin info logs never reach dsh's web.log; the resume path keeps its own trace file. */
const RESUME_LOG = join(STATE_DIR, "resume.log");
let busyChain = Promise.resolve();

/** Append one line to the resume trace; best effort, never throws. */
export async function trace(fileOrLine: string, maybeLine?: string): Promise<void> {
  const file = maybeLine === undefined ? RESUME_LOG : fileOrLine;
  const line = maybeLine ?? fileOrLine;
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${new Date().toISOString()} ${line}\n`);
  } catch {}
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
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

/** Record (or clear) that a session's turn is running; serialized read-modify-write. */
export function markBusy(id: string, on: boolean, path = BUSY_FILE): Promise<void> {
  busyChain = busyChain.then(
    async () => {
      let ids: unknown[] = [];
      try {
        ids = JSON.parse(await readFile(path, "utf8"));
      } catch {}
      const set = new Set(Array.isArray(ids) ? ids : []);
      if (on ? set.has(id) : !set.has(id)) return;
      if (on) set.add(id);
      else set.delete(id);
      await writeJson(path, [...set]);
    },
    () => {},
  );
  return busyChain;
}

/** Sessions whose turn the previous dsh process left unfinished; cleared on read. */
export async function takeInterrupted(path = BUSY_FILE): Promise<string[]> {
  let ids: unknown[] = [];
  try {
    ids = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
  await writeJson(path, []).catch(() => {});
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

/** The provider of the last `model/selection` event in a session log, if any. */
export function lastSelectedProvider(
  events: Iterable<{ type: string; data?: unknown }>,
): string | undefined {
  let provider: string | undefined;
  for (const e of events) {
    if (e.type !== "model/selection" || typeof e.data !== "object" || e.data === null) continue;
    // SAFETY: a non-null object; the one field read is checked for string before use
    const p = (e.data as { provider?: unknown }).provider;
    if (typeof p === "string") provider = p;
  }
  return provider;
}

/** Sessions waiting for a usage limit to reset: session id to reset instant (ms since epoch). */
const LIMIT_WAITS_FILE = (dir: string) => join(dir, "limit-waits.json");
let limitChain: Promise<void> = Promise.resolve();

export async function loadLimitWaits(dir: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const parsed: unknown = JSON.parse(await readFile(LIMIT_WAITS_FILE(dir), "utf8"));
    if (typeof parsed === "object" && parsed !== null)
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "number") map.set(k, v);
  } catch {}
  return map;
}

/** Record (or with `resetAt` undefined, forget) a session's wait; saves serialize. */
export function saveLimitWait(dir: string, sessionId: string, resetAt: number | undefined) {
  const run = limitChain.then(async () => {
    const map = await loadLimitWaits(dir);
    if (resetAt === undefined) map.delete(sessionId);
    else map.set(sessionId, resetAt);
    await writeJson(LIMIT_WAITS_FILE(dir), Object.fromEntries(map));
  });
  limitChain = run.catch(() => {});
  return run;
}

const AUX_DIR = join(STATE_DIR, "aux");
let auxReady: Promise<string> | undefined;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export const auxCwd = (): Promise<string> =>
  (auxReady ??= mkdir(AUX_DIR, { recursive: true }).then(() => AUX_DIR));

const startedCache = new Map<string, Set<string>>(); // per-stateFile cache for known sessions

/**
 * Loads the set of Claude session IDs that this plugin has started.
 * Cached after the first call; per-instance when a state file is given.
 */
export async function loadStarted(stateFile = STATE_FILE): Promise<Set<string>> {
  const cached = startedCache.get(stateFile);
  if (cached) return cached;
  try {
    const ids: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    const set = new Set(
      Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [],
    );
    startedCache.set(stateFile, set);
    return set;
  } catch {
    const empty = new Set<string>();
    startedCache.set(stateFile, empty);
    return empty;
  }
}

/**
 * Records or removes a Claude session ID from the known sessions list.
 */
export async function rememberStarted(
  id: string,
  keep = true,
  stateFile = STATE_FILE,
): Promise<void> {
  const set = await loadStarted(stateFile);
  if (keep ? set.has(id) : !set.has(id)) return;
  if (keep) set.add(id);
  else set.delete(id);
  try {
    await writeJson(stateFile, [...set]);
  } catch {
    /* state is an optimization only */
  }
}

/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export async function authHeaders(home = CLAUDE_HOME): Promise<Record<string, string> | null> {
  if (process.env.ANTHROPIC_API_KEY) return { "x-api-key": process.env.ANTHROPIC_API_KEY };
  try {
    const raw = await readFile(join(home, ".credentials.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const oauth =
      typeof parsed === "object" && parsed !== null && "claudeAiOauth" in parsed
        ? parsed.claudeAiOauth
        : undefined;
    if (typeof oauth === "object" && oauth !== null && "accessToken" in oauth) {
      const token = oauth.accessToken;
      const expiresAt =
        "expiresAt" in oauth && typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0;
      if (typeof token === "string" && token && expiresAt > Date.now()) {
        return { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" };
      }
    }
  } catch {
    /* no stored credential */
  }
  return null;
}

/**
 * Record this boot's time in `file` and return how long ago the previous boot was, or undefined
 * when there was none (or the file is unreadable). Best effort, never throws.
 */
export async function noteBoot(file: string, now = Date.now()): Promise<number | undefined> {
  let previous: number | undefined;
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "at" in parsed &&
      typeof parsed.at === "number"
    )
      previous = parsed.at;
  } catch {}
  try {
    await writeJson(file, { at: now });
  } catch {}
  return previous === undefined ? undefined : now - previous;
}

/** The shape of a durable session event this module inspects; anything else is ignored. */
interface LooseEvent {
  type: string;
  data?: unknown;
}

/**
 * True when the session log already holds a next-turn inbox message from `plugin` that no turn
 * has consumed yet (an `agent/inbox/spliced` after the last `turn/start`). dsh restores the inbox
 * from the log on resume, so nudging again would queue a duplicate notice (14 of them on
 * 2026-09-05 after a crash loop).
 */
export function hasPendingNotice(
  events: Iterable<LooseEvent>,
  plugin: string,
  texts: readonly string[] = [],
): boolean {
  let pending = false;
  for (const e of events) {
    if (e.type === "turn/start") {
      pending = false;
      continue;
    }
    if (e.type !== "agent/inbox/spliced") continue;
    const d = e.data;
    if (typeof d !== "object" || d === null || !("inserted" in d) || !Array.isArray(d.inserted))
      continue;
    const target = "target" in d ? d.target : undefined;
    if (target !== "next-turn") continue;
    for (const m of d.inserted) {
      if (typeof m !== "object" || m === null) continue;
      const src = "source" in m ? m.source : undefined;
      if (typeof src === "object" && src !== null && "plugin" in src && src.plugin === plugin)
        pending = true;
      // Notices sent on the owner's behalf carry the user source; match them by their text.
      const content = "content" in m && Array.isArray(m.content) ? m.content : [];
      for (const block of content) {
        if (typeof block !== "object" || block === null || !("text" in block)) continue;
        if (typeof block.text === "string" && texts.includes(block.text)) pending = true;
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
] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const isPermissionMode = (v: string): v is PermissionMode =>
  PERMISSION_MODES.some((m) => m === v);

/** Rank by loosening: plan (strictest) through bypassPermissions (loosest). */
const PERMISSION_RANK = {
  plan: 0,
  default: 1,
  acceptEdits: 2,
  auto: 3,
  dontAsk: 3,
  bypassPermissions: 4,
} as const satisfies Record<PermissionMode, number>;

/** Modes at or below the given ceiling, in table order. */
export const modesUpTo = (ceiling: PermissionMode): PermissionMode[] =>
  PERMISSION_MODES.filter((m) => PERMISSION_RANK[m] <= PERMISSION_RANK[ceiling]);

/** Per-session permission mode overrides. Keyed by dsh session id; null means unset. */
export const PERMISSION_MODES_FILE = (d: string) => join(d, "permission-modes.json");
let permissionModesChain = Promise.resolve();

/** Per-session turn cost records; keyed by dsh session id; value is a ring buffer of last 50. */
export const TURNS_FILE = (d: string) => join(d, "turns.json");
let turnsChain = Promise.resolve();

/** Load the per-session permission mode overrides from disk. */
export async function loadPermissionModes(dir: string): Promise<Map<string, string | null>> {
  const file = PERMISSION_MODES_FILE(dir);
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const map = new Map<string, string | null>();
    if (typeof parsed === "object" && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" || v === null) {
          map.set(k, v);
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save a session's permission mode override (or clear it with null); serialized read-modify-write. */
export function savePermissionMode(
  dir: string,
  sessionId: string,
  mode: string | null,
): Promise<void> {
  const run = permissionModesChain.then(async () => {
    const file = PERMISSION_MODES_FILE(dir);
    const map = await loadPermissionModes(dir);
    if (mode === null) map.delete(sessionId);
    else map.set(sessionId, mode);
    const obj: Record<string, string | null> = {};
    for (const [k, v] of map) obj[k] = v;
    await writeJson(file, obj);
  });
  // The caller sees a failed write; the chain itself carries on for the next save.
  permissionModesChain = run.catch(() => {});
  return run;
}

/** Load the per-session turn cost records from disk. Drops entries with missing or non-numeric fields; missing apiMs/turns default to 0 for backward compat. */
export async function loadTurnRecords(dir: string): Promise<Map<string, TurnRecord[]>> {
  const file = TURNS_FILE(dir);
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const map = new Map<string, TurnRecord[]>();
    if (typeof parsed === "object" && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (!Array.isArray(v)) continue;
        const records: TurnRecord[] = [];
        for (const entry of v) {
          if (typeof entry !== "object" || entry === null) continue;
          // SAFETY: a non-null object; every field is re-checked as a number below
          const r = entry as Record<string, unknown>;
          const num = (key: string): number | undefined =>
            typeof r[key] === "number" ? r[key] : undefined;
          const at = num("at");
          const costUsd = num("costUsd");
          const durationMs = num("durationMs");
          const input = num("input");
          const output = num("output");
          const cacheRead = num("cacheRead");
          const cacheWrite = num("cacheWrite");
          if (
            at === undefined ||
            costUsd === undefined ||
            durationMs === undefined ||
            input === undefined ||
            output === undefined ||
            cacheRead === undefined ||
            cacheWrite === undefined
          )
            continue;
          // apiMs and turns were not always written; older files read as 0.
          const record: TurnRecord = {
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
          if (ttftMs !== undefined) record.ttftMs = ttftMs;
          records.push(record);
        }
        if (records.length > 0) map.set(k, records);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save a session's turn cost records (already capped at 50); serialized read-modify-write. */
export function saveTurnRecords(
  dir: string,
  sessionId: string,
  records: TurnRecord[],
): Promise<void> {
  const run = turnsChain.then(async () => {
    const file = TURNS_FILE(dir);
    let obj: Record<string, unknown[]> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        // SAFETY: top-level JSON object with string keys maps to a record of arrays.
        obj = parsed as Record<string, unknown[]>;
      }
    } catch {}
    obj[sessionId] = records;
    await writeJson(file, obj);
  });
  turnsChain = run.catch(() => {});
  return run;
}

/** Per-session `/btw` asides; keyed by dsh session id; value is the session's aside ring. */
export const ASIDES_FILE = (d: string) => join(d, "asides.json");
let asidesChain = Promise.resolve();

/**
 * Load the persisted `/btw` asides. Pending entries are dropped: a pending aside never got its
 * answer, and the process that would have delivered it is gone after a restart, so restoring a
 * forever-spinner would be a lie. Entries missing the required fields are skipped.
 */
export async function loadAsides(dir: string): Promise<Map<string, AsideEntry[]>> {
  const file = ASIDES_FILE(dir);
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    const map = new Map<string, AsideEntry[]>();
    if (typeof parsed === "object" && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (!Array.isArray(v)) continue;
        const entries: AsideEntry[] = [];
        for (const raw of v) {
          if (typeof raw !== "object" || raw === null) continue;
          // SAFETY: a non-null object; each field is checked for its type before use.
          const r = raw as Record<string, unknown>;
          if (typeof r.id !== "string" || typeof r.question !== "string") continue;
          if (typeof r.at !== "number") continue;
          if (r.pending === true) continue;
          const entry: AsideEntry = { id: r.id, question: r.question, pending: false, at: r.at };
          if (typeof r.answer === "string") entry.answer = r.answer;
          if (typeof r.error === "string") entry.error = r.error;
          if (r.dismissed === true) entry.dismissed = true;
          entries.push(entry);
        }
        if (entries.length > 0) map.set(k, entries);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save one session's aside ring (already capped by the caller); serialized read-modify-write. */
export function saveAsides(dir: string, sessionId: string, entries: AsideEntry[]): Promise<void> {
  const run = asidesChain.then(async () => {
    const file = ASIDES_FILE(dir);
    let obj: Record<string, unknown[]> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        // SAFETY: top-level JSON object with string keys maps to a record of arrays.
        obj = parsed as Record<string, unknown[]>;
      }
    } catch {}
    obj[sessionId] = entries;
    await writeJson(file, obj);
  });
  asidesChain = run.catch(() => {});
  return run;
}

/** Per-session opening prompt, keyed by dsh session id, plus the shared `default` key the starter card
 *  offers a session that has none of its own. */
export const STARTERS_FILE = (d: string) => join(d, "starters.json");
let startersChain = Promise.resolve();

/** Load the saved openers. A non-string or blank value is skipped, so a hand-edited file cannot put a
 *  card on screen with nothing in it. */
export async function loadStarters(dir: string): Promise<Map<string, string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(STARTERS_FILE(dir), "utf8"));
    const map = new Map<string, string>();
    if (typeof parsed === "object" && parsed !== null) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string" && v.trim() !== "") map.set(k, v);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Save one opener, or drop it when the text is blank; serialized read-modify-write. */
export function saveStarter(dir: string, key: string, text: string | undefined): Promise<void> {
  const run = startersChain.then(async () => {
    const file = STARTERS_FILE(dir);
    let obj: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
      if (typeof parsed === "object" && parsed !== null) {
        // SAFETY: a top-level JSON object with string keys.
        obj = parsed as Record<string, unknown>;
      }
    } catch {}
    if (text === undefined || text.trim() === "") delete obj[key];
    else obj[key] = text;
    await writeJson(file, obj);
  });
  startersChain = run.catch(() => {});
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
export function buildRedactor(env: Record<string, string | undefined>): (s: string) => string {
  const secrets: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length < 8 || !SECRET_NAME.test(name)) continue;
    secrets.push([name, value]);
  }
  secrets.sort((a, b) => b[1].length - a[1].length); // longest first, so a prefix never masks part
  return (s: string) => {
    let out = s;
    for (const [name, value] of secrets)
      if (out.includes(value)) out = out.split(value).join(`[redacted:${name}]`);
    return out;
  };
}
