/** A span of seqs a row shadows or replaces; dsh carries more fields on it than the repair reads. */
type Range = {
    start: number;
    end: number;
    [key: string]: unknown;
};
/** One seq, or an inclusive pair standing for a run of them. */
type Ref = number | [number, number];
/** A block of an assistant message; only `tool-call` blocks matter here. */
export type Block = {
    type: string;
    id?: string;
    [key: string]: unknown;
};
/** The payload fields the repair reads. dsh's events carry plenty more, which pass through as-is. */
export type Data = {
    callId?: string;
    message?: {
        content?: Block[];
        source?: {
            callId?: string;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    shadowedSeqs?: number[];
    shadowedRange?: Range;
    messageSeqs?: number[];
    texts?: string[];
    dt?: number[];
    [key: string]: unknown;
};
/** A log row. Ordinary rows own one `seq`; a packed chunk run owns `seq0` plus one slot per chunk. */
export type Row = {
    type: string;
    seq?: number;
    seq0?: number;
    data?: Data;
    surfaceOp?: string | Record<string, unknown>;
    sourceEventSeqs?: Ref[];
    [key: string]: unknown;
};
export type Header = {
    version?: number;
    [key: string]: unknown;
};
/** As much of dsh's session-format catalog as the repair calls. `src/rows-probe.ts` loads the
 *  installed dsh's and its type is assignable here. */
export type Catalog = {
    currentVersion?: number;
    createRestore(header: Header, options: {
        recovery: string;
        validation: string;
    }): {
        decodeRow(row: Row): void;
        finish(): void;
    };
};
/** The event types dsh folds onto the conversation surface; the first of them is the system head. */
export declare const SURFACE: Set<string>;
/**
 * Drop unadvertised tool rows and keep every seq reference consistent. A `tool/call` no
 * `assistant/message` tool-call block advertised is what rows mode wrote for Claude Code's own
 * tools; dsh 0.1.5's v0 migration refused it, and dsh 0.1.7 refuses it again in v4 logs at load,
 * as "has no advertised tool lifecycle". The v4 result rows are the same rows to drop, found
 * through the call id they carry on the message.
 *
 * Then, when the first surface row is not a `system/message`, insert the head the seed writes
 * since 2026-09-23 ahead of it, inside the same step, in the source shape `version` requires
 * (plugin source up to v3, system-prompt from v4). A log with no surface row at all is left as is.
 */
export declare function repair(rows: Row[], version?: number): {
    rows: Row[];
    droppedCalls: number;
    addedHead: boolean;
    closedCalls: number;
};
/** Whether the log's first surface row is something other than a `system/message`: the shape the
 *  Restore tab seeded before 2026-09-23. A log with no surface row at all is not headless. */
export declare const headless: (rows: Row[]) => boolean;
/** The four refusal texts the repair mends, as dsh 0.1.5 to 0.1.7 word them, plus `headless`,
 *  the plugin's own word (never dsh's) for a log that loads today but has no system head and
 *  will be refused after its first live turn. A message holding none of them is a refusal the
 *  plugin does not understand and leaves alone. */
export declare const KNOWN_REFUSALS: readonly ["does not match one advertised tool call", "has no advertised tool lifecycle", "protected first surface head", "leaves unresolved tool call", "headless"];
/** Whether dsh's refusal is one `repair()` mends. False for any other text, including an empty
 *  one, so an unrecognised failure is reported rather than rewritten. */
export declare function knownRefusal(message: string): boolean;
/** Decode a zstd session log (one or more frames) into its header and rows. Throws on an empty
 *  file or a first line that is not JSON; a row that is not JSON also throws, which is the
 *  failure the caller records as unknown. Uses node's own zstd, so no `zstd` binary is needed.
 *  Node 22's `zstdDecompressSync` stops at the first frame (measured 2026-09-23 on the node that
 *  runs dsh-web; bun decodes the whole stream), and a real log is many frames, one per flush, so
 *  the frames are cut at their magic bytes and decoded one by one, the way dsh reads the log. */
export declare function readLog(file: string): {
    header: Header;
    rows: Row[];
};
/** One zstd frame. dsh reads the header as its own frame ("first frame is not exactly one header
 *  line" otherwise), then the rows; two frames back to back are one valid stream. */
export declare const frame: (text: string) => Buffer;
/** Write a repaired log as two frames next to the original, copy the original to
 *  `<file>.bak-<ms>`, rename the new file into place, and return the backup path. The path is
 *  never absent: the rename is atomic on one filesystem, and a crash between the copy and the
 *  rename leaves the original in place and a `.bak` beside it. */
export declare function writeLog(file: string, header: Header, rows: Row[]): string;
/** Copy a backup back over the log it was taken from. Idempotent when the backup is already
 *  gone: nothing to restore, nothing thrown. */
export declare function restoreBak(file: string, bak: string): void;
/** Feed rows through dsh's restore with the options its own load uses; undefined on success,
 *  the refusal message otherwise. Mirrors what dsh does at load, so a log this answers undefined
 *  for is one dsh loads. */
export declare function migrate(catalog: Catalog, header: Header, rows: Row[]): string | undefined;
export {};
