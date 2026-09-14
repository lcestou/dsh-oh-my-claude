// The panel dialog is not a composer slot, so it never receives `inputActions.setDraft`
// (src/client/shared.ts:614). One queued draft crosses the gap: the panel puts text here, a
// renderless dock entry takes it and writes the composer. Module state, one tab, never persisted.

interface Queued {
  session: string;
  text: string;
}
let queued: Queued | null = null;
const subs = new Set<() => void>();

/** Queue text for a session's composer. The last call wins: two clicks mean the second prompt. */
export const queueDraft = (session: string, text: string): void => {
  queued = { session, text };
  for (const fn of subs) fn();
};

/** Take the queued draft for a session, if the queued one is that session's. Clears it. */
export const takeDraft = (session: string): string | undefined => {
  if (queued === null || queued.session !== session) return undefined;
  const { text } = queued;
  queued = null;
  return text;
};

// The other direction: what is in the composer right now, mirrored out of the dock entry that can
// read it. `useInput` is a hook, so only a slot component sees the draft; the recap watcher is a
// plain interval and cannot. One tab, never persisted, empty when no composer is mounted.
let typed = "";

export const noteDraft = (text: string): void => {
  typed = text;
};

/** Whether the person is mid-sentence in the composer. The CLI skips its own away summary on this. */
export const draftPending = (): boolean => typed.trim() !== "";

export const subscribeDraft = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};
