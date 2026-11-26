import { type HistoryFile, type HistoryWindow } from "./usage-history.js";
/** The history file, or an empty one when the text is not JSON or not this shape (a torn write, an
 *  older build's, a hand edit). A malformed row is dropped alone; the rest of its login survives. */
export declare function parseUsageHistory(text: string): HistoryFile;
/**
 * The store behind the usage route: loads the file once, folds each fresh reply in, and writes the
 * whole file in the background one write at a time, each snapshotting the map as it starts, so a
 * slow write never lands over a later one. A failed write is dropped, not retried: memory keeps the
 * rows and the next change writes them again. `read` and `write` are the caller's (`readFile`,
 * `writeJson`), so tests can hand in their own.
 */
export declare function createUsageHistory(read: () => Promise<string>, write: (value: HistoryFile) => Promise<void>): {
    /** Folds one fresh reply into `login`'s rows; writes only when a row changed. */
    record: (login: string, windows: readonly HistoryWindow[], fetchedAt: number) => Promise<void>;
    /** `login`'s ended windows as of `now`; `{}` for a login never recorded. */
    view: (login: string, now: number) => Promise<import("./usage-history.js").UsageHistory>;
};
