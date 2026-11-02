// Esc Esc in an empty, idle composer: open the panel's Rewind tab on the session's latest prompt,
// the way the Claude Code terminal's double Escape opens /rewind on the last message, and once the
// rewind runs put that prompt back in the composer to edit and resend. The second press is the
// only one taken; a single Escape stays dsh's (it closes dsh's menus, and two of them stop a
// running reply, which is why this fires only while nothing runs). The timing rule is a pure
// function (`escapeStep`) so it is testable without a DOM; the hook owns the listeners.
import { useEffect, useRef } from "react";
import { useHintFlag } from "./hints.js";
import { REWOUND_EVENT } from "./recall.js";
import { inOwnComposer, isClaudeSession, type ClientCtx } from "./shared.js";

/** Fired on `window` to open the plugin's panel on a tab, from code that has no panel of its own.
 *  `rewindLatest` asks the Rewind tab to pick the newest prompt itself, preview and all. */
export const OPEN_PANEL_EVENT = "omc-open-panel";

/** The event's `detail`. */
export interface OpenPanelDetail {
  tab: string;
  rewindLatest?: boolean;
}

/** The `OPEN_PANEL_EVENT` itself, typed: a listener checks `instanceof` and reads `detail`
 *  without parsing, since only this module's callers construct one. */
export class OpenPanelEvent extends Event {
  /** Non-bubbling, not cancelable: fired on `window`, which is where the panel listens. */
  constructor(readonly detail: OpenPanelDetail) {
    super(OPEN_PANEL_EVENT);
  }
}

/** The `REWOUND_EVENT` as the Rewind tab fires it: `text` is the prompt the rewind dropped from
 *  the transcript, for the composer to take back; undefined when the tab had none to name. */
export class RewoundEvent extends Event {
  /** Same event name `recall.ts` listens for as a plain `Event`, so its list goes stale too.
   *  `sessionId` names the session rewound, so only its composer takes the text. */
  constructor(
    readonly sessionId: string,
    readonly text: string | undefined,
  ) {
    super(REWOUND_EVENT);
  }
}

/** How close two Escapes must land to count as one gesture when dsh does not say: the same
 *  half second dsh's own stop sequence defaults to. */
export const ESC_GAP_MS = 500;

/**
 * One Escape against the gesture: `fire` when it is the second within `gapMs` of the first, and
 * the time to remember for the next press (nothing after a firing, so a third press starts over).
 */
export function escapeStep(lastAt: number | null, now: number, gapMs: number) {
  if (lastAt !== null && now - lastAt <= gapMs) return { fire: true, lastAt: null };
  return { fire: false, lastAt: now };
}

/**
 * Mounts the Esc Esc gesture on the composer for one Claude session. Off with the `editLastOff`
 * hint. A press with a modifier, inside an IME composition, outside the composer, with text in the
 * box, or while a turn runs resets the gesture rather than counting; so the two presses that stop
 * a reply never also open the tab. Follows dsh's own double-Escape interval when its shortcuts
 * service is there. The rewind's own half, writing the dropped prompt back, needs `setDraft` and
 * an empty composer: typed text is never replaced.
 */
export function useEditLastPrompt({
  sessionId,
  ctx,
  setDraft,
  draft,
  running,
}: {
  sessionId: string;
  ctx: ClientCtx;
  setDraft: ((text: string) => void) | undefined;
  draft: string;
  running: boolean;
}): void {
  const [off] = useHintFlag("editLastOff");
  const lastAt = useRef<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const runningRef = useRef(running);
  runningRef.current = running;
  const setRef = useRef(setDraft);
  setRef.current = setDraft;
  useEffect(() => {
    if (off) return;
    // Read per press, so a changed dsh interval holds without a remount.
    const gap = () =>
      ctx.get?.<{ stopSequenceMs?: number }>("shortcuts")?.stopSequenceMs ?? ESC_GAP_MS;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inBox = inOwnComposer(e.target, sessionId);
      if (
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.isComposing ||
        e.repeat ||
        !inBox ||
        runningRef.current ||
        draftRef.current.trim() !== "" ||
        !isClaudeSession(ctx, sessionId)
      ) {
        lastAt.current = null;
        return;
      }
      const step = escapeStep(lastAt.current, performance.now(), gap());
      lastAt.current = step.lastAt;
      if (!step.fire) return;
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new OpenPanelEvent({ tab: "Rewind", rewindLatest: true }));
    };
    const onRewound = (e: Event) => {
      if (!(e instanceof RewoundEvent) || e.sessionId !== sessionId || e.text === undefined) return;
      if (draftRef.current.trim() === "") setRef.current?.(e.text);
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener(REWOUND_EVENT, onRewound);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener(REWOUND_EVENT, onRewound);
    };
  }, [off, ctx, sessionId]);
}
