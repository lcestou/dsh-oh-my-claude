import type { StreamChunk, ContentBlockType, LlmFailure, TokenUsage } from "@deepseek-ai/dsh-llm";
import {
  type ClaudeEvent,
  type ClaudeStreamPartial,
  type ClaudeContentBlock,
  toolResultText,
} from "./process.js";
import { NATIVE_TOOL_MAP, TurnRecord, commandNames, finishReason } from "./adapter.js";
import { suggestRule } from "./permissions.js";
import type { JsonValue } from "./dsh.js";

// ---------------------------------------------------------------------------
// stream-json → dsh chunks (moved from src/adapter.ts)

const TOOL_TEXT_LIMIT = 600;
const clip = (s: string, n = TOOL_TEXT_LIMIT): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const DENIED_RE = /requires? approval|permission (was )?denied|not allowed/i;
/** Every Claude Code tool except the dsh MCP relay gets a session row: mapped names pick the
 *  client's bash/read/edit presenters, the rest (TodoWrite, ToolSearch, Skill, mcp__*) the generic one. */
const isNativeTool = (toolName: string) => toolName !== "" && !toolName.startsWith("mcp__dsh__");

// --- inline tool rendering: format a native call/result as text-lane markdown so dsh's
// MarkdownText highlights it, instead of the grey unformatted reasoning lane. -----------

/** File extension → markdown fence language, so a Read result highlights by file type. */
const EXT_LANG = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  json: "json",
  md: "md",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  java: "java",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
} satisfies Record<string, string>;

const langOf = (path: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = m?.[1]?.toLowerCase() ?? "";
  // SAFETY: `ext in EXT_LANG` proves ext is a key, so the keyof assertion holds
  return ext in EXT_LANG ? (EXT_LANG[ext as keyof typeof EXT_LANG] ?? "") : "";
};

/** Wrap body in a fence long enough to survive any backtick run inside it. */
const fence = (body: string, lang = ""): string => {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${body}\n${ticks}`;
};

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The background shell a BashOutput or KillShell call names, under either of the CLI's two keys. */
const shellId = (inp: Record<string, unknown>): string => asStr(inp.bash_id ?? inp.shell_id);

/** Clamp a fenced body to its first `max` lines, with a count of what was elided. A tool-heavy turn
 *  floods the transcript with full read/bash/diff dumps; the head plus a tail count keeps each row
 *  scannable without hiding that more exists. */
const MAX_BODY_LINES = 18;
export function capLines(body: string, max = MAX_BODY_LINES): string {
  const lines = body.split("\n");
  if (lines.length <= max) return body;
  return `${lines.slice(0, max).join("\n")}\n… ${lines.length - max} more lines`;
}

/** The icon glyph that leads each tool header. The client's fold keys on this leading glyph to spot a
 *  tool header (see TOOL_ICONS in the client), so the set here and there must stay in sync. */
const TOOL_ICON = new Map<string, string>([
  ["bash", "❯"],
  ["bash_output", "❯"],
  ["kill_shell", "❯"],
  ["read", "▤"],
  ["write", "✎"],
  ["edit", "✎"],
  ["notebook_edit", "✎"],
  ["grep", "⌕"],
  ["glob", "✳"],
  ["web_fetch", "⤓"],
  ["web_search", "⌕"],
  ["todo_write", "☑"],
  ["task", "⚙"],
  ["exit_plan_mode", "☰"],
  ["enter_plan_mode", "☰"],
  ["slash_command", "⌘"],
]);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The word joiner that follows the glyph on every tool header we write.
 *
 * The glyph alone is not proof of a header: a person who pastes a line starting with `◆` or `❯`,
 * or asks about one of these characters, used to have it eaten by the icon swap and any code block
 * under it folded away. This character is invisible, survives the markdown round trip, and is not
 * something prose carries, so the client can require it before claiming a paragraph. Kept in sync
 * with `FOLD_MARK` in the client.
 */
export const HEADER_MARK = "\u2060";

/** `todo_write` → "Todo write": the underscore names read as sentences, not as identifiers. */
const words = (name: string): string => cap(name.replaceAll("_", " "));

/** An MCP tool's own name: `mcp__dsh__subagent` is dsh's `subagent`, not a tool called `Mcp`. */
const mcpName = (name: string): string | undefined => {
  const parts = name.split("__");
  return parts.length >= 3 && parts[0] === "mcp"
    ? `${parts[1]} · ${parts.slice(2).join(" ")}`
    : undefined;
};

/** Icon + a capitalized, human name for a tool header: `❯ Bash`, `▤ Read`, `⤓ Web fetch`. */
const label = (name: string): string => {
  const human = mcpName(name) ?? (name.startsWith("web_") ? `Web ${name.slice(4)}` : words(name));
  return `${TOOL_ICON.get(name) ?? "◆"}${HEADER_MARK} ${human}`;
};

/** Every line of `text` under one diff marker, so an empty side still renders as a marker line. */
const prefixed = (text: string, mark: "-" | "+"): string =>
  text
    .split("\n")
    .map((l) => `${mark} ${l}`)
    .join("\n");

/** A native tool call as markdown: an icon-led plain header, arguments in the fence that suits the tool. */
export function formatToolCall(name: string, inputJson: string): string {
  let inp: Record<string, unknown> = {};
  try {
    // SAFETY: inputJson is Claude's own tool_use input, stored verbatim; shape read defensively below
    inp = JSON.parse(inputJson) as Record<string, unknown>;
  } catch {
    inp = {};
  }
  const file = asStr(inp.file_path);
  switch (name) {
    case "bash": {
      const desc = asStr(inp.description);
      return `${label("bash")}${desc ? ` · ${desc}` : ""}\n${fence(capLines(asStr(inp.command)), "bash")}`;
    }
    case "read":
      return `${label("read")} \`${file}\``;
    case "write":
      return `${label("write")} \`${file}\`\n${fence(capLines(asStr(inp.content)), langOf(file))}`;
    case "edit": {
      // Edit carries one `old_string`/`new_string` pair at the top level; MultiEdit maps to this
      // same presenter but carries `edits[]` instead, and reading the top level for it produced a
      // fence holding one bare `-` and one bare `+`.
      // SAFETY: `edits` is Claude's own MultiEdit input; the array check is above and each entry's
      // fields are read through `asStr`, which answers "" for anything that is not a string.
      const edits = Array.isArray(inp.edits)
        ? (inp.edits as Record<string, unknown>[])
        : [{ old_string: inp.old_string, new_string: inp.new_string }];
      const diff = edits
        .map((e) => `${prefixed(asStr(e.old_string), "-")}\n${prefixed(asStr(e.new_string), "+")}`)
        .join("\n");
      return `${label("edit")} \`${file}\`\n${fence(capLines(diff), "diff")}`;
    }
    case "grep":
      return `${label("grep")} \`${asStr(inp.pattern)}\`${inp.path ? ` in \`${asStr(inp.path)}\`` : ""}`;
    case "glob":
      return `${label("glob")} \`${asStr(inp.pattern)}\``;
    case "web_fetch":
      return `${label("web_fetch")} ${asStr(inp.url)}`;
    case "web_search":
      return `${label("web_search")} \`${asStr(inp.query)}\``;
    case "todo_write": {
      // The list itself is the point: a JSON dump of it said nothing at a glance.
      const todos = Array.isArray(inp.todos) ? inp.todos : [];
      const rows = todos
        .map((t) => {
          const item = isRec(t) ? t : {};
          const status = asStr(item.status);
          const box = status === "completed" ? "x" : status === "in_progress" ? "~" : " ";
          return `- [${box}] ${asStr(item.content)}`;
        })
        .join("\n");
      return `${label("todo_write")} ${todos.length} item${todos.length === 1 ? "" : "s"}\n${fence(capLines(rows), "markdown")}`;
    }
    case "task": {
      // Which subagent, and what it was told — the prompt is the whole brief, so it rides the cap.
      const kind = asStr(inp.subagent_type);
      const desc = asStr(inp.description);
      const head = `${label("task")}${kind ? ` \`${kind}\`` : ""}${desc ? ` · ${desc}` : ""}`;
      const prompt = asStr(inp.prompt);
      return prompt ? `${head}\n${fence(capLines(prompt), "markdown")}` : head;
    }
    case "exit_plan_mode":
    case "enter_plan_mode": {
      const plan = asStr(inp.plan);
      return plan ? `${label(name)}\n${fence(capLines(plan), "markdown")}` : label(name);
    }
    case "slash_command":
      return `${label("slash_command")} \`${asStr(inp.command)}\``;
    case "bash_output": {
      // The CLI names the same handle two ways: BashOutput takes `bash_id`, KillShell `shell_id`.
      // Both are read either way here so a rename on one side does not blank the header.
      const filter = asStr(inp.filter);
      return `${label("bash_output")} \`${shellId(inp)}\`${filter ? ` matching \`${filter}\`` : ""}`;
    }
    case "kill_shell":
      return `${label("kill_shell")} \`${shellId(inp)}\``;
    case "notebook_edit": {
      const cell = asStr(inp.cell_id);
      const head = `${label("notebook_edit")} \`${asStr(inp.notebook_path)}\`${cell ? ` cell \`${cell}\`` : ""}`;
      const src = asStr(inp.new_source);
      return src ? `${head}\n${fence(capLines(src), "python")}` : head;
    }
    default: {
      // `capLines` caps at 18 lines and `JSON.stringify` writes one, so an unknown tool's header
      // used to print its whole input on a single line — a `Task` call's entire subagent prompt,
      // `ExitPlanMode`'s entire plan. Pretty-printing gives the line cap something to cut.
      const pretty =
        Object.keys(inp).length > 0
          ? JSON.stringify(inp, (_k, v: unknown) => (typeof v === "string" ? clip(v, 300) : v), 2)
          : inputJson;
      return `${label(name)}\n${fence(capLines(pretty), "json")}`;
    }
  }
}

/** A native tool result as markdown: icon-led header + status, body fenced with a language when we can guess one. */
export function formatToolResult(
  name: string,
  filePath: string,
  body: string,
  isError: boolean,
): string {
  // Same shape as the call header (`❯ Bash · List files`): the dot, then a capitalized word.
  const head = `${label(name)} · ${isError ? "Error" : "Result"}`;
  if (isError) return `${head}\n${fence(capLines(body))}`;
  const lang = name === "read" ? langOf(filePath) : "";
  return `${head}\n${fence(capLines(body), lang)}`;
}

function usageEvent(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): StreamChunk {
  // dsh TokenUsage: inputTokens excludes cache hits; the three prompt counters plus output sum to totalTokens.
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const usage: TokenUsage = {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + cacheRead + cacheWrite + output,
  };
  if (cacheRead) usage.cacheReadTokens = cacheRead;
  if (cacheWrite) usage.cacheWriteTokens = cacheWrite;
  return { type: "usage", usage };
}

/** One open lane of a turn: which kind it is, what has been written into it, and when it started. */
export interface TranslatorBlock {
  index: number;
  blockType: string;
  text: string;
  started: boolean;
  tool?: boolean;
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
  "keep_alive",
]);
// stream_event sub-types with no renderable delta (SSE bookkeeping).
const BENIGN_PARTIALS = new Set(["message_delta", "message_stop", "ping"]);

/** Task statuses that end a task: after one of these no further frame arrives for that task_id. */
const TASK_TERMINAL = new Set(["completed", "failed", "killed"]);

/** The elapsed marks a long tool call reports at, in seconds; past the last one it repeats every
 *  five minutes. A 30-second call is already the first heartbeat the CLI sends, so a call that
 *  finishes quickly never draws a line at all. */
const HEARTBEAT_STEPS = [30, 60, 120, 300, 600];
const HEARTBEAT_REPEAT = 300;
const nextHeartbeat = (elapsed: number): number =>
  HEARTBEAT_STEPS.find((s) => s > elapsed) ??
  (Math.floor(elapsed / HEARTBEAT_REPEAT) + 1) * HEARTBEAT_REPEAT;

/** `45s`, `4m30s`, `1h2m`: how long a call has been running, in the shortest form that stays exact. */
export function elapsedText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h${m % 60}m` : `${h}h`;
}

/** The token marks a silent thinking stretch reports at; past the last one it repeats every 20k.
 *  The counter stays quiet below the floor: short thinking is over before it would help. */
const THINK_FLOOR = 1000;
const THINK_STEPS = [THINK_FLOOR, 2000, 5000, 10_000, 20_000];
const THINK_REPEAT = 20_000;
const nextThinkStep = (tokens: number): number =>
  THINK_STEPS.find((s) => s > tokens) ?? (Math.floor(tokens / THINK_REPEAT) + 1) * THINK_REPEAT;

/** `1k`, `4.6k`, `23k`: an estimate, so one decimal below 10k and none above it. */
export function tokensText(tokens: number): string {
  const k = Math.max(0, tokens) / 1000;
  return `${k < 10 ? Math.round(k * 10) / 10 : Math.round(k)}k`;
}

/** A reset instant as the CLI's error reference prints it: `3:45pm` later today, `Mon 12am`
 *  within the week, `Sep 8, 1pm` beyond it, then the zone. Minutes only when they are not zero.
 *  No year: a plan window reopens within a week, so the nearest future date is the only reading. */
export function resetClock(
  ms: number,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const away = ms - Date.now();
  const clock: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", timeZone: zone };
  const opts: Intl.DateTimeFormatOptions =
    away <= 24 * 60 * 60 * 1000
      ? clock
      : away <= 7 * 24 * 60 * 60 * 1000
        ? { weekday: "short", ...clock }
        : { month: "short", day: "numeric", ...clock };
  const text = new Date(ms)
    .toLocaleString("en-US", opts)
    .replace(":00", "")
    .replace(/\s([AP]M)/i, (_, half: string) => half.toLowerCase());
  return `${text} (${zone})`;
}

/** What the CLI calls each limit in its own banner (its `rateLimitType` table). */
const LIMIT_NAMES = new Map([
  ["five_hour", "session limit"],
  ["seven_day", "weekly limit"],
  ["seven_day_opus", "Opus limit"],
  ["seven_day_sonnet", "Sonnet limit"],
  ["seven_day_overage_included", "Fable limit"],
  ["overage", "usage credit limit"],
]);

/** Turns the CLI's stream-json events into the markdown and tool rows one dsh turn shows. */
export class Translator {
  log: (level: string, msg: string) => void;
  unknownSeen: Set<string>; // (where:type) already warned, so schema drift warns once, not per event
  toolActivity: boolean;
  /** Word the limit failure as "continuing automatically at …": the adapter arms the wait. */
  continueAfterLimit: boolean;
  /** Set when a usage limit ended the turn with a reset time in the future (ms since epoch). */
  limitResetAt: number | undefined;
  /** A limit's failure, held back until the CLI's own message and result frame have gone by. */
  limitFailure: (LlmFailure & { providerRetryAfterMs?: number }) | undefined;
  /** IANA zone for reset clocks: the browser's when dsh stamped one, else the box's. */
  timeZone: string | undefined;
  hostLabel: string | undefined;
  relay: boolean; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
  dshIds: Set<string>; // tool_use ids of dsh tools called over the MCP bridge
  dshNames: Map<string, string>; // dsh tool_use id → tool name, for a fallback row
  relayed: Set<string>; // dsh tool_use ids dsh ran natively; results not drawn here
  limit: number;
  index: number;
  open: Map<number, TranslatorBlock>; // api block index → { index, blockType, text }
  sawPartial: boolean;
  /** `message.id` of the message currently streaming, so only its own echo is dropped. */
  streamedId: string | undefined;
  finished: boolean;
  denied: number; // tool calls Claude Code refused because a non-interactive run cannot ask
  toolPending: boolean; // a tool_use block closed and its result has not arrived yet
  aborting: boolean; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
  /** task_id → { block, lastSummary, lastToolName } tracks open task blocks across progress frames. */
  readonly taskBlocks = new Map<
    string,
    { block: TranslatorBlock; lastSummary?: string; lastToolName?: string; lastStatus?: string }
  >();
  /** tool_use_id → { block, nextAt } tracks the block a long-running call reports its elapsed
   *  time into, and the next elapsed mark worth a line. */
  readonly heartbeatBlocks = new Map<string, { block: TranslatorBlock; nextAt: number }>();

  /** The counter a silent thinking stretch draws into, and the thinking block it stands in for. */
  thinking?: { block: TranslatorBlock; nextAt: number };
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
  /** Running figures for the turn's status row: the thinking estimate as it climbs, and output tokens
   *  once a usage frame names them. Fired on the frames that carry them, nothing is polled. */
  onProgress?: (progress: { thinking?: number; output?: number }) => void;
  /** Output tokens across every assistant message of this turn so far. A `message_delta` reports
   *  the message it closes, not the turn, so the figure summed here is what the status row shows;
   *  reporting each message's own count made the row drop back to a few hundred at every tool step. */
  private turnOutput = 0;
  /** callId → original input JSON string, kept so Edit can build meta.diffs from it. */
  readonly callInputs = new Map<string, string>();
  /** callId → the seq onToolCall returned, so a re-fired block never appends `tool/call` twice. */
  readonly firedCalls = new Map<string, number>();
  /** callId → mapped tool name, so an inline result row knows which tool (and file) it belongs to. */
  readonly callNames = new Map<string, string>();

  /**
   * Fires onToolCall at most once per callId. The streaming and whole-message paths can both
   * reach the same tool_use block; a second append gives the client two `tool/call` starts for
   * one callId, which throws in ConversationNodeAssembler and stalls the whole event feed.
   */
  private fireToolCall(callId: string, toolName: string, input: string): number | undefined {
    const seen = this.firedCalls.get(callId);
    if (seen !== undefined) return seen;
    const seq = this.onToolCall?.(callId, toolName, input);
    if (seq !== undefined) {
      this.firedCalls.set(callId, seq);
      this.callInputs.set(callId, input);
    }
    return seq;
  }

  constructor({
    toolActivity = true,
    continueAfterLimit = false,
    timeZone,
    toolTextLimit = TOOL_TEXT_LIMIT,
    relay = false,
    dshIds,
    relayed,
    log,
    onToolCall,
    onToolResult,
    onResult,
    redact,
    onInit,
    onProgress,
    hostLabel,
  }: {
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
    onProgress?: (progress: { thinking?: number; output?: number }) => void;
    /** The box a remote turn runs on, so a logged-out error names it, not this local host. */
    hostLabel?: string;
  } = {}) {
    this.log = log ?? (() => {});
    this.unknownSeen = new Set(); // (where:type) already warned, so schema drift warns once, not per event
    this.toolActivity = toolActivity;
    this.continueAfterLimit = continueAfterLimit;
    this.limitResetAt = undefined;
    this.limitFailure = undefined;
    this.timeZone = timeZone;
    this.hostLabel = hostLabel;
    this.relay = relay; // dsh tool calls are relayed to dsh's own loop: hide Claude's view of them
    this.dshIds = dshIds ?? new Set(); // tool_use ids of dsh tools called over the MCP bridge
    this.dshNames = new Map(); // dsh tool_use id → tool name, for a fallback row
    this.relayed = relayed ?? new Set(); // dsh tool_use ids dsh ran natively; results not drawn here
    this.limit = toolTextLimit;
    this.index = 0;
    this.open = new Map(); // api block index → { index, blockType, text }
    this.sawPartial = false;
    this.streamedId = undefined;
    this.finished = false;
    this.denied = 0; // tool calls Claude Code refused because a non-interactive run cannot ask
    this.toolPending = false; // a tool_use block closed and its result has not arrived yet
    this.aborting = false; // dsh cancelled: the CLI's interrupt result finishes as aborted, not error
    this.onToolCall = onToolCall;
    this.onToolResult = onToolResult;
    this.onResult = onResult;
    this.redact = redact;
    this.onInit = onInit;
    this.onProgress = onProgress;
  }

  deltaType(block: TranslatorBlock): "text-delta" | "reasoning-delta" {
    return block.blockType === "text" ? "text-delta" : "reasoning-delta";
  }

  /** Warn once when a CLI event/block type is neither handled nor knowingly ignored, so a Claude
   *  Code stream-json schema change shows up loud in the log instead of as silently dropped output. */
  noteUnknown(where: string, type: string | null | undefined) {
    if (type === null || type === undefined) return;
    const key = `${where}:${type}`;
    if (this.unknownSeen.has(key)) return;
    this.unknownSeen.add(key);
    this.log(
      "warn",
      `unhandled Claude Code ${where} "${type}"; stream-json schema may have changed`,
    );
  }

  /** A block is announced on its first text. Claude emits thinking blocks that carry only a
   *  signature and never any text; announcing those eagerly draws an empty bubble. */
  startBlock(blockType: string, prefix = "") {
    const block: TranslatorBlock = { index: this.index++, blockType, text: "", started: false };
    return { block, events: prefix ? this.delta(block, prefix) : [] };
  }

  /** Text for a block, with its block-start ahead of the first non-empty piece. Empty in, empty out. */
  delta(block: TranslatorBlock, text: string): StreamChunk[] {
    if (!text) return [];
    block.text += text;
    const events: StreamChunk[] = [];
    if (!block.started) {
      block.started = true;
      // SAFETY: blocks are opened with "text", "reasoning" or "tool-call"; hidden ones never announce
      events.push({
        type: "block-start",
        index: block.index,
        blockType: block.blockType as ContentBlockType,
      });
    }
    events.push({ type: this.deltaType(block), index: block.index, text });
    return events;
  }

  /** Close a block; one that never got text was never announced and closes silently. */
  endBlock(block: TranslatorBlock): StreamChunk[] {
    if (!block.started) return [];
    return [
      {
        type: "block-end",
        index: block.index,
        block:
          block.blockType === "text"
            ? { type: "text", text: block.text }
            : { type: "reasoning", text: block.text },
      },
    ];
  }

  wholeBlock(blockType: string, text: string): StreamChunk[] {
    const { block, events } = this.startBlock(blockType);
    events.push(...this.delta(block, text), ...this.endBlock(block));
    return events;
  }

  translate(event: ClaudeEvent): StreamChunk[] {
    switch (event?.type) {
      case "system": {
        if (event.subtype === "init") {
          const names = commandNames(event.slash_commands);
          const tools: string[] = [];
          if (Array.isArray(event.tools))
            for (const t of event.tools) if (String(t) === t) tools.push(t);
          if (names.length > 0 || tools.length > 0) this.onInit?.(names, tools);
          return [];
        }
        if (event.subtype === "thinking_tokens") {
          this.onProgress?.({ thinking: event.estimated_tokens ?? 0 });
          return this.thinkingTokens(event.estimated_tokens ?? 0);
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
            return this.wholeBlock(
              "reasoning",
              `⚠ Compaction failed: ${event.compact_error ?? "unknown reason"}`,
            );
          return [];
        }
        // Auto-memory traffic: one line each way, so the Memory button's count is explained.
        if (event.subtype === "memory_saved") {
          const paths = event.written_paths ?? [];
          const names = paths.map((f) => f.slice(f.lastIndexOf("/") + 1)).join(", ");
          return this.wholeBlock(
            "reasoning",
            `${event.verb ?? "Saved"} ${paths.length} ${paths.length === 1 ? "memory" : "memories"}${names ? `: ${names}` : ""}`,
          );
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
          const failed =
            (event.outcome !== undefined && event.outcome !== "success") ||
            (Number.isFinite(exitCode) && exitCode !== 0);
          if (!failed) return [];
          const out = (event.output || event.stdout || event.stderr || "").trim();
          const tail = Number.isFinite(exitCode) ? `exit ${exitCode}` : (event.outcome ?? "failed");
          return this.wholeBlock(
            "reasoning",
            `⚠ Hook ${event.hook_name ?? "?"} (${event.hook_event ?? "?"}) ${tail}${out ? `: ${clip(out)}` : ""}`,
          );
        }
        // Task frames from the CLI's built-in subagent runner. Each task_started opens a block (if it
        // has a task_id) so task_progress can append to it; task_started with no task_id emits the
        // closed one-line form. task_progress appends short lines when something changes (last_tool_name
        // or summary different from the last appended line). task_notification appends completion and
        // closes the block. background_tasks_changed is silent (list churn). On result, every open
        // task block is closed.
        if (event.subtype === "task_started") {
          const taskId = event.task_id;
          const startLine = `Task${event.is_backgrounded ? " (background)" : ""}: ${event.description ?? taskId ?? "?"}${event.subagent_type ? ` [${event.subagent_type}]` : ""}`;
          if (!taskId) {
            return this.wholeBlock("reasoning", startLine);
          }
          const { block, events } = this.startBlock("reasoning", startLine);
          this.taskBlocks.set(taskId, { block, lastSummary: undefined, lastToolName: undefined });
          return events;
        }
        if (event.subtype === "task_progress") {
          const taskId = event.task_id ?? "";
          const entry = this.taskBlocks.get(taskId);
          if (!entry) return [];
          const summary = (event.summary ?? "").trim();
          const toolName = event.last_tool_name ?? "";
          const summaryChanged = summary && summary !== entry.lastSummary;
          const toolNameChanged = toolName && toolName !== entry.lastToolName;
          if (!summaryChanged && !toolNameChanged) return [];
          const usage = event.usage ?? {};
          const input = usage.input_tokens ?? 0;
          const output = usage.output_tokens ?? 0;
          let progressLine = "";
          if (toolNameChanged) {
            progressLine += `${clip(toolName)}`;
            if (input > 0 || output > 0) progressLine += ` · ${input}→${output}t`;
            entry.lastToolName = toolName;
          }
          if (summaryChanged) {
            if (progressLine) progressLine += "\n";
            progressLine += `${clip(summary)}`;
            entry.lastSummary = summary;
          }
          return this.delta(entry.block, progressLine ? `\n${progressLine}` : "");
        }
        if (event.subtype === "task_notification") {
          const taskId = event.task_id ?? "";
          const entry = this.taskBlocks.get(taskId);
          const summary = (event.summary ?? "").trim();
          const completionLine = `Task ${event.status ?? "done"}: ${summary ? clip(summary) : taskId || "?"}`;
          if (!entry) {
            return this.wholeBlock("reasoning", completionLine);
          }
          const events: StreamChunk[] = [];
          events.push(...this.delta(entry.block, `\n${completionLine}`));
          events.push(...this.endBlock(entry.block));
          this.taskBlocks.delete(taskId);
          return events;
        }
        // task_updated carries the transitions a notification never sends: a task that dies, is
        // killed or is paused. Without it a dead task's block stays open until the result frame
        // force-closes it at the end of the turn.
        if (event.subtype === "task_updated") {
          const entry = this.taskBlocks.get(event.task_id ?? "");
          const patch = event.patch ?? {};
          const status = typeof patch.status === "string" ? patch.status : "";
          if (!entry || !status || status === entry.lastStatus) return [];
          entry.lastStatus = status;
          if (!TASK_TERMINAL.has(status)) {
            // Only a pause is worth a line: pending and running are the states it passes through.
            return status === "paused" ? this.delta(entry.block, "\n… paused") : [];
          }
          const error = typeof patch.error === "string" ? patch.error.trim() : "";
          const events = this.delta(
            entry.block,
            `\nTask ${status}${error ? `: ${clip(error)}` : ""}`,
          );
          events.push(...this.endBlock(entry.block));
          this.taskBlocks.delete(event.task_id ?? "");
          return events;
        }
        // The CLI re-sends the whole command catalog when a skill or custom command appears
        // mid-session; the bridge's copy is otherwise stale until the next spawn. Correctness, not
        // display, so it draws nothing.
        if (event.subtype === "commands_changed") {
          const names = commandNames(event.commands);
          if (names.length > 0) this.onInit?.(names, []);
          return [];
        }
        // A silent switch to a weaker model during a long unattended run is invisible otherwise.
        if (event.subtype === "model_fallback") {
          const from = event.original_model ?? "";
          const to = event.fallback_model ?? "";
          const pair = from && to ? `: ${from} → ${to}` : from || to ? `: ${from || to}` : "";
          const why = event.trigger ? ` (${event.trigger})` : "";
          const said = (event.content ?? "").trim();
          return this.wholeBlock(
            "reasoning",
            said ? `⚠ ${clip(said)}` : `⚠ Model fallback${pair}${why}`,
          );
        }
        // The loop's own banner. This box runs many hooks and `info` is documented as transcript
        // only, so only a suggestion or worse is drawn — plus anything that ended the turn early,
        // whatever its level, since a turn stopping without explanation is the confusing case.
        if (event.subtype === "informational") {
          const said = (event.content ?? "").trim();
          const loud = event.level === "suggestion" || event.level === "warning";
          if (!said || (!loud && !event.prevent_continuation)) return [];
          const stopped = event.prevent_continuation ? "⛔ " : "⚠ ";
          return this.wholeBlock("reasoning", `${stopped}${clip(said)}`);
        }
        // A denial as it happens, with the reason. The result frame still reports the count at the
        // end of the turn; this is the only place the CLI says which rule refused and why.
        if (event.subtype === "permission_denied") {
          const tool = clip(event.tool_name || "tool");
          const reason =
            typeof event.decision_reason === "string"
              ? event.decision_reason
              : (event.message ?? "");
          const why = reason.trim();
          return this.wholeBlock("reasoning", `⚠ Denied ${tool}${why ? `: ${clip(why)}` : ""}`);
        }
        if (event.subtype === "background_tasks_changed") {
          return [];
        }
        // The CLI retries a failed API call by itself (up to max_retries, backing off). Without a
        // line here the turn looks like it is working while nothing happens: dsh only sees silence
        // and keeps the spinner verb. Worded like the CLI's own retry banner: the error, the wait,
        // the reset time when a usage limit is the cause, and the attempt count.
        if (event.subtype === "api_retry" || event.subtype === "api_error") {
          const err = event.error ?? {};
          const wait = Math.round((event.retry_delay_ms ?? 0) / 1000);
          const resetsAt = err.rate_limits?.resets_at;
          const reset = Number.isFinite(resetsAt)
            ? ` (resets ${resetClock((resetsAt ?? 0) * 1000, this.timeZone)})`
            : "";
          // api_error is the same failure without the retry framing, and it alone says whether the
          // connection itself is down — worth naming, since that reads as the model hanging.
          const down = err.is_network_down
            ? " · network is down"
            : err.connection
              ? ` · ${err.connection}`
              : "";
          const head = err.formatted ?? err.message ?? `API error ${err.status ?? ""}`.trim();
          const retrying = event.subtype === "api_retry" || event.retry_delay_ms !== undefined;
          const tail = retrying
            ? ` · Retrying in ${wait}s${reset} · attempt ${event.attempt ?? "?"}/${event.max_retries ?? "?"}`
            : reset;
          return this.wholeBlock("reasoning", `⚠ ${head}${down}${tail}`);
        }
        // Claude Code compacted its own context (auto or /compact). One line so the user knows
        // why the model may have lost detail; every other system subtype is handshake noise.
        if (event.subtype !== "compact_boundary") return [];
        const meta = event.compact_metadata ?? {};
        const how = meta.trigger === "manual" ? "manual" : "auto";
        const size = Number.isFinite(meta.pre_tokens) ? `, ${meta.pre_tokens} tokens before` : "";
        return this.wholeBlock("reasoning", `✓ Context compacted by Claude Code (${how}${size})`);
      }
      case "tool_progress":
        return this.toolProgress(event);
      case "stream_event":
        return this.partial(event.event ?? { type: "" });
      case "assistant":
        return this.assistant(
          event.message?.content ?? [],
          event.parent_tool_use_id,
          event.message?.id,
        );
      case "user":
        return this.toolResults(event.message?.content ?? [], event.parent_tool_use_id);
      case "result": {
        this.finished = true;
        const events: StreamChunk[] = [];
        // Close any open task blocks that were never notified (process killed, turn cancelled).
        for (const [, entry] of this.taskBlocks) {
          events.push(...this.endBlock(entry.block));
        }
        this.taskBlocks.clear();
        // Same for a call that never reported a result: its block would otherwise stay open.
        for (const [, entry] of this.heartbeatBlocks) events.push(...this.endBlock(entry.block));
        this.heartbeatBlocks.clear();
        events.push(...this.endThinking());
        this.thinkingBlock = undefined;
        if (this.denied > 0 && !event.is_error) {
          const n = this.denied;
          events.push(
            ...this.wholeBlock(
              "text",
              `\n\n_Claude Code denied ${n} tool call${n === 1 ? "" : "s"} that needed approval. Switch Access mode to Full Access to allow them._`,
            ),
          );
        }
        if (event.usage) {
          events.push(usageEvent(event.usage));
          this.onProgress?.({ output: event.usage.output_tokens ?? 0 });
        }
        // Per-turn accounting: forward the summary to the adapter's ring buffer.
        // SAFETY: these fields are emitted by the Claude Code CLI on the result frame; they may not be in every schema version
        const e = event as {
          total_cost_usd?: unknown;
          duration_ms?: unknown;
          duration_api_ms?: unknown;
          num_turns?: unknown;
        };
        const totalCost = Number(e.total_cost_usd);
        const durationMs = Number(e.duration_ms);
        const apiMs = Number(e.duration_api_ms);
        if (Number.isFinite(totalCost) || Number.isFinite(durationMs)) {
          const record: TurnRecord = {
            at: Date.now(),
            costUsd: Number.isFinite(totalCost) ? totalCost : 0,
            durationMs: Number.isFinite(durationMs) ? durationMs : 0,
            apiMs: Number.isFinite(apiMs) ? apiMs : 0,
            turns: Number.isFinite(Number(e.num_turns)) ? Number(e.num_turns) : 0,
            input: event.usage?.input_tokens ?? 0,
            output: event.usage?.output_tokens ?? 0,
            cacheRead: event.usage?.cache_read_input_tokens ?? 0,
            cacheWrite: event.usage?.cache_creation_input_tokens ?? 0,
          };
          // The frame names the calls a rule refused without ever naming the rule: `tool_name`,
          // `tool_use_id` and `tool_input`, nothing else. Only the rule-shaped label is kept, since
          // the record is written to disk and a tool input carries file contents and secrets.
          // SAFETY: the field is off the wire and absent from ClaudeEvent, so it is read as unknown
          // and the shape below is checked by Array.isArray plus the ?? on every member.
          const denied = (event as { permission_denials?: unknown }).permission_denials;
          if (Array.isArray(denied)) {
            const labels = new Set<string>();
            // SAFETY: each member is used only through `??`, so a frame of another shape yields the
            // bare tool name rather than throwing.
            const calls = denied as {
              tool_name?: string;
              tool_input?: Record<string, JsonValue>;
            }[];
            for (const call of calls)
              labels.add(suggestRule(call.tool_name ?? "", call.tool_input ?? {}));
            if (labels.size > 0) record.denials = [...labels];
          }
          this.onResult?.(record);
        }
        events.push({
          type: "finish",
          reason: this.aborting
            ? { kind: "aborted", failure: { message: "aborted", code: "ABORTED" } }
            : this.limitFailure
              ? { kind: "error", failure: this.limitFailure }
              : finishReason(event, this.hostLabel),
        });
        return events;
      }
      case "rate_limit_event": {
        // Emitted on every run. Status is allowed | allowed_warning | rejected (SDK types);
        // only "rejected" is a limit. allowed_warning means "near the cap", the turn goes on.
        // Treating it as an error ended turns early and dsh's retry re-sent the prompt.
        const info = event.rate_limit_info ?? {};
        const status = info.status ?? "allowed";
        if (status !== "rejected") return [];
        // Extra usage on and not itself exhausted: the request went through on credits. The CLI
        // shows no limit here, so neither does the turn.
        const covered =
          info.isUsingOverage === true ||
          info.overageStatus === "allowed" ||
          info.overageStatus === "allowed_warning";
        if (covered) return [];
        // Credits exhausted too: their own reset is the one that matters.
        const resetsAt =
          info.overageStatus === "rejected" && Number.isFinite(info.overageResetsAt)
            ? info.overageResetsAt
            : info.resetsAt;
        const resetAt = Number.isFinite(resetsAt) ? (resetsAt ?? 0) * 1000 : 0;
        const resetMs = resetAt - Date.now();
        if (resetMs > 0) this.limitResetAt = resetAt;
        // Right after this frame the CLI sends its own sentence as a synthetic assistant message
        // ("You've reached your Fable limit. Switch to another model, or manage usage credits at
        // …"), then the result frame. That message is the only authority on what went wrong, so
        // the turn does not end here: it is relayed as text, and this failure rides the result
        // frame. Whatever the cause — a cap, an org setting, an outage — the user reads the CLI's
        // own words, and this row adds only which window it was and when it reopens.
        const name = LIMIT_NAMES.get(info.rateLimitType ?? "") ?? "usage limit";
        const clock = resetMs > 0 ? ` · resets ${resetClock(resetAt, this.timeZone)}` : "";
        const waiting =
          resetMs > 0 && this.continueAfterLimit
            ? " · continuing automatically when it resets"
            : "";
        const failure: LlmFailure & { providerRetryAfterMs?: number } = {
          message: `You've hit your ${name}${clock}${waiting}`,
          code: "RATE_LIMIT",
        };
        if (resetMs > 0) failure.providerRetryAfterMs = resetMs;
        this.limitFailure = failure;
        return [];
      }
      default:
        if (!BENIGN_EVENTS.has(event?.type)) this.noteUnknown("event", event?.type);
        return [];
    }
  }

  // SAFETY: ev is ClaudeStreamPartial from Claude Code stream-json protocol
  partial(ev: ClaudeStreamPartial) {
    switch (ev.type) {
      case "message_start": {
        this.sawPartial = true;
        // Which message is being streamed, so the echo of *this* message can be dropped without
        // dropping a different one. See `assistant`.
        this.streamedId = ev.message?.id;
        this.toolPending = false;
        this.open.clear();
        this.thinkingBlock = undefined;
        return this.endThinking();
      }
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
          if (!cbMeta.id) return [];
          const existing = this.callInputs.get(cbMeta.id);
          this.callInputs.set(cbMeta.id, (existing ?? "") + partial);
          return [];
        }
        if (!block || block.index < 0) return [];
        const d = ev.delta ?? {};
        const text = d.text ?? d.thinking ?? d.partial_json ?? "";
        return this.delta(block, text);
      }
      case "content_block_stop": {
        const block = this.open.get(ev.index ?? -1);
        if (!block) return [];
        const apiIndex = ev.index ?? -1;
        // Native tool: its input is now complete. Either hand it to the dsh session (onToolCall)
        // or draw it inline as a formatted markdown block that rides this turn's ordered stream.
        const cbMeta = this.cbMeta.get(apiIndex);
        let inlineCall: StreamChunk[] = [];
        if (cbMeta?.id) {
          this.cbMeta.delete(apiIndex);
          // Hidden blocks accumulate input via callInputs in the delta handler; live blocks use block.text.
          const input = this.callInputs.get(cbMeta.id) ?? block.text;
          // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
          const mapped =
            NATIVE_TOOL_MAP[(cbMeta.name ?? "") as keyof typeof NATIVE_TOOL_MAP] ??
            cbMeta.name ??
            "";
          // Gate on the id, never on the input: a tool called with no arguments (`ExitPlanMode`,
          // `ListMcpResources`, any MCP tool called with `{}`) streams one `input_json_delta`
          // carrying `""`, and skipping the call for it left the result frame — which only looks
          // the id up — firing alone. That orphan is what the assembler throws on.
          const args = input || "{}";
          if (this.onToolCall) {
            this.fireToolCall(cbMeta.id, mapped, args);
          } else {
            // Inline: keep input+name so the result row can format itself, and draw the call now.
            this.callInputs.set(cbMeta.id, args);
            this.callNames.set(cbMeta.id, mapped);
            inlineCall = this.wholeBlock("text", formatToolCall(mapped, args));
          }
        }
        this.open.delete(apiIndex);
        // A finished tool_use block means the CLI is now running that tool: no stream events until
        // its result arrives, however long it takes. Callers read this to pause their idle timer.
        this.toolPending = block.tool === true;
        // The estimate resets at the next content_block_start, so the counter ends with its block.
        let done: StreamChunk[] = [];
        if (block === this.thinkingBlock) {
          done = this.endThinking();
          this.thinkingBlock = undefined;
        }
        const tail = block.index < 0 ? done : [...done, ...this.endBlock(block)];
        return [...tail, ...inlineCall];
      }
      default:
        // `message_delta` is the only frame carrying usage while the turn is still running: the
        // `result` frame reports it too, but not until the turn is over, which is too late for a
        // status row that exists to say what is happening now. Measured on 2.1.268: one per
        // assistant message, so the figure climbs a step per tool step. Nothing is rendered from it
        // — it feeds the running count and the frame stays bookkeeping otherwise.
        if (ev?.type === "message_delta") {
          // SAFETY: a stream event off the wire, read as unknown; the one field used is checked as a
          // number below, so a frame of another shape reports nothing rather than throwing.
          const out = (ev as { usage?: { output_tokens?: unknown } }).usage?.output_tokens;
          if (typeof out === "number" && out > 0) {
            this.turnOutput += out;
            this.onProgress?.({ output: this.turnOutput });
          }
          return [];
        }
        if (!BENIGN_PARTIALS.has(ev?.type)) this.noteUnknown("stream event", ev?.type);
        return [];
    }
  }

  /** Tracks content_block metadata for native-tool blocks whose input we collect via deltas. */
  readonly cbMeta = new Map<number, { id?: string; name?: string }>();

  openBlock(apiIndex: number, cb: { type?: string; id?: string; name?: string }) {
    let opened: { block: TranslatorBlock; events: StreamChunk[] };
    if (cb.type === "text") opened = this.startBlock("text");
    else if (cb.type === "thinking") {
      opened = this.startBlock("reasoning");
      this.thinkingBlock = opened.block;
    } else if (cb.type === "tool_use") {
      const toolName = cb.name ?? "";
      const dsh = toolName.startsWith("mcp__dsh__");
      if (dsh && cb.id) {
        this.dshIds.add(cb.id);
        this.dshNames.set(cb.id, toolName.slice("mcp__dsh__".length));
      }
      // Native tools: hide the raw block and accumulate input; content_block_stop draws the row
      // (a dsh session row when onToolCall is wired, else a formatted inline markdown block).
      if (isNativeTool(toolName) && cb.id && (this.onToolCall || this.toolActivity)) {
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
    } else {
      this.noteUnknown("content block", cb.type);
      return [];
    }
    this.open.set(apiIndex, opened.block);
    return opened.events;
  }

  assistant(
    content: ClaudeContentBlock[],
    parentToolUseId: string | null | undefined,
    id?: string,
  ) {
    // Claude Code subagent output (--forward-subagent-text) arrives as whole messages tagged with the
    // parent tool id; it never comes as partials, so it is always rendered, folded into reasoning.
    if (parentToolUseId) {
      if (!this.toolActivity) return [];
      const text = content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n");
      return text ? this.wholeBlock("reasoning", `↳ subagent\n${clip(text, this.limit)}`) : [];
    }
    // The whole-message echo of what just streamed as deltas is a duplicate and is dropped. The
    // guard used to be `sawPartial` alone, which latched on the first `message_start` and stayed
    // set for the rest of the run — so it also swallowed the assistant message the CLI sends on its
    // own after refusing a turn on a rate limit, the one text that names the cap that was hit and
    // whether credits still apply. Only the id that was actually streamed is an echo.
    if (this.sawPartial && (id === undefined || id === this.streamedId)) return [];
    const events: StreamChunk[] = [];
    for (const b of content) {
      if (b.type === "text" && b.text) events.push(...this.wholeBlock("text", b.text));
      else if (b.type === "thinking" && b.thinking)
        events.push(...this.wholeBlock("reasoning", b.thinking));
      else if (b.type === "tool_use") {
        const toolName = b.name ?? "";
        const dsh = toolName.startsWith("mcp__dsh__");
        if (dsh) {
          this.dshIds.add(b.id);
          this.dshNames.set(b.id, toolName.slice("mcp__dsh__".length));
        }
        // Native tools render as session rows (onToolCall) or an inline markdown block.
        if (isNativeTool(toolName) && b.id) {
          const args = JSON.stringify(b.input ?? {});
          // SAFETY: NATIVE_TOOL_MAP is a closed literal type; keyof narrows index access to known keys
          const mapped = NATIVE_TOOL_MAP[toolName as keyof typeof NATIVE_TOOL_MAP] ?? toolName;
          if (this.onToolCall) {
            this.fireToolCall(b.id, mapped, args);
          } else if (this.toolActivity) {
            this.callInputs.set(b.id, args);
            this.callNames.set(b.id, mapped);
            events.push(...this.wholeBlock("text", formatToolCall(mapped, args)));
          }
          continue;
        }
        if (!this.toolActivity || (dsh && this.relay)) continue;
        const [kind, lead] = this.toolLead(b);
        events.push(
          ...this.wholeBlock(kind, lead + clip(JSON.stringify(b.input ?? {}), this.limit)),
        );
      }
    }
    return events;
  }

  /** dsh tools reached over the MCP bridge (subagents, jobs...) render as visible text rows, the
   *  rest as collapsed reasoning. Returns [block kind, lead text]. */
  toolLead(cb: { id?: string; name?: string }): [string, string] {
    const toolName = cb.name ?? "";
    if (toolName.startsWith("mcp__dsh__")) {
      if (cb.id) this.dshIds.add(cb.id);
      return ["text", `⤷ ${toolName.slice("mcp__dsh__".length)} `];
    }
    return ["reasoning", `${cb.name} `];
  }

  /** The CLI's per-call progress frame. Two variants reach a headless run: a 30-second heartbeat
   *  carrying the live elapsed time, and a subagent retrying an API failure. A call that finishes
   *  inside 30 seconds never sends one, so a block here means "this one is genuinely slow" —
   *  without it a ten-minute Bash call is indistinguishable from a hung process. */
  toolProgress(event: Extract<ClaudeEvent, { type: "tool_progress" }>): StreamChunk[] {
    if (!this.toolActivity) return [];
    const name = clip(event.tool_name || "tool");
    const retry = event.subagent_retry;
    if (retry) {
      // Not a heartbeat and not on a clock: the only signal that a subagent is quietly retrying.
      const attempt = retry.attempt ?? 0;
      const max = retry.max_retries ?? 0;
      const count = attempt && max ? ` ${attempt}/${max}` : attempt ? ` ${attempt}` : "";
      const why = retry.error_category || (retry.error_status ? `HTTP ${retry.error_status}` : "");
      const wait = retry.retry_delay_ms
        ? `, retrying in ${Math.round(retry.retry_delay_ms / 1000)}s`
        : "";
      const who = event.subagent_type ? `${name} [${event.subagent_type}]` : name;
      return this.wholeBlock(
        "reasoning",
        `↻ ${who} attempt${count} failed${why ? `: ${why}` : ""}${wait}`,
      );
    }
    const id = event.tool_use_id;
    if (!event.heartbeat || !id) return [];
    const elapsed = event.elapsed_time_seconds ?? 0;
    const entry = this.heartbeatBlocks.get(id);
    if (!entry) {
      const tag = event.parent_tool_use_id ? "↳ " : "";
      const { block, events } = this.startBlock(
        "reasoning",
        `${tag}⏱ ${name} running · ${elapsedText(elapsed)}`,
      );
      this.heartbeatBlocks.set(id, { block, nextAt: nextHeartbeat(elapsed) });
      return events;
    }
    // Every heartbeat after the first only writes when it passes the next mark, so a long call
    // grows a handful of lines rather than one every 30 seconds.
    if (elapsed < entry.nextAt) return [];
    entry.nextAt = nextHeartbeat(elapsed);
    return this.delta(entry.block, `\n⏱ ${elapsedText(elapsed)}`);
  }

  /** A running estimate for the thinking block the model is in the middle of. Only the silent kind
   *  draws: when the thinking text streams, the reasoning block itself is the progress, and a
   *  counter beside it would say the same thing twice. Fable-class models return thinking blocks
   *  that carry a signature and no text, and this is the only sign they are working. */
  thinkingTokens(total: number): StreamChunk[] {
    if (this.thinkingBlock?.started) return this.endThinking();
    const entry = this.thinking;
    if (!entry) {
      if (total < THINK_FLOOR) return [];
      const { block, events } = this.startBlock("reasoning", `~${tokensText(total)} tokens`);
      this.thinking = { block, nextAt: nextThinkStep(total) };
      return events;
    }
    // One frame per delta arrives, so only a crossed mark writes.
    if (total < entry.nextAt) return [];
    entry.nextAt = nextThinkStep(total);
    // Each mark on its own line, no ` → ` chain: dsh's Think summary is a nowrap line that follows the
    // end (data-follow-end), so the collapsed row shows the newest figure while the expanded block
    // keeps the ladder.
    return this.delta(entry.block, `\n~${tokensText(total)} tokens`);
  }

  /** Close the counter: the thinking block it stood in for is over, or the turn is. */
  endThinking(): StreamChunk[] {
    const entry = this.thinking;
    if (!entry) return [];
    this.thinking = undefined;
    return this.endBlock(entry.block);
  }

  /** Close the elapsed-time block a slow call opened, whichever way its result is drawn. */
  endHeartbeat(toolUseId: string): StreamChunk[] {
    const entry = this.heartbeatBlocks.get(toolUseId);
    if (!entry) return [];
    this.heartbeatBlocks.delete(toolUseId);
    return this.endBlock(entry.block);
  }

  toolResults(content: ClaudeContentBlock[], parentToolUseId: string | null | undefined) {
    this.toolPending = false;
    if (!this.toolActivity) return [];
    const events: StreamChunk[] = [];
    for (const b of content) {
      if (b.type !== "tool_result") continue;
      const rawText = toolResultText(b).trim();
      const raw = this.redact ? this.redact(rawText) : rawText;
      if (b.is_error && DENIED_RE.test(raw)) this.denied++;
      const body = clip(raw || "(empty)", this.limit);
      const tag = parentToolUseId ? "↳ " : "";
      const toolUseId = b.tool_use_id ?? "";
      events.push(...this.endHeartbeat(toolUseId));
      const dsh = this.dshIds.delete(toolUseId);
      if (dsh && this.relayed.delete(toolUseId)) continue; // dsh drew the native call and result
      // Inline native result: draw a formatted markdown block matching its call, in stream order.
      if (!this.onToolResult && this.callNames.has(toolUseId)) {
        const name = this.callNames.get(toolUseId)!;
        const argsJson = this.callInputs.get(toolUseId) ?? "";
        this.callNames.delete(toolUseId);
        this.callInputs.delete(toolUseId);
        this.firedCalls.delete(toolUseId);
        let filePath = "";
        try {
          // SAFETY: argsJson is Claude's own tool_use input; only file_path is read, defensively
          filePath = asStr((JSON.parse(argsJson) as { file_path?: unknown }).file_path);
        } catch {
          filePath = "";
        }
        events.push(
          ...this.wholeBlock("text", formatToolResult(name, filePath, body, b.is_error ?? false)),
        );
        continue;
      }
      // Native tool result: append a dsh session row, skip reasoning text.
      if (this.onToolResult && !this.callInputs.has(toolUseId)) {
        // Not a native tool we tracked — fall through to old behavior.
      } else if (this.onToolResult && this.callInputs.has(toolUseId)) {
        const argsJson = this.callInputs.get(toolUseId)!;
        // Result closes the call: both maps only need the entry until here (fire dedupe, Edit diff).
        this.callInputs.delete(toolUseId);
        this.firedCalls.delete(toolUseId);
        let meta: object | undefined;
        try {
          // SAFETY: argsJson was produced by Claude's tool_use input and stored verbatim; the shape is trusted here
          interface EditCallInput {
            file_path: string;
            old_string: string;
            new_string: string;
          }
          // SAFETY: JSON.parse output cast to EditCallInput; fields validated below with truthiness checks
          const inp = JSON.parse(argsJson) as EditCallInput;
          if (inp.file_path && inp.old_string && inp.new_string) {
            meta = {
              diffs: [{ path: inp.file_path, oldText: inp.old_string, newText: inp.new_string }],
            };
          }
        } catch {
          // ignore malformed input JSON
        }
        try {
          this.onToolResult(toolUseId, raw, b.is_error ?? false, meta);
        } catch (err) {
          this.log("warn", `native tool result append failed: ${err}`);
          // fall through to render reasoning text as before
        }
        continue;
      }
      const toolName = this.dshNames.get(toolUseId);
      this.dshNames.delete(toolUseId);
      // A dsh call that could not be relayed ran inside the bridge: show it as one compact row.
      const lead = dsh && this.relay ? `⤷ ${toolName ?? "dsh tool"} (ran in bridge)\n` : "";
      events.push(
        ...this.wholeBlock(
          dsh ? "text" : "reasoning",
          `${lead}${tag}${dsh ? "⤶" : "◀"} ${b.is_error ? "error" : "result"}\n${body}`,
        ),
      );
    }
    return events;
  }
}
