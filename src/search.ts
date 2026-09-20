// Search one Claude Code transcript's searchable text for a query and produce a readable snippet.
// Searchable text is what a reader sees: the `text` blocks of user and assistant messages and
// `[image]` for an image block, decided exactly as `textBlocks` in transcript.ts decides it, so a
// hit always points at words on screen. A `tool_result` block is not text a reader sees, so it is
// not matched. This is the pure core — no file input or output; the route that walks transcript
// files comes later.
import { truncateBytes } from "./transcript.js";

/** One session's hit, or undefined when no record holds every word. */
export interface TranscriptHit {
  count: number;
  when: number;
  role: "user" | "assistant";
  snippet: string;
}

/** A parsed line is a plain JSON object; a string, a number, null and an array are not records.
 *  `search.ts` joins the modules allowed to test a shape at run time, because the thing it parses
 *  is Claude Code's transcript format and not this project's own. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The text a reader sees in one record: the `text` blocks joined, `[image]` for an image block,
 *  and nothing for a `tool_result` block — exactly `textBlocks` in transcript.ts, minus the block
 *  wrappers. A message whose content is neither a string nor a block array yields no text. */
const blocksOf = (content: unknown): string[] => {
  if (typeof content === "string") return content ? [content] : [];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") out.push(block.text);
    else if (block.type === "image") out.push("[image]");
  }
  return out;
};

/** `Date.parse` of a timestamp when it is a string that parses to a number, else undefined. */
function timestampAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const when = Date.parse(value);
  return Number.isFinite(when) ? when : undefined;
}

/** One record's role and the text a reader would see in it, or undefined when the line is not a
 *  user or assistant message with text. Mirrors `textBlocks` in transcript.ts: string content, the
 *  `text` blocks of an array, and `[image]` for an image block. A `tool_result` block is not text
 *  a reader sees, so it is not searchable. */
export function recordText(
  line: string,
): { role: "user" | "assistant"; text: string; at?: number } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A half-written trailing line is not a record; skip it rather than crash the search.
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (parsed.type !== "user" && parsed.type !== "assistant") return undefined;
  const role = parsed.type === "user" ? "user" : "assistant";
  const message = parsed.message;
  const text = isRecord(message) ? blocksOf(message.content).join("\n") : "";
  if (!text) return undefined;
  const at = timestampAt(parsed.timestamp);
  return at === undefined ? { role, text } : { role, text, at };
}

/** The query split into lowercased words. Empty input gives an empty list, which matches nothing. */
export function queryWords(q: string): string[] {
  return q
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/** A window of a record's text around its first match: `radius` characters each side, every run of
 *  whitespace collapsed to one space and trimmed, `…` where the cut is inside the record, capped at
 *  400 bytes so a record of hundreds of kilobytes cannot blow up the snippet. */
const makeSnippet = (text: string, firstWord: string, radius: number): string => {
  const position = text.toLowerCase().indexOf(firstWord);
  if (position < 0) return "";
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  return truncateBytes(`${head}${body}${tail}`, 400);
};

/** Search one transcript's whole text, line by line. Every word must appear in the same record,
 *  case-insensitive. Returns one hit for the session, not one per record: `count` is how many
 *  records matched, and the snippet comes from the first. */
export function searchTranscript(
  text: string,
  words: string[],
  snippetRadius?: number,
): TranscriptHit | undefined {
  const firstWord = words[0];
  if (firstWord === undefined) return undefined;
  let hit: TranscriptHit | undefined;
  for (const line of text.split("\n")) {
    const record = recordText(line);
    if (!record) continue;
    if (!words.every((word) => record.text.toLowerCase().includes(word))) continue;
    const snippetText = makeSnippet(record.text, firstWord, snippetRadius ?? 80);
    if (hit === undefined) {
      hit = { count: 1, when: record.at ?? 0, role: record.role, snippet: snippetText };
    } else {
      hit.count += 1;
    }
  }
  return hit;
}
