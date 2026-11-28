// A Claude session rebuilt from dsh's log, for a turn that has no Claude transcript to resume.
//
// Without one (pruned, moved aside after a refusal, never written on this box) the CLI used to get
// the whole history as one prompt: every earlier message, reply, tool call and result flattened into
// a single user message under `[user]` / `[assistant]` / `[tool]` labels. The model then reads the
// conversation as one block of text written by the user, mostly tool output, rather than as turns:
// its own earlier replies are no longer its own, and the people it talks with are a few lines inside
// it. Written as a transcript, the history keeps its turns, and the CLI resumes it like any other.
import { isJsonValue, isRec } from "../decode.js";
import { createHash, randomUUID } from "node:crypto";
import { readdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { NATIVE_TOOL_MAP, nativeToolName } from "./cli.js";
import { promptTextOf, textOf } from "./prompt.js";
/** What stands in for a result the log never got (the turn was cut off before the tool answered). */
export const NO_RESULT = "No result was recorded for this call.";
/** The tool name Claude saw: dsh's tools reach it over the bridge as `mcp__dsh__<name>`; a name
 *  that already has a server prefix, and Claude Code's own PascalCase tools, stay as they are. */
export const bridgedName = (name) => name.includes("__") || /^[A-Z]/.test(name) ? name : `mcp__dsh__${name}`;
/** Claude Code's own tool names, by the dsh name the plugin logs each one under. Where two share a
 *  dsh name (Edit and MultiEdit both log as `edit`) the first in `NATIVE_TOOL_MAP` wins. */
const NATIVE_NAMES = new Map(Object.entries(NATIVE_TOOL_MAP)
    .toReversed()
    .map(([native, dsh]) => [dsh, native]));
/** The id and the dsh name of the message that announces a tool call the plugin draws itself:
 *  `<callId>:call` for one of Claude's own tools (named as dsh draws it), `<callId>:dsh` for a dsh
 *  call that ran inside the bridge, which arrives under its `mcp__dsh__` name. `isNativeCall`
 *  reads the mark back when a transcript is rebuilt. */
export function announcementOf(callId, toolName) {
    if (toolName.startsWith("mcp__dsh__")) {
        return { id: `${callId}:dsh`, name: toolName.slice("mcp__dsh__".length) };
    }
    const name = nativeToolName(toolName) ?? toolName;
    return { id: `${callId}:call`, name };
}
/** The id shape the plugin mints for a relayed dsh call (`randomUUID`); Claude's own calls carry
 *  the API's tool_use id instead. */
const RELAY_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** The tool_use id shape the API accepts. */
const API_ID = /^[a-zA-Z0-9_-]{1,64}$/;
/** A logged call id as the API takes it: kept when it already fits, else a stand-in hashed from it,
 *  so a call and its result still pair. Other providers' ids do not fit: pi-ai's Responses calls
 *  carry `<call_id>|<item_id>`, and some run to kilobytes with `+` and `/`. Only the rows written
 *  get the stand-in; pairing and native-call checks keep comparing the logged id. From
 *  ThirteenCh13's report and suggested fix in #325. */
const apiId = (id) => API_ID.test(id) ? id : `toolu_seed_${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
/** Whether a logged call is one of Claude's own tools. The plugin writes each live one as a message
 *  of its own with the id `<callId>:call` (a dsh call that ran inside the bridge, `<callId>:dsh`).
 *  The Import seed writes them inside Claude's reply under
 *  dsh's name, where only the id tells them apart: a relayed dsh call has a minted id, Claude's
 *  call keeps its tool_use id, and a dsh tool Claude called over the bridge keeps its
 *  `mcp__dsh__` name. */
const isNativeCall = (m, call) => m.id === `${call.id}:call` ||
    (m.id !== `${call.id}:dsh` &&
        m.source?.provider === "claude-code" &&
        NATIVE_NAMES.has(call.name) &&
        !RELAY_ID.test(call.id));
/** The name Claude called a logged tool by: its own name for one of its own tools, the bridge
 *  name for a dsh tool. */
const calledName = (m, call) => {
    if (!isNativeCall(m, call)) {
        return bridgedName(call.name);
    }
    // MultiEdit logs as `edit` too; its input is the one that carries an `edits` list.
    if (call.name === "edit" && /"edits"\s*:\s*\[/.test(call.arguments)) {
        return "MultiEdit";
    }
    return NATIVE_NAMES.get(call.name) ?? call.name;
};
/** A tool call's arguments (dsh keeps them as JSON text) as the object a `tool_use` block carries;
 *  anything that does not parse to an object is kept whole under `input`. */
const inputOf = (args) => {
    if (args.trim() === "") {
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(args);
    }
    catch {
        return { input: args };
    }
    // Always JSON, coming off JSON.parse; the check is what types it.
    const value = isJsonValue(parsed) ? parsed : null;
    if (isRec(value)) {
        return value;
    }
    return { input: value };
};
/** The id a tool result answers, in either form dsh has written one. */
const resultCallId = (m) => m.role === "tool"
    ? m.toolCallId
    : m.role === "user" && m.source?.kind === "tool"
        ? m.source.callId
        : undefined;
/** Text of a message's non-text blocks, named so the turn still says something was there. */
const attachmentLines = (content) => Array.isArray(content)
    ? content.flatMap((b) => {
        if (b.type !== "image" && b.type !== "file") {
            return [];
        }
        // SAFETY: both attachment refs carry an id; only some carry a name
        const ref = b.attachment;
        return [`[${b.type} ${ref?.name ?? ref?.attachmentId ?? ""}]`.replace(" ]", "]")];
    })
    : [];
/** Where the history a seed holds ends: just past the last assistant message and the results that
 *  answer its calls. Everything after it is the new turn the prompt carries. 0 when no assistant
 *  message exists, which leaves nothing to seed. */
export function historyEnd(messages) {
    let last = -1;
    messages.forEach((m, i) => {
        if (m.role === "assistant") {
            last = i;
        }
    });
    if (last < 0) {
        return 0;
    }
    // Calls made side by side are logged as consecutive messages, all before their results: the
    // results that follow answer any of them.
    let first = last;
    while (messages[first - 1]?.role === "assistant") {
        first--;
    }
    const calls = new Set(messages.slice(first, last + 1).flatMap(callIdsOf));
    // A developer message dsh puts between a call and its result does not cut the result off.
    let end = last + 1;
    for (let i = last + 1; i < messages.length; i++) {
        const m = messages[i];
        if (m === undefined) {
            break;
        }
        const id = resultCallId(m);
        if (id !== undefined && calls.has(id)) {
            end = i + 1;
        }
        else if (m.role !== "developer") {
            break;
        }
    }
    return end;
}
/** The ids of the tool calls a message made. */
const callIdsOf = (m) => Array.isArray(m.content) ? m.content.flatMap((b) => (b.type === "tool-call" ? [b.id] : [])) : [];
/**
 * The transcript text (JSONL) for `messages[0, historyEnd)`: each person's message a user turn,
 * each reply an assistant turn with its tool calls, each result a `tool_result`. System messages
 * stay out (the system prompt rides on its own flag) and reasoning stays out (it carries no
 * signature the API would accept). A call the log has no result for gets one saying so, since the
 * API refuses a `tool_use` left unanswered. Empty when there is nothing to seed.
 */
export function seedTranscriptText(messages, o) {
    const end = historyEnd(messages);
    if (end === 0) {
        return "";
    }
    const drops = o.drops ?? new Set();
    const base = (o.now ?? new Date()).getTime();
    const rows = [];
    let parent = null;
    const push = (type, content) => {
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
    let open = [];
    const closeOpen = () => {
        for (const id of open) {
            push("user", [
                {
                    type: "tool_result",
                    tool_use_id: apiId(id),
                    content: [{ type: "text", text: NO_RESULT }],
                    is_error: true,
                },
            ]);
        }
        open = [];
    };
    /** A message the conversation shows as someone speaking: a person, or dsh's developer messages
     *  when they count. Either closes the calls still open. */
    const isConversation = (m) => (m.role === "user" && m.source?.kind !== "tool") ||
        (o.developer === true && m.role === "developer");
    const history = messages.slice(0, end);
    /** Whether a result for one of the open calls still comes after `from`, before the person speaks
     *  again: then the calls are running side by side, not cut off. */
    const answeredLater = (from) => {
        for (const later of history.slice(from + 1)) {
            const id = resultCallId(later);
            if (id !== undefined && open.includes(id)) {
                return true;
            }
            if (isConversation(later)) {
                return false;
            }
        }
        return false;
    };
    for (const [i, m] of history.entries()) {
        const callId = resultCallId(m);
        if (callId !== undefined) {
            if (!open.includes(callId)) {
                continue;
            } // its call is not in the seed, or already answered
            open = open.filter((id) => id !== callId);
            const full = textOf(m.content);
            const cap = o.cap ?? 0;
            const kept = cap > 0 && full.length > cap
                ? `${full.slice(0, cap)}… (${full.length - cap} more characters)`
                : full;
            const text = [kept, ...attachmentLines(m.content)].filter(Boolean).join("\n") || "(no output)";
            const block = {
                type: "tool_result",
                tool_use_id: apiId(callId),
                content: [{ type: "text", text }],
            };
            if (m.isError) {
                block.is_error = true;
            }
            push("user", [block]);
            continue;
        }
        if (m.role === "assistant") {
            // Claude runs a message's tool calls side by side, and the plugin logs each as a message of
            // its own before any result: those calls belong in the one reply that made them, or the
            // first would be closed as unanswered and its real result dropped.
            const last = rows.at(-1);
            const together = open.length > 0 && last?.type === "assistant" && answeredLater(i);
            if (!together) {
                closeOpen();
            }
            const content = together && last ? last.message.content : [];
            if (Array.isArray(m.content)) {
                for (const b of m.content) {
                    if (b.type === "text" && b.text.trim() !== "") {
                        content.push({ type: "text", text: b.text });
                    }
                    if (b.type === "tool-call") {
                        content.push({
                            type: "tool_use",
                            id: apiId(b.id),
                            name: calledName(m, b),
                            input: inputOf(b.arguments),
                        });
                        open.push(b.id);
                    }
                }
            }
            else if (m.content !== undefined && m.content.trim() !== "") {
                content.push({ type: "text", text: m.content });
            }
            if (content.length > 0 && !together) {
                push("assistant", content);
            }
            continue;
        }
        if (!isConversation(m)) {
            continue;
        }
        const text = [promptTextOf(m, drops, o.copies), ...attachmentLines(m.content)]
            .filter((t) => t.trim() !== "")
            .join("\n");
        if (text === "") {
            continue;
        }
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
/** How many moved-aside copies of one transcript a rebuild keeps. */
export const REPLACED_KEEP = 2;
/**
 * Delete the older `<dest>.replaced-<ms>` copies a transcript rebuild left beside `dest`, keeping
 * the `keep` newest by their stamp. Only names that are `dest`'s own name plus `.replaced-` and
 * digits are touched, so another transcript's copies and every other file stay. A copy that is
 * already gone or cannot be deleted is passed over; an unreadable directory deletes nothing.
 */
export async function pruneReplaced(dest, keep = REPLACED_KEEP) {
    const prefix = `${basename(dest)}.replaced-`;
    const names = await readdir(dirname(dest)).catch(() => []);
    const stamped = names
        .filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))
        .toSorted((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    for (const old of stamped.slice(keep)) {
        await unlink(join(dirname(dest), old)).catch(() => undefined);
    }
}
//# sourceMappingURL=seed.js.map