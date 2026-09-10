// Claude Code transcripts (~/.claude/projects/<cwd>/<uuid>.jsonl) → dsh session events, so a
// session started in the terminal can be opened in dsh with its history and resumed from there.
// This is an I/O boundary: transcript lines are decoded here and typed shapes leave.
import { open, readdir, stat } from "node:fs/promises";
import { readAt, type FsBox } from "./remote-fs.js";
import { join } from "node:path";
import type { JsonValue } from "./dsh.js";
import { NATIVE_TOOL_MAP } from "./adapter.js";

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const RESULT_TEXT_LIMIT = 4000;
/** A subagent can talk for pages; the resumed step shows the same amount a tool result gets. */
const SUBAGENT_TEXT_LIMIT = 4000;
const TITLE_BYTES = 80;

/** A decoded transcript line: any JSON object. Fields are read with narrowing, never assumed. */
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Claude's own tool name as dsh's presenter table keys it. Live, the translator maps `Bash` to
 * `bash` before the row is written, but a resumed transcript carries Claude's PascalCase verbatim —
 * and dsh's `TOOL_VARIANTS` is lowercase-keyed, so every native tool degraded to a generic sparkle
 * row on resume while the same tool rendered properly live.
 */
const toolNameOf = (name: unknown): string => {
  const raw = String(name ?? "tool");
  // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows the index to its known keys,
  // and an unlisted name reads as undefined, which falls back to Claude's own spelling.
  return NATIVE_TOOL_MAP[raw as keyof typeof NATIVE_TOOL_MAP] ?? raw;
};

/** A leading byte-order mark, dropped: with it the first line is not JSON and the record is lost. */
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text);

const parseLine = (line: string): Rec | undefined => {
  try {
    const v: unknown = JSON.parse(line);
    return isRec(v) ? v : undefined;
  } catch {
    return undefined;
  }
};

const timeOf = (rec: Rec | undefined, fallback: number): number => {
  const t = Date.parse(typeof rec?.timestamp === "string" ? rec.timestamp : "");
  return Number.isFinite(t) ? t : fallback;
};

/** Plain text of a user prompt, or "" for tool results / injections that are not a prompt. */
function promptText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const b of content)
    if (isRec(b) && b.type === "text" && typeof b.text === "string") texts.push(b.text);
  return texts.join("\n");
}

/** Injected material Claude Code stores as user lines: slash-command echoes, hook output, reminders. */
const isNoise = (text: string) => /^\s*<(command-|local-command|system-reminder)/.test(text);

/**
 * Truncate to a byte budget without splitting a character. Encode once and cut at a UTF-8 boundary:
 * this used to append a character at a time and measure `out + ch` on each one, which is quadratic
 * in the budget and ran on every tool result in a transcript. Folding a 49 MB session spent 1.2 s
 * of its 1.35 s here.
 */
export function truncateBytes(text: string, max: number): string {
  if (max <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  // Back off over continuation bytes (0b10xxxxxx) so the cut lands between characters, never inside
  // one. At most three steps, whatever the budget.
  let end = max;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.toString("utf8", 0, end);
}

const titleFrom = (text: string): string =>
  truncateBytes(
    (
      text
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
        .trim()
        .split("\n")[0] ?? ""
    ).replace(/\s+/g, " "),
    TITLE_BYTES,
  );

/** One-shots older plugin versions ran inside the workspace dir (titles now run from a scratch dir). */
const isAuxPrompt = (text: string) => text.startsWith("Generate the session title");

/**
 * Read only the head of a transcript: first real prompt, timestamps, summary. Cheap for a listing.
 * Whole lines, not a byte window: a first prompt with pasted images is one JSON line of several
 * hundred KB, and cutting it mid-line made the transcript vanish from the list.
 */
async function peek(
  path: string,
  maxBytes = 256 * 1024,
): Promise<{ lines: string[]; partial: boolean }> {
  // ONE READ, NOT A LINE STREAM. This used to run `readline` over a `createReadStream` and call
  // `rl.close()` once the running byte total passed the cap, which was both slow and wrong:
  // `close()` does not stop the iterator, so every line already buffered in the current chunk was
  // still yielded. A 42 MB transcript returned 77 lines by the cap arithmetic and 89 in practice,
  // and the surplus moved with the chunk boundary — so `turns` for a capped file was not stable
  // between two peeks of the same bytes. Reading the head once and splitting it is deterministic
  // and, measured over 187 transcripts, 88 ms became 24 ms.
  const fh = await open(path, "r");
  try {
    // `allocUnsafe`: only the first `bytesRead` bytes are ever read back, and the default head is
    // far past `Buffer.poolSize`, so this is a fresh allocation rather than a slice of the shared
    // pool. Zeroing 256 KB per transcript would be part of the cost this rewrite is about.
    const buf = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const partial = bytesRead >= maxBytes;
    const lines = buf.toString("utf8", 0, bytesRead).split("\n");
    // The last element is either the empty string after a trailing newline or, when the cap cut
    // the file mid-record, a fragment. Neither is a line; a fragment would fail to parse anyway.
    if (lines.at(-1) === "" || partial) lines.pop();
    return { lines, partial };
  } finally {
    await fh.close();
  }
}

/** One transcript in a listing: what the session browser shows before opening it. */
export interface TranscriptListItem {
  id: string;
  title: string;
  createdAt: number;
  modifiedAt: number;
  bytes: number;
  turns: number;
  turnsPartial: boolean;
  cwd?: string;
  /** Brought in from a file rather than written by a CLI run on this box. */
  imported?: boolean;
}

/** How many transcripts to stat and peek at once. Two descriptors each; see `listTranscripts`. */
const LIST_BATCH = 32;

// Head bound for the retry in `listTranscripts` when the first peek found no turn at all. Sized
// against the worst dir on this box (194 transcripts): 2 MB recovers every one of them, and a
// batch of 32 retries at once is 64 MB of transient buffer rather than the 128 MB 4 MB would cost.
const DEEP_PEEK_BYTES = 2 * 1024 * 1024;

/** What one pass over a transcript head yields; `scan` in `listTranscripts` fills it. */
interface Scan {
  turns: number;
  createdAt: number;
  title: string;
  summary?: string;
  cwd?: string;
}

/**
 * Transcripts in one project dir, newest first. `exclude` holds Claude session ids that already
 * belong to dsh sessions the plugin started itself (their dsh side is the source of truth).
 */
export async function listTranscripts(
  dir: string,
  exclude: Set<string> = new Set(),
): Promise<TranscriptListItem[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  // ONE FILE AT A TIME WAS THE WHOLE COST HERE. Every transcript needs a `stat` and a bounded
  // `peek`, and awaiting them in a plain loop made 187 files into 374 sequential round-trips —
  // 160 ms on a warm cache for one project dir, and `listAllTranscripts` pays it per dir. The
  // work per file is independent, so it runs in batches instead. BATCHED rather than one big
  // `Promise.all`: the caller already fans out across every project dir at once, and an
  // unbounded map would multiply that into hundreds of open descriptors for no extra speed.
  /** What a listing needs from the head of one transcript. */
  const scan = (lines: string[], fallbackTime: number): Scan => {
    const found: Scan = { turns: 0, createdAt: fallbackTime, title: "" };
    for (const line of lines) {
      const rec = parseLine(line);
      if (!rec) continue;
      if (found.cwd === undefined && typeof rec.cwd === "string") found.cwd = rec.cwd;
      if (rec.type === "summary" && typeof rec.summary === "string") found.summary = rec.summary;
      if (rec.type !== "user" || rec.isSidechain || rec.isMeta) continue;
      const text = promptText(isRec(rec.message) ? rec.message.content : undefined);
      if (!text) continue;
      if (found.turns === 0 && isAuxPrompt(text)) break;
      found.turns += 1;
      if (found.turns === 1) found.createdAt = timeOf(rec, found.createdAt);
      if (!found.title && !isNoise(text)) found.title = titleFrom(text);
    }
    return found;
  };

  const read = async (name: string): Promise<TranscriptListItem | undefined> => {
    const m = UUID_FILE.exec(name);
    const id = m?.[1];
    if (!id || exclude.has(id)) return undefined;
    const path = join(dir, name);
    const info = await stat(path);
    let head = await peek(path);
    let found = scan(head.lines, info.mtimeMs);
    // A SECOND LOOK, ONLY WHEN THE FIRST ONE FOUND NOTHING. A transcript can open with a single
    // enormous record — a pasted image, a dumped file — and push its first real user turn past the
    // head bound, which makes a real session look empty and drops it from the list entirely. Nine
    // of 194 transcripts on this box do exactly that. Re-reading a larger head costs nothing in
    // the common case because the common case never reaches this line.
    if (found.turns === 0 && head.partial) {
      head = await peek(path, DEEP_PEEK_BYTES);
      found = scan(head.lines, info.mtimeMs);
    }
    if (found.turns === 0) return undefined;
    const item: TranscriptListItem = {
      id,
      title: found.summary ?? found.title,
      createdAt: found.createdAt,
      modifiedAt: info.mtimeMs,
      bytes: info.size,
      turns: found.turns,
      turnsPartial: head.partial,
    };
    if (found.cwd) item.cwd = found.cwd;
    return item;
  };
  const out: TranscriptListItem[] = [];
  for (let i = 0; i < names.length; i += LIST_BATCH) {
    const batch = await Promise.all(names.slice(i, i + LIST_BATCH).map(read));
    for (const item of batch) if (item) out.push(item);
  }
  return out.toSorted((a, b) => b.modifiedAt - a.modifiedAt);
}

/** The dsh content blocks a transcript turn becomes. */
export type SeedBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; id: string; name: string; arguments: string };

const textBlocks = (content: unknown): Array<{ type: "text"; text: string }> => {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: Array<{ type: "text"; text: string }> = [];
  for (const b of content) {
    if (!isRec(b)) continue;
    if (b.type === "text" && typeof b.text === "string") out.push({ type: "text", text: b.text });
    else if (b.type === "image") out.push({ type: "text", text: "[image]" });
  }
  return out;
};

const resultBlocks = (content: unknown): Array<{ type: "text"; text: string }> => {
  const blocks = textBlocks(content);
  const text = blocks.map((b) => b.text).join("\n");
  return text ? [{ type: "text", text: truncateBytes(text, RESULT_TEXT_LIMIT) }] : [];
};

/** The subagent a Task result names, from the `toolUseResult` the CLI writes beside the result. */
const agentIdOf = (result: unknown): string | undefined => {
  if (!isRec(result)) return undefined;
  return typeof result.agentId === "string" && result.agentId ? result.agentId : undefined;
};

/**
 * What a subagent said, from its own transcript: its assistant text, its tool calls left out.
 *
 * This is what the live view shows — the CLI forwards a subagent's messages as whole assistant
 * messages and the translator folds them into one reasoning row each (`↳ subagent`) — so a resumed
 * Task reads the way the same run did while it was running instead of a call with nothing between
 * it and its result.
 */
export function subagentText(text: string, limit = SUBAGENT_TEXT_LIMIT): string {
  const said: string[] = [];
  for (const line of stripBom(text).split("\n")) {
    const rec = parseLine(line);
    if (rec?.type !== "assistant") continue;
    const msg = isRec(rec.message) ? rec.message : undefined;
    for (const b of textBlocks(msg?.content)) said.push(b.text);
  }
  return truncateBytes(said.join("\n").trim(), limit);
}

/**
 * Fold each subagent's own text into the step that called it, right behind the Task call, which is
 * where the live run put it. `texts` is keyed by Task call id; a subagent whose file could not be
 * read is simply not there, and its call resumes the way it does today.
 */
export function attachSubagents(folded: FoldedTranscript, texts: Map<string, string>): void {
  if (texts.size === 0) return;
  for (const turn of folded.turns)
    for (const step of turn.steps)
      // Backwards, so an insert cannot shift a block this loop has not looked at yet.
      for (let i = step.content.length - 1; i >= 0; i--) {
        const block = step.content[i];
        if (block?.type !== "tool-call") continue;
        const file = texts.get(block.id);
        if (file === undefined) continue;
        const said = subagentText(file);
        if (said) step.content.splice(i + 1, 0, { type: "reasoning", text: `↳ subagent\n${said}` });
      }
}

/** One tool call's outcome inside a folded step. */
export interface FoldedResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  time: number;
}

/** One assistant message of a turn: its blocks, its tool calls, and their results by call id. */
export interface FoldedStep {
  msgId: string | undefined;
  id: string;
  model: string | undefined;
  time: number;
  content: SeedBlock[];
  calls: Array<{ id: string; name: string; arguments: Record<string, JsonValue> }>;
  results: Map<string, FoldedResult>;
}

/** One user prompt and the assistant steps that answered it. */
export interface FoldedTurn {
  id: string;
  time: number;
  content: Array<{ type: "text"; text: string }>;
  steps: FoldedStep[];
}

export interface FoldedTranscript {
  turns: FoldedTurn[];
  title: string | undefined;
  createdAt: number;
  /** Task call id to the subagent that answered it, for the records kept in a file of their own. */
  agents: Map<string, string>;
}

/**
 * Fold a transcript into turns: one user prompt, then assistant steps (one per Claude message id)
 * with their tool calls and results. Unfinished trailing prompts are dropped; the seed must end on
 * a completed turn.
 *
 * A subagent's own records are not folded here. On 2.1 they are not in this file at all — they live
 * in `<session>/subagents/agent-<id>.jsonl` and are attached by `attachSubagents` — and the inline
 * `isSidechain` records older transcripts carry are skipped, because the turn they belong to is the
 * Task call that spawned them rather than a prompt of the user's own.
 */
export function foldTranscript(text: string): FoldedTranscript {
  const turns: FoldedTurn[] = [];
  let cur: FoldedTurn | undefined;
  let title: string | undefined;
  let createdAt: number | undefined;
  const agents = new Map<string, string>();
  const close = () => {
    if (cur?.steps.length) turns.push(cur);
    cur = undefined;
  };
  for (const line of stripBom(text).split("\n")) {
    const rec = parseLine(line);
    if (!rec || rec.isSidechain) continue;
    if (rec.type === "summary" && typeof rec.summary === "string") {
      title = rec.summary;
      continue;
    }
    const msg = isRec(rec.message) ? rec.message : undefined;
    if (rec.type === "user") {
      const content: unknown[] = Array.isArray(msg?.content) ? msg.content : [];
      const results = content.filter((b): b is Rec => isRec(b) && b.type === "tool_result");
      if (results.length) {
        const step = cur?.steps.at(-1);
        if (!step) continue;
        // A Task's result carries the id of the subagent that ran it, and the record holds one
        // result, so the id belongs to that call. Two results in a record leave it unclaimed rather
        // than guessing which call the subagent answered.
        const agent = agentIdOf(rec.toolUseResult);
        for (const r of results) {
          const id = typeof r.tool_use_id === "string" ? r.tool_use_id : String(r.tool_use_id);
          if (agent !== undefined && results.length === 1) agents.set(id, agent);
          step.results.set(id, {
            content: resultBlocks(r.content),
            isError: r.is_error === true,
            time: timeOf(rec, step.time),
          });
        }
        continue;
      }
      if (rec.isMeta) continue;
      const prompt = textBlocks(msg?.content);
      if (prompt.length === 0) continue;
      const plain = promptText(msg?.content);
      // Slash-command echoes, hook stdout and system reminders are stored as user lines, but they
      // are injections, not prompts: live they never render as a turn of their own, and copying
      // them in gave a resumed session user bubbles full of `<command-message>` markup. Checked
      // before `close()`, so an injection between a prompt and its answer does not end the turn.
      if (isNoise(plain)) continue;
      close();
      const time = timeOf(rec, Date.now());
      createdAt ??= time;
      if (!title) title = titleFrom(plain);
      cur = {
        id: typeof rec.uuid === "string" ? rec.uuid : `u${turns.length}`,
        time,
        content: prompt,
        steps: [],
      };
    } else if (rec.type === "assistant" && cur) {
      const last = cur.steps.at(-1);
      const msgId = typeof msg?.id === "string" ? msg.id : undefined;
      const step: FoldedStep =
        last && last.msgId === msgId
          ? last
          : {
              msgId,
              id:
                msgId ??
                (typeof rec.uuid === "string" ? rec.uuid : `a${turns.length}:${cur.steps.length}`),
              model: typeof msg?.model === "string" ? msg.model : undefined,
              time: timeOf(rec, cur.time),
              content: [],
              calls: [],
              results: new Map(),
            };
      if (step !== last) cur.steps.push(step);
      const blocks: unknown[] = Array.isArray(msg?.content) ? msg.content : [];
      for (const b of blocks) {
        if (!isRec(b)) continue;
        if (b.type === "text" && typeof b.text === "string")
          step.content.push({ type: "text", text: b.text });
        else if (b.type === "thinking" && typeof b.thinking === "string")
          step.content.push({ type: "reasoning", text: b.thinking });
        else if (b.type === "tool_use" && typeof b.id === "string") {
          // SAFETY: a tool_use input is the JSON object Claude sent; any JSON object is a JsonValue map
          const args = isRec(b.input) ? (b.input as Record<string, JsonValue>) : {};
          const name = toolNameOf(b.name);
          // dsh keeps tool-call arguments as a JSON string (its token meter reads `.length`).
          step.content.push({
            type: "tool-call",
            id: b.id,
            name,
            arguments: JSON.stringify(args),
          });
          step.calls.push({ id: b.id, name, arguments: args });
        }
      }
    }
  }
  close();
  return { turns, title, createdAt: createdAt ?? Date.now(), agents };
}

/** A tool result as the seed writes it into a user message. */
type ToolResultSeed = {
  type: "tool-result";
  toolCallId: string;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** One dsh session event as the seed writes it: the shapes dsh persists itself. */
export interface SeedEvent {
  type: string;
  seq: number;
  time: number;
  data: Record<string, JsonValue>;
  surfaceOp?: "append";
  sourceEventSeqs?: number[];
}

/** dsh session events for folded turns. Shapes follow what dsh writes itself; seqs are contiguous from 0. */
export function toSessionEvents(folded: FoldedTranscript): SeedEvent[] {
  const events: SeedEvent[] = [];
  // Record times are copied from the transcript, where a tool result can be stamped later than the
  // `turn/end` that follows it (Claude writes the result when it arrives, not when the turn closed).
  // dsh reads these events in order, so a time that goes backwards puts a step after the end of its
  // own turn. Each event is stamped at least as late as the one before it.
  let last = 0;
  const push = (
    type: string,
    time: number,
    data: Record<string, JsonValue>,
    extra?: { surfaceOp?: "append"; sourceEventSeqs?: number[] },
  ): number => {
    last = Math.max(last, time);
    events.push({ type, seq: events.length, time: last, data, ...extra });
    return events.length - 1;
  };
  folded.turns.forEach((t, i) => {
    const turn = i + 1;
    push("turn/start", t.time, { turn });
    t.steps.forEach((s, j) => {
      const step = j + 1;
      push("step/start", s.time, { turn, step });
      if (step === 1)
        push(
          "user/message",
          t.time,
          { id: t.id, role: "user", content: t.content, source: { kind: "user" } },
          { surfaceOp: "append" },
        );
      push(
        "assistant/message",
        s.time,
        {
          turn,
          step,
          message: {
            id: s.id,
            role: "assistant",
            content: s.content,
            source: { kind: "model", provider: "claude-code", model: s.model ?? "claude-code" },
          },
          // dsh 0.1.5 keeps the raw chunk stream on the settled message and refuses a seed without
          // the field ("invalid settlement fields"). A transcript has no chunks; dsh's own v1->v2
          // migration writes the same empty stream for a message it cannot replay, and every
          // reader (usage, first-token time, images) walks it and finds nothing.
          stream: [],
        },
        { surfaceOp: "append" },
      );
      for (const c of s.calls) {
        const callSeq = push("tool/call", s.time, {
          turn,
          step,
          callId: c.id,
          name: c.name,
          arguments: JSON.stringify(c.arguments),
        });
        // A call with no result in the file never returned — the session was killed mid-tool, or
        // the transcript was cut. dsh needs a result for every call, but seeding a settled empty
        // one erased the single fact worth keeping: that this is where the session died.
        const r = s.results.get(c.id) ?? {
          content: [{ type: "text" as const, text: "No result recorded: the session ended here." }],
          isError: true,
          time: s.time,
        };
        const block: ToolResultSeed = {
          type: "tool-result",
          toolCallId: c.id,
          content: r.content,
        };
        if (r.isError) block.isError = true;
        push(
          "tool/result",
          r.time,
          {
            turn,
            step,
            message: {
              id: `${c.id}:result`,
              role: "user",
              content: [block],
              source: { kind: "tool", callId: c.id },
            },
          },
          { surfaceOp: "append", sourceEventSeqs: [callSeq] },
        );
      }
      push("step/end", s.time, { turn, step });
    });
    push("turn/end", t.steps.at(-1)?.time ?? t.time, { turn, reason: { kind: "completed" } });
  });
  if (folded.title)
    push("session/title", folded.createdAt, {
      title: titleFrom(folded.title),
      messageSeqs: [],
      source: { kind: "user" },
    });
  return events;
}

/**
 * The bytes a transcript gained past `offset`, or "" when it has not grown. A file shorter than the
 * offset was replaced under us; it reads as nothing new until the next finished turn sets a fresh
 * baseline from its size.
 */
export async function readTranscriptFrom(path: string, offset: number): Promise<string> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    if (size <= offset) return "";
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

/**
 * The completed turns some other entrypoint wrote into a session's transcript: a terminal that
 * picked the session up with `claude /resume` stamps every row `entrypoint: cli`, while this
 * plugin's child stamps `own`. Rows without the stamp (queue bookkeeping, summaries) never count.
 * Folding drops an unanswered trailing prompt, so a terminal turn still running is not reported.
 */
export function foreignTurns(text: string, own: string): FoldedTurn[] {
  const lines = stripBom(text)
    .split("\n")
    .filter((l) => {
      const e = parseLine(l);
      return typeof e?.entrypoint === "string" && e.entrypoint !== own;
    });
  return lines.length === 0 ? [] : foldTranscript(lines.join("\n")).turns;
}

/** Those turns as one markdown block for the top of the next dsh turn, each side cut at `limit` bytes. */
export function foreignTurnsBlock(turns: FoldedTurn[], limit: number): string {
  const n = turns.length;
  const out = [
    `⇄ ${n} exchange${n === 1 ? "" : "s"} in a terminal since the last turn here; Claude resumed from the transcript, so it saw them.`,
  ];
  for (const t of turns) {
    const prompt = t.content.map((b) => b.text).join("\n");
    const reply = t.steps
      .flatMap((s) => s.content.filter((b) => b.type === "text").map((b) => b.text))
      .join("\n");
    out.push("", `> ${truncateBytes(prompt, limit).replaceAll("\n", "\n> ")}`);
    if (reply) out.push("", truncateBytes(reply, limit));
  }
  return out.join("\n");
}

/** Where 2.1 keeps a session's subagent transcripts: a directory beside the session's own file. */
export const subagentsDir = (path: string): string =>
  join(path.endsWith(".jsonl") ? path.slice(0, -".jsonl".length) : path, "subagents");

/**
 * Reads and parses a Claude Code transcript into folded turns, subagents included, from the box the
 * session runs on. Answers undefined when there is no such file; a box that cannot be reached
 * throws, rather than reading as a session with no history.
 */
export async function readTranscript(
  box: FsBox,
  path: string,
): Promise<FoldedTranscript | undefined> {
  const file = await readAt(box, path);
  if (file === null) return undefined;
  const folded = foldTranscript(file.text);
  if (folded.agents.size === 0) return folded;
  const dir = subagentsDir(path);
  const texts = new Map<string, string>();
  await Promise.all(
    [...folded.agents].map(async ([callId, agentId]) => {
      // A subagent file that is not there is normal: the directory is a 2.1 addition, and a run the
      // CLI never finished writing has none. The Task call resumes without its text either way.
      const text = await readAt(box, join(dir, `agent-${agentId}.jsonl`)).catch(() => null);
      if (text !== null) texts.set(callId, text.text);
    }),
  );
  attachSubagents(folded, texts);
  return folded;
}

/** A Claude Code transcript copied under a new id, cut before the (keep+1)-th human prompt so a
 *  dsh fork at an earlier turn rewinds Claude too. keep <= 0 keeps everything. */
export function forkTranscriptText(
  text: string,
  fromId: string,
  toId: string,
  keep: number,
): string {
  const out: string[] = [];
  let prompts = 0;
  for (const line of stripBom(text).split("\n")) {
    if (!line) continue;
    if (keep > 0) {
      const entry = parseLine(line);
      const message = isRec(entry?.message) ? entry.message : undefined;
      const content = message?.content;
      const human =
        entry?.type === "user" &&
        entry.isSidechain !== true &&
        (typeof content === "string" ||
          (Array.isArray(content) && !content.some((b) => isRec(b) && b.type === "tool_result")));
      if (human && ++prompts > keep) break;
    }
    out.push(line);
  }
  return `${out.join("\n").replaceAll(fromId, toId)}\n`;
}
