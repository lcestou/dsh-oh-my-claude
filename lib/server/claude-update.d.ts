/** The CLI's three release channels; `latest` is its default for an absent key. */
export type Channel = "latest" | "stable" | "rc";
/** One run of `claude update`, as the history under Tune shows it. */
export interface ClaudeUpdateEntry {
    at: number;
    /** `claude --version` before the run, or null when the box did not answer. */
    from: string | null;
    /** `claude --version` after the run, or null when the box did not answer. */
    to: string | null;
    by: "button" | "auto";
    /** True when `to` is a release after `from`. */
    ok: boolean;
    /** The CLI's last output line, kept for a failure and for a run it declined. */
    note?: string;
}
/** The record of one box, and the two choices around it. */
export interface ClaudeUpdates {
    /** Install a newer release on the next timer tick without asking. */
    auto?: true;
    /** The release the card was dismissed for; a newer one shows the card again. */
    skipped?: string;
    /** The release the card was folded to its header for; a newer one opens it again. Kept here,
     *  beside `skipped`, so a fold made in one session or tab holds in every other on this box. */
    folded?: string;
    /** Newest last; at most 50 kept. */
    log: ClaudeUpdateEntry[];
}
/** The file: one record per box, keyed "this-box" or the ssh host. */
export type ClaudeUpdatesFile = Record<string, ClaudeUpdates>;
/** What the routes answer: the box, the two versions, why checks are off, and the record. */
export interface ClaudeUpdateState {
    host: string;
    label: string;
    installed: string | null;
    latest?: string;
    channel: Channel;
    off?: "DISABLE_AUTOUPDATER" | "DISABLE_UPDATES";
    checkedAt?: number;
    busy: boolean;
    auto: boolean;
    skipped?: string;
    folded?: string;
    log: ClaudeUpdateEntry[];
}
/** What the card above the composer needs: only when a release after `installed` is out. */
export interface ClaudeUpdateCard {
    host: string;
    label: string;
    installed: string;
    latest: string;
    /** The card was folded for this release; it mounts as its header line. */
    folded: boolean;
}
export type Exec = (args: string[], timeoutMs: number) => Promise<{
    out: string;
    error?: string;
}>;
type FetchFn = (url: string, init: {
    signal: AbortSignal;
}) => Promise<Response>;
/**
 * The newest Claude Code release on `channel`, or undefined when the pointer did not answer in time.
 * Memoised per channel; `timeoutMs` bounds the one read so a slow downloads host cannot hold the
 * status route. A response that does not parse as a version is treated as "no new release this tick".
 */
export declare function latestClaude(channel: Channel, fetchFn?: FetchFn, now?: number, timeoutMs?: number): Promise<string | undefined>;
/** Test seam: forget what was read. */
export declare function forgetLatestClaude(): void;
/**
 * The version the box reports from `claude --version`, or null when the binary is not on the path
 * or does not answer in time. Only the leading `<major>.<minor>.<patch>` segment matters.
 */
export declare function installedClaude(exec: Exec): Promise<string | null>;
/** The user's release channel from settings, or `"latest"` when there is no key or it is unrecognised. */
export declare function channelFrom(settingsText: string | undefined): Channel;
/**
 * Which of the two disable knobs are set, if any: `DISABLE_UPDATES` before `DISABLE_AUTOUPDATER`,
 * or undefined when both are off and the settings file does not override them.
 */
export declare function offBy(env: NodeJS.ProcessEnv, settingsText: string | undefined): "DISABLE_AUTOUPDATER" | "DISABLE_UPDATES" | undefined;
/**
 * The last non-empty line of `out`, else the last non-empty line of `error ?? ""`, trimmed and
 * capped at 200 characters. Returns undefined when both strings are empty after trimming.
 */
export declare function lastLine(out: string, error: string | undefined): string | undefined;
/**
 * Load one box's record from `dir/claude-updates.json`, answering `{ log: [] }` when the file is
 * missing, unreadable, not an object, or the key has no `log` array. A malformed entry is dropped
 * on its own; the rest of the history stays.
 */
export declare function readUpdates(dir: string, key: string): Promise<ClaudeUpdates>;
/**
 * Persist one box's record under `dir/claude-updates.json`, serialised against other writers by a
 * module-level chain. Re-reads the whole file first so a concurrent save cannot lose an entry from
 * another box; truncates `log` to the newest 50 on every write. The directory is created with
 * `recursive: true` when it does not exist yet.
 */
export declare function writeUpdates(dir: string, key: string, data: ClaudeUpdates): Promise<void>;
/** True when `state` has a newer release available and neither disable knob is on. */
export declare function newer(state: ClaudeUpdateState | undefined): boolean;
/** A card to show the user when a newer release is out and auto-update is off and not dismissed. */
export declare function cardFor(state: ClaudeUpdateState | undefined): ClaudeUpdateCard | null;
export interface ClaudeUpdaterOptions {
    dir: string;
    host: string;
    label: string;
    /** Path of the box's user settings.json; undefined for a box whose file is not readable from here. */
    settingsPath?: string;
    env: NodeJS.ProcessEnv;
    exec: Exec;
    /** Called with `host` after a run that installed a new version. */
    onUpdated?: (host: string) => void;
    fetchFn?: FetchFn;
    now?: () => number;
    readSettings?: (path: string) => Promise<string | undefined>;
}
/** Keeps one box's Claude Code current: reads the release channel, checks for a newer version,
 *  runs `claude update` from a button or on its own, and keeps the log of runs on disk. */
export declare class ClaudeUpdater {
    private readonly opts;
    private readonly key;
    private stateValue;
    private loadPromise;
    /** The run in flight, handed to every caller that asks while it lasts. */
    private running?;
    /** Fill in the settings reader and clock defaults, start as not installed on the latest
     *  channel, and begin loading the saved record. */
    constructor(opts: ClaudeUpdaterOptions);
    /** Read the persisted record into `auto`, `skipped`, `folded` and `log`. */
    private load;
    /** The four fields the file keeps, out of the state. */
    private record;
    /** Now in epoch milliseconds, from the injected clock when a test set one. */
    private tick;
    /** The last answer, no I/O. */
    state(): ClaudeUpdateState;
    /** Refresh installed, channel, off and latest. Never installs. */
    check(): Promise<ClaudeUpdateState>;
    /** Run `claude update` on the box; a second caller while one runs gets the same promise. */
    runUpdate(by: "button" | "auto"): Promise<ClaudeUpdateEntry>;
    /** Run `claude update` and log the result. Success means the installed version moved, whatever
     *  the CLI printed, and a failed run marks the latest release skipped so it is not offered
     *  again. */
    private runOnce;
    /** Toggle auto-update on or off and persist the change. */
    setAuto(on: boolean): Promise<ClaudeUpdateState>;
    /** Dismiss the card for `version`; refuse when it is not a parseable version. */
    skip(version: string): Promise<ClaudeUpdateState>;
    /** Fold the card to its header for `version`, or open it again with `null`; a version that
     *  does not parse changes nothing. */
    fold(version: string | null): Promise<ClaudeUpdateState>;
}
export {};
