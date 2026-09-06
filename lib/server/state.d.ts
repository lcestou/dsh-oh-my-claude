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
/** Record (or clear) that a session's turn is running; serialized read-modify-write. */
export declare function markBusy(id: string, on: boolean, path?: string): Promise<void>;
/** Sessions whose turn the previous dsh process left unfinished; cleared on read. */
export declare function takeInterrupted(path?: string): Promise<string[]>;
/** Scratch cwd for title and compaction one-shots, so their transcripts stay out of workspaces. */
export declare const auxCwd: () => Promise<string>;
/**
 * Loads the set of Claude session IDs that this plugin has started.
 * Cached after the first call; per-instance when a state file is given.
 */
export declare function loadStarted(stateFile?: string): Promise<Set<string>>;
/**
 * Records or removes a Claude session ID from the known sessions list.
 */
export declare function rememberStarted(id: string, keep?: boolean, stateFile?: string): Promise<void>;
/** Headers for the Anthropic Models API: an API key from the env, else Claude Code's stored OAuth token. */
export declare function authHeaders(home?: string): Promise<Record<string, string> | null>;
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
export declare const isPermissionMode: (v: string) => v is PermissionMode;
/** Per-session permission mode overrides. Keyed by dsh session id; null means unset. */
export declare const PERMISSION_MODES_FILE: (d: string) => string;
/** Load the per-session permission mode overrides from disk. */
export declare function loadPermissionModes(dir: string): Promise<Map<string, string | null>>;
/** Save a session's permission mode override (or clear it with null); serialized read-modify-write. */
export declare function savePermissionMode(dir: string, sessionId: string, mode: string | null): Promise<void>;
/**
 * A replacer that masks the values of secret-looking environment variables (`*KEY`, `*TOKEN`,
 * `*SECRET`, `*PASSWORD`, `*CREDENTIAL`, eight characters or longer) as `[redacted:NAME]`.
 * Built once per adapter from its own environment; the Claude CLI inherits that environment, so a
 * `cat .env` or an echoed header would otherwise land verbatim in the session log.
 */
export declare function buildRedactor(env: Record<string, string | undefined>): (s: string) => string;
export {};
