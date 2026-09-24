import type { AsideEntry, TurnRecord } from "./adapter.js";
import type { ToolMode } from "./rows-probe.js";
/** Claude Code's config dir: transcripts, settings.json. Honors CLAUDE_CONFIG_DIR like the CLI. */
export declare const CLAUDE_HOME: string;
/** Resolve a raw configDir value to an absolute path for this plugin instance.
 * Non-empty → expanded absolute path; empty → falls through to CLAUDE_HOME. */
export declare function resolveClaudeHome(dir: string): string;
export declare const STATE_DIR: string;
/** Derive per-instance state dir from a provider id; default id uses the shared top-level path. */
export declare function stateDir(providerId: string): string;
/** Append one line to the resume trace; best effort, never throws. */
export declare function trace(fileOrLine: string, maybeLine?: string): Promise<void>;
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
export declare function writeJson(file: string, value: unknown): Promise<void>;
/** Record (or clear) that a session's turn is running; serialized read-modify-write. */
export declare function markBusy(id: string, on: boolean, path?: string): Promise<void>;
/** Sessions whose turn the previous dsh process left unfinished; cleared on read. */
export declare function takeInterrupted(path?: string): Promise<string[]>;
/** The provider of the last `model/selection` event in a session log, if any. Read from the tail,
 *  so a long log costs the events after its last selection, not all of them. */
export declare function lastSelectedProvider(events: readonly {
    type: string;
    data?: unknown;
}[]): string | undefined;
/** The bridged slash-command names, or an empty list when the file is missing, unreadable or not
 *  an array. Never throws. */
export declare function loadCommandCatalog(dir: string): Promise<string[]>;
/** Remember the catalog; a write that fails leaves the menu to the next init frame, not an error. */
export declare function saveCommandCatalog(dir: string, names: string[]): Promise<void>;
/** The saved holds keyed by session id, or an empty record when the file is missing, unreadable
 *  or not an object. Never throws. */
export declare function loadHolds(dir: string): Promise<Record<string, unknown>>;
/** Set one session's hold; serialized read-modify-write. */
export declare function saveHold(dir: string, sessionId: string, record: unknown): Promise<void>;
/**
 * Drop a session's hold, but only the one named: a respawn writes the new hold's record before the
 * old hold's exit arrives, and that exit must not take the new record with it.
 */
export declare function dropHold(dir: string, sessionId: string, name?: string): Promise<void>;
/** Each waiting session's reset time, keyed by session id. A missing or corrupt file reads as no
 *  waits, and an entry whose value is not a number is dropped. Never throws. */
export declare function loadLimitWaits(dir: string): Promise<Map<string, number>>;
/** Record (or with `resetAt` undefined, forget) a session's wait; saves serialize. */
export declare function saveLimitWait(dir: string, sessionId: string, resetAt: number | undefined): Promise<void>;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export declare const auxCwd: () => Promise<string>;
/**
 * The Claude session IDs this plugin has started.
 *
 * Read from disk every time rather than cached for the life of the process: the state directory is
 * shared, so a second dsh over the same one, or a hand edit, is invisible to a cache that was
 * filled at startup, and the sessions it started would stay hidden from this one's list until a
 * restart. The file holds a few hundred ids at most and is read once per request.
 */
export declare function loadStarted(stateFile?: string): Promise<Set<string>>;
/**
 * Records or removes a Claude session ID from the known sessions list.
 *
 * The whole set is written back, so it is re-read inside the same serialized step: writing a set
 * that was loaded earlier would erase every id another writer added in between.
 */
export declare function rememberStarted(id: string, keep?: boolean, stateFile?: string): Promise<void>;
/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export declare function authHeaders(home?: string): Promise<Record<string, string> | null>;
/** The same read from the text of a credentials file already in hand: a remote box's, fetched
 *  over ssh, decodes here the way this box's does. */
export declare function authHeadersFrom(raw: string | null): Record<string, string> | null;
/**
 * Record this boot's time in `file` and return how long ago the previous boot was, or undefined
 * when there was none (or the file is unreadable). Best effort, never throws.
 */
export declare function noteBoot(file: string, now?: number): Promise<number | undefined>;
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
export declare function hasPendingNotice(events: Iterable<LooseEvent>, plugin: string, texts?: readonly string[]): boolean;
/** Claude Code permission modes the CLI accepts for `--permission-mode` and `set_permission_mode`. */
export declare const PERMISSION_MODES: readonly ["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"];
export type PermissionMode = (typeof PERMISSION_MODES)[number];
/** Narrow an unchecked string, from config or a request body, to a mode the CLI accepts.
 *  The match is exact and case-sensitive. */
export declare const isPermissionMode: (v: string) => v is PermissionMode;
/** Modes at or below the given ceiling, in table order. */
export declare const modesUpTo: (ceiling: PermissionMode) => PermissionMode[];
/** Per-session permission mode overrides. Keyed by dsh session id; null means unset. */
export declare const PERMISSION_MODES_FILE: (d: string) => string;
/** Per-session turn cost records; keyed by dsh session id; value is a ring buffer of last 50. */
export declare const TURNS_FILE: (d: string) => string;
/** Load the per-session permission mode overrides from disk. */
export declare function loadPermissionModes(dir: string): Promise<Map<string, string | null>>;
/** Save a session's permission mode override (or clear it with null); serialized read-modify-write. */
export declare function savePermissionMode(dir: string, sessionId: string, mode: string | null): Promise<void>;
/** Load the per-session turn cost records from disk. Drops entries with missing or non-numeric fields; missing apiMs/turns default to 0 for backward compat. */
export declare function loadTurnRecords(dir: string): Promise<Map<string, TurnRecord[]>>;
/** Save a session's turn cost records (already capped at 50); serialized read-modify-write. */
export declare function saveTurnRecords(dir: string, sessionId: string, records: TurnRecord[]): Promise<void>;
/** Per-session `/btw` asides; keyed by dsh session id; value is the session's aside ring. */
export declare const ASIDES_FILE: (d: string) => string;
/**
 * Load the persisted `/btw` asides. Pending entries are dropped: a pending aside never got its
 * answer, and the process that would have delivered it is gone after a restart, so restoring a
 * forever-spinner would be a lie. Entries missing the required fields are skipped.
 */
export declare function loadAsides(dir: string): Promise<Map<string, AsideEntry[]>>;
/** Save one session's aside ring (already capped by the caller); serialized read-modify-write. */
export declare function saveAsides(dir: string, sessionId: string, entries: AsideEntry[]): Promise<void>;
/** Why a log was or was not rewritten. `fine` loads; `healed` was rewritten and loads now;
 *  `unknown` is refused for a reason the plugin does not mend; `rolled-back` was rewritten, still
 *  refused, and the .bak was put back; `owned` was skipped because another process holds its
 *  write lock. */
export type RepairVerdict = "fine" | "healed" | "unknown" | "rolled-back" | "owned";
/** One log's verdict, as the sweep and the on-open heal record it. */
export interface SessionRepairRecord {
    /** The log's absolute path as dsh's `locate()` or its own error text named it. */
    path: string;
    /** `stat` at the time of the verdict; a changed pair re-probes the log on the next sweep. */
    mtimeMs: number;
    size: number;
    verdict: RepairVerdict;
    /** The refusal text dsh gave, first 300 chars, for `unknown` and `rolled-back`. */
    reason?: string;
    /** The backup written beside the log, for `healed` and `rolled-back`. */
    bak?: string;
    /** What the repair did, for `healed`: the counts `repair()` returns. */
    did?: {
        droppedCalls: number;
        addedHead: boolean;
        closedCalls: number;
    };
    /** When the verdict was reached, ms since epoch. */
    at: number;
}
/** The box-wide record of session-log repairs, one entry per dsh session id. */
export interface SessionRepairsFile {
    version: 1;
    /** When the last full sweep finished; 0 before the first. */
    lastSweepAt: number;
    /** Keyed by dsh session id (the log header's `id`). */
    logs: Record<string, SessionRepairRecord>;
}
/** The repairs record; its key is the dsh session id, never the path, which can move. */
export declare const SESSION_REPAIRS_FILE: (d: string) => string;
/** Load the repairs record. An unreadable or unparseable file reads as the empty default, and an
 *  entry missing `path`, `verdict` or `at` is skipped, so a hand-edited file cannot put a notice
 *  on screen for a log nobody can find. */
export declare function loadSessionRepairs(dir: string): Promise<SessionRepairsFile>;
/** Write the whole record; serialized behind the same chain as `recordRepair`. */
export declare function saveSessionRepairs(dir: string, next: SessionRepairsFile): Promise<void>;
/** Replace one session's entry: read, set, write, serialized so two heals cannot lose each
 *  other's verdict. */
export declare function recordRepair(dir: string, id: string, record: SessionRepairRecord): Promise<void>;
/** Load the saved openers. A non-string or blank value is skipped, so a hand-edited file cannot put a
 *  card on screen with nothing in it. */
export declare function loadStarters(dir: string): Promise<Map<string, string>>;
/** Save one opener, or drop it when the text is blank; serialized read-modify-write. */
export declare function saveStarter(dir: string, key: string, text: string | undefined): Promise<void>;
export interface WorkspaceModel {
    model: string;
    /** The Claude mount the model ran on (`claude-code`, or a box's `claude-code-<name>`). Absent
     *  on rows written before 2026-09-22, which then only name the model. */
    provider?: string;
    at: number;
}
/** `{ [cwd]: { model, at } }`; a row whose model is not a non-empty string is skipped. */
export declare function loadWorkspaceModels(dir: string): Promise<Map<string, WorkspaceModel>>;
/** Save the model for one cwd, or forget it when `model` is undefined or blank. */
export declare function saveWorkspaceModel(dir: string, cwd: string, model: string | undefined, at?: number, provider?: string): Promise<void>;
export interface WorkspaceContextSizes {
    sizes: Record<string, number>;
    at: number;
}
/** `{ [cwd]: { sizes, at } }`; a row without a sizes object is skipped, and a size that is not a
 *  finite number is dropped rather than shown as a wrong figure. */
export declare function loadContextSizes(dir: string): Promise<Map<string, WorkspaceContextSizes>>;
/** Merge one turn's measurements into the row for `cwd`, or forget the row when `sizes` is
 *  undefined. Merged, not replaced: a resumed turn carries no instruction bundle and no skill
 *  catalog, and overwriting the row with what that one turn happened to contain would show the
 *  owner a zero for a block dsh really did send at the start of the session. */
export declare function saveContextSizes(dir: string, cwd: string, sizes: Record<string, number> | undefined, at?: number): Promise<void>;
/**
 * A replacer that masks the values of secret-looking environment variables (`*KEY`, `*TOKEN`,
 * `*SECRET`, `*PASSWORD`, `*CREDENTIAL`, eight characters or longer) as `[redacted:NAME]`.
 * Built once per adapter from its own environment; the Claude CLI inherits that environment, so a
 * `cat .env` or an echoed header would otherwise land verbatim in the session log.
 */
export declare function buildRedactor(env: Record<string, string | undefined>): (s: string) => string;
/** Tool activity as the Tune switch last set it; absent means the config default. */
export declare const TOOL_MODE_FILE: (d: string) => string;
/** The saved tool mode, or undefined when the file is missing, corrupt or names a mode this version
 *  does not know, so the caller keeps its config default. Never throws. */
export declare function loadToolMode(dir: string): Promise<ToolMode | undefined>;
/** Save the tool mode for the next dsh start to read back through `loadToolMode`. */
export declare const saveToolMode: (dir: string, mode: ToolMode) => Promise<void>;
/** Where each watched session's transcript stood when it was last read: `{ [dshSessionId]:
 *  { path, seen } }`, so a restart carries on where the watch left off instead of re-showing or
 *  skipping what landed meanwhile. */
export declare const WATCH_FILE: (d: string) => string;
/** `provider` is the plugin instance that ran the session's turns and so owns its mirror turns; a
 *  second instance watching the same file would send a followup the first does not recognise, and
 *  that would reach Claude as a prompt (seen 2026-09-11 on a session on an SSH box). */
export type WatchRecord = {
    path: string;
    seen: number;
    host?: string;
    provider?: string;
    claudeId?: string;
};
/** Every watch record saved under `dir`, keyed by dsh session id. Waits for any save still queued
 *  for that directory first, so a reader never sees a baseline older than one already handed to
 *  `saveWatch`. */
export declare function loadWatches(dir: string): Promise<Map<string, WatchRecord>>;
/** Record where a session's watch has read up to. Queued behind any save already pending for
 *  `dir`, so saves land in the order they were called; the returned promise settles when this one
 *  has been written. */
export declare function saveWatch(dir: string, sessionId: string, record: WatchRecord): Promise<void>;
/** The terminal mirror: whether the plugin copies exchanges from a terminal that picked this session
 *  up with `claude /resume` into the dsh session as they land. Off unless the owner turned it on,
 *  and a missing or unreadable file reads as off, so a fresh box does not get it by surprise: the
 *  mirror holds a dsh turn open while it fills, which can leave a typed prompt queued behind it.
 *  Carrying a session between dsh and a terminal does not depend on this and never did. Claude Code
 *  writes the transcript itself, so `/resume` sees dsh's turns, and opening a terminal session in dsh
 *  seeds it from that transcript. This flag only governs the live copy in one direction. */
export declare const TERMINAL_SYNC_FILE: (d: string) => string;
/** The saved choice, or undefined when there is none to read. Undefined rather than a value on a
 *  missing or corrupt file so the caller keeps its own default instead of having one asserted over
 *  it: the read is asynchronous, and answering `false` here overwrote a value set meanwhile. */
export declare function loadTerminalSync(dir: string): Promise<boolean | undefined>;
/** Save the terminal-mirror switch for the next dsh start to read back through `loadTerminalSync`. */
export declare const saveTerminalSync: (dir: string, enabled: boolean) => Promise<void>;
export {};
