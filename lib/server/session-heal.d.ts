import { type Catalog } from "./session-repair.js";
import { type SessionRepairRecord, type SessionRepairsFile } from "./state.js";
/** A session log header as `list()` hands it: the id and cwd `locate` needs. */
export interface HealHeader {
    id: string;
    cwd?: string;
}
/** What the heal needs from dsh: the persistence service with the two calls the plugin's mirror
 *  type lacks today, and the catalog loader. `locate` is optional because dsh 0.1.5 and 0.1.6
 *  are not known to have it; without it the sweep has no path and skips, while the on-open and
 *  wake paths still work from the error text. */
export interface HealHost {
    persistence: {
        list(): Promise<Array<HealHeader | {
            header: HealHeader;
            sizeBytes?: number;
        }>>;
        open(id: string, access: "read"): Promise<{
            read?(offset: number): Promise<{
                events: readonly {
                    type: string;
                }[];
            }>;
            close(): Promise<void>;
        }>;
        locate?(meta: {
            id: string;
            cwd?: string;
        }): {
            kind: string;
            path: string;
        };
    };
    /** dsh's catalog, or undefined when it cannot be found; then nothing is written. */
    catalog(): Promise<Catalog | undefined>;
    stateDir: string;
    log(level: "info" | "warn", message: string): void;
}
/** The plugin's own word for a log that loads today and is refused after its first live turn. */
export declare const HEADLESS = "headless";
/** Ask dsh to load the log the way a click would, without taking its write lock. Undefined when
 *  it loads with a system head; the sentinel `"headless"` when it loads but its first surface
 *  row (`SURFACE`) is not a `system/message`, the shape a restore seeded before #101 that has
 *  not had a live turn yet (it loads today and is refused from the first reload after that
 *  turn); otherwise the refusal text. The headless check reads the events the read-open already
 *  decoded, so it costs no second parse. A not-found error reads as undefined: nothing to heal. */
export declare function probeLoad(host: HealHost, id: string): Promise<string | undefined>;
/** The path dsh named in a refusal, `(raw log: /abs/path)`, or undefined when the text has none. */
export declare function rawLogPath(message: string): string | undefined;
/** Heal one refused log in place: decode, `repair()`, prove with the catalog, write with a
 *  `.bak`, prove again through dsh's own load, roll back if that second proof fails. Records the
 *  verdict under the session id and returns it. Never throws for a refusal; a file that cannot
 *  be read at all is recorded as `unknown` with the read error as its reason. */
export declare function healLog(host: HealHost, id: string, path: string, reason: string): Promise<SessionRepairRecord>;
/** Walk every stored current-version log once, skipping the ones whose stat matches their
 *  record, probing the rest through dsh and healing the known refusals. Runs to completion on
 *  its own; a throw on one log is recorded as `unknown` for that log and the walk goes on. Yields
 *  to the event loop between logs so a first sweep does not stall requests. A log whose located
 *  path does not exist is an older generation dsh migrates itself on its next write-open, and is
 *  skipped with no record. */
export declare function sweepRefusedLogs(host: HealHost): Promise<{
    healed: number;
    unknown: number;
    rolledBack: number;
}>;
/** What the panel's notice counts: verdicts newer than the dismissal, and the newest one's time. */
export interface RepairsSummary {
    healed: number;
    unknown: number;
    rolledBack: number;
    /** The newest counted entry's `at`, 0 when nothing counted; a dismissal records it. */
    at: number;
}
/** The summary the panel shows: entries newer than `seenAt`, counted by verdict, and the newest
 *  entry's time so a dismissal can name it. */
export declare function repairsSummary(file: SessionRepairsFile, seenAt: number): RepairsSummary;
