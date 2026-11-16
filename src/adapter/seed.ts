// A Claude session rebuilt from dsh's log, for a turn that has no Claude transcript to resume.
//
// Without one (pruned, moved aside after a refusal, never written on this box) the CLI used to get
// the whole history as one prompt: every earlier message, reply, tool call and result flattened into
// a single user message under `[user]` / `[assistant]` / `[tool]` labels. The model then reads the
// conversation as one block of text written by the user, mostly tool output, rather than as turns:
// its own earlier replies are no longer its own, and the people it talks with are a few lines inside
// it. Written as a transcript, the history keeps its turns, and the CLI resumes it like any other.
import { randomUUID } from "node:crypto";
import type { ContextSource } from "../context-sources.js";
import type { JsonValue } from "../dsh.js";
import { NATIVE_TOOL_MAP } from "./cli.js";
import { type LooseMessage, type NativeCopies, promptTextOf, textOf } from "./prompt.js";

/** One transcript row the CLI's `--resume` loads. */
interface Row {
  parentUuid: string | null;
  isSidechain: false;
  type: "user" | "assistant";
  message: { role: "user" | "assistant"; content: Block[] };
  uuid: string;
  timestamp: string;
  userType: "external";
  cwd: string;
  sessionId: string;
  version: string;
}

/** The arguments of one tool call, as JSON. */
type ToolInput = { [key: string]: JsonValue };

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: ToolInput }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: { type: "text"; text: string }[];
      is_error?: boolean;
    };

/** What stands in for a result the log never got (the turn was cut off before the tool answered). */
export const NO_RESULT = "No result was recorded for this call.";

/** The tool name Claude saw: dsh's tools reach it over the bridge as `mcp__dsh__<name>`; a name
 *  that already has a server prefix, and Claude Code's own PascalCase tools, stay as they are. */
export const bridgedName = (name: string): string =>
  name.includes("__") || /^[A-Z]/.test(name) ? name : `mcp__dsh__${name}`;

/** Claude Code's own tool names, by the dsh name the plugin logs each one under. Where two share a
 *  dsh name (Edit and MultiEdit both log as `edit`) the first in `NATIVE_TOOL_MAP` wins. */
const NATIVE_NAMES = new Map<string, string>(
  Object.entries(NATIVE_TOOL_MAP)
    .toReversed()
    .map(([native, dsh]) => [dsh, native]),
);

/** The name Claude called a logged tool by. The plugin writes each of Claude's own tool calls as a
 *  message of its own with the id `<callId>:call`; dsh's relayed calls never carry that id, so they
 *  keep their bridge name. A call logged by the Import seed carries Claude's message id instead, so
 *  it keeps the bridge name; shortcut: an imported session rebuilt from its log names native calls
 *  as dsh's, mark them at import if that turns up. */
const calledName = (
  m: LooseMessage,
  call: { id: string; name: string; arguments: string },
): string => {
  if (m.id !== `${call.id}:call`) return bridgedName(call.name);
  // MultiEdit logs as `edit` too; its input is the one that carries an `edits` list.
  if (call.name === "edit" && /"edits"\s*:\s*\[/.test(call.arguments)) return "MultiEdit";
  return NATIVE_NAMES.get(call.name) ?? call.name;
};

/** A tool call's arguments (dsh keeps them as JSON text) as the object a `tool_use` block carries;
 *  anything that does not parse to an object is kept whole under `input`. */
const inputOf = (args: string) => {
  if (args.trim() === "") return {} satisfies ToolInput;
  let value: JsonValue;
  try {
    // SAFETY: JSON.parse of text yields a JSON value
    value = JSON.parse(args) as JsonValue;
  } catch {
    return { input: args } satisfies ToolInput;
  }
  if (value instanceof Object && !Array.isArray(value)) return value;
  return { input: value } satisfies ToolInput;
};

/** The id a tool result answers, in either form dsh has written one. */
const resultCallId = (m: LooseMessage): string | undefined =>
  m.role === "tool"
    ? m.toolCallId
    : m.role === "user" && m.source?.kind === "tool"
      ? m.source.callId
      : undefined;

/** Text of a message's non-text blocks, named so the turn still says something was there. */
const attachmentLines = (content: LooseMessage["content"]): string[] =>
  Array.isArray(content)
    ? content.flatMap((b) => {
        if (b.type !== "image" && b.type !== "file") return [];
        // SAFETY: both attachment refs carry an id; only some carry a name
        const ref = (b as { attachment?: { name?: string; attachmentId?: string } }).attachment;
        return [`[${b.type} ${ref?.name ?? ref?.attachmentId ?? ""}]`.replace(" ]", "]")];
      })
    : [];

/** Where the history a seed holds ends: just past the last assistant message and the results that
 *  answer its calls. Everything after it is the new turn the prompt carries. 0 when no assistant
 *  message exists, which leaves nothing to seed. */
export function historyEnd(messages: readonly LooseMessage[]): number {
  let last = -1;
  messages.forEach((m, i) => {
    if (m.role === "assistant") last = i;
  });
  const lastReply = messages[last];
  if (lastReply === undefined) return 0;
  const calls = new Set(callIdsOf(lastReply));
  let end = last + 1;
  for (let m = messages[end]; m !== undefined; m = messages[++end]) {
    const id = resultCallId(m);
    if (id === undefined || !calls.has(id)) break;
  }
  return end;
}

/** The ids of the tool calls a message made. */
const callIdsOf = (m: LooseMessage): string[] =>
  Array.isArray(m.content) ? m.content.flatMap((b) => (b.type === "tool-call" ? [b.id] : [])) : [];

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
export function seedTranscriptText(messages: readonly LooseMessage[], o: SeedOptions): string {
  const end = historyEnd(messages);
  if (end === 0) return "";
  const drops = o.drops ?? new Set<ContextSource>();
  const base = (o.now ?? new Date()).getTime();
  const rows: Row[] = [];
  let parent: string | null = null;
  const push = (type: Row["type"], content: Block[]) => {
    const uuid = randomUUID();
    rows.push({
      parentUuid: parent,
      isSidechain: false,
      type,
      message: { role: type, content },
      uuid,
      // Strictly increasing, so a reader sorting by time keeps the order written.
      timestamp: new Date(base - (end - rows.length) * 1000).toISOString(),
      userType: "external",
      cwd: o.cwd,
      sessionId: o.sessionId,
      version: o.version,
    });
    parent = uuid;
  };
  let open: string[] = [];
  const closeOpen = () => {
    for (const id of open)
      push("user", [
        {
          type: "tool_result",
          tool_use_id: id,
          content: [{ type: "text", text: NO_RESULT }],
          is_error: true,
        },
      ]);
    open = [];
  };
  for (const m of messages.slice(0, end)) {
    const callId = resultCallId(m);
    if (callId !== undefined) {
      if (!open.includes(callId)) continue; // its call is not in the seed, or already answered
      open = open.filter((id) => id !== callId);
      const full = textOf(m.content);
      const cap = o.cap ?? 0;
      const kept =
        cap > 0 && full.length > cap
          ? `${full.slice(0, cap)}… (${full.length - cap} more characters)`
          : full;
      const text =
        [kept, ...attachmentLines(m.content)].filter(Boolean).join("\n") || "(no output)";
      const block: Block = {
        type: "tool_result",
        tool_use_id: callId,
        content: [{ type: "text", text }],
      };
      if (m.isError) block.is_error = true;
      push("user", [block]);
      continue;
    }
    if (m.role === "assistant") {
      closeOpen();
      const content: Block[] = [];
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b.type === "text" && b.text.trim() !== "")
            content.push({ type: "text", text: b.text });
          if (b.type === "tool-call") {
            content.push({
              type: "tool_use",
              id: b.id,
              name: calledName(m, b),
              input: inputOf(b.arguments),
            });
            open.push(b.id);
          }
        }
      } else if (m.content !== undefined && m.content.trim() !== "") {
        content.push({ type: "text", text: m.content });
      }
      if (content.length > 0) push("assistant", content);
      continue;
    }
    const conversation =
      (m.role === "user" && m.source?.kind !== "tool") ||
      (o.developer === true && m.role === "developer");
    if (!conversation) continue;
    const text = [promptTextOf(m, drops, o.copies), ...attachmentLines(m.content)]
      .filter((t) => t.trim() !== "")
      .join("\n");
    if (text === "") continue;
    closeOpen();
    push("user", [{ type: "text", text }]);
  }
  closeOpen();
  // The API takes a conversation that opens with the user; one that opens with a reply (a session
  // whose first message was withheld) gets a neutral first line.
  if (rows[0]?.type === "assistant") {
    const first = randomUUID();
    rows[0].parentUuid = first;
    rows.unshift({
      ...rows[0],
      parentUuid: null,
      type: "user",
      uuid: first,
      timestamp: new Date(Date.parse(rows[0].timestamp) - 1000).toISOString(),
      message: { role: "user", content: [{ type: "text", text: "(conversation start)" }] },
    });
  }
  return rows.length > 0 ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "";
}
