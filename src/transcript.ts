// Claude Code transcripts (~/.claude/projects/<cwd>/<uuid>.jsonl) → dsh session events, so a
// session started in the terminal can be opened in dsh with its history and resumed from there.
// This is an I/O boundary: transcript lines are decoded here and typed shapes leave.
import { open, readdir, stat } from "node:fs/promises";
import { readAt, type FsBox } from "./remote-fs.js";
import { join } from "node:path";
import type { JsonValue } from "./dsh.js";
import { NATIVE_TOOL_MAP } from "./adapter.js";
import { formatToolCall, formatToolResult } from "./translator.js";

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

/** A user row the CLI wrote on its own behalf, not a person's prompt: background-task notifications
 *  land as `type: "user"` with `promptSource: "system"` (`origin.kind: "task-notification"`, seen on
 *  2.1.268). Kept as an exclusion rather than a test for `"typed"` so rows from CLIs that predate the
 *  field, and `"queued"` rows (a person's prompt held while the CLI was busy), still count. */
const isSystemPrompt = (rec: Rec): boolean => rec.promptSource === "system";

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
      if (rec.type !== "user" || rec.isSidechain || rec.isMeta || isSystemPrompt(rec)) continue;
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
/** Text the owner typed while the CLI was busy. Claude Code records it as a `queue-operation` row
 *  rather than a user row: no `entrypoint`, no `message`, just the text. Both the fold and the
 *  foreign-row filter below key off those fields, so a message queued mid-turn reached dsh by no
 *  route at all — neither the mirror nor the seed a terminal-only session is opened from. Measured on
 *  a real transcript 2026-09-11: 68 `enqueue` rows, of which 25 never appeared as a user row. */
const queuedPrompt = (rec: Rec): string | undefined => {
  if (rec.type !== "queue-operation" || rec.operation !== "enqueue") return undefined;
  const text = typeof rec.content === "string" ? rec.content : "";
  return text.trim() ? text : undefined;
};

/** How a queued message is matched against the prompts, on a trimmed head rather than the whole text
 *  so a stray newline does not make the same words look like two different messages. */
const queueKey = (text: string): string => text.trim().slice(0, 200);

/** Queued texts that also arrive as a prompt of their own. The CLI writes the queue row when the
 *  message is typed and, when it delivers it, usually writes it again as a real user row carrying
 *  `promptSource: "queued"`. Folding both puts the same words in twice as two exchanges with
 *  different replies, which is what makes a mirrored conversation read as though it jumped around.
 *  Measured on this session: 85 enqueue rows, 46 of them also a user row. The user row is the
 *  canonical one, since it sits where the CLI actually delivered the message, so the queue row is
 *  skipped wherever its text turns up there — and kept where it does not, which is the case this
 *  reads queue rows for at all. */
const deliveredAsPrompt = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const line of stripBom(text).split("\n")) {
    const rec = parseLine(line);
    if (rec?.type !== "user") continue;
    const content = isRec(rec.message) ? rec.message.content : undefined;
    if (typeof content === "string" && content.trim()) out.add(queueKey(content));
  }
  return out;
};

export function foldTranscript(text: string): FoldedTranscript {
  const turns: FoldedTurn[] = [];
  const delivered = deliveredAsPrompt(text);
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
    const queued = queuedPrompt(rec);
    if (queued !== undefined) {
      // A message typed mid-turn opens an exchange of its own here. The CLI hands it to the same
      // turn it was typed during, but dsh has no way to show a second prompt inside one turn, and a
      // bubble in the wrong place reads better than words that are simply gone.
      // A later `remove` row for this text is not a reason to drop it. Two attempts at reading one
      // as a retraction both lost real messages: the CLI writes `remove` when it *delivers* a queued
      // message, under `absorbed_mid_turn`, under `delivered_to_agent`, and under no reason at all.
      // Counted across every transcript on this box: 2046 removals, of which 1238 are absorbed, 3
      // are delivered_to_agent and 805 carry no reason — and of those 805, 439 hold text that never
      // appears as a user row anywhere, which is the signature of a message delivered mid-turn. Not
      // one removal in 2046 names a retraction. Showing a line someone took back is a cosmetic
      // oddity; dropping one is the failure this reads queue rows to prevent, so nothing is dropped.
      // The exception is a message that also arrives as a prompt of its own: fold it there, once.
      if (delivered.has(queueKey(queued))) continue;
      close();
      const qtime = timeOf(rec, Date.now());
      createdAt ??= qtime;
      title ??= titleFrom(queued);
      cur = {
        id: typeof rec.uuid === "string" ? rec.uuid : `q${turns.length}`,
        time: qtime,
        content: [{ type: "text", text: queued }],
        steps: [],
      };
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
      if (rec.isMeta || isSystemPrompt(rec)) continue;
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

/** What another entrypoint wrote into a stretch of transcript: its completed turns, and how many
 *  bytes of the stretch are settled. A prompt still being answered is not settled: `consumed` stops
 *  at its row, so the next read starts there and reports the whole turn once. */
export interface ForeignTurns {
  turns: FoldedTurn[];
  consumed: number;
  /** Bytes through the end of the first completed turn, or `consumed` when there is none. A live
   *  stream owns one exchange: settling it moves the baseline by this much rather than by
   *  `consumed`, so an exchange that landed behind it is still ahead of the baseline for the next
   *  read to mirror instead of being jumped over and lost. */
  firstEnd: number;
  /** The entrypoint stamps seen on those rows: `cli` for a terminal, `sdk-cli` for a print run. */
  stamps: Set<string>;
  /** Byte offset of the newest foreign prompt in the read, open or answered; where the latest
   *  exchange begins. `consumed` when there is no foreign prompt. Used to re-read the latest
   *  exchange when a session is opened, so the tab always catches up to it. */
  lastPromptAt: number;
  /** The turn still being answered at the end of the read, folded up to its completed steps, or
   *  undefined when the read ends on a settled turn. Live streaming renders this as it grows. */
  running?: FoldedTurn;
}

const isPromptContent = (content: unknown): boolean =>
  typeof content === "string" ||
  (Array.isArray(content) && !content.some((b) => isRec(b) && b.type === "tool_result"));
/** Stop reasons that end a Claude turn; `tool_use` does not — the assistant resumes after the tool. */
const TERMINAL_STOPS = new Set(["end_turn", "stop_sequence", "max_tokens"]);
/** Whether an assistant row closes the turn it belongs to. The CLI splits one turn into several
 *  assistant rows (thinking, text, then a tool call), and stamps every row before a tool with
 *  `stop_reason: "tool_use"`; only the last row of a finished turn carries a terminal stop reason.
 *  Keying off `stop_reason` is why an answer that writes a sentence, calls a tool, then writes the
 *  rest is not cut at that first sentence. A row without the field (older transcript, a partial)
 *  falls back to "has text, no tool call", the shape used before the field was read. */
const endsTurn = (message: Rec | undefined): boolean => {
  const stop = typeof message?.stop_reason === "string" ? message.stop_reason : undefined;
  if (stop !== undefined) return TERMINAL_STOPS.has(stop);
  const content = message?.content;
  return (
    Array.isArray(content) &&
    content.some((b) => isRec(b) && b.type === "text") &&
    !content.some((b) => isRec(b) && b.type === "tool_use")
  );
};

/**
 * The turns some other entrypoint wrote into a stretch of a session's transcript: a terminal that
 * picked the session up with `claude /resume` stamps every row `entrypoint: cli`, while this
 * plugin's child stamps `own`. Rows without the stamp (queue bookkeeping, summaries) never count,
 * and neither do SDK stamps: another program driving the CLI is not a person to echo, and a CLI
 * too old to keep the stamp it was given (lilly's 2.1.123 writes sdk-cli for this plugin's own
 * child) would otherwise see its own dsh turns come back as terminal ones.
 * A prompt is running until an assistant row with a terminal `stop_reason` lands; it and what
 * follows wait for the next read, so a reply that writes a sentence, calls a tool, then writes the
 * rest is mirrored whole, not cut at the sentence.
 */
const SDK_STAMPS = new Set(["sdk-cli", "sdk-ts", "sdk-py"]);

export function foreignTurns(text: string, own: string): ForeignTurns {
  const lines: string[] = [];
  const stamps = new Set<string>();
  let offset = 0;
  let pending: { at: number; line: number } | undefined;
  let lastPromptAt: number | undefined;
  let firstEnd: number | undefined;
  const delivered = deliveredAsPrompt(text);
  for (const l of text.split("\n")) {
    const e = parseLine(l);
    // A queued message carries no stamp to judge it by, only its text. Nothing this plugin drives
    // queues anything — dsh sends one prompt per turn over stream-json, and the queue is the
    // terminal's own — so a queue row is a person at a terminal, which is exactly what to mirror.
    const queued = e ? queuedPrompt(e) : undefined;
    if (queued !== undefined && !delivered.has(queueKey(queued))) {
      pending = { at: offset, line: lines.length };
      lastPromptAt = offset;
      lines.push(l);
    } else if (
      typeof e?.entrypoint === "string" &&
      e.entrypoint !== own &&
      !SDK_STAMPS.has(e.entrypoint)
    ) {
      stamps.add(e.entrypoint);
      const content = isRec(e.message) ? e.message.content : undefined;
      if (e.type === "user" && isPromptContent(content) && !isSystemPrompt(e)) {
        pending = { at: offset, line: lines.length };
        lastPromptAt = offset;
      } else if (e.type === "assistant" && endsTurn(isRec(e.message) ? e.message : undefined)) {
        pending = undefined;
        firstEnd ??= offset + Buffer.byteLength(l) + 1;
      }
      lines.push(l);
    }
    offset += Buffer.byteLength(l) + 1;
  }
  const done = pending ? lines.slice(0, pending.line) : lines;
  const consumed = pending?.at ?? Buffer.byteLength(text);
  // The unfinished turn at the tail, folded up to whatever completed steps it has so far, so a live
  // stream can render it while it grows. foldTranscript drops a trailing prompt with no step, so a
  // just-typed prompt with no reply yet yields nothing here until its first step lands.
  const runningLines = pending ? lines.slice(pending.line) : [];
  const running =
    runningLines.length > 0 ? foldTranscript(runningLines.join("\n")).turns[0] : undefined;
  return {
    turns: done.length === 0 ? [] : foldTranscript(done.join("\n")).turns,
    consumed,
    firstEnd: firstEnd ?? consumed,
    stamps,
    lastPromptAt: lastPromptAt ?? consumed,
    running,
  };
}

/** A short, stable fingerprint of a turn for dedup: its prompt and the start of its final answer,
 *  both of which the mirrored dsh message also carries, so "has the dsh log already shown this
 *  exchange?" is a substring test against the log's recent messages. Empty only for an empty turn. */
/** The text blocks of a dsh assistant/message's content, joined; other block kinds are skipped.
 *  A boundary decode so callers outside this file need no `typeof` on event data. */
export function assistantMessageText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const b of content) if (isRec(b) && typeof b.text === "string") out.push(b.text);
  return out.join("\n");
}

/** Whether the dsh log already shows this exchange, so re-reading the latest one when a session opens
 *  does not mirror it twice. The prompt and the reply land in dsh as two separate messages, so one
 *  string spanning both can never be found in either: the fingerprint that did exactly that matched
 *  nothing at all, and every re-read mirrored the exchange again. Both halves are checked, and both
 *  must be present, because dropping an exchange that was not really shown is the worse mistake — a
 *  tool-heavy reply can open with the same rendered line as another, so the reply alone is not enough
 *  to tell two exchanges apart. `shown` must carry the text of recent user *and* assistant messages. */
export function alreadyShown(turn: FoldedTurn, shown: string, limit: number): boolean {
  if (shown === "") return false;
  const prompt = turn.content
    .map((b) => b.text)
    .join(" ")
    .trim()
    .slice(0, 60);
  const reply = mirrorReply(turn, limit).trim().slice(0, 60);
  return prompt !== "" && reply !== "" && shown.includes(prompt) && shown.includes(reply);
}

/** A long terminal turn (a build, a survey with dozens of tool calls) is cut here as one message. */
const MIRROR_REPLY_BYTES = 48 * 1024;

/** The reply a terminal got, as the markdown of one dsh assistant message: each step's blocks in
 *  order, tool calls and their results drawn the way the inline translator draws them in a live
 *  turn, text as it is. Thinking stays out, as it does live. Results are cut at `limit` bytes. */
export function mirrorReply(turn: FoldedTurn, limit: number): string {
  const md = mirrorReplyBlocks(turn, limit).join("\n\n") || "(no reply)";
  if (Buffer.byteLength(md) <= MIRROR_REPLY_BYTES) return md;
  return `${truncateBytes(md, MIRROR_REPLY_BYTES)}\n\n… cut here; the whole exchange is in the transcript.`;
}

/** The reply as one markdown chunk per rendered block — a text block, or a tool call with its
 *  result — in order. Live streaming yields the chunks a running turn has gained since the last
 *  render, so a long turn fills into one dsh turn step by step instead of landing all at once. */
export function mirrorReplyBlocks(turn: FoldedTurn, limit: number): string[] {
  const parts: string[] = [];
  for (const step of turn.steps) {
    for (const block of step.content) {
      if (block.type === "text") {
        if (block.text.trim()) parts.push(block.text.trim());
      } else if (block.type === "tool-call") {
        const name = toolNameOf(block.name);
        const result = step.results.get(block.id);
        let filePath = "";
        try {
          const args: unknown = JSON.parse(block.arguments);
          if (isRec(args) && typeof args.file_path === "string") filePath = args.file_path;
        } catch {
          // arguments that are not JSON have no path to read
        }
        // The call is one block and its output is the next. The CLI writes the call row when it makes
        // the call and the result row only when the tool returns — a median of 1.5s apart on this box
        // and minutes for a slow command — so pairing them into a single block left the tab blank for
        // the whole run, showing nothing of what was already known to be running. Two blocks also keep
        // the live render append-only: a block that has been shown is never rewritten, only followed
        // by its output when that lands. Joined for a settled turn, the rendered text is unchanged.
        parts.push(formatToolCall(name, block.arguments));
        if (result)
          parts.push(
            formatToolResult(
              name,
              filePath,
              truncateBytes(result.content.map((b) => b.text).join("\n"), limit),
              result.isError,
            ),
          );
      }
    }
  }
  return parts;
}

/**
 * A transcript as one Markdown document: title, date, then `## You` and `## Claude` per turn, the
 * reply rendered by the same blocks the terminal mirror draws (text, tool calls, results).
 */
export function toMarkdown(folded: FoldedTranscript, limit = 4000): string {
  const lines: string[] = [
    `# ${folded.title ?? "Claude Code session"}`,
    "",
    `_${new Date(folded.createdAt).toISOString()}_`,
  ];
  for (const turn of folded.turns) {
    const userText = turn.content
      .map((b) => b.text)
      .join("\n")
      .trim();
    lines.push(
      "",
      "## You",
      "",
      userText || "(empty)",
      "",
      "## Claude",
      "",
      // Blocks are paragraphs: a text block followed by a fenced tool call needs the blank line.
      mirrorReplyBlocks(turn, limit).join("\n\n"),
    );
  }
  return `${lines.join("\n")}\n`;
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
