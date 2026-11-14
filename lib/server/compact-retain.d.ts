import type { CompactionService } from "./dsh.js";
/** dsh's own default: the newest 16% of the window stays verbatim (`dsh-compaction-basic`). */
export declare const DEFAULT_RETAIN_RATIO = 0.16;
/** How much of the transcript's end to read for a `budget`-token tail. Rows past it are not seen,
 *  which only keeps the tail shorter. */
export declare const retentionSpan: (budget: number) => number;
/** Retention settings as dsh's compaction service holds them, global and per model. */
export type RetentionSettings = NonNullable<CompactionService["config"]>;
/**
 * The verbatim budget in tokens, resolved the way dsh resolves its own: an exact provider/model
 * policy's `retainTokens` or `retainRatio` first, then the global pair, then the 16% default. A
 * ratio is of the whole window; dsh takes it of the window less its own output reservation, which
 * this route does not have, since Claude Code picks its own output cap. Zero with no window.
 */
export declare function retainBudget(settings: RetentionSettings | undefined, route: {
    provider: string;
    model: string;
} | undefined, window: number | undefined): number;
/** Tokens for a stretch of text, estimated without a tokenizer: a quarter token per ASCII
 *  character, one per other character, which keeps Chinese or Japanese text from reading as a
 *  quarter of its real cost. */
export declare function estimateTokens(text: string): number;
/**
 * Instructions for `/compact` on the transcript as it stands before the compaction: summarize only
 * what comes before the rows that will be kept. Undefined when nothing would be kept. The rows
 * actually kept are chosen again after the compaction (`widenPreserved`), by the same rule on the
 * same rows, so the two agree unless the transcript changed in between.
 */
export declare function compactInstructions(text: string, budget: number): string | undefined;
/** The replacement for the compaction's boundary row, or why there is none. `start` and `end`
 *  are the boundary line's character range in the text it was found in, newline excluded. */
export type BoundaryEdit = {
    kind: "edit";
    start: number;
    end: number;
    line: string;
    kept: number;
    tokens: number;
} | {
    kind: "skip";
    why: string;
};
/**
 * The last compaction's boundary row with its kept list widened to the newest rows that fit
 * `budget`, read from the transcript's tail after the compaction. The rows are those that led up
 * to the compaction (the boundary's `logicalParentUuid`), and the kept rows keep their anchor:
 * the summary row, which the CLI splices them after. Skipped when the CLI already keeps as much,
 * when its own kept rows are not all inside the wider list (a shape this does not know), or when
 * there is no summary row to anchor to.
 */
export declare function widenPreserved(text: string, budget: number): BoundaryEdit;
