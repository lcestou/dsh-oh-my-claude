import { type RunningTotals } from "./process.js";
/** The part of a stored turn the repair reads and rewrites. */
export interface StoredTurn {
    costUsd: number;
    apiMs: number;
    durationMs: number;
    /** The session's totals as this turn's result reported them, on records written since they were
     *  kept. Such a record is touched only when its own cost equals that total. */
    costTotal?: number;
    apiTotal?: number;
}
/** What a repair answers: the session's records, changed ones as copies, and how many changed. */
export interface Repaired<T> {
    turns: T[];
    repaired: number;
}
/**
 * A session's records with each running total put back to that turn's own share.
 *
 * A suspect record's figures are taken as the session's totals at the end of that turn. What the
 * session stood at before it is the largest total known to be smaller: one the CLI wrote to the
 * transcript when a process exited (`exits`), or the total the records before it add up to. The
 * difference is the turn's own.
 *
 * That base can be too low (a process that died without writing its totals, records dropped off
 * the front of the ring) or missing, and then the difference still holds turns that are not this
 * one, which shows as API time longer than the turn. Such a record is cut to the turn's length at
 * the rate the figure itself implies: cost per second of API time, times the seconds the turn
 * lasted. That is an estimate, an upper one for a turn that ran one call at a time. The one record
 * left as stored is the first of a session whose records are all still here, where the total and
 * the turn are the same figure.
 *
 * Wrong in one case: a turn that really did spend longer on the API than it lasted, by running
 * subagents side by side, is read as a total and comes out too low.
 * @param exits totals from the transcript's `cost-state` rows, in any order
 * @param whole the session's first record is still among `turns` (the ring has not dropped any)
 * @returns the records, repaired ones as copies, and how many changed
 */
export declare function repairTurns<T extends StoredTurn>(turns: readonly T[], exits: readonly RunningTotals[], whole?: boolean): Repaired<T>;
/** What `repairStoredTurns` needs from the adapter that owns the records. */
export interface RepairHost {
    /** The plugin's state directory: `turns.json`, its copy and the marker live here. */
    stateDir: string;
    /** Claude Code's home on this box; transcripts are under `projects/` in it. */
    claudeHome: string;
    /** The live records, by dsh session id. Repaired lists are rewritten in place. */
    buffer: Map<string, StoredTurn[]>;
    /** The sessions whose records came from this state directory; others are another mount's. */
    ids: ReadonlySet<string>;
    /** How many records a session keeps; a shorter list still has the session's first record. */
    ring: number;
    /** The Claude transcript id a dsh session id maps to. */
    claudeIdOf: (sessionId: string) => string;
    /** Persist one session's records. */
    save: (sessionId: string, turns: StoredTurn[]) => Promise<void>;
}
/** What one pass did, as written to the marker and the log. */
export interface RepairReport {
    at: number;
    sessions: number;
    repaired: number;
}
/** The marker a finished pass leaves, so the next start does not run it again. */
export declare const REPAIR_MARKER: (stateDir: string) => string;
/**
 * Repair every stored session once. Before anything is rewritten, `turns.json` is copied to
 * `turns.json.before-repair`, so the stored figures are one file move from back. A pass that
 * finds a marker does nothing and answers undefined. Transcripts are read from this box only: a
 * session that ran on an SSH box, or whose transcript is gone, is repaired from its own records
 * alone. A session that cannot be read or saved is skipped, and the marker is still written, so a
 * broken file does not make every start read every transcript again.
 */
export declare function repairStoredTurns(host: RepairHost): Promise<RepairReport | undefined>;
