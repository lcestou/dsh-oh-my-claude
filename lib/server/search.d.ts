/** One session's hit, or undefined when no record holds every word. */
export interface TranscriptHit {
    count: number;
    when: number;
    role: "user" | "assistant";
    snippet: string;
}
/** One record's role and the text a reader would see in it, or undefined when the line is not a
 *  user or assistant message with text. Mirrors `textBlocks` in transcript.ts: string content, the
 *  `text` blocks of an array, and `[image]` for an image block. A `tool_result` block is not text
 *  a reader sees, so it is not searchable. */
export declare function recordText(line: string): {
    role: "user" | "assistant";
    text: string;
    at?: number;
} | undefined;
/** The query split into lowercased words. Empty input gives an empty list, which matches nothing. */
export declare function queryWords(q: string): string[];
/** Search one transcript's whole text, line by line. Every word must appear in the same record,
 *  case-insensitive. Returns one hit for the session, not one per record: `count` is how many
 *  records matched, and the snippet comes from the first. */
export declare function searchTranscript(text: string, words: string[], snippetRadius?: number): TranscriptHit | undefined;
