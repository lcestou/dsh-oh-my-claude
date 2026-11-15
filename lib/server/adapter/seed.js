// A Claude session rebuilt from dsh's log, for a turn that has no Claude transcript to resume.
//
// Without one (pruned, moved aside after a refusal, never written on this box) the CLI used to get
// the whole history as one prompt: every earlier message, reply, tool call and result flattened into
// a single user message under `[user]` / `[assistant]` / `[tool]` labels. The model then reads the
// conversation as one block of text written by the user, mostly tool output, rather than as turns:
// its own earlier replies are no longer its own, and the people it talks with are a few lines inside
// it. Written as a transcript, the history keeps its turns, and the CLI resumes it like any other.
import { randomUUID } from "node:crypto";
import { promptTextOf, textOf } from "./prompt.js";
/** What stands in for a result the log never got (the turn was cut off before the tool answered). */
export const NO_RESULT = "No result was recorded for this call.";
/** The tool name Claude saw: dsh's tools reach it over the bridge as `mcp__dsh__<name>`; a name
 *  that already has a server prefix, and Claude Code's own PascalCase tools, stay as they are. */
export const bridgedName = (name) => name.includes("__") || /^[A-Z]/.test(name) ? name : `mcp__dsh__${name}`;
/** A tool call's arguments (dsh keeps them as JSON text) as the object a `tool_use` block carries;
 *  anything that does not parse to an object is kept whole under `input`. */
const inputOf = (args) => {
    if (args.trim() === "")
        return {};
    let value;
    try {
        // SAFETY: JSON.parse of text yields a JSON value
        value = JSON.parse(args);
    }
    catch {
        return { input: args };
    }
    if (value instanceof Object && !Array.isArray(value))
        return value;
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
        if (b.type !== "image" && b.type !== "file")
            return [];
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
        if (m.role === "assistant")
            last = i;
    });
    const lastReply = messages[last];
    if (lastReply === undefined)
        return 0;
    const calls = new Set(callIdsOf(lastReply));
    let end = last + 1;
    for (let m = messages[end]; m !== undefined; m = messages[++end]) {
        const id = resultCallId(m);
        if (id === undefined || !calls.has(id))
            break;
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
    if (end === 0)
        return "";
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
            if (!open.includes(callId))
                continue; // its call is not in the seed, or already answered
            open = open.filter((id) => id !== callId);
            const full = textOf(m.content);
            const cap = o.cap ?? 0;
            const kept = cap > 0 && full.length > cap
                ? `${full.slice(0, cap)}… (${full.length - cap} more characters)`
                : full;
            const text = [kept, ...attachmentLines(m.content)].filter(Boolean).join("\n") || "(no output)";
            const block = {
                type: "tool_result",
                tool_use_id: callId,
                content: [{ type: "text", text }],
            };
            if (m.isError)
                block.is_error = true;
            push("user", [block]);
            continue;
        }
        if (m.role === "assistant") {
            closeOpen();
            const content = [];
            if (Array.isArray(m.content)) {
                for (const b of m.content) {
                    if (b.type === "text" && b.text.trim() !== "")
                        content.push({ type: "text", text: b.text });
                    if (b.type === "tool-call") {
                        content.push({
                            type: "tool_use",
                            id: b.id,
                            name: bridgedName(b.name),
                            input: inputOf(b.arguments),
                        });
                        open.push(b.id);
                    }
                }
            }
            else if (m.content !== undefined && m.content.trim() !== "") {
                content.push({ type: "text", text: m.content });
            }
            if (content.length > 0)
                push("assistant", content);
            continue;
        }
        const conversation = (m.role === "user" && m.source?.kind !== "tool") ||
            (o.developer === true && m.role === "developer");
        if (!conversation)
            continue;
        const text = [promptTextOf(m, drops, o.copies), ...attachmentLines(m.content)]
            .filter((t) => t.trim() !== "")
            .join("\n");
        if (text === "")
            continue;
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
            message: { role: "user", content: [{ type: "text", text: "(conversation start)" }] },
        });
    }
    return rows.length > 0 ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "";
}
//# sourceMappingURL=seed.js.map