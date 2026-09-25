// How the steer card spots dsh putting a withdrawn attachment steer back in the composer, as a pure
// step so the pairing rules have a test. The hook that feeds it lives with the card in index.tsx.
import type { WaitingSteerRow } from "./events.js";

/** How far apart a withdrawn attachment steer and dsh's restore of it may land and still pair. */
export const RESTORE_WINDOW_MS = 4000;

/** What the watch remembers between one composer or steer-list update and the next. */
export interface RestoreWatch {
  /** The composer's attachment ids at the last update, in row order. */
  ids: readonly string[];
  /** The waiting steers at the last update. */
  rows: readonly WaitingSteerRow[];
  /** Attachment steers that left the waiting list, not yet paired with a restore. */
  left: Array<{ text: string; count: number; at: number }>;
  /** Ids that appeared at the head of the composer's row, not yet paired with a steer. */
  heads: Array<{ ids: string[]; at: number }>;
  /** Texts of paired steers, waiting for dsh to put the same words back in the composer. */
  words: Array<{ text: string; at: number }>;
}

/** One step's answer: the watch to keep, the composer ids to take off, and whether to clear the
 *  composer's text. */
export interface RestoreStep {
  next: RestoreWatch;
  remove: string[];
  clearDraft: boolean;
}

/** A watch that starts from what the composer and the list hold now, so nothing already there pairs. */
export const startWatch = (
  ids: readonly string[],
  rows: readonly WaitingSteerRow[],
): RestoreWatch => ({ ids, rows, left: [], heads: [], words: [] });

/**
 * Advance the watch by one update and say what to undo. dsh restores a failed attachment send by
 * putting its ids at the head of the composer's row (a file the person picks lands at the tail)
 * and its text into an empty composer. A steer leaving the waiting list pairs with a head insertion
 * of the same count, in either order, within RESTORE_WINDOW_MS; its ids go in `remove`, and
 * `clearDraft` turns true once the composer holds exactly its text. A steer Claude took also
 * leaves the list, but no restore follows, so it ages out unpaired. Gets wrong: a head insertion
 * of the same count from anything else inside the window, which dsh does not make today.
 */
export function stepRestore(
  watch: RestoreWatch,
  now: { ids: readonly string[]; rows: readonly WaitingSteerRow[]; draft: string; at: number },
): RestoreStep {
  const fresh = (e: { at: number }) => now.at - e.at < RESTORE_WINDOW_MS;
  let left = watch.left.filter(fresh);
  let heads = watch.heads.filter(fresh);
  let words = watch.words.filter(fresh);
  for (const was of watch.rows)
    if (was.attachments?.length && !now.rows.some((w) => w.id === was.id))
      left.push({ text: was.text.trim(), count: was.attachments.length, at: now.at });
  if (now.ids !== watch.ids) {
    const before = new Set(watch.ids);
    const head: string[] = [];
    for (const id of now.ids) {
      if (before.has(id)) break;
      head.push(id);
    }
    // Only a pure insertion at the head counts; a reorder or a removal alongside it is not dsh's.
    if (head.length > 0 && before.size + head.length === now.ids.length)
      heads.push({ ids: head, at: now.at });
  }
  const remove: string[] = [];
  for (const gone of left) {
    const match = heads.find((h) => h.ids.length === gone.count);
    if (!match) continue;
    remove.push(...match.ids);
    heads = heads.filter((h) => h !== match);
    left = left.filter((l) => l !== gone);
    if (gone.text) words.push({ text: gone.text, at: gone.at });
  }
  const said = words.find((w) => w.text === now.draft.trim());
  if (said) words = words.filter((w) => w !== said);
  return {
    next: { ids: now.ids, rows: now.rows, left, heads, words },
    remove,
    clearDraft: said !== undefined,
  };
}
