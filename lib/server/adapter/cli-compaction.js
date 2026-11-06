// Where dsh's compaction summary for a Claude session comes from. dsh condenses its own copy of
// the conversation, which Claude never reads, through a `purpose: "compaction"` request this
// adapter serves. dsh measures that copy by the CLI's own reported prompt, so only compacting
// the CLI relieves it: the request is answered with Claude Code's compaction, at dsh's threshold.
/** Claude Code is inside a turn: running, or held on relayed tool calls or a steer. */
export const cliMidTurn = (proc) => proc.busy || proc.relays.size > 0 || proc.parked !== undefined;
/** Pick the route; a pending CLI summary wins over the rest, since reusing it costs nothing and
 *  leaves the CLI alone. */
export function compactionRoute(facts) {
    if (!facts.enabled)
        return { kind: "fallback", why: "cliCompaction off" };
    if (facts.pending !== undefined)
        return { kind: "reuse", summary: facts.pending };
    if (facts.provider !== undefined && facts.provider !== facts.ownProvider)
        return { kind: "fallback", why: `switching to ${facts.provider}` };
    if (facts.mirrored)
        return { kind: "fallback", why: "terminal mirror on" };
    if (!facts.reachable)
        return { kind: "fallback", why: "no live process or turn on record" };
    if (facts.switchPending && (facts.midTurn || facts.justCompacted))
        return { kind: "fallback", why: "model switch pending" };
    if (facts.justCompacted)
        return {
            kind: "refuse",
            why: "Claude Code compacted this session already; dsh's figure catches up after the next request",
            owe: false,
        };
    if (facts.midTurn)
        return {
            kind: "refuse",
            why: "Claude Code is mid-turn; this Claude session compacts with Claude Code's own /compact once the turn ends",
            owe: true,
        };
    return { kind: "cli" };
}
//# sourceMappingURL=cli-compaction.js.map