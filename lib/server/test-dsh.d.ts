import { type Header, type Row } from "./session-repair.js";
import { type SessionRouteOptions } from "./sessions.js";
import type { HealHost } from "./session-heal.js";
import { type JsonValue, type SessionHeader } from "./dsh.js";
/** What a test gets back: dsh's persistence over `root`, the id shapes, the log files, and the
 *  knobs that make dsh refuse or own a log. */
export interface FakeDsh {
    root: string;
    /** dsh's `sessionPersistence`, the four calls the plugin uses, over real files under `root`. */
    persistence: {
        list(): Promise<Array<{
            header: SessionHeader;
        }>>;
        create(header: SessionHeader): Promise<{
            append(events: readonly unknown[]): Promise<void>;
            flush(): Promise<void>;
            close(): Promise<void>;
        }>;
        open(id: string, access: "read" | "write"): Promise<{
            header: SessionHeader;
            read(offset?: number): Promise<{
                events: Row[];
            }>;
            append(events: readonly unknown[]): Promise<void>;
            flush(): Promise<void>;
            close(): Promise<void>;
        }>;
        locate(meta: {
            id: string;
            cwd?: string;
        }): {
            kind: "jsonl";
            path: string;
        };
    };
    /** The calls the persistence took, in order: `create`, `append`, `flush`, `close`, `open:read`,
     *  `open:write`. */
    calls: string[];
    /** The events every `append` received, flattened, oldest first. */
    appended: Row[];
    /** A dsh session id in dsh's own form, `session-<uuid>`, hex throughout, from a short label. */
    sessionId(label: string): string;
    /** The transcript id the plugin keeps a dsh-started session's Claude Code transcript under. */
    transcriptId(dshId: string): string;
    /** The stored log's path for a session in `cwd`, as `locate` answers it. */
    logPath(dshId: string, cwd: string): string;
    /** Write a stored log as dsh would have it on disk and list it. Rows are taken as the tests
     *  build them, plain objects, and read back as dsh's rows. */
    writeLog(dshId: string, cwd: string, rows: readonly object[], version?: number): void;
    /** Read a stored log back through the repair module's reader. */
    readLog(dshId: string, cwd: string): {
        header: Header;
        rows: Row[];
    };
    /** Write a Claude Code transcript under `<projects>/<cwd key>/<transcript id>.jsonl`. */
    writeTranscript(transcriptId: string, cwd: string, rows: object[]): void;
    /** The `projects` directory the transcripts live under, for `projectDir` options. */
    projects: string;
    /** The transcript directory for one workspace, `<projects>/<cwd key>`, as the routes read it. */
    projectDir(cwd: string): string;
    /** Make dsh refuse `dshId`: a constant message until cleared, or a rule read against the log's
     *  rows on every open, which is how dsh's loader really behaves (a repaired log loads). */
    refuse(dshId: string, rule: string | ((rows: Row[]) => string | undefined) | undefined): void;
    /** Make the next `create` throw a plain error, the way a full disk would. */
    failCreate(on: boolean): void;
    /** Make a write-open of `dshId` throw `SessionAlreadyOwnedError`, as dsh does while another
     *  handle holds the lock. */
    own(dshId: string, owned: boolean): void;
    /** A `HealHost` over this persistence with a catalog that accepts every log. */
    heal(stateDir: string): HealHost;
    /** A `PluginContext` slice for `openTranscriptOnce`: no session loaded, this persistence. */
    ctx(): {
        sessions: {
            get(): undefined;
        };
        sessionPersistence: FakeDsh["persistence"];
    };
    /** A workspace registry whose one workspace is `cwd`; `attached` lists the sessions attached. */
    registry(cwd: string): {
        registry: object;
        attached: string[];
    };
    /** Register the plugin's routes against this fake and answer requests to them. */
    routes(options?: Partial<SessionRouteOptions>): {
        respond(method: string, url: string, body?: string): Promise<{
            status: number;
            body: Record<string, JsonValue>;
        }>;
    };
    /** Remove the temp directory. */
    dispose(): void;
}
/**
 * Build the fake over a fresh directory. Throws only when the directory cannot be made. Every
 * method that stands in for dsh answers the way dsh does on this box's 0.1.7: `create` throws
 * `SessionAlreadyExistsError` when the log file exists, `open` throws
 * `SessionPersistenceNotFoundError` when it does not, `locate` names the current-generation path
 * whether or not the file exists, and `list` answers header snapshots.
 */
export declare function fakeDsh(root: string): FakeDsh;
/** The session directories the fake wrote, for a test that wants to count them. */
export declare const storedSessions: (fake: FakeDsh) => string[];
