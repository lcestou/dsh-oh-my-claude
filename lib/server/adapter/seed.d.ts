import type { ContextSource } from "../context-sources.js";
import type { LooseMessage, NativeCopies } from "./prompt.js";
/** What stands in for a result the log never got (the turn was cut off before the tool answered). */
export declare const NO_RESULT = "No result was recorded for this call.";
/** The tool name Claude saw: dsh's tools reach it over the bridge as `mcp__dsh__<name>`; a name
 *  that already has a server prefix, and Claude Code's own PascalCase tools, stay as they are. */
export declare const bridgedName: (name: string) => string;
/** The id and the dsh name of the message that announces a tool call the plugin draws itself:
 *  `<callId>:call` for one of Claude's own tools (named as dsh draws it), `<callId>:dsh` for a dsh
 *  call that ran inside the bridge, which arrives under its `mcp__dsh__` name. `isNativeCall`
 *  reads the mark back when a transcript is rebuilt. */
export declare function announcementOf(callId: string, toolName: string): {
    id: string;
    name: string;
};
/** Where the history a seed holds ends: just past the last assistant message and the results that
 *  answer its calls. Everything after it is the new turn the prompt carries. 0 when no assistant
 *  message exists, which leaves nothing to seed. */
export declare function historyEnd(messages: ReadonlyArray<LooseMessage>): number;
export interface SeedOptions {
    sessionId: string;
    cwd: string;
    /** The CLI version the rows claim, as the CLI itself stamps them. */
    version: string;
    /** Withheld blocks, as the prompt builder drops them. */
    drops?: ReadonlySet<ContextSource>;
    copies?: NativeCopies;
    /** dsh's developer messages count as conversation (the `dsh` system prompt mode). */
    developer?: boolean;
    /** Characters of one tool result kept; 0 keeps it whole. */
    cap?: number;
    now?: Date;
}
/**
 * The transcript text (JSONL) for `messages[0, historyEnd)`: each person's message a user turn,
 * each reply an assistant turn with its tool calls, each result a `tool_result`. System messages
 * stay out (the system prompt rides on its own flag) and reasoning stays out (it carries no
 * signature the API would accept). A call the log has no result for gets one saying so, since the
 * API refuses a `tool_use` left unanswered. Empty when there is nothing to seed.
 */
export declare function seedTranscriptText(messages: ReadonlyArray<LooseMessage>, o: SeedOptions): string;
/** How many moved-aside copies of one transcript a rebuild keeps. */
export declare const REPLACED_KEEP = 2;
/**
 * Delete the older `<dest>.replaced-<ms>` copies a transcript rebuild left beside `dest`, keeping
 * the `keep` newest by their stamp. Only names that are `dest`'s own name plus `.replaced-` and
 * digits are touched, so another transcript's copies and every other file stay. A copy that is
 * already gone or cannot be deleted is passed over; an unreadable directory deletes nothing.
 */
export declare function pruneReplaced(dest: string, keep?: number): Promise<void>;
