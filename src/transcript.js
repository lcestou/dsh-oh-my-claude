// Claude Code transcripts (~/.claude/projects/<cwd>/<uuid>.jsonl) → dsh session events, so a
// session started in the terminal can be opened in dsh with its history and resumed from there.
import { readdir, readFile, stat, open } from "node:fs/promises";
import { join } from "node:path";

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const RESULT_TEXT_LIMIT = 4000;
const TITLE_BYTES = 80;

const parseLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};

const timeOf = (rec, fallback) => {
  const t = Date.parse(rec?.timestamp ?? "");
  return Number.isFinite(t) ? t : fallback;
};

/** Plain text of a user prompt, or "" for tool results / injections that are not a prompt. */
function promptText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Injected material Claude Code stores as user lines: slash-command echoes, hook output, reminders. */
const isNoise = (text) => /^\s*<(command-|local-command|system-reminder)/.test(text);

export function truncateBytes(text, max) {
  if (Buffer.byteLength(text) <= max) return text;
  let out = "";
  for (const ch of text) {
    if (Buffer.byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

const titleFrom = (text) =>
  truncateBytes(
    text
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .trim()
      .split("\n")[0]
      .replace(/\s+/g, " "),
    TITLE_BYTES,
  );

/** One-shots older plugin versions ran inside the workspace dir (titles now run from a scratch dir). */
const isAuxPrompt = (text) => text.startsWith("Generate the session title");

/** Read only the head of a transcript: first real prompt, timestamps, summary. Cheap for a listing. */
async function peek(path, maxBytes = 256 * 1024) {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return {
      lines: buf.subarray(0, bytesRead).toString("utf8").split("\n"),
      partial: bytesRead === maxBytes,
    };
  } finally {
    await fh.close();
  }
}

/**
 * Transcripts in one project dir, newest first. `exclude` holds Claude session ids that already
 * belong to dsh sessions the plugin started itself (their dsh side is the source of truth).
 */
export async function listTranscripts(dir, exclude = new Set()) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = UUID_FILE.exec(name);
    if (!m || exclude.has(m[1])) continue;
    const path = join(dir, name);
    const info = await stat(path);
    let title = "";
    let summary;
    let createdAt = info.mtimeMs;
    let turns = 0;
    const head = await peek(path);
    for (const line of head.lines) {
      const rec = parseLine(line);
      if (!rec) continue;
      if (rec.type === "summary" && typeof rec.summary === "string") summary = rec.summary;
      if (rec.type !== "user" || rec.isSidechain || rec.isMeta) continue;
      const text = promptText(rec.message?.content);
      if (!text) continue;
      if (turns === 0 && isAuxPrompt(text)) break;
      turns += 1;
      if (turns === 1) createdAt = timeOf(rec, createdAt);
      if (!title && !isNoise(text)) title = titleFrom(text);
    }
    if (turns === 0) continue;
    out.push({
      id: m[1],
      title: summary ?? title ?? "",
      createdAt,
      modifiedAt: info.mtimeMs,
      bytes: info.size,
      turns,
      turnsPartial: head.partial,
    });
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

const textBlocks = (content) => {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") out.push({ type: "text", text: b.text });
    else if (b?.type === "image") out.push({ type: "text", text: "[image]" });
  }
  return out;
};

const resultBlocks = (content) => {
  const blocks = textBlocks(content);
  const text = blocks.map((b) => b.text).join("\n");
  return text ? [{ type: "text", text: truncateBytes(text, RESULT_TEXT_LIMIT) }] : [];
};

/**
 * Fold a transcript into turns: one user prompt, then assistant steps (one per Claude message id)
 * with their tool calls and results. Sidechains (Claude's own subagents) and unfinished trailing
 * prompts are dropped; the seed must end on a completed turn.
 */
export function foldTranscript(text) {
  const turns = [];
  let cur;
  let title;
  let createdAt;
  const close = () => {
    if (cur?.steps.length) turns.push(cur);
    cur = undefined;
  };
  for (const line of text.split("\n")) {
    const rec = parseLine(line);
    if (!rec || rec.isSidechain) continue;
    if (rec.type === "summary" && typeof rec.summary === "string") {
      title = rec.summary;
      continue;
    }
    const msg = rec.message;
    if (rec.type === "user") {
      const content = Array.isArray(msg?.content) ? msg.content : [];
      const results = content.filter((b) => b?.type === "tool_result");
      if (results.length) {
        const step = cur?.steps.at(-1);
        if (!step) continue;
        for (const r of results)
          step.results.set(r.tool_use_id, {
            content: resultBlocks(r.content),
            isError: r.is_error === true,
            time: timeOf(rec, step.time),
          });
        continue;
      }
      if (rec.isMeta) continue;
      const prompt = textBlocks(msg?.content);
      if (prompt.length === 0) continue;
      close();
      const time = timeOf(rec, Date.now());
      createdAt ??= time;
      const plain = promptText(msg?.content);
      if (!title && !isNoise(plain)) title = titleFrom(plain);
      cur = { id: rec.uuid ?? `u${turns.length}`, time, content: prompt, steps: [] };
    } else if (rec.type === "assistant" && cur) {
      const last = cur.steps.at(-1);
      const step =
        last && last.msgId === msg?.id
          ? last
          : {
              msgId: msg?.id,
              id: msg?.id ?? rec.uuid ?? `a${turns.length}:${cur.steps.length}`,
              model: typeof msg?.model === "string" ? msg.model : undefined,
              time: timeOf(rec, cur.time),
              content: [],
              calls: [],
              results: new Map(),
            };
      if (step !== last) cur.steps.push(step);
      for (const b of Array.isArray(msg?.content) ? msg.content : []) {
        if (b?.type === "text" && typeof b.text === "string")
          step.content.push({ type: "text", text: b.text });
        else if (b?.type === "thinking" && typeof b.thinking === "string")
          step.content.push({ type: "reasoning", text: b.thinking });
        else if (b?.type === "tool_use" && typeof b.id === "string") {
          const args = b.input && typeof b.input === "object" ? b.input : {};
          // dsh keeps tool-call arguments as a JSON string (its token meter reads `.length`).
          step.content.push({
            type: "tool-call",
            id: b.id,
            name: String(b.name ?? "tool"),
            arguments: JSON.stringify(args),
          });
          step.calls.push({ id: b.id, name: String(b.name ?? "tool"), arguments: args });
        }
      }
    }
  }
  close();
  return { turns, title, createdAt: createdAt ?? Date.now() };
}

/** dsh session events for folded turns. Shapes follow what dsh writes itself; seqs are contiguous from 0. */
export function toSessionEvents(folded) {
  const events = [];
  const push = (type, time, data, extra) => {
    events.push({ type, seq: events.length, time, data, ...extra });
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
        const r = s.results.get(c.id) ?? { content: [], isError: false, time: s.time };
        push(
          "tool/result",
          r.time,
          {
            turn,
            step,
            message: {
              id: `${c.id}:result`,
              role: "user",
              content: [
                {
                  type: "tool-result",
                  toolCallId: c.id,
                  content: r.content,
                  ...(r.isError ? { isError: true } : {}),
                },
              ],
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

export async function readTranscript(path) {
  return foldTranscript(await readFile(path, "utf8"));
}
