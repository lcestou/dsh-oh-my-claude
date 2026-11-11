// Which of dsh's two pending lanes an edited message belongs in. dsh keeps a queue (`next-turn`,
// delivered when the turn ends) and a steer list (`next-step`, delivered at the running turn's next
// step), and picks the lane when a message is sent: plain text by the busy-Enter preference, a
// command or skill always the queue, since its handler queues the line. An edit only replaces the
// text, so a queued `/skill` rewritten into plain words stayed in the queue, and the only way to
// steer it was to copy the text, delete the row and send it again (owner, 2026-11-11). The adapter
// uses what is here to move such a row, and to queue a steer that was edited into a command.
import { serverText } from "../locale.js";
import { textOf } from "./prompt.js";
/** How many queued command rows are remembered. A row leaves when it is moved; one that ran or was
 *  deleted is only pushed out by newer ones, so the cap is what bounds the set. */
const REMEMBERED = 200;
/** The name a pending line opens with when it is a command or skill line (`/name arguments`), read
 *  the way dsh's composer tells a command draft from plain text: leading space ignored, then a
 *  slash. Undefined for plain text, and for a bare `/`. */
export const commandNameOf = (text) => /^\/([^\s/]+)/.exec(text.trimStart())?.[1];
/** The ids of pending messages the command bridge queued, newest last, at most `REMEMBERED`. */
export class CommandRows {
    ids = new Set();
    /** Remember a row; a message without an id cannot be found again and is skipped. */
    add(id) {
        if (!id)
            return;
        this.ids.delete(id);
        this.ids.add(id);
        // SAFETY: the set is over the cap, so it has a first value
        if (this.ids.size > REMEMBERED)
            this.ids.delete(this.ids.values().next().value);
    }
    /** Whether the bridge queued this row and it has not been moved since. */
    has(id) {
        return id !== undefined && this.ids.has(id);
    }
    /** Forget a row, once it has been moved or is known to be plain text. */
    delete(id) {
        this.ids.delete(id);
    }
}
/** Whether a message just written into the queue is a command row edited into plain text: one the
 *  bridge queued, typed by a person, whose words no longer open with a command. A row whose
 *  arguments alone changed is still a command and stays. Blank text never moves. */
export function leavesQueue(m, rows) {
    if (!rows.has(m.id) || m.source?.kind !== "user")
        return false;
    const text = textOf(m.content);
    return text.trim() !== "" && commandNameOf(text) === undefined;
}
/** dsh's busy-Enter preference ("Send behavior while busy"), read from its settings service: the
 *  described form whose live values carry `busyEnter`, whatever id the profile gives that entry.
 *  `queue`, dsh's own default, when there is no service, no such form or another value, so a dsh
 *  that moves the setting leaves edited rows where they are. A `describe` that throws is the
 *  caller's to catch. */
export function busyEnterOf(read) {
    for (const entry of read?.describe?.() ?? []) {
        // SAFETY: the descriptor's value is the entry's live config; for dsh's conversation plugin
        // that is `{ busyEnter }`, and any other entry reads as undefined through the optional chain.
        const value = entry.value;
        if (value?.busyEnter !== undefined)
            return value.busyEnter === "steer" ? "steer" : "queue";
    }
    return "queue";
}
/** What a bridged command's handler tells the person who typed it. The handler only queues the
 *  line, so while a turn runs the receipt says it was added to the queue: "sent" stayed in the chat
 *  after the row was edited or removed, for a line Claude never got. dsh writes the receipt once
 *  and it cannot be changed later, so it states what happened then and promises nothing about the
 *  row. `status` is the agent's from before the line was queued; `sent` is the idle wording. */
export const lineReceipt = (line, status, sent) => status === "running" ? serverText("bridgeQueued", { line }) : sent;
//# sourceMappingURL=lane.js.map