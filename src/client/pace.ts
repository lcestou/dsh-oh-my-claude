/** Window lengths of the two plan limits, in ms: the API sends only the reset time, and the
 *  elapsed share of a window is what turns a percent into a pace. */
export const WINDOW_MS = { session: 5 * 3_600_000, weekly: 7 * 86_400_000 } as const;

/** What a window's burn rate projects: the cap is hit at `at` (epoch ms) before the reset, or the
 *  window ends at `percent` used. */
export type Pace = { kind: "cap"; at: number } | { kind: "ends"; percent: number };

/**
 * Projects a window's usage linearly from how much of it has elapsed. Undefined when the reset is
 * unknown, when less than 5 % of the window has passed (a fresh window reads any first call as a
 * runaway rate), when nothing has been used, or when the window has already reset. The projection
 * is linear on purpose: a pace mark answers "at this rate", not "given your habits".
 */
export function paceOf(
  usedPercent: number,
  resetsAt: number | null,
  windowMs: number,
  now = Date.now(),
): Pace | undefined {
  if (resetsAt === null || usedPercent <= 0) return undefined;
  const left = resetsAt - now;
  const elapsed = windowMs - left;
  if (left <= 0 || elapsed < windowMs * 0.05) return undefined;
  const projected = (usedPercent * windowMs) / elapsed;
  if (projected < 100) return { kind: "ends", percent: Math.round(projected) };
  // Time to the cap at the same rate: the remaining percent takes (remaining / used) of the
  // time spent so far.
  const at = now + ((100 - usedPercent) / usedPercent) * elapsed;
  return { kind: "cap", at };
}
