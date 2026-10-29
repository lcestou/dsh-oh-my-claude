import { type FsBox } from "./remote-fs.js";
/** How much of the transcript's end is read: a summary runs to some 20k characters, and the
 *  turn's own rows after it are small, so this leaves room for both and for one earlier pair. */
export declare const TAIL_BYTES: number;
/** The summary of the compaction whose boundary reported `preTokens`, from the transcript's tail,
 *  with the CLI's framing stripped. With no `preTokens` to match, the last summary in the tail.
 *  Undefined when the tail holds no matching pair: the row may not be flushed yet, and a caller
 *  that reads again a moment later finds it then. A first line cut mid-row by the tail offset
 *  fails to parse and is skipped like any other non-row line. */
export declare function compactSummaryOf(tail: string, preTokens?: number): string | undefined;
/** Read the summary matching `preTokens` from the end of the transcript at `path` on `box`.
 *  Undefined for a missing file or a tail without it; a box that cannot be reached throws. */
export declare function readCompactSummary(box: FsBox, path: string, preTokens?: number): Promise<string | undefined>;
