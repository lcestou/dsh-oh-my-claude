import type { StreamChunk, LlmFailure } from "@deepseek-ai/dsh-llm";
import { type ClaudeEvent, type ClaudeStreamPartial, type ClaudeContentBlock } from "./process.js";
import { TurnRecord } from "./adapter.js";
export declare function capLines(body: string, max?: number): string;
/** A native tool call as markdown: name in bold, arguments in the fence that suits the tool. */
export declare function formatToolCall(name: string, inputJson: string): string;
/** A native tool result as markdown: name + status, body fenced with a language when we can guess one. */
export declare function formatToolResult(name: string, filePath: string, body: string, isError: boolean): string;
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
    relay: boolean;
    dshIds: Set<string>;
    dshNames: Map<string, string>;
    relayed: Set<string>;
    limit: number;
    index: number;
    open: Map<number, TranslatorBlock>;
    sawPartial: boolean;
    finished: boolean;
    denied: number;
    toolPending: boolean;
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
    onInit?: (commands: string[], tools: string[]) => void;
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
    constructor({ toolActivity, continueAfterLimit, timeZone, toolTextLimit, relay, dshIds, relayed, log, onToolCall, onToolResult, onResult, redact, onInit, hostLabel, }?: {
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
        onInit?: (commands: string[], tools: string[]) => void;
        /** The box a remote turn runs on, so a logged-out error names it, not this local host. */
        hostLabel?: string;
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
    partial(ev: ClaudeStreamPartial): StreamChunk[];
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
    assistant(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
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
    /** Close the counter: the thinking block it stood in for is over, or the turn is. */
    endThinking(): StreamChunk[];
    /** Close the elapsed-time block a slow call opened, whichever way its result is drawn. */
    endHeartbeat(toolUseId: string): StreamChunk[];
    toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
}
