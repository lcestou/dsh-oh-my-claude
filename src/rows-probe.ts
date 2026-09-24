// Whether the dsh this plugin runs inside loads a log holding a raw `tool/call` row that no settled
// `assistant/message` advertised. That is what native tool rows for Claude Code's own tools write:
// Claude runs the tool inside one dsh step, so the row lands before the message and the message
// never names it. dsh 0.1.5's format migration refuses such rows ("tool/call … does not match one
// advertised tool call"), which is what broke every rows-mode log at the v0 to v3 bump; its plain
// load of a current-format log does not check them (dsh-session-persistence-jsonl passes
// `validation: "transformed"`, and for the current version that validates nothing), measured on
// 0.1.5-rc.1 against a real log. A session that will not load is worse than inline tool text, so
// the Tune switch for rows unlocks only when this probe passes. It runs the restore dsh runs at
// load, in the mode dsh runs it, on a synthetic log in memory: nothing on disk is touched, and a
// dsh that starts checking at load locks the switch again without a plugin release.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JsonValue } from "./dsh.js";

/** Tool activity as the Tune switch names it: inline text, or dsh's native tool rows. */
export type ToolMode = "inline" | "rows";

/** What the Tune switch shows: the mode in force and whether rows are open to it at all. */
export interface ToolModeInfo {
  mode: ToolMode;
  rows: RowsSupport;
}

export interface RowsSupport {
  ok: boolean;
  /** Why rows are off, in the words dsh's loader used; empty when they are on. */
  reason: string;
}

/** The first line of a v3 log. */
interface LogHeader {
  type: "session";
  version: number;
  id: string;
  createdAt: number;
  cwd: string;
  isSeeded: boolean;
  delegationDepth: number;
  agentPreset: string;
}
/** One event line of a v3 log: the envelope dsh writes, with the payload it carries. */
interface LogRow {
  type: string;
  seq: number;
  time: number;
  surfaceOp?: "append";
  sourceEventSeqs?: number[];
  data: JsonValue;
}
export interface RawRowsLog {
  header: LogHeader;
  rows: LogRow[];
}
/** The slice of dsh's session-format catalog the probe calls: the restore a load runs. */
export interface Catalog {
  /** The log version this dsh writes. The probe stamps its fixture with it, see `rawRowsLog`. */
  readonly currentVersion?: number;
  createRestore(
    header: LogHeader,
    options: { recovery: string; validation: string },
  ): { decodeRow(row: LogRow): void; finish(): void };
}

const T0 = 1_700_000_000_000;
/** One synthetic log row for the probe, timed at a base plus its sequence number so rows stay
 *  ordered. */
const ev = (
  seq: number,
  type: string,
  data: JsonValue,
  extra: Pick<LogRow, "surfaceOp" | "sourceEventSeqs"> = {},
): LogRow => ({
  type,
  seq,
  time: T0 + seq,
  ...extra,
  data,
});

/**
 * A tool's result as the log version stores it. Up to v3 (dsh 0.1.6) it is a user message from the
 * tool source holding one `tool-result` block; from v4 (dsh 0.1.7) it is a first-class message of
 * its own, `role: "tool"`, the call id on the message and the text as plain blocks, and v4's
 * loader refuses the wrapper block outright ("content must not contain a released tool-result
 * wrapper"). The live rows mode gets this right on its own by calling dsh's
 * `createToolResultMessage`; the probe and the Import seed build the message by hand and have to
 * pick the shape themselves.
 */
export function toolResultMessage(
  version: number,
  callId: string,
  id: string,
  text: string,
  isError = false,
): JsonValue {
  const content = [{ type: "text", text }];
  if (version >= 4)
    return {
      id,
      role: "tool",
      toolCallId: callId,
      source: { kind: "tool", callId },
      content,
      isError,
    };
  return {
    id,
    role: "user",
    source: { kind: "tool", callId },
    content: [{ type: "tool-result", toolCallId: callId, content, isError }],
  };
}

/**
 * The current-format log rows mode writes for one turn with one tool: the announcement, the call
 * and its result sit inside the step, ahead of the settled text message.
 *
 * `version` is the log version the installed dsh writes, not a fixed 3. A fixture stamped below
 * that version is a log needing migration, and dsh 0.1.7's v3-to-v4 migration refuses to run at
 * all without a parent's historical child evidence bound to it ("V3 catalog migration requires
 * explicit historical child facts"). The probe then failed before reaching the row it exists to
 * ask about, and locked rows over a migration a live session never runs.
 */
export const rawRowsLog = (version = 3): RawRowsLog => ({
  header: {
    type: "session",
    version,
    id: "session-00000000-0000-4000-8000-000000000000",
    createdAt: T0,
    cwd: "/",
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "probe",
  },
  rows: [
    ev(0, "turn/start", { turn: 1 }),
    ev(1, "step/start", { turn: 1, step: 1 }),
    ev(
      2,
      "user/message",
      { content: [{ type: "text", text: "hi" }], source: { kind: "user" }, role: "user", id: "u" },
      { surfaceOp: "append" },
    ),
    // The announcement rows mode writes before each call from 2026-09-22 on: one tool-call block
    // in an assistant message of its own, which is what dsh 0.1.7's loader requires and what
    // 0.1.5's migration wanted. A log without it is what the repair tool mends.
    ev(
      3,
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          source: { kind: "model", provider: "claude-code", model: "probe" },
          id: "raw:call",
          content: [{ type: "tool-call", id: "raw", name: "bash", arguments: "{}" }],
        },
        stream: [],
      },
      { surfaceOp: "append" },
    ),
    ev(4, "tool/call", { turn: 1, step: 1, callId: "raw", name: "bash", arguments: "{}" }),
    ev(
      5,
      "tool/result",
      { turn: 1, step: 1, message: toolResultMessage(version, "raw", "r", "ok") },
      { sourceEventSeqs: [4], surfaceOp: "append" },
    ),
    ev(
      6,
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          source: { kind: "model", provider: "claude-code", model: "probe" },
          id: "m",
          content: [{ type: "text", text: "ab" }],
        },
        stream: [
          { type: "chunk", time: T0, chunk: { type: "block-start", index: 0, blockType: "text" } },
          { type: "text-chunks", time0: T0, index: 0, dt: [], texts: ["ab"] },
          {
            type: "chunk",
            time: T0,
            chunk: { type: "block-end", index: 0, block: { type: "text", text: "ab" } },
          },
        ],
      },
      { surfaceOp: "append" },
    ),
    ev(7, "step/end", { turn: 1, step: 1 }),
    ev(8, "turn/end", { turn: 1, reason: "done" }),
  ],
});

/** dsh's session-format catalog, found next to the dsh that is running this plugin. The plugin's
 *  own node_modules cannot answer: a copy pinned there would be probing a different dsh. */
const catalogPath = (entry = process.argv[1] ?? ""): string | undefined => {
  const rel = join("node_modules", "@deepseek-ai", "dsh-session-format-catalog", "lib", "index.js");
  for (let dir = dirname(resolve(entry)); ; dir = dirname(dir)) {
    const at = join(dir, rel);
    if (existsSync(at)) return at;
    if (dir === dirname(dir)) return undefined;
  }
};

/**
 * The installed dsh's session-format catalog, the module its own loader restores a log with.
 * Undefined when dsh cannot be found next to the running entry or the module has no such export,
 * which a caller reads as "cannot judge a log" rather than an error.
 */
export async function loadSessionCatalog(entry?: string): Promise<Catalog | undefined> {
  const at = catalogPath(entry);
  if (at === undefined) return undefined;
  try {
    // SAFETY: `at` is dsh's own catalog module, checked to exist above, and its export carries the
    // version it reads and writes. A dsh that renames either answers undefined through the catch.
    const { sessionFormatCatalog } = (await import(at)) as { sessionFormatCatalog?: Catalog };
    return sessionFormatCatalog;
  } catch {
    return undefined;
  }
}

/**
 * The log version the installed dsh writes: 3 up to 0.1.6, 4 from 0.1.7. Read off dsh's own
 * catalog, so a log this plugin writes carries the version the reader expects. Undefined when the
 * catalog cannot be found or read, which leaves the caller to keep its own default.
 */
export async function currentLogVersion(entry?: string): Promise<number | undefined> {
  return (await loadSessionCatalog(entry))?.currentVersion;
}

/** Feed the synthetic log through dsh's own restore, with the options its load passes. */
export async function probeRawToolRows(entry?: string): Promise<RowsSupport> {
  const at = catalogPath(entry);
  if (at === undefined) return { ok: false, reason: "dsh session-format catalog not found" };
  try {
    // SAFETY: `at` is dsh's own catalog module, checked to exist above; the export name is the one
    // tools/dsh-session-repair.ts reads. A dsh that renames it fails on the call below, and the
    // catch answers "rows off" with the message, which is the safe side.
    const { sessionFormatCatalog } = (await import(at)) as { sessionFormatCatalog: Catalog };
    const version = sessionFormatCatalog.currentVersion ?? 3;
    const { header, rows } = rawRowsLog(version);
    // The pair dsh-session-persistence-jsonl hands createRestore when it loads a session. Up to
    // 0.1.6 (v3) that is "transformed", which checks nothing on a current-format log, and
    // "current" would have locked rows that loaded fine. 0.1.7 (v4) loads with "current", whose
    // relationship check requires every tool/call to be advertised by an assistant/message block:
    // a raw row is refused ("has no advertised tool lifecycle"), and two rows-mode sessions were
    // refused that way on 2026-09-22 while this probe, still asking with "transformed", said rows
    // were fine. Ask the way the installed dsh loads.
    const restore = sessionFormatCatalog.createRestore(header, {
      recovery: "strict",
      validation: version >= 4 ? "current" : "transformed",
    });
    for (const row of rows) restore.decodeRow(row);
    restore.finish();
    return { ok: true, reason: "" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
