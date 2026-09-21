// Which plan limits bind the session in front of the reader, and how badly. The API grades every
// window itself (`severity`) and names the model a scoped one belongs to, so this follows its
// grading rather than a threshold of ours, and a model or limit kind added later is covered by
// the same rule without an edit here.

/** A usage window as the usage route sends it. */
export interface LimitWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  severity?: string;
  model?: string;
}

/** How loud a limit is: `critical` when the API says so, `warning` for any other grade that is
 *  not `normal`, so a grade the API adds later still shows rather than passing silently. */
export type LimitLevel = "critical" | "warning";

/** A name's words, lowercased: `claude-fable-5-1` gives claude, fable, 5, 1. */
const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Whether a window counts against a session on `model`. One not scoped to a model counts against
 *  every session; one scoped to a model counts when every word of that model's name is a whole word
 *  of the session's model id (`Fable` in `claude-fable-5-1`), so a short name cannot match inside
 *  a longer one. Never when the session's model is unknown. */
export function bindsModel(w: LimitWindow, model: string | undefined): boolean {
  if (w.model === undefined) return true;
  if (!model) return false;
  const have = new Set(words(model));
  const need = words(w.model);
  return need.length > 0 && need.every((x) => have.has(x));
}

/** The loudest window that binds `model`, with its level, or undefined when every binding window
 *  is normal or ungraded. Critical beats warning; between two at the same level, the one that
 *  resets later wins, since that is how long the session is held up. */
export function worstLimit(
  windows: readonly LimitWindow[],
  model: string | undefined,
): { level: LimitLevel; window: LimitWindow } | undefined {
  let found: { level: LimitLevel; window: LimitWindow } | undefined;
  for (const w of windows) {
    if (!w.severity || w.severity === "normal" || !bindsModel(w, model)) continue;
    const level: LimitLevel = w.severity === "critical" ? "critical" : "warning";
    const louder = !found || (level === "critical" && found.level === "warning");
    const longer = found?.level === level && (w.resetsAt ?? 0) > (found.window.resetsAt ?? 0);
    if (louder || longer) found = { level, window: w };
  }
  return found;
}
