/** Claude Code's config dir: transcripts, settings.json. Honors CLAUDE_CONFIG_DIR like the CLI. */
export declare const CLAUDE_HOME: string;
/** Resolve a raw configDir value to an absolute path for this plugin instance.
 * Non-empty → expanded absolute path; empty → falls through to CLAUDE_HOME. */
export declare function resolveClaudeHome(dir: string): string;
export declare const STATE_DIR: string;
export declare const STATE_FILE: string;
/** Derive per-instance state dir from a provider id; default id uses the shared top-level path. */
export declare function stateDir(providerId: string): string;
/** Sessions with a turn in flight. Survives a dsh restart so those sessions can be nudged back. */
export declare const BUSY_FILE: string;
/** Plugin info logs never reach dsh's web.log; the resume path keeps its own trace file. */
export declare const RESUME_LOG: string;
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
