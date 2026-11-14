#!/usr/bin/env bun
// Live check: the plugin's `compactOnCli` keeps the newest turns of a real Claude session verbatim.
//
// The offline suite writes the transcript itself. This drives a real `claude -p` through a few
// turns in a scratch directory, hands its pipes to the adapter as the session's process, and asks
// the adapter to compact it the way dsh's compaction does. It then reads the transcript the CLI
// wrote, resumes the session in a fresh `claude -p --resume`, and reads the request that process
// logged, to see the kept turns sent word for word after the summary. It spends tokens on the
// model given (claude-haiku-4-5 by default). The scratch directory and the transcripts are removed
// after; `--keep` leaves them.
//
//   DSH_OMC_STATE_DIR=$(mktemp -d) bun tools/compact-retain-check.ts [model] [--keep]
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, Config, registryKey } from "../src/adapter.js";
import { projectDirName } from "../src/adapter/transcript-watch.js";
import type { PluginContext } from "../src/dsh.js";
import type { ClaudeEvent, ClaudeProcess } from "../src/process.js";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const model = args.find((a) => !a.startsWith("--")) ?? "claude-haiku-4-5";
const cwd = realpathSync(mkdtempSync(join(tmpdir(), "omc-retain-check-")));
const claudeId = randomUUID();
const transcript = join(homedir(), ".claude", "projects", projectDirName(cwd), `${claudeId}.jsonl`);

const FIRST = "Remember the codeword AMBER-FALCON. Reply with exactly: OK";
const POEM = "Remember the codeword VIOLET-STONE. Write a three-line poem about river stones.";
const TOOL =
  "Use the Bash tool once to run: echo kept-tool-output. Then reply with what it printed.";
const CODEWORD = "Remember a second codeword, TEAL-RIVER. Reply with exactly: OK";
const RECALL =
  "Without using any tools: quote the poem you wrote word for word, then list every codeword I gave you.";

let failed = 0;
/** Print one line and count it when the expectation does not hold. */
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
};

/** A `claude -p` over stream-json, its stdout parsed into a queue of events. */
function startClaude(resume: boolean) {
  const child: ChildProcessWithoutNullStreams = spawn(
    "claude",
    [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      model,
      "--permission-mode",
      "bypassPermissions",
      resume ? "--resume" : "--session-id",
      claudeId,
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  );
  const events: ClaudeEvent[] = [];
  let wake: (() => void) | undefined;
  const state = { ended: false };
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      try {
        // SAFETY: a line of the CLI's stream-json output; the adapter checks what it reads
        events.push(JSON.parse(line) as ClaudeEvent);
      } catch {
        continue;
      }
      wake?.();
    }
  });
  const done = new Promise<void>((resolve) =>
    child.once("exit", () => {
      state.ended = true;
      wake?.();
      resolve();
    }),
  );
  const nextEvent = async (): Promise<ClaudeEvent | null> => {
    while (events.length === 0 && !state.ended) await new Promise<void>((r) => (wake = r));
    return events.shift() ?? null;
  };
  const write = (line: string) => child.stdin.write(line);
  return { child, done, nextEvent, write, ended: () => state.ended };
}

/** One user turn, written and read to its result; answers the assistant's text. */
async function turn(cli: ReturnType<typeof startClaude>, text: string): Promise<string> {
  cli.write(
    `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`,
  );
  let reply = "";
  for (;;) {
    const event = await cli.nextEvent();
    if (event === null) throw new Error(`claude ended during: ${text}`);
    if (event.type === "assistant")
      for (const b of event.message?.content ?? []) if (b.type === "text") reply += b.text ?? "";
    if (event.type === "result") return reply;
  }
}

/** The fields of a transcript row this check reads. */
type Row = {
  uuid?: string;
  type?: string;
  subtype?: string;
  hash?: string;
  tail?: string[];
  compactMetadata?: { preservedMessages?: { uuids?: string[] } };
  message?: { content?: string | Array<{ type?: string; text?: string }> };
};
/** The session's transcript, as rows. */
const rows = (): Row[] =>
  existsSync(transcript)
    ? readFileSync(transcript, "utf8")
        .split("\n")
        .flatMap((l) => {
          try {
            // SAFETY: one transcript row; every field Row names is optional
            return [JSON.parse(l) as Row];
          } catch {
            return [];
          }
        })
    : [];
/** The text blocks of a row's message, each whole. */
function texts(row: Row | undefined): string[] {
  const content = row?.message?.content;
  if (Array.isArray(content))
    return content.flatMap((b) => (b.type === "text" && b.text !== undefined ? [b.text] : []));
  return content === undefined ? [] : [content];
}

const first = startClaude(false);
try {
  for (const text of [FIRST, POEM, TOOL, CODEWORD]) {
    const reply = await turn(first, text);
    console.log(`   turn: ${text.slice(0, 50)} -> ${reply.replace(/\s+/g, " ").slice(0, 60)}`);
  }
  const written: string[] = [];
  const bridge = {
    alive: true,
    busy: false,
    compacting: false,
    resuming: false,
    relays: new Map(),
    parked: undefined,
    steers: new Map(),
    lastUsed: Date.now(),
    spec: { cwd, sessionId: claudeId, model },
    hasTurnOutput: () => false,
    write: (line: string) => {
      written.push(line);
      return first.write(line);
    },
    nextEvent: first.nextEvent,
    kill() {
      first.child.kill("SIGTERM");
    },
    child: { done: first.done },
  };
  Object.defineProperty(bridge, "alive", { get: () => !first.ended() });
  const ctx = {
    on() {},
    logger: { info() {}, warn: (m: string) => console.log(`   warn: ${m}`) },
    sessions: {
      get: () => ({
        header: {},
        snapshotEvents: () => [],
        requestHeader: () => ({ version: 1, config: { provider: "claude-code", model } }),
      }),
    },
    get: (name: string) => (name === "compaction" ? { config: { retainTokens: 8000 } } : undefined),
  };
  // SAFETY: the parts of dsh's context compactOnCli and retainTail read
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- a stand-in for dsh's context, which no script outside dsh can build
  const a = new ClaudeCodeAdapter(ctx as unknown as PluginContext, Config({}));
  // SAFETY: the parts of a ClaudeProcess compactOnCli, retainTail and endIdleProcess read
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the real class spawns its own child; this hands the adapter one the script owns
  a.processes.set(registryKey(a.providerId, "s1"), bridge as unknown as ClaudeProcess);
  const summary = await a.compactOnCli("s1");
  console.log(`   summary: ${(summary ?? "").replace(/\s+/g, " ").slice(0, 120)}…`);
  check(
    "/compact told what to leave out",
    written.some((l) => l.includes("/compact The newest part of this conversation")),
    written.map((l) => l.slice(0, 160)).join(" | "),
  );
  check("the summary came back", summary !== undefined, "");
  check("the CLI ended for the resume", first.ended(), "");
  const after = rows();
  const boundary = after.findLast((r) => r.subtype === "compact_boundary");
  const kept = boundary?.compactMetadata?.preservedMessages?.uuids ?? [];
  const firstKept = after.find((r) => r.uuid === kept[0]);
  check(
    "the kept rows start at the poem prompt",
    texts(firstKept).includes(POEM),
    `${kept.length} rows kept, first: ${texts(firstKept)[0]?.slice(0, 60)}`,
  );
  const log = join(process.env.DSH_OMC_STATE_DIR ?? "", "resume.log");
  console.log(
    `   resume.log: ${existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").slice(-3).join(" | ") : "none"}`,
  );

  const second = startClaude(true);
  const reply = await turn(second, RECALL);
  console.log(`   recall: ${reply.replace(/\s+/g, " ").slice(0, 300)}`);
  second.child.stdin.end();
  await second.done;
  const resumed = rows();
  // The resumed process makes one request, the recall: the last one the transcript logs.
  const request = resumed.findLast((r) => r.type === "api-request");
  const blobs = new Map(resumed.map((r) => [r.hash, r]));
  const sent = (request?.tail ?? []).flatMap((h) => texts(blobs.get(h)));
  check(
    "the resumed request carries the kept turns verbatim",
    [POEM, TOOL, CODEWORD].every((t) => sent.includes(t)) && !sent.includes(FIRST),
    `${sent.length} text blocks; first exchange left to the summary: ${!sent.includes(FIRST)}`,
  );
} finally {
  if (!first.ended()) first.child.kill("SIGTERM");
  if (!keep) {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(join(homedir(), ".claude", "projects", projectDirName(cwd)), {
      recursive: true,
      force: true,
    });
  } else console.log(`kept ${cwd} and ${transcript}`);
}
console.log(`\n${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
