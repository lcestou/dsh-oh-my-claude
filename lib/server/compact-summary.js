// Claude Code's compaction summary, read back from the transcript. The CLI feeds the summary
// straight into its next prompt and never puts it on the stream, but it writes it to the session's
// transcript as a `user` row flagged `isCompactSummary`, right after the `compact_boundary` row.
import z from "@deepseek-ai/schemastery";
import { readFromAt, sizeAt } from "./remote-fs.js";
/** How much of the transcript's end is read: a summary runs to some 20k characters, and the
 *  turn's own rows after it are small, so this leaves room for both and for one earlier pair. */
export const TAIL_BYTES = 512 * 1024;
const TextRow = z.object({
    isCompactSummary: z.boolean().default(false),
    message: z.object({ content: z.string() }),
});
const BlockRow = z.object({
    isCompactSummary: z.boolean().default(false),
    message: z.object({ content: z.array(z.object({ text: z.string().default("") })) }),
});
const BoundaryRow = z.object({
    subtype: z.string().default(""),
    compactMetadata: z.object({ preTokens: z.number().default(-1) }).default({ preTokens: -1 }),
});
/** The summary row's text, or undefined when the line is not one. */
function summaryText(line) {
    try {
        const row = TextRow(JSON.parse(line));
        return row.isCompactSummary ? row.message.content : undefined;
    }
    catch {
        try {
            const row = BlockRow(JSON.parse(line));
            return row.isCompactSummary ? row.message.content.map((b) => b.text).join("\n") : undefined;
        }
        catch {
            return undefined;
        }
    }
}
/** The `preTokens` of a `compact_boundary` row, or undefined when the line is not one. */
function boundaryPreTokens(line) {
    try {
        const row = BoundaryRow(JSON.parse(line));
        return row.subtype === "compact_boundary" ? row.compactMetadata.preTokens : undefined;
    }
    catch {
        return undefined;
    }
}
/** The CLI's own framing around the summary, which the reader of a chat row does not need: the
 *  "this session is being continued" paragraph, the tool list, and the reminder tags. */
function stripFraming(text) {
    return text
        .replace(/^This session is being continued[^\n]*\n+/, "")
        .replace(/<tools-used-before-summary>[\s\S]*?<\/tools-used-before-summary>\s*/g, "")
        .replace(/<\/?system-reminder>\s*/g, "")
        .trim();
}
/** The summary of the compaction whose boundary reported `preTokens`, from the transcript's tail,
 *  with the CLI's framing stripped. With no `preTokens` to match, the last summary in the tail.
 *  Undefined when the tail holds no matching pair: the row may not be flushed yet, and a caller
 *  that reads again a moment later finds it then. A first line cut mid-row by the tail offset
 *  fails to parse and is skipped like any other non-row line. */
export function compactSummaryOf(tail, preTokens) {
    let lastBoundary;
    let found;
    for (const line of tail.split("\n")) {
        if (line.includes('"compact_boundary"')) {
            const pre = boundaryPreTokens(line);
            if (pre !== undefined)
                lastBoundary = pre;
            continue;
        }
        if (!line.includes('"isCompactSummary":true'))
            continue;
        const text = summaryText(line);
        if (text === undefined)
            continue;
        if (preTokens === undefined || lastBoundary === preTokens)
            found = stripFraming(text);
    }
    return found;
}
/** Read the summary matching `preTokens` from the end of the transcript at `path` on `box`.
 *  Undefined for a missing file or a tail without it; a box that cannot be reached throws. */
export async function readCompactSummary(box, path, preTokens) {
    const size = await sizeAt(box, path);
    if (size === null)
        return undefined;
    const tail = await readFromAt(box, path, Math.max(0, size - TAIL_BYTES));
    return compactSummaryOf(tail, preTokens);
}
//# sourceMappingURL=compact-summary.js.map