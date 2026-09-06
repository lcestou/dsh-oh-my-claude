import type { StreamChunk } from "@deepseek-ai/dsh-llm";
import { type ClaudeEvent, type ClaudeStreamPartial, type ClaudeContentBlock } from "./process.js";
import { TurnRecord } from "./adapter.js";
export interface TranslatorBlock {
    index: number;
    blockType: string;
    text: string;
    started: boolean;
    tool?: boolean;
}
/** A reset instant as the CLI's banner shows it: `7pm` or `7:30pm`, then the box's zone. */
export declare function resetClock(ms: number, zone?: string): string;
export declare class Translator {
    log: (level: string, msg: string) => void;
    unknownSeen: Set<string>;
    toolActivity: boolean;
    /** Word the limit failure as "continuing automatically at …": the adapter arms the wait. */
    continueAfterLimit: boolean;
    /** Set when a usage limit ended the turn with a reset time in the future (ms since epoch). */
    limitResetAt: number | undefined;
    /** IANA zone for reset clocks: the browser's when dsh stamped one, else the box's. */
    timeZone: string | undefined;
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
    /** Injected: append tool/call to the dsh session for a native Claude Code tool. */
    onToolCall?: (callId: string, name: string, args: string) => number | undefined;
    /** Injected: append tool/result to the dsh session for a native Claude Code tool. */
    onToolResult?: (callId: string, text: string, isError: boolean, meta?: object) => void;
    /** Injected: fire per-turn accounting summary from the result frame. */
    onResult?: (summary: TurnRecord) => void;
    /** Injected: mask secret values in tool results before they are shown or appended. */
    redact?: (s: string) => string;
    /** Injected: the CLI's slash-command catalog from its init frame. */
    onInit?: (commands: string[]) => void;
    /** callId → original input JSON string, kept so Edit can build meta.diffs from it. */
    readonly callInputs: Map<string, string>;
    /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
    readonly firedCalls: Map<string, number>;
    /**
     * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
     * reach the same tool_use block; a second append gives the client two `tool/call` starts for
     * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
     */
    private fireToolCall;
    constructor({ toolActivity, continueAfterLimit, timeZone, toolTextLimit, relay, dshIds, relayed, log, onToolCall, onToolResult, onResult, redact, onInit, }?: {
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
        onInit?: (commands: string[]) => void;
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
    toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined): StreamChunk[];
}
