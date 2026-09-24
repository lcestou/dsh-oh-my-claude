import type { JsonValue } from "./dsh.js";
/** Tool activity as the Tune switch names it: inline text, or dsh's native tool rows. */
export type ToolMode = "inline" | "rows";
/** What the Tune switch shows: the mode in force and whether rows are open to it at all. */
export interface ToolModeInfo {
    mode: ToolMode;
    rows: RowsSupport;
}
export interface RowsSupport {
    ok: boolean;
    /** Why rows are off, in the words dsh's loader used; empty when they are on. */
    reason: string;
}
/** The first line of a v3 log. */
interface LogHeader {
    type: "session";
    version: number;
    id: string;
    createdAt: number;
    cwd: string;
    isSeeded: boolean;
    delegationDepth: number;
    agentPreset: string;
}
/** One event line of a v3 log: the envelope dsh writes, with the payload it carries. */
interface LogRow {
    type: string;
    seq: number;
    time: number;
    surfaceOp?: "append";
    sourceEventSeqs?: number[];
    data: JsonValue;
}
export interface RawRowsLog {
    header: LogHeader;
    rows: LogRow[];
}
/** The slice of dsh's session-format catalog the probe calls: the restore a load runs. */
export interface Catalog {
    /** The log version this dsh writes. The probe stamps its fixture with it, see `rawRowsLog`. */
    readonly currentVersion?: number;
    createRestore(header: LogHeader, options: {
        recovery: string;
        validation: string;
    }): {
        decodeRow(row: LogRow): void;
        finish(): void;
    };
}
/**
 * A tool's result as the log version stores it. Up to v3 (dsh 0.1.6) it is a user message from the
 * tool source holding one `tool-result` block; from v4 (dsh 0.1.7) it is a first-class message of
 * its own, `role: "tool"`, the call id on the message and the text as plain blocks, and v4's
 * loader refuses the wrapper block outright ("content must not contain a released tool-result
 * wrapper"). The live rows mode gets this right on its own by calling dsh's
 * `createToolResultMessage`; the probe and the Import seed build the message by hand and have to
 * pick the shape themselves.
 */
export declare function toolResultMessage(version: number, callId: string, id: string, text: string, isError?: boolean): JsonValue;
/**
 * The current-format log rows mode writes for one turn with one tool: the announcement, the call
 * and its result sit inside the step, ahead of the settled text message.
 *
 * `version` is the log version the installed dsh writes, not a fixed 3. A fixture stamped below
 * that version is a log needing migration, and dsh 0.1.7's v3-to-v4 migration refuses to run at
 * all without a parent's historical child evidence bound to it ("V3 catalog migration requires
 * explicit historical child facts"). The probe then failed before reaching the row it exists to
 * ask about, and locked rows over a migration a live session never runs.
 */
export declare const rawRowsLog: (version?: number) => RawRowsLog;
/**
 * The installed dsh's session-format catalog, the module its own loader restores a log with.
 * Undefined when dsh cannot be found next to the running entry or the module has no such export,
 * which a caller reads as "cannot judge a log" rather than an error.
 */
export declare function loadSessionCatalog(entry?: string): Promise<Catalog | undefined>;
/**
 * The log version the installed dsh writes: 3 up to 0.1.6, 4 from 0.1.7. Read off dsh's own
 * catalog, so a log this plugin writes carries the version the reader expects. Undefined when the
 * catalog cannot be found or read, which leaves the caller to keep its own default.
 */
export declare function currentLogVersion(entry?: string): Promise<number | undefined>;
/** Feed the synthetic log through dsh's own restore, with the options its load passes. */
export declare function probeRawToolRows(entry?: string): Promise<RowsSupport>;
export {};
