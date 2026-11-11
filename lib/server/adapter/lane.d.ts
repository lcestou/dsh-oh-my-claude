import { type LocaleSettingsReader } from "../locale.js";
import { type LooseMessage } from "./prompt.js";
/** The name a pending line opens with when it is a command or skill line (`/name arguments`), read
 *  the way dsh's composer tells a command draft from plain text: leading space ignored, then a
 *  slash. Undefined for plain text, and for a bare `/`. */
export declare const commandNameOf: (text: string) => string | undefined;
/** The ids of pending messages the command bridge queued, newest last, at most `REMEMBERED`. */
export declare class CommandRows {
    private readonly ids;
    /** Remember a row; a message without an id cannot be found again and is skipped. */
    add(id: string | undefined): void;
    /** Whether the bridge queued this row and it has not been moved since. */
    has(id: string | undefined): boolean;
    /** Forget a row, once it has been moved or is known to be plain text. */
    delete(id: string): void;
}
/** Whether a message just written into the queue is a command row edited into plain text: one the
 *  bridge queued, typed by a person, whose words no longer open with a command. A row whose
 *  arguments alone changed is still a command and stays. Blank text never moves. */
export declare function leavesQueue(m: LooseMessage, rows: CommandRows): boolean;
/** dsh's busy-Enter preference ("Send behavior while busy"), read from its settings service: the
 *  described form whose live values carry `busyEnter`, whatever id the profile gives that entry.
 *  `queue`, dsh's own default, when there is no service, no such form or another value, so a dsh
 *  that moves the setting leaves edited rows where they are. A `describe` that throws is the
 *  caller's to catch. */
export declare function busyEnterOf(read: LocaleSettingsReader | undefined): "queue" | "steer";
/** What a bridged command's handler tells the person who typed it. The handler only queues the
 *  line, so while a turn runs the receipt says it was added to the queue: "sent" stayed in the chat
 *  after the row was edited or removed, for a line Claude never got. dsh writes the receipt once
 *  and it cannot be changed later, so it states what happened then and promises nothing about the
 *  row. `status` is the agent's from before the line was queued; `sent` is the idle wording. */
export declare const lineReceipt: (line: string, status: string | undefined, sent: string) => string;
