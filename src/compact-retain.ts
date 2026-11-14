// The newest part of a Claude session kept word for word through Claude Code's `/compact`.
//
// `/compact` summarizes the whole conversation and keeps only its last round. The transcript row
// it writes for the compaction, `compact_boundary`, lists the rows kept after the summary in
// `compactMetadata.preservedMessages`, and `--resume` splices exactly those rows back in right
// after the summary. Widening that list to the newest share of the conversation, on a CLI that is
// then started again with `--resume`, keeps that share verbatim. Nothing here writes: these
// functions read transcript text and answer the replacement row.
import z from "@deepseek-ai/schemastery";
import type { CompactionService, JsonValue } from "./dsh.js";

/** dsh's own default: the newest 16% of the window stays verbatim (`dsh-compaction-basic`). */
export const DEFAULT_RETAIN_RATIO = 0.16;
/** What one image or document block costs, roughly, since its base64 says nothing about tokens. */
const ATTACHED_FILE_TOKENS = 1600;
/** A `data` string longer than this is an attached file's base64, not text the model reads. */
const INLINE_DATA_CHARS = 1000;
/** Transcript bytes read per budgeted token: a row carries its ids, cwd, version and timestamps
 *  beside its content, and JSON escapes newlines and quotes, so a token's worth of text takes up
 *  far more than its four characters. */
const BYTES_PER_TOKEN = 24;
/** The most of a transcript one retention reads: an SSH read buffers at most 8 MB. */
const READ_MAX = 6 * 1024 * 1024;
/** The least it reads, enough for the compaction rows themselves (a summary runs to 20k chars). */
const READ_MIN = 512 * 1024;
/** How much of the transcript's end to read for a `budget`-token tail. Rows past it are not seen,
 *  which only keeps the tail shorter. */
export const retentionSpan = (budget: number): number =>
  Math.min(Math.max(budget * BYTES_PER_TOKEN, READ_MIN), READ_MAX);
/** How much of the first kept message the summary instructions quote to name the cut. */
const EXCERPT_CHARS = 100;

const Block = z.object({
  type: z.string().default(""),
  id: z.string().default(""),
  tool_use_id: z.string().default(""),
  text: z.string().default(""),
  name: z.string().default(""),
});
const Uuids = z.object({
  anchorUuid: z.string().default(""),
  uuids: z.array(z.string()).default([]),
});
const RowSchema = z.object({
  type: z.string().default(""),
  subtype: z.string().default(""),
  uuid: z.string().default(""),
  parentUuid: z.union([z.string(), z.const(null)]).default(null),
  logicalParentUuid: z.union([z.string(), z.const(null)]).default(null),
  isSidechain: z.boolean().default(false),
  isCompactSummary: z.boolean().default(false),
  message: z
    .object({
      id: z.string().default(""),
      content: z.union([z.string(), z.array(Block)]).default(""),
    })
    .default({ id: "", content: "" }),
  compactMetadata: z
    .object({
      preservedMessages: Uuids.required(false),
    })
    .required(false),
});
type Row = ReturnType<typeof RowSchema>;

/** One transcript row with where its line sits in the text it was read from. */
interface Line {
  row: Row;
  /** The line's first and one-past-last character in that text, newline excluded. */
  start: number;
  end: number;
  /** What the row costs in the model's context, estimated (`estimateTokens`). */
  tokens: number;
}

/** Retention settings as dsh's compaction service holds them, global and per model. */
export type RetentionSettings = NonNullable<CompactionService["config"]>;

/**
 * The verbatim budget in tokens, resolved the way dsh resolves its own: an exact provider/model
 * policy's `retainTokens` or `retainRatio` first, then the global pair, then the 16% default. A
 * ratio is of the whole window; dsh takes it of the window less its own output reservation, which
 * this route does not have, since Claude Code picks its own output cap. Zero with no window.
 */
export function retainBudget(
  settings: RetentionSettings | undefined,
  route: { provider: string; model: string } | undefined,
  window: number | undefined,
): number {
  const policy = settings?.modelPolicies?.find(
    (p) => p.provider === route?.provider && p.model === route?.model,
  );
  const own = policy?.retainTokens ?? policy?.retainRatio;
  const tokens = own === undefined ? settings?.retainTokens : policy?.retainTokens;
  if (tokens !== undefined) return Math.max(0, Math.floor(tokens));
  const ratio =
    (own === undefined ? settings?.retainRatio : policy?.retainRatio) ?? DEFAULT_RETAIN_RATIO;
  if (window === undefined || !Number.isFinite(window) || window <= 0) return 0;
  return Math.max(0, Math.floor(window * ratio));
}

/** Tokens for a stretch of text, estimated without a tokenizer: a quarter token per ASCII
 *  character, one per other character, which keeps Chinese or Japanese text from reading as a
 *  quarter of its real cost. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 4 + (text.length - ascii));
}

/** What the model reads of a row, priced: a message's content, or an attachment (a file the CLI
 *  attached, a reminder) as a whole. Signatures are dropped and attached files counted at one
 *  fixed cost each instead of by their base64. */
function rowTokens(line: string): number {
  let files = 0;
  let content: JsonValue = "";
  try {
    const parsed: { message?: { content?: JsonValue }; attachment?: JsonValue } = JSON.parse(line);
    content = parsed.message?.content ?? parsed.attachment ?? "";
  } catch {
    return 0;
  }
  const text = JSON.stringify(content, (key: string, value: JsonValue) => {
    if (key === "signature") return undefined;
    if (key === "data" && JSON.stringify(value).length > INLINE_DATA_CHARS) {
      files++;
      return "";
    }
    return value;
  });
  return estimateTokens(text) + files * ATTACHED_FILE_TOKENS;
}

/** Every row in `text` that parses, with its place. A first line cut by a read offset fails to
 *  parse and is skipped like any other non-row line. */
function rowsOf(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf("\n", start);
    const end = nl < 0 ? text.length : nl;
    const line = text.slice(start, end);
    if (line.trim() !== "") {
      try {
        const row = RowSchema(JSON.parse(line));
        out.push({ row, start, end, tokens: rowTokens(line) });
      } catch {
        // not a row
      }
    }
    start = end + 1;
  }
  return out;
}

/** The conversation ending at `leaf`, oldest first, walked back through `parentUuid` until a row
 *  with no parent or one outside the text that was read. A later copy of a row wins, as in the
 *  CLI's own loader. */
function chainTo(lines: Line[], leaf: string): Line[] {
  const byUuid = new Map<string, Line>();
  for (const l of lines) if (l.row.uuid !== "") byUuid.set(l.row.uuid, l);
  const chain: Line[] = [];
  const seen = new Set<string>();
  let at: string | null = leaf;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const l = byUuid.get(at);
    if (!l) break;
    chain.push(l);
    at = l.row.parentUuid;
  }
  return chain.toReversed();
}

/** The blocks of a row's message, empty for a plain string. */
const blocksOf = (row: Row) => (Array.isArray(row.message.content) ? row.message.content : []);

/**
 * The newest rows of `chain` whose estimated cost fits `budget`, starting at a point the API
 * accepts after a summary: a user prompt (no tool result in it) or the first row of an assistant
 * message, with every earlier tool call already answered, so no tool call is split from its result
 * and no message from its other rows. Never the whole conversation since the last summary: at
 * least one assistant row stays before the cut for the summary to cover. Progress rows are left
 * out, as the CLI leaves them out of what it keeps. Empty when no such point fits.
 */
function retainedTail(chain: Line[], budget: number): Line[] {
  let floor = 0;
  chain.forEach((l, i) => {
    if (l.row.isCompactSummary || l.row.subtype === "compact_boundary") floor = i + 1;
  });
  const cuts = new Set<number>();
  const open = new Set<string>();
  let lastMessage = "";
  let replied = false;
  for (let i = floor; i < chain.length; i++) {
    const row = chain[i]?.row;
    if (!row) continue;
    const blocks = blocksOf(row);
    if (open.size === 0 && replied) {
      const prompt = row.type === "user" && !blocks.some((b) => b.type === "tool_result");
      const reply =
        row.type === "assistant" && row.message.id !== "" && row.message.id !== lastMessage;
      if (prompt || reply) cuts.add(i);
    }
    if (row.type === "assistant") {
      replied = true;
      lastMessage = row.message.id;
      for (const b of blocks) if (b.type === "tool_use" && b.id !== "") open.add(b.id);
    } else if (row.type === "user") {
      for (const b of blocks) if (b.type === "tool_result") open.delete(b.tool_use_id);
    }
  }
  let total = 0;
  let cut = -1;
  for (let i = chain.length - 1; i >= floor; i--) {
    const l = chain[i];
    if (l && l.row.type !== "progress") total += l.tokens;
    if (total > budget) break;
    if (cuts.has(i)) cut = i;
  }
  return cut < 0 ? [] : chain.slice(cut).filter((l) => l.row.type !== "progress");
}

/** The first `EXCERPT_CHARS` of a row's text on one line, or "" for a row with none. */
function excerptOf(row: Row): string {
  const content = row.message.content;
  const text = Array.isArray(content)
    ? (content.find((b) => b.type === "text" && b.text !== "")?.text ?? "")
    : content;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
}

/** How the summary instructions name the first kept row. */
function describeCut(row: Row, kept: number): string {
  const excerpt = excerptOf(row);
  if (row.type === "user" && excerpt !== "") return `the user message that begins "${excerpt}"`;
  if (row.type === "assistant" && excerpt !== "") return `your reply that begins "${excerpt}"`;
  const tool = blocksOf(row).find((b) => b.type === "tool_use")?.name;
  if (row.type === "assistant" && tool) return `your ${tool} call`;
  return `the last ${kept} messages`;
}

/**
 * Instructions for `/compact` on the transcript as it stands before the compaction: summarize only
 * what comes before the rows that will be kept. Undefined when nothing would be kept. The rows
 * actually kept are chosen again after the compaction (`widenPreserved`), by the same rule on the
 * same rows, so the two agree unless the transcript changed in between.
 */
export function compactInstructions(text: string, budget: number): string | undefined {
  if (budget <= 0) return undefined;
  const lines = rowsOf(text);
  const leaf = lines.findLast(
    (l) =>
      l.row.uuid !== "" &&
      !l.row.isSidechain &&
      ["user", "assistant", "attachment", "system"].includes(l.row.type),
  );
  if (!leaf) return undefined;
  const tail = retainedTail(chainTo(lines, leaf.row.uuid), budget);
  const first = tail[0];
  if (!first) return undefined;
  return (
    `The newest part of this conversation, from ${describeCut(first.row, tail.length)} to the ` +
    "end, stays in the context word for word right after your summary. Summarize only what comes " +
    "before it, and do not repeat what comes after it."
  );
}

/** The boundary row as the CLI wrote it; only the metadata is touched. */
interface RawBoundary {
  compactMetadata?: { preservedMessages?: JsonValue; preservedSegment?: JsonValue };
}

/** The replacement for the compaction's boundary row, or why there is none. `start` and `end`
 *  are the boundary line's character range in the text it was found in, newline excluded. */
export type BoundaryEdit =
  | { kind: "edit"; start: number; end: number; line: string; kept: number; tokens: number }
  | { kind: "skip"; why: string };

/**
 * The last compaction's boundary row with its kept list widened to the newest rows that fit
 * `budget`, read from the transcript's tail after the compaction. The rows are those that led up
 * to the compaction (the boundary's `logicalParentUuid`), and the kept rows keep their anchor:
 * the summary row, which the CLI splices them after. Skipped when the CLI already keeps as much,
 * when its own kept rows are not all inside the wider list (a shape this does not know), or when
 * there is no summary row to anchor to.
 */
export function widenPreserved(text: string, budget: number): BoundaryEdit {
  if (budget <= 0) return { kind: "skip", why: "no verbatim budget" };
  const lines = rowsOf(text);
  const boundary = lines.findLast((l) => l.row.subtype === "compact_boundary");
  if (!boundary) return { kind: "skip", why: "no compaction in the transcript's tail" };
  const meta = boundary.row.compactMetadata;
  const leaf = boundary.row.logicalParentUuid;
  if (!meta || leaf === null) return { kind: "skip", why: "the boundary names no prior row" };
  const anchor =
    meta.preservedMessages?.anchorUuid ||
    lines.find((l) => l.row.isCompactSummary && l.row.parentUuid === boundary.row.uuid)?.row.uuid;
  if (!anchor) return { kind: "skip", why: "no summary row to keep the rows after" };
  const tail = retainedTail(chainTo(lines, leaf), budget);
  const uuids = tail.map((l) => l.row.uuid);
  const cliKept = meta.preservedMessages?.uuids ?? [];
  if (uuids.length <= cliKept.length) return { kind: "skip", why: "Claude Code keeps as much" };
  const wide = new Set(uuids);
  if (!cliKept.every((u) => wide.has(u)))
    return { kind: "skip", why: "Claude Code kept rows outside the newest stretch" };
  // The row is rewritten from its own text, so every field this module does not read stays as
  // the CLI wrote it.
  const raw: RawBoundary = JSON.parse(text.slice(boundary.start, boundary.end));
  const compactMetadata = {
    ...raw.compactMetadata,
    // `allUuids` also lists rows the CLI held in memory but never wrote; these are all on disk.
    preservedMessages: { anchorUuid: anchor, uuids, allUuids: uuids },
    preservedSegment: { headUuid: uuids[0], anchorUuid: anchor, tailUuid: uuids.at(-1) },
  };
  return {
    kind: "edit",
    start: boundary.start,
    end: boundary.end,
    line: JSON.stringify({ ...raw, compactMetadata }),
    kept: uuids.length,
    tokens: tail.reduce((sum, l) => sum + l.tokens, 0),
  };
}
