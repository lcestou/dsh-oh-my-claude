/** How one dsh compaction request is answered. `reuse`: the summary of a compaction the CLI made
 *  that dsh has not taken yet. `cli`: run `/compact` on the session's CLI now. `refuse`: fail the
 *  request, which dsh logs and steps past; `owe` asks for the compaction once the agent is idle.
 *  `fallback`: the one-shot summarizer, as before this existed. `why` goes to resume.log. */
export type CompactionRoute = {
    kind: "reuse";
    summary: string;
} | {
    kind: "cli";
} | {
    kind: "refuse";
    why: string;
    owe: boolean;
} | {
    kind: "fallback";
    why: string;
};
export type CompactionFacts = {
    enabled: boolean;
    /** A CLI compaction summary dsh has not taken yet. */
    pending: string | undefined;
    /** The provider the session runs its next request on; another one means the session is moving
     *  away from Claude, and the model it moves to reads dsh's copy, so that copy needs a summary. */
    provider: string | undefined;
    ownProvider: string;
    /** The terminal mirror is on: the session belongs to a terminal, not to this adapter. */
    mirrored: boolean;
    /** A live process, or a turn since dsh started whose spec can start one, to run `/compact` on. */
    reachable: boolean;
    /** Claude Code is inside a turn: running, or held on relayed tool calls or a steer. A `/compact`
     *  written now would queue behind that turn. */
    midTurn: boolean;
    /** The CLI compacted since its last request. dsh still prices the prompt that request reported
     *  until the next one reports, so it asks again for a compaction that already happened. */
    justCompacted: boolean;
    /** A model picked since the last request: dsh may be compacting ahead of the switch, and a
     *  failed compaction there fails the switch. */
    switchPending: boolean;
};
/** Claude Code is inside a turn: running, or held on relayed tool calls or a steer. */
export declare const cliMidTurn: (proc: {
    busy: boolean;
    relays: {
        size: number;
    };
    parked: string | undefined;
}) => boolean;
/** Pick the route; a pending CLI summary wins over the rest, since reusing it costs nothing and
 *  leaves the CLI alone. */
export declare function compactionRoute(facts: CompactionFacts): CompactionRoute;
