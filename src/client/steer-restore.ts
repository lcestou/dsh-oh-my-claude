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
  /** The composer's text at the last update. */
  draft: string;
  /** Texts that filled an empty composer in one update, the way dsh restores a draft. */
  jumps: Array<{ text: string; at: number }>;
}

/** One step's answer: the watch to keep, the composer ids to take off, and whether to clear the
 *  composer's text. */
export interface RestoreStep {
  next: RestoreWatch;
  remove: string[];
  clearDraft: boolean;
}

/** When this tab took each steer back (Edit, Remove, Send now), by message id. Module state: the
 *  card that clicked may be gone by the time dsh's restore lands, and the watch outlives it. */
const withdrawnAt = new Map<string, number>();

/** Record steers this tab is taking back, so their restore can pair. */
export const noteWithdrawn = (ids: readonly string[], at = Date.now()): void => {
  for (const id of ids) withdrawnAt.set(id, at);
};

/** The steers taken back from this tab within the window, dropping older records as it reads. */
export const withdrawnSince = (at: number): Set<string> => {
  for (const [id, when] of withdrawnAt) if (at - when >= RESTORE_WINDOW_MS) withdrawnAt.delete(id);
  return new Set(withdrawnAt.keys());
};

/** A watch that starts from what the composer and the list hold now, so nothing already there pairs. */
export const startWatch = (
  ids: readonly string[],
  rows: readonly WaitingSteerRow[],
  draft = "",
): RestoreWatch => ({ ids, rows, left: [], heads: [], words: [], draft, jumps: [] });

/**
 * Advance the watch by one update and say what to undo. dsh restores a failed attachment send by
 * putting its ids at the head of the composer's row (a file the person picks lands at the tail)
 * and its text into an empty composer. Only a steer that was taken back counts: one in
 * `withdrawn` (this tab's Edit, Remove or Send now, or a row now held from any tab). A steer Claude
 * took leaves the list too, and a file picked into an empty composer right after would otherwise
 * look like its restore. A withdrawn steer pairs with a head insertion of the same count, in either
 * order, within RESTORE_WINDOW_MS; its ids go in `remove`, and `clearDraft` turns true when the
 * composer holds exactly its text and that text filled an empty composer in one update, which is
 * how dsh restores it; typing builds text up a key at a time. Gets wrong: pasting exactly the
 * withdrawn steer's words into an empty composer within the window clears them, a file picked into
 * an empty composer within the window after taking an attachment steer back from this tab is
 * removed, and a steer removed from another tab leaves its restore here in place.
 */
export function stepRestore(
  watch: RestoreWatch,
  now: {
    ids: readonly string[];
    rows: readonly WaitingSteerRow[];
    draft: string;
    at: number;
    withdrawn: ReadonlySet<string>;
  },
): RestoreStep {
  const fresh = (e: { at: number }) => now.at - e.at < RESTORE_WINDOW_MS;
  let left = watch.left.filter(fresh);
  let heads = watch.heads.filter(fresh);
  let words = watch.words.filter(fresh);
  const jumps = watch.jumps.filter(fresh);
  const text = now.draft.trim();
  if (watch.draft.trim() === "" && text !== "") jumps.push({ text, at: now.at });
  for (const was of watch.rows)
    if (
      was.attachments?.length &&
      now.withdrawn.has(was.id) &&
      !now.rows.some((w) => w.id === was.id)
    )
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
  const said = words.find((w) => w.text === text && jumps.some((j) => j.text === text));
  if (said) words = words.filter((w) => w !== said);
  return {
    next: { ids: now.ids, rows: now.rows, left, heads, words, draft: now.draft, jumps },
    remove,
    clearDraft: said !== undefined,
  };
}
