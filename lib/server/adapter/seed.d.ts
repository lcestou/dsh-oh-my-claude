import type { ContextSource } from "../context-sources.js";
import { type LooseMessage, type NativeCopies } from "./prompt.js";
/** What stands in for a result the log never got (the turn was cut off before the tool answered). */
export declare const NO_RESULT = "No result was recorded for this call.";
/** The tool name Claude saw: dsh's tools reach it over the bridge as `mcp__dsh__<name>`; a name
 *  that already has a server prefix, and Claude Code's own PascalCase tools, stay as they are. */
export declare const bridgedName: (name: string) => string;
/** Where the history a seed holds ends: just past the last assistant message and the results that
 *  answer its calls. Everything after it is the new turn the prompt carries. 0 when no assistant
 *  message exists, which leaves nothing to seed. */
export declare function historyEnd(messages: readonly LooseMessage[]): number;
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
export declare function seedTranscriptText(messages: readonly LooseMessage[], o: SeedOptions): string;
