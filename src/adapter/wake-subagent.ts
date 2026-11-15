import { hasPendingNotice } from "../state.js";
import { RECONNECT_TEXT, RELOAD_TEXT, RESTART_TEXT } from "./turn.js";

/** The parent of a subagent's session and whether a restart notice already waits in its inbox, or
 *  undefined for any other session: a fork carries a parent too, but dsh resumes it like a root.
 *  `events` is called only for a subagent's session, so a caller can pass a lazy read. */
export function subagentLinkOf(
  header: { parentSession?: string; origin?: string },
  events: () => Iterable<{ type: string; data?: unknown }>,
): { parentId: string; noticePending: boolean } | undefined {
  if (header.origin !== "subagent" || !header.parentSession) return undefined;
  return {
    parentId: String(header.parentSession),
    noticePending: hasPendingNotice(events(), "dsh-oh-my-claude", [
      RESTART_TEXT,
      RECONNECT_TEXT,
      RELOAD_TEXT,
    ]),
  };
}
