/** Every block dsh adds to a prompt that this plugin can recognise. `runtime` is the file and
 *  approval policy snapshot: it is here to be classified and measured, never to be withheld. */
export const CONTEXT_SOURCES = ["instructions", "skills", "runtime"] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

/** The blocks the Settings switches can withhold. A session without the runtime snapshot asks for
 *  approvals that are auto-rejected, so it is deliberately not in here. */
export const TOGGLEABLE = ["instructions", "skills"] as const;
export type Toggleable = (typeof TOGGLEABLE)[number];

/** Hint key per source. Absent means the block is sent, so a fresh box behaves as it did before
 *  these switches existed; `readHints` drops `false` outright, which is the same thing. */
const OFF_KEY = {
  instructions: "dshContextInstructionsOff",
  skills: "dshContextSkillsOff",
} satisfies Record<Toggleable, string>;

/** True withholds every toggleable block, whatever the per-source keys say. */
const MASTER_KEY = "dshContextOff";

/** Which of the toggleable context sources are withheld by the given hint map. */
export function contextDrops(hints: Record<string, boolean | number>): Set<ContextSource> {
  if (hints[MASTER_KEY] === true) {
    return new Set(TOGGLEABLE);
  }
  const dropped = new Set<ContextSource>();
  for (const t of TOGGLEABLE) {
    if (hints[OFF_KEY[t]] === true) {
      dropped.add(t);
    }
  }
  return dropped;
}
