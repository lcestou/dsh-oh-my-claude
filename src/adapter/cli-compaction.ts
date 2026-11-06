// Where dsh's compaction summary for a Claude session comes from. dsh condenses its own copy of
// the conversation, which Claude never reads, through a `purpose: "compaction"` request this
// adapter serves. dsh measures that copy by the CLI's own reported prompt, so only compacting
// the CLI relieves it: the request is answered with Claude Code's compaction, at dsh's threshold.

/** How one dsh compaction request is answered. `reuse`: the summary of a compaction the CLI made
 *  that dsh has not taken yet. `cli`: run `/compact` on the session's CLI now. `refuse`: fail the
 *  request, which dsh logs and steps past; `owe` asks for the compaction once the agent is idle.
 *  `fallback`: the one-shot summarizer, as before this existed. `why` goes to resume.log. */
export type CompactionRoute =
  | { kind: "reuse"; summary: string }
  | { kind: "cli" }
  | { kind: "refuse"; why: string; owe: boolean }
  | { kind: "fallback"; why: string };

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
export const cliMidTurn = (proc: {
  busy: boolean;
  relays: { size: number };
  parked: string | undefined;
}): boolean => proc.busy || proc.relays.size > 0 || proc.parked !== undefined;

/** Pick the route; a pending CLI summary wins over the rest, since reusing it costs nothing and
 *  leaves the CLI alone. */
export function compactionRoute(facts: CompactionFacts): CompactionRoute {
  if (!facts.enabled) return { kind: "fallback", why: "cliCompaction off" };
  if (facts.pending !== undefined) return { kind: "reuse", summary: facts.pending };
  if (facts.provider !== undefined && facts.provider !== facts.ownProvider)
    return { kind: "fallback", why: `switching to ${facts.provider}` };
  if (facts.mirrored) return { kind: "fallback", why: "terminal mirror on" };
  if (!facts.reachable) return { kind: "fallback", why: "no live process or turn on record" };
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
