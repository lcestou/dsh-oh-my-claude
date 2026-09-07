import { toolResultText, } from "./process.js";
import { NATIVE_TOOL_MAP, commandNames, finishReason } from "./adapter.js";
// ---------------------------------------------------------------------------
// stream-json → dsh chunks (moved from src/adapter.ts)
const TOOL_TEXT_LIMIT = 600;
const clip = (s, n = TOOL_TEXT_LIMIT) => (s.length > n ? `${s.slice(0, n)}…` : s);
const DENIED_RE = /requires? approval|permission (was )?denied|not allowed/i;
/** Every Claude Code tool except the dsh MCP relay gets a session row: mapped names pick the
 *  client's bash/read/edit presenters, the rest (TodoWrite, ToolSearch, Skill, mcp__*) the generic one. */
const isNativeTool = (toolName) => toolName !== "" && !toolName.startsWith("mcp__dsh__");
function usageEvent(u) {
    // dsh TokenUsage: inputTokens excludes cache hits; the three prompt counters plus output sum to totalTokens.
    const input = u.input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const usage = {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + cacheRead + cacheWrite + output,
    };
    if (cacheRead)
        usage.cacheReadTokens = cacheRead;
    if (cacheWrite)
        usage.cacheWriteTokens = cacheWrite;
    return { type: "usage", usage };
}
// Top-level CLI event types we knowingly swallow (protocol/handshake, not renderable content).
// Anything not here and not handled in translate() is a stream-json schema drift worth one warning.
const BENIGN_EVENTS = new Set([
    "system",
    "control_request",
    "control_cancel_request",
    "control_response",
    "timeout",
    "dsh_relay",
]);
// stream_event sub-types with no renderable delta (SSE bookkeeping).
const BENIGN_PARTIALS = new Set(["message_delta", "message_stop", "ping"]);
/** A reset instant as the CLI's banner shows it: `7pm` or `7:30pm`, then the box's zone. */
export function resetClock(ms, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    const clock = new Date(ms)
        .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })
        .toLowerCase()
        .replace(":00", "")
        .replace(" ", "");
    return `${clock} (${zone})`;
}
export class Translator {
    log;
    unknownSeen; // (where:type) already warned, so schema drift warns once, not per event
    toolActivity;
    /** Word the limit failure as "continuing automatically at …": the adapter arms the wait. */
    continueAfterLimit;
    /** Set when a usage limit ended the turn with a reset time in the future (ms since epoch). */
    limitResetAt;
    /** IANA zone for reset clocks: the browser's when dsh stamped one, else the box's. */
    timeZone;
    relay; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
    dshIds; // tool_use ids of dsh tools called over the MCP bridge
    dshNames; // dsh tool_use id → tool name, for a fallback row
    relayed; // dsh tool_use ids dsh ran natively; results not drawn here
    limit;
    index;
    open; // api block index → { index, blockType, text }
    sawPartial;
    finished;
    denied; // tool calls Claude Code refused because a non-interactive run cannot ask
    toolPending; // a tool_use block closed and its result has not arrived yet
    aborting; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
    /** Injected: append tool/call to the dsh session for a native Claude Code tool. */
    onToolCall;
    /** Injected: append tool/result to the dsh session for a native Claude Code tool. */
    onToolResult;
    /** Injected: fire per-turn accounting summary from the result frame. */
    onResult;
    /** Injected: mask secret values in tool results before they are shown or appended. */
    redact;
    /** Injected: the CLI's slash-command catalog from its init frame. */
    onInit;
    /** callId → original input JSON string, kept so Edit can build meta.diffs from it. */
    callInputs = new Map();
    /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
    firedCalls = new Map();
    /**
     * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
     * reach the same tool_use block; a second append gives the client two `tool/call` starts for
     * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
     */
    fireToolCall(callId, toolName, input) {
        const seen = this.firedCalls.get(callId);
        if (seen !== undefined)
            return seen;
        const seq = this.onToolCall?.(callId, toolName, input);
        if (seq !== undefined) {
            this.firedCalls.set(callId, seq);
            this.callInputs.set(callId, input);
        }
        return seq;
    }
    constructor({ toolActivity = true, continueAfterLimit = false, timeZone, toolTextLimit = TOOL_TEXT_LIMIT, relay = false, dshIds, relayed, log, onToolCall, onToolResult, onResult, redact, onInit, } = {}) {
        this.log = log ?? (() => { });
        this.unknownSeen = new Set(); // (where:type) already warned, so schema drift warns once, not per event
        this.toolActivity = toolActivity;
        this.continueAfterLimit = continueAfterLimit;
        this.limitResetAt = undefined;
        this.timeZone = timeZone;
        this.relay = relay; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
        this.dshIds = dshIds ?? new Set(); // tool_use ids of dsh tools called over the MCP bridge
        this.dshNames = new Map(); // dsh tool_use id → tool name, for a fallback row
        this.relayed = relayed ?? new Set(); // dsh tool_use ids dsh ran natively; results not drawn here
        this.limit = toolTextLimit;
        this.index = 0;
        this.open = new Map(); // api block index → { index, blockType, text }
        this.sawPartial = false;
        this.finished = false;
        this.denied = 0; // tool calls Claude Code refused because a non-interactive run cannot ask
        this.toolPending = false; // a tool_use block closed and its result has not arrived yet
        this.aborting = false; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
        this.onToolCall = onToolCall;
        this.onToolResult = onToolResult;
        this.onResult = onResult;
        this.redact = redact;
        this.onInit = onInit;
    }
    deltaType(block) {
        return block.blockType === "text" ? "text-delta" : "reasoning-delta";
    }
    /** Warn once when a CLI event/block type is neither handled nor knowingly ignored, so a Claude
     *  Code stream-json schema change shows up loud in the log instead of as silently dropped output. */
    noteUnknown(where, type) {
        if (type === null || type === undefined)
            return;
        const key = `${where}:${type}`;
        if (this.unknownSeen.has(key))
            return;
        this.unknownSeen.add(key);
        this.log("warn", `unhandled Claude Code ${where} "${type}" — stream-json schema may have changed`);
    }
    /** A block is announced on its first text. Claude emits thinking blocks that carry only a
     *  signature and never any text; announcing those eagerly draws an empty bubble. */
    startBlock(blockType, prefix = "") {
        const block = { index: this.index++, blockType, text: "", started: false };
        return { block, events: prefix ? this.delta(block, prefix) : [] };
    }
    /** Text for a block, with its block-start ahead of the first non-empty piece. Empty in, empty out. */
    delta(block, text) {
        if (!text)
            return [];
        block.text += text;
        const events = [];
        if (!block.started) {
            block.started = true;
            // SAFETY: blocks are opened with "text", "reasoning" or "tool-call"; hidden ones never announce
            events.push({
                type: "block-start",
                index: block.index,
                blockType: block.blockType,
            });
        }
        events.push({ type: this.deltaType(block), index: block.index, text });
        return events;
    }
    /** Close a block; one that never got text was never announced and closes silently. */
    endBlock(block) {
        if (!block.started)
            return [];
        return [
            {
                type: "block-end",
                index: block.index,
                block: block.blockType === "text"
                    ? { type: "text", text: block.text }
                    : { type: "reasoning", text: block.text },
            },
        ];
    }
    wholeBlock(blockType, text) {
        const { block, events } = this.startBlock(blockType);
        events.push(...this.delta(block, text), ...this.endBlock(block));
        return events;
    }
    translate(event) {
        switch (event?.type) {
            case "system": {
                if (event.subtype === "init") {
                    const names = commandNames(event.slash_commands);
                    if (names.length > 0)
                        this.onInit?.(names);
                    return [];
                }
                // Compaction opens with a `status:"compacting"` frame, then a long silent stretch while the
                // CLI summarizes, then `compact_boundary` when done. Announce the start at once so the silence
                // is explained; the boundary line reports the result. A failed run gets neither boundary nor a
                // start it can pair with, so surface its error here. All of it rides the reasoning lane so it
                // reads as model activity in the UI, not as chat text the model appears to have typed.
                if (event.subtype === "status") {
                    if (event.status === "compacting")
                        return this.wholeBlock("reasoning", "⟳ Compacting context…");
                    if (event.compact_result === "failed")
                        return this.wholeBlock("reasoning", `⚠ Compaction failed: ${event.compact_error ?? "unknown reason"}`);
                    return [];
                }
                // Auto-memory traffic: one line each way, so the Memory button's count is explained.
                if (event.subtype === "memory_saved") {
                    const paths = event.written_paths ?? [];
                    const names = paths.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ");
                    return this.wholeBlock("reasoning", `${event.verb ?? "Saved"} ${paths.length} ${paths.length === 1 ? "memory" : "memories"}${names ? `: ${names}` : ""}`);
                }
                if (event.subtype === "memory_recall") {
                    const n = event.memories?.length ?? 0;
                    return n > 0
                        ? this.wholeBlock("reasoning", `Recalled ${n} ${n === 1 ? "memory" : "memories"}`)
                        : [];
                }
                // Hook lifecycle: this box runs dozens of hooks per tool call, so only a hook that failed,
                // was cancelled or exited non-zero gets a reasoning line; a clean run and hook_started are
                // silent. Outcome literals in the CLI are "success", "error" and "cancelled".
                if (event.subtype === "hook_response") {
                    const exitCode = event.exit_code;
                    const failed = (event.outcome !== undefined && event.outcome !== "success") ||
                        (Number.isFinite(exitCode) && exitCode !== 0);
                    if (!failed)
                        return [];
                    const out = (event.output || event.stdout || event.stderr || "").trim();
                    const tail = Number.isFinite(exitCode) ? `exit ${exitCode}` : (event.outcome ?? "failed");
                    return this.wholeBlock("reasoning", `⚠ Hook ${event.hook_name ?? "?"} (${event.hook_event ?? "?"}) ${tail}${out ? `: ${clip(out)}` : ""}`);
                }
                // Task frames from the CLI's built-in subagent runner. A start and a notification each get one
                // reasoning line so a native background Bash or a stray native Agent run is visible; progress and
                // the list churn are silent.
                if (event.subtype === "task_started") {
                    return this.wholeBlock("reasoning", `▶ Task${event.is_backgrounded ? " (background)" : ""}: ${event.description ?? event.task_id ?? "?"}${event.subagent_type ? ` [${event.subagent_type}]` : ""}`);
                }
                if (event.subtype === "task_notification") {
                    const summary = (event.summary ?? "").trim();
                    return this.wholeBlock("reasoning", `■ Task ${event.status ?? "done"}: ${summary ? clip(summary) : (event.task_id ?? "?")}`);
                }
                // The CLI retries a failed API call by itself (up to max_retries, backing off). Without a
                // line here the turn looks like it is working while nothing happens: dsh only sees silence
                // and keeps the spinner verb. Worded like the CLI's own retry banner: the error, the wait,
                // the reset time when a usage limit is the cause, and the attempt count.
                if (event.subtype === "api_retry") {
                    const err = event.error ?? {};
                    const wait = Math.round((event.retry_delay_ms ?? 0) / 1000);
                    const resetsAt = err.rate_limits?.resets_at;
                    const reset = Number.isFinite(resetsAt)
                        ? ` (resets ${resetClock((resetsAt ?? 0) * 1000, this.timeZone)})`
                        : "";
                    return this.wholeBlock("reasoning", `⚠ ${err.formatted ?? err.message ?? `API error ${err.status ?? ""}`.trim()} · Retrying in ${wait}s${reset} · attempt ${event.attempt ?? "?"}/${event.max_retries ?? "?"}`);
                }
                // Claude Code compacted its own context (auto or /compact). One line so the user knows
                // why the model may have lost detail; every other system subtype is handshake noise.
                if (event.subtype !== "compact_boundary")
                    return [];
                const meta = event.compact_metadata ?? {};
                const how = meta.trigger === "manual" ? "manual" : "auto";
                const size = Number.isFinite(meta.pre_tokens) ? `, ${meta.pre_tokens} tokens before` : "";
                return this.wholeBlock("reasoning", `✓ Context compacted by Claude Code (${how}${size})`);
            }
            case "stream_event":
                return this.partial(event.event ?? { type: "" });
            case "assistant":
                return this.assistant(event.message?.content ?? [], event.parent_tool_use_id);
            case "user":
                return this.toolResults(event.message?.content ?? [], event.parent_tool_use_id);
            case "result": {
                this.finished = true;
                const events = [];
                if (this.denied > 0 && !event.is_error) {
                    const n = this.denied;
                    events.push(...this.wholeBlock("text", `\n\n_Claude Code denied ${n} tool call${n === 1 ? "" : "s"} that needed approval. Switch Access mode to Full Access to allow them._`));
                }
                if (event.usage)
                    events.push(usageEvent(event.usage));
                // Per-turn accounting: forward the summary to the adapter's ring buffer.
                // SAFETY: these fields are emitted by the Claude Code CLI on the result frame; they may not be in every schema version
                const e = event;
                const totalCost = Number(e.total_cost_usd);
                const durationMs = Number(e.duration_ms);
                const apiMs = Number(e.duration_api_ms);
                if (Number.isFinite(totalCost) || Number.isFinite(durationMs)) {
                    this.onResult?.({
                        at: Date.now(),
                        costUsd: Number.isFinite(totalCost) ? totalCost : 0,
                        durationMs: Number.isFinite(durationMs) ? durationMs : 0,
                        apiMs: Number.isFinite(apiMs) ? apiMs : 0,
                        turns: Number.isFinite(Number(e.num_turns)) ? Number(e.num_turns) : 0,
                        input: event.usage?.input_tokens ?? 0,
                        output: event.usage?.output_tokens ?? 0,
                        cacheRead: event.usage?.cache_read_input_tokens ?? 0,
                        cacheWrite: event.usage?.cache_creation_input_tokens ?? 0,
                    });
                }
                events.push({
                    type: "finish",
                    reason: this.aborting
                        ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
                        : finishReason(event),
                });
                return events;
            }
            case "rate_limit_event": {
                // Emitted on every run. Status is allowed | allowed_warning | rejected (SDK types);
                // only "rejected" is a limit. allowed_warning means "near the cap", the turn goes on.
                // Treating it as an error ended turns early and dsh's retry re-sent the prompt.
                const info = event.rate_limit_info ?? {};
                const status = info.status ?? "allowed";
                if (status !== "rejected")
                    return [];
                // Extra usage on and not itself exhausted: the request went through on credits. The CLI
                // shows no limit here, so neither does the turn.
                const covered = info.isUsingOverage === true ||
                    info.overageStatus === "allowed" ||
                    info.overageStatus === "allowed_warning";
                if (covered)
                    return [];
                this.finished = true;
                // Credits exhausted too: their own reset is the one that matters.
                const resetsAt = info.overageStatus === "rejected" && Number.isFinite(info.overageResetsAt)
                    ? info.overageResetsAt
                    : info.resetsAt;
                const resetAt = Number.isFinite(resetsAt) ? (resetsAt ?? 0) * 1000 : 0;
                const resetMs = resetAt - Date.now();
                if (resetMs > 0)
                    this.limitResetAt = resetAt;
                // The CLI's own words ("You've hit your session limit · resets 7pm (…)") arrive as an
                // assistant text block just before this frame and are relayed as they are; this row only
                // adds whether the wait is on, as the CLI's "Continuing automatically when your limit
                // resets" does. No second clock.
                const tail = resetMs > 0 && this.continueAfterLimit
                    ? " · continuing automatically when it resets"
                    : "";
                const failure = {
                    message: `Usage limit reached${tail}`,
                    code: "RATE_LIMIT",
                };
                if (resetMs > 0)
                    failure.providerRetryAfterMs = resetMs;
                return [{ type: "finish", reason: { kind: "error", failure } }];
            }
            default:
                if (!BENIGN_EVENTS.has(event?.type))
                    this.noteUnknown("event", event?.type);
                return [];
        }
    }
    // SAFETY: ev is ClaudeStreamPartial from Claude Code stream-json protocol
    partial(ev) {
        switch (ev.type) {
            case "message_start":
                this.sawPartial = true;
                this.toolPending = false;
                this.open.clear();
                return [];
            case "content_block_start":
                return this.openBlock(ev.index ?? -1, ev.content_block ?? {});
            case "content_block_delta": {
                const block = this.open.get(ev.index ?? -1);
                // Hidden native-tool blocks still need their input JSON accumulated.
                const apiIndex = ev.index ?? -1;
                const cbMeta = this.cbMeta.get(apiIndex);
                if (cbMeta && ev.delta?.partial_json !== undefined) {
                    const partial = ev.delta?.partial_json ?? "";
                    // Store accumulated input on the meta so content_block_stop can emit tool/call.
                    if (!cbMeta.id)
                        return [];
                    const existing = this.callInputs.get(cbMeta.id);
                    this.callInputs.set(cbMeta.id, (existing ?? "") + partial);
                    return [];
                }
                if (!block || block.index < 0)
                    return [];
                const d = ev.delta ?? {};
                const text = d.text ?? d.thinking ?? d.partial_json ?? "";
                return this.delta(block, text);
            }
            case "content_block_stop": {
                const block = this.open.get(ev.index ?? -1);
                if (!block)
                    return [];
                const apiIndex = ev.index ?? -1;
                // For native tools, emit tool/call now that the input is complete.
                const cbMeta = this.cbMeta.get(apiIndex);
                if (cbMeta?.id && this.onToolCall) {
                    this.cbMeta.delete(apiIndex);
                    // Hidden blocks accumulate input via callInputs in the delta handler; live blocks use block.text.
                    const input = this.callInputs.get(cbMeta.id) ?? block.text;
                    if (input) {
                        // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
                        const mapped = NATIVE_TOOL_MAP[(cbMeta.name ?? "")] ??
                            cbMeta.name ??
                            "";
                        this.fireToolCall(cbMeta.id, mapped, input);
                    }
                }
                this.open.delete(apiIndex);
                // A finished tool_use block means the CLI is now running that tool: no stream events until
                // its result arrives, however long it takes. Callers read this to pause their idle timer.
                this.toolPending = block.tool === true;
                return block.index < 0 ? [] : this.endBlock(block);
            }
            default:
                if (!BENIGN_PARTIALS.has(ev?.type))
                    this.noteUnknown("stream event", ev?.type);
                return [];
        }
    }
    /** Tracks content_block metadata for native-tool blocks whose input we collect via deltas. */
    cbMeta = new Map();
    openBlock(apiIndex, cb) {
        let opened;
        if (cb.type === "text")
            opened = this.startBlock("text");
        else if (cb.type === "thinking")
            opened = this.startBlock("reasoning");
        else if (cb.type === "tool_use") {
            const toolName = cb.name ?? "";
            const dsh = toolName.startsWith("mcp__dsh__");
            if (dsh && cb.id) {
                this.dshIds.add(cb.id);
                this.dshNames.set(cb.id, toolName.slice("mcp__dsh__".length));
            }
            // Native tools get a dsh session row; hide the reasoning-lane block entirely.
            if (isNativeTool(toolName) && this.onToolCall && cb.id) {
                this.cbMeta.set(apiIndex, { id: cb.id, name: toolName });
                this.open.set(apiIndex, {
                    index: -1,
                    blockType: "hidden",
                    text: "",
                    started: false,
                    tool: true,
                });
                return [];
            }
            if (!this.toolActivity || (dsh && this.relay)) {
                this.open.set(apiIndex, {
                    index: -1,
                    blockType: "hidden",
                    text: "",
                    started: false,
                    tool: true,
                });
                return [];
            }
            opened = this.startBlock(...this.toolLead(cb));
            opened.block.tool = true;
        }
        else {
            this.noteUnknown("content block", cb.type);
            return [];
        }
        this.open.set(apiIndex, opened.block);
        return opened.events;
    }
    assistant(content, parentToolUseId) {
        // Claude Code subagent output (--forward-subagent-text) arrives as whole messages tagged with the
        // parent tool id; it never comes as partials, so it is always rendered, folded into reasoning.
        if (parentToolUseId) {
            if (!this.toolActivity)
                return [];
            const text = content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n");
            return text ? this.wholeBlock("reasoning", `↳ subagent\n${clip(text, this.limit)}`) : [];
        }
        if (this.sawPartial)
            return []; // already streamed as deltas
        const events = [];
        for (const b of content) {
            if (b.type === "text" && b.text)
                events.push(...this.wholeBlock("text", b.text));
            else if (b.type === "thinking" && b.thinking)
                events.push(...this.wholeBlock("reasoning", b.thinking));
            else if (b.type === "tool_use") {
                const toolName = b.name ?? "";
                const dsh = toolName.startsWith("mcp__dsh__");
                if (dsh) {
                    this.dshIds.add(b.id);
                    this.dshNames.set(b.id, toolName.slice("mcp__dsh__".length));
                }
                // Native tools render as session rows; skip the reasoning-lane block.
                if (isNativeTool(toolName) && this.onToolCall && b.id) {
                    const args = JSON.stringify(b.input ?? {});
                    // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
                    const mapped = NATIVE_TOOL_MAP[toolName] ?? toolName;
                    this.fireToolCall(b.id, mapped, args);
                    continue;
                }
                if (!this.toolActivity || (dsh && this.relay))
                    continue;
                const [kind, lead] = this.toolLead(b);
                events.push(...this.wholeBlock(kind, lead + clip(JSON.stringify(b.input ?? {}), this.limit)));
            }
        }
        return events;
    }
    /** dsh tools reached over the MCP bridge (subagents, jobs...) render as visible text rows, the
     *  rest as collapsed reasoning. Returns [block kind, lead text]. */
    toolLead(cb) {
        const toolName = cb.name ?? "";
        if (toolName.startsWith("mcp__dsh__")) {
            if (cb.id)
                this.dshIds.add(cb.id);
            return ["text", `⤷ ${toolName.slice("mcp__dsh__".length)} `];
        }
        return ["reasoning", `▶ ${cb.name} `];
    }
    toolResults(content, parentToolUseId) {
        this.toolPending = false;
        if (!this.toolActivity)
            return [];
        const events = [];
        for (const b of content) {
            if (b.type !== "tool_result")
                continue;
            const rawText = toolResultText(b).trim();
            const raw = this.redact ? this.redact(rawText) : rawText;
            if (b.is_error && DENIED_RE.test(raw))
                this.denied++;
            const body = clip(raw || "(empty)", this.limit);
            const tag = parentToolUseId ? "↳ " : "";
            const toolUseId = b.tool_use_id ?? "";
            const dsh = this.dshIds.delete(toolUseId);
            if (dsh && this.relayed.delete(toolUseId))
                continue; // dsh drew the native call and result
            // Native tool result: append a dsh session row, skip reasoning text.
            if (this.onToolResult && !this.callInputs.has(toolUseId)) {
                // Not a native tool we tracked — fall through to old behaviour.
            }
            else if (this.onToolResult && this.callInputs.has(toolUseId)) {
                const argsJson = this.callInputs.get(toolUseId);
                // Result closes the call: both maps only need the entry until here (fire dedupe, Edit diff).
                this.callInputs.delete(toolUseId);
                this.firedCalls.delete(toolUseId);
                let meta;
                try {
                    // SAFETY: JSON.parse output cast to EditCallInput; fields validated below with truthiness checks
                    const inp = JSON.parse(argsJson);
                    if (inp.file_path && inp.old_string && inp.new_string) {
                        meta = {
                            diffs: [{ path: inp.file_path, oldText: inp.old_string, newText: inp.new_string }],
                        };
                    }
                }
                catch {
                    // ignore malformed input JSON
                }
                try {
                    this.onToolResult(toolUseId, raw, b.is_error ?? false, meta);
                }
                catch (err) {
                    this.log("warn", `native tool result append failed: ${err}`);
                    // fall through to render reasoning text as before
                }
                continue;
            }
            const toolName = this.dshNames.get(toolUseId);
            this.dshNames.delete(toolUseId);
            // A dsh call that could not be relayed ran inside the bridge: show it as one compact row.
            const lead = dsh && this.relay ? `⤷ ${toolName ?? "dsh tool"} (ran in bridge)\n` : "";
            events.push(...this.wholeBlock(dsh ? "text" : "reasoning", `${lead}${tag}${dsh ? "⤶" : "◀"} ${b.is_error ? "error" : "result"}\n${body}`));
        }
        return events;
    }
}
//# sourceMappingURL=translator.js.map