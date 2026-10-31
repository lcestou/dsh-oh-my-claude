// What the composer's Ctrl+R history search reads: the prompts a person typed, newest first, folded
// the way a shell's history is read back, shared by every scope the route serves (one session, a
// workspace's transcripts, the whole box).
/** The user lines this plugin itself sends the CLI (a reattach after a dsh restart, a usage limit
 *  reset: `src/adapter/turn.ts`). The transcript stores them as prompts; nobody typed them. */
export const PLUGIN_NOTICE = "[Oh My Claude] ";
/** How many transcripts a workspace or box scope folds, newest first. Each fold reads a whole
 *  transcript, so the cap is what keeps a Ctrl+R on a busy box under a second. */
export const HISTORY_MAX_FILES = 30;
/** How many prompts the route answers with after the fold: enough for a box scope to reach back
 *  weeks, small enough that the client filters it per keystroke without noticing. */
export const HISTORY_MAX_PROMPTS = 500;
/**
 * Folds typed prompts from any number of transcripts into one list: blank lines and the plugin's
 * own notices dropped, the text trimmed, newest first, and a prompt sent more than once kept at its
 * newest sending only. Exact text decides a repeat, so a prompt that differs by one character is
 * two entries, as in a shell. Input order does not matter.
 */
export function foldHistory(prompts) {
    const newest = new Map();
    for (const p of prompts) {
        const text = p.text.trim();
        if (text === "" || text.startsWith(PLUGIN_NOTICE))
            continue;
        const seen = newest.get(text);
        if (seen === undefined || p.time > seen)
            newest.set(text, p.time);
    }
    return [...newest].map(([text, time]) => ({ text, time })).toSorted((a, b) => b.time - a.time);
}
//# sourceMappingURL=history.js.map