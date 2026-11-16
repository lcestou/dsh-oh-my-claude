// Where dsh's compaction summary for a Claude session comes from. dsh condenses its own copy of
// the conversation, which Claude never reads, through a `purpose: "compaction"` request this
// adapter serves. dsh measures that copy by the CLI's own reported prompt, so only compacting
// the CLI relieves it: the request is answered with Claude Code's compaction, at dsh's threshold.
/** The variable Claude Code reads, at every request, for the share of its window at which it
 *  compacts on its own: `min(effective window × pct / 100, effective window − 13,000)` on 2.1.325,
 *  where the effective window is the window less the output reservation. */
export const AUTOCOMPACT_PCT_ENV = "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE";
/** `dsh-compaction-basic`'s defaults for what its resolved config leaves out. */
const DSH_THRESHOLD_RATIO = 0.8;
const DSH_HEADROOM_TOKENS = 65536;
/**
 * Where Claude Code should compact on its own, as a percentage of the window: dsh's own threshold
 * for the route, resolved the way `dsh-compaction-basic` does (`min(window × ratio, window −
 * headroom − output reservation)`). dsh asks for its compaction between steps, and a Claude Code
 * mid-turn can only refuse, so without this a turn that crosses dsh's threshold runs on to the
 * CLI's own (about 97% of the window) and every step pays for a context dsh meant to cut. Set to
 * dsh's threshold, the CLI compacts at the same point inside the turn, and a dsh request that
 * still comes takes that summary (`reuse`) instead of a second one. A hair early, since the CLI takes its share of the
 * window less its output reservation. Undefined when dsh does not compact on its own, or for a
 * threshold the CLI's own default already meets.
 */
export function cliCompactPct(settings, route, window, reserved = 0) {
    if (settings === undefined || settings.auto === false)
        return undefined;
    if (window === undefined || !Number.isFinite(window) || window <= 0)
        return undefined;
    const policy = settings.modelPolicies?.find((p) => p.provider === route?.provider && p.model === route?.model);
    const ratio = policy?.thresholdRatio ?? settings.thresholdRatio ?? DSH_THRESHOLD_RATIO;
    const headroom = policy?.headroomTokens ?? settings.headroomTokens ?? DSH_HEADROOM_TOKENS;
    if (!Number.isFinite(ratio) || ratio <= 0)
        return undefined;
    const threshold = Math.min(window * ratio, window - headroom - Math.max(0, reserved));
    if (threshold <= 0)
        return undefined;
    // One decimal, rounded down, so the CLI never compacts later than dsh asks.
    const pct = Math.floor((threshold / window) * 1000) / 10;
    return pct > 0 && pct < 100 ? pct : undefined;
}
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