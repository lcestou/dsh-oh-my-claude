/** The user lines this plugin itself sends the CLI (a reattach after a dsh restart, a usage limit
 *  reset: `src/adapter/turn.ts`). The transcript stores them as prompts; nobody typed them. */
export declare const PLUGIN_NOTICE = "[Oh My Claude] ";
/** One prompt as the route answers it: the text as typed, and when it was sent. */
export interface HistoryEntry {
    text: string;
    time: number;
}
/** How many transcripts a workspace or box scope folds, newest first. Each fold reads a whole
 *  transcript, so the cap is what keeps a Ctrl+R on a busy box under a second. */
export declare const HISTORY_MAX_FILES = 30;
/** How many prompts the route answers with after the fold: enough for a box scope to reach back
 *  weeks, small enough that the client filters it per keystroke without noticing. */
export declare const HISTORY_MAX_PROMPTS = 500;
/**
 * Folds typed prompts from any number of transcripts into one list: blank lines and the plugin's
 * own notices dropped, the text trimmed, newest first, and a prompt sent more than once kept at its
 * newest sending only. Exact text decides a repeat, so a prompt that differs by one character is
 * two entries, as in a shell. Input order does not matter.
 */
export declare function foldHistory(prompts: ReadonlyArray<HistoryEntry>): HistoryEntry[];
