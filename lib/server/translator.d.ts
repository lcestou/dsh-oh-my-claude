import type { StreamChunk, LlmFailure } from "@deepseek-ai/dsh-llm";
import { type ClaudeEvent, type ClaudeStreamPartial, type ClaudeContentBlock } from "./process.js";
import { TurnRecord } from "./adapter.js";
import { type PluginLoadError } from "./plugins.js";
export declare function capLines(body: string, max?: number): string;
/**
 * The word joiner that follows the glyph on every tool header we write.
 *
 * The glyph alone is not proof of a header: a person who pastes a line starting with `◆` or `❯`,
 * or asks about one of these characters, used to have it eaten by the icon swap and any code block
 * under it folded away. This character is invisible, survives the markdown round trip, and is not
 * something prose carries, so the client can require it before claiming a paragraph. Kept in sync
 * with `FOLD_MARK` in the client.
 */
export declare const HEADER_MARK = "\u2060";
/** A native tool call as markdown: an icon-led plain header, arguments in the fence that suits the tool. */
export declare function formatToolCall(name: string, inputJson: string): string;
/** A native tool result as markdown: icon-led header + status, body fenced with a language when we can guess one. */
export declare function formatToolResult(name: string, filePath: string, body: string, isError: boolean): string;
/** One open lane of a turn: which kind it is, what has been written into it, and when it started. */
export interface TranslatorBlock {
    index: number;
    blockType: string;
    text: string;
    started: boolean;
    tool?: boolean;
}
/** `45s`, `4m30s`, `1h2m`: how long a call has been running, in the shortest form that stays exact. */
export declare function elapsedText(seconds: number): string;
/** `1k`, `4.6k`, `23k`: an estimate, so one decimal below 10k and none above it. */
export declare function tokensText(tokens: number): string;
/** A reset instant as the CLI's error reference prints it: `3:45pm` later today, `Mon 12am`
 *  within the week, `Sep 8, 1pm` beyond it, then the zone. Minutes only when they are not zero.
 *  No year: a plan window reopens within a week, so the nearest future date is the only reading. */
export declare function resetClock(ms: number, zone?: string): string;
/** Turns the CLI's stream-json events into the markdown and tool rows one dsh turn shows. */
/** What the live translator tells the adapter about the running turn, for the status row. */
export interface TurnProgress {
    /** The estimate for the thinking block in progress, cumulative for that block. */
    thinking?: number;
    /** A thinking block opened (true) or closed (false). */
    thinkingOpen?: boolean;
    /** Output tokens summed across the turn so far. */
    output?: number;
    /** A tool call is in flight (true) or its result landed (false). */
    tool?: boolean;
    /** A frame of model output arrived; moves the stall clock. */
    frame?: boolean;
    /** A dsh tool call went out to dsh, by name. */
    relay?: {
        name: string;
    };
}
/** A model switch the CLI reported mid-turn, surfaced to the notice and the picker. `direction` and
 *  `scope` come from `model_refusal_fallback`; `model_fallback` and `model_consent_fallback` leave
 *  them undefined. The client moves the picker only for a `model_refusal_fallback` that is `sticky`
 *  and session-scoped. `sessionId` and `at` are filled by the adapter, not the translator. */
export interface FallbackRecord {
    sessionId: string;
    kind: "model_refusal_fallback" | "model_refusal_no_fallback" | "model_fallback" | "model_consent_fallback";
    from: string;
    to: string;
    direction?: "retry" | "revert" | "sticky";
    scope?: "session" | "local";
    category?: string;
    at: number;
    content?: string;
}
export declare class Translator {
    log: (level: string, msg: string) => void;
    unknownSeen: Set<string>;
    toolActivity: boolean;
    /** Word the limit failure as "continuing automatically at …": the adapter arms the wait. */
    continueAfterLimit: boolean;
    /** Set when a usage limit ended the turn with a reset time in the future (ms since epoch). */
    limitResetAt: number | undefined;
    /** A limit's failure, held back until the CLI's own message and result frame have gone by. */
    limitFailure: (LlmFailure & {
        providerRetryAfterMs?: number;
    }) | undefined;
    /** IANA zone for reset clocks: the browser's when dsh stamped one, else the box's. */
    timeZone: string | undefined;
    hostLabel: string | undefined;
    /** The suffix for a 5xx retry line, from the adapter's cache of Anthropic's status page. */
    statusNote: ((httpStatus: number) => string) | undefined;
    relay: boolean;
    dshIds: Set<string>;
    dshNames: Map<string, string>;
    relayed: Set<string>;
    limit: number;
    index: number;
    open: Map<number, TranslatorBlock>;
    sawPartial: boolean;
    /** `message.id` of the message currently streaming, so only its own echo is dropped. */
    streamedId: string | undefined;
    finished: boolean;
    denied: number;
    autoDenied: string[];
    toolPending: boolean;
    /** A compaction announced and not yet closed, so its 30-second heartbeat prints one line, not six.
     *  A Translator lives for one stream() call; a compaction killed mid-flight leaves this set for the
     *  rest of that turn, which costs at most one missing announcement. */
    compacting: boolean;
    aborting: boolean;
    /** task_id → { block, lastSummary, lastToolName } tracks open task blocks across progress frames. */
    readonly taskBlocks: Map<string, {
        block: TranslatorBlock;
        lastSummary?: string;
        lastToolName?: string;
        lastStatus?: string;
    }>;
    /** tool_use_id → { block, nextAt } tracks the block a long-running call reports its elapsed
     *  time into, and the next elapsed mark worth a line. */
    readonly heartbeatBlocks: Map<string, {
        block: TranslatorBlock;
        nextAt: number;
    }>;
    /** The counter a silent thinking stretch draws into, and the thinking block it stands in for. */
    thinking?: {
        block: TranslatorBlock;
        nextAt: number;
    };
    thinkingBlock?: TranslatorBlock;
    /** Injected: append tool/call to the dsh session for a native Claude Code tool. */
    onToolCall?: (callId: string, name: string, args: string) => number | undefined;
    /** Injected: append tool/result to the dsh session for a native Claude Code tool. */
    onToolResult?: (callId: string, text: string, isError: boolean, meta?: object) => void;
    /** Injected: fire per-turn accounting summary from the result frame. */
    onResult?: (summary: TurnRecord) => void;
    /** Injected: mask secret values in tool results before they are shown or appended. */
    redact?: (s: string) => string;
    /** Injected: the CLI's slash-command catalog and tool names from its init frame. */
    onInit?: (commands: string[], tools: string[], pluginErrors?: PluginLoadError[]) => void;
    /** Running figures for the turn's status row: the thinking estimate as it climbs, and output tokens
     *  once a usage frame names them. Fired on the frames that carry them, nothing is polled. */
    onProgress?: (progress: TurnProgress) => void;
    /** Injected: fired when the CLI switched or refused the turn's model, from any fallback frame. The
     *  adapter banks it; the client fires a notice and moves the picker (only a sticky, session-scoped
     *  model_refusal_fallback). `sessionId` and `at` are added by the adapter. */
    onModel?: (rec: Omit<FallbackRecord, "sessionId" | "at">) => void;
    /** Output tokens across every assistant message of this turn so far. A `message_delta` reports
     *  the message it closes, not the turn, so the figure summed here is what the status row shows;
     *  reporting each message's own count made the row drop back to a few hundred at every tool step. */
    private turnOutput;
    /** This step's own token usage, summed over the assistant messages it covered.
     *
     *  A step is one `stream()` call, and it ends when tool calls are relayed to dsh — so a step runs
     *  one API call per assistant message and several when the CLI works through its own Read, Bash
     *  and Edit without ever handing dsh a call. `message_delta` reports each of those messages
     *  exactly once and carries all four counters settled, so summing them is what this step really
     *  spent. Emitted by `takeStepUsage` at the step's end, because dsh fails a stream that reports
     *  usage more than once ("LLM stream emitted usage more than once"). */
    private stepUsage;
    /** Whether any `message_delta` was counted, which is what makes `stepUsage` the better source. */
    private sawUsageDelta;
    /** The result frame's `usage`: the whole turn's, kept only for a CLI too old to stream partials. */
    private resultUsage;
    /** callId → original input JSON string, kept so Edit can build meta.diffs from it. */
    readonly callInputs: Map<string, string>;
    /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
    readonly firedCalls: Map<string, number>;
    /** callId → mapped tool name, so an inline result row knows which tool (and file) it belongs to. */
    readonly callNames: Map<string, string>;
    /**
     * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
     * reach the same tool_use block; a second append gives the client two `tool/call` starts for
     * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
     */
    private fireToolCall;
    constructor({ toolActivity, continueAfterLimit, timeZone, toolTextLimit, relay, dshIds, relayed, log, onToolCall, onToolResult, onResult, redact, onInit, onProgress, onModel, hostLabel, statusNote, }?: {
        toolActivity?: boolean;
        continueAfterLimit?: boolean;
        timeZone?: string;
        toolTextLimit?: number;
        relay?: boolean;
        dshIds?: Set<string>;
        relayed?: Set<string>;
        log?: (level: string, msg: string) => void;
        onToolCall?: (callId: string, name: string, args: string) => number | undefined;
        onToolResult?: (callId: string, text: string, isError: boolean, meta?: object) => void;
        onResult?: (summary: TurnRecord) => void;
        redact?: (s: string) => string;
        onInit?: (commands: string[], tools: string[], pluginErrors?: PluginLoadError[]) => void;
        onProgress?: (progress: TurnProgress) => void;
        onModel?: (rec: Omit<FallbackRecord, "sessionId" | "at">) => void;
        /** The box a remote turn runs on, so a logged-out error names it, not this local host. */
        hostLabel?: string;
        /** What to append to a 5xx retry line from the Anthropic status page cache. */
        statusNote?: (httpStatus: number) => string;
    });
    deltaType(block: TranslatorBlock): "text-delta" | "reasoning-delta";
    /** Warn once when a CLI event/block type is neither handled nor knowingly ignored, so a Claude
     *  Code stream-json schema change shows up loud in the log instead of as silently dropped output. */
    noteUnknown(where: string, type: string | null | undefined): void;
    /** A block is announced on its first text. Claude emits thinking blocks that carry only a
     *  signature and never any text; announcing those eagerly draws an empty bubble. */
    startBlock(blockType: string, prefix?: string): {
        block: TranslatorBlock;
        events: StreamChunk[];
    };
    /** Text for a block, with its block-start ahead of the first non-empty piece. Empty in, empty out. */
    delta(block: TranslatorBlock, text: string): StreamChunk[];
    /** Close a block; one that never got text was never announced and closes silently. */
    endBlock(block: TranslatorBlock): StreamChunk[];
    wholeBlock(blockType: string, text: string): StreamChunk[];
    translate(event: ClaudeEvent): StreamChunk[];
    /** One summed usage chunk for the step that is ending, or nothing when none can be proven.
     *
     *  Called once per `stream()` call, right before its `finish`. The result frame is only a
     *  fallback: it carries the whole turn's usage, so on a turn of several steps charging it to
     *  whichever step happened to see it is what left every other step with no sample at all — and
     *  `deriveTurnTokenUsage` drops the turn's pill unless every step has one. */
    takeStepUsage(): StreamChunk[];
    partial(ev: ClaudeStreamPartial, subagent?: boolean): StreamChunk[];
    /** Tracks content_block metadata for native-tool blocks whose input we collect via deltas. */
    readonly cbMeta: Map<number, {
        id?: string;
        name?: string;
    }>;
    openBlock(apiIndex: number, cb: {
        type?: string;
        id?: string;
        name?: string;
    }): StreamChunk[];
    assistant(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined, id?: string): StreamChunk[];
    /** dsh tools reached over the MCP bridge (subagents, jobs...) render as visible text rows, the
     *  rest as collapsed reasoning. Returns [block kind, lead text]. */
    toolLead(cb: {
        id?: string;
        name?: string;
    }): [string, string];
    /** The CLI's per-call progress frame. Two variants reach a headless run: a 30-second heartbeat
     *  carrying the live elapsed time, and a subagent retrying an API failure. A call that finishes
     *  inside 30 seconds never sends one, so a block here means "this one is genuinely slow" —
     *  without it a ten-minute Bash call is indistinguishable from a hung process. */
    toolProgress(event: Extract<ClaudeEvent, {
        type: "tool_progress";
    }>): StreamChunk[];
    /** A running estimate for the thinking block the model is in the middle of. Only the silent kind
     *  draws: when the thinking text streams, the reasoning block itself is the progress, and a
     *  counter beside it would say the same thing twice. Fable-class models return thinking blocks
     *  that carry a signature and no text, and this is the only sign they are working. */
    thinkingTokens(total: number): StreamChunk[];
    /** A tool call in flight, or not: the status row reads it to hold its thinking and stall ramps
     *  the way the CLI's line does while a tool runs. Reported only on change. */
    private setToolPending;
    /** The thinking block is over, or the turn is: tell the status row, once per open block. */
    private closeThinking;
    /** Close the counter: the thinking block it stood in for is over, or the turn is. */
    endThinking(): StreamChunk[];
    /** Close the elapsed-time block a slow call opened, whichever way its result is drawn. */
    endHeartbeat(toolUseId: string): StreamChunk[];
    toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
}
