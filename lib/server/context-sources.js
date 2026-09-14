/** Every block dsh adds to a prompt that this plugin can recognise. `runtime` is the file and
 *  approval policy snapshot: it is here to be classified and measured, never to be withheld. */
export const CONTEXT_SOURCES = ["instructions", "skills", "runtime"];
/** The blocks the Settings switches can withhold. A session without the runtime snapshot asks for
 *  approvals that are auto-rejected, so it is deliberately not in here. */
export const TOGGLEABLE = ["instructions", "skills"];
/** Hint key per source. Absent means the block is sent, so a fresh box behaves as it did before
 *  these switches existed; `readHints` drops `false` outright, which is the same thing. */
export const OFF_KEY = {
    instructions: "dshContextInstructionsOff",
    skills: "dshContextSkillsOff",
};
/** True withholds every toggleable block, whatever the per-source keys say. */
export const MASTER_KEY = "dshContextOff";
/** Which of the toggleable context sources are withheld by the given hint map. */
export function contextDrops(hints) {
    if (hints[MASTER_KEY] === true) {
        return new Set(TOGGLEABLE);
    }
    const dropped = new Set();
    for (const t of TOGGLEABLE) {
        if (hints[OFF_KEY[t]] === true) {
            dropped.add(t);
        }
    }
    return dropped;
}
/** Which withheld block a logged source names, if any. `kind: "plugin"` alone is never enough: the
 *  wake notice and the background job notices share that kind and are how those features report
 *  back. */
export function sourceBlockOf(source) {
    if (source?.kind === "agent-instructions")
        return "instructions";
    if (source?.kind === "skill-catalog")
        return "skills";
    if (source?.kind === "plugin" && source.plugin === "@deepseek-ai/dsh-system-prompt")
        return "runtime";
    return undefined;
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
export function maskedRows(order, node, drops) {
    const masked = [];
    for (const key of order) {
        const row = node(key);
        if (row === undefined)
            continue;
        if (row.kind === "system-prompt") {
            masked.push(key);
            continue;
        }
        if (row.kind !== "context")
            continue;
        const block = sourceBlockOf(row.data?.source);
        if (block !== undefined && drops.has(block))
            masked.push(key);
    }
    return masked;
}
/** Every row the Settings card shows a number for. Two of them are not messages: `tools` is this
 *  plugin's own guidance appended to the system prompt, and `claudemd` is what the CLAUDE.md filter
 *  took out of dsh's instruction bundle before the rest was sent. */
export const CONTEXT_SIZE_KEYS = [...CONTEXT_SOURCES, "tools", "claudemd"];
//# sourceMappingURL=context-sources.js.map