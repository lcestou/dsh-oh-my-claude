/** Every block dsh adds to a prompt that this plugin can recognise. `runtime` is the file and
 *  approval policy snapshot: it is here to be classified and measured, never to be withheld. */
export declare const CONTEXT_SOURCES: readonly ["instructions", "skills", "runtime"];
export type ContextSource = (typeof CONTEXT_SOURCES)[number];
/** The blocks the Settings switches can withhold. A session without the runtime snapshot asks for
 *  approvals that are auto-rejected, so it is deliberately not in here. */
export declare const TOGGLEABLE: readonly ["instructions", "skills"];
export type Toggleable = (typeof TOGGLEABLE)[number];
/** Hint key per source. These only matter once the master switch is on; absent means the block is
 *  sent, and `readHints` drops `false` outright, which is the same thing. */
export declare const OFF_KEY: {
    instructions: string;
    skills: string;
};
/** The master switch, off unless the box says otherwise: a fresh install sends the prompt, the
 *  CLAUDE.md files and nothing else. Anything but `true` withholds every toggleable block, whatever
 *  the per-source keys say. Named `On` rather than `Off` so the absent key reads as the default. */
export declare const MASTER_KEY = "dshContextOn";
/** Which of the toggleable context sources are withheld by the given hint map. */
export declare function contextDrops(hints: Record<string, boolean | number>): Set<ContextSource>;
/** The fields of a logged `user/message` source that decide which block it is. dsh types the source
 *  as `unknown` in its chat contract and as a loose record in the adapter's message shape, so the
 *  two callers agree on this much and nothing more. */
export type LoggedSource = {
    readonly kind?: string;
    readonly plugin?: string;
} | undefined;
/** Which withheld block a logged source names, if any. `kind: "plugin"` alone is never enough: the
 *  wake notice and the background job notices share that kind and are how those features report
 *  back. */
export declare function sourceBlockOf(source: LoggedSource): ContextSource | undefined;
/** One row of dsh's chat, as much of it as the row mask reads. */
export interface ChatFlowNode {
    readonly kind: string;
    readonly data?: {
        readonly source?: LoggedSource;
    };
}
/**
 * Which chat rows misdescribe a Claude Code session, given what the switches withheld. dsh draws a
 * row for every block it assembled, and a row for a block that never left dsh reads as a receipt
 * for something Claude Code never saw. Two kinds qualify: dsh's own system prompt, which this
 * plugin has never passed on, and any injected block a switch dropped from the prompt.
 * @param order - the chat's render order, as dsh publishes it.
 * @param node - reader for one row by key.
 * @param drops - the blocks the switches are withholding right now.
 * @returns the keys to fold away, in render order.
 */
export declare function maskedRows(order: readonly string[], node: (key: string) => ChatFlowNode | undefined, drops: ReadonlySet<ContextSource>): string[];
/** Every row the Settings card shows a number for. Two of them are not messages: `tools` is this
 *  plugin's own guidance appended to the system prompt, and `claudemd` is what the CLAUDE.md filter
 *  took out of dsh's instruction bundle before the rest was sent. */
export declare const CONTEXT_SIZE_KEYS: readonly ["instructions", "skills", "runtime", "tools", "claudemd"];
export type ContextSizeKey = (typeof CONTEXT_SIZE_KEYS)[number];
/** Characters per row, absent where this turn carried nothing to measure. */
export type ContextSizes = Partial<Record<ContextSizeKey, number>>;
