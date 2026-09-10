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
/** The current-format log rows mode would write for one turn with one tool: shapes copied from a
 *  dsh 0.1.5 v3 log. The call and its result sit inside the step, ahead of the settled message. */
export declare const rawRowsLog: () => RawRowsLog;
/** Feed the synthetic log through dsh's own restore, with the options its load passes. */
export declare function probeRawToolRows(entry?: string): Promise<RowsSupport>;
export {};
