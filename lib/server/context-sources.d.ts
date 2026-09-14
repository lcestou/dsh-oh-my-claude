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
