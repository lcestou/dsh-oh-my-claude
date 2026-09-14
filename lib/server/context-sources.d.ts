/** Every block dsh adds to a prompt that this plugin can recognise. `runtime` is the file and
 *  approval policy snapshot: it is here to be classified and measured, never to be withheld. */
export declare const CONTEXT_SOURCES: readonly ["instructions", "skills", "runtime"];
export type ContextSource = (typeof CONTEXT_SOURCES)[number];
/** The blocks the Settings switches can withhold. A session without the runtime snapshot asks for
 *  approvals that are auto-rejected, so it is deliberately not in here. */
export declare const TOGGLEABLE: readonly ["instructions", "skills"];
export type Toggleable = (typeof TOGGLEABLE)[number];
/** Which of the toggleable context sources are withheld by the given hint map. */
export declare function contextDrops(hints: Record<string, boolean | number>): Set<ContextSource>;
/** Every row the Settings card shows a number for. Two of them are not messages: `tools` is this
 *  plugin's own guidance appended to the system prompt, and `claudemd` is what the CLAUDE.md filter
 *  took out of dsh's instruction bundle before the rest was sent. */
export declare const CONTEXT_SIZE_KEYS: readonly ["instructions", "skills", "runtime", "tools", "claudemd"];
export type ContextSizeKey = (typeof CONTEXT_SIZE_KEYS)[number];
/** Characters per row, absent where this turn carried nothing to measure. */
export type ContextSizes = Partial<Record<ContextSizeKey, number>>;
