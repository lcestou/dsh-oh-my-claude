#!/usr/bin/env bun
// Live check: dsh's compaction of a Claude session is answered by Claude Code's own `/compact`
// (`cliCompaction`), on a real dsh and a real `claude`.
//
// The offline suite fakes both. This links the checkout into dsh's `acp` profile, where one dsh
// process serves several turns over stdio, so what happens after a turn can be watched. Each
// scenario gets throwaway DSH_HOME, DSH_OMC_STATE_DIR and cwd directories and runs on
// claude-haiku-4-5 with compaction-basic's threshold lowered. A prompt carrying a long log pushes
// the context past it: a user message, which dsh's tool-result pruner leaves alone.
//   s1  crossed in a turn's last step: a later turn's start runs /compact once
//   s2  crossed mid-turn (a dsh tool call splits the turn): refused, compacted once idle
//   s3  Claude Code's own threshold comes first: its summary reaches dsh's copy, no model call
//   s4  a Claude model picked before the turn that compacts: /compact, the switch goes through
//   s5  deepseek-flash picked: dsh's one-shot summarizer, the CLI left alone
//   s6  a Claude model picked whose threshold only the switch itself crosses (dsh 0.2.2 prices a
//       switch): /compact, the switch goes through
//   s7  a forked subagent crosses: nothing runs on it once idle, so it settles at once; woken
//       again, its turn's start runs /compact once
//   s8  the same for a team member, on a dsh with the experimental agent-team bundle
//   s9  a forked subagent inherits a parent past the threshold: one-shot before its CLI starts
// s2, s7, s8 and s9 mount a web server, the session controller and what it needs, so the plugin's MCP
// bridge comes up and Claude can call dsh tools. It spends tokens, on haiku and in s4 and s6 on
// sonnet. dsh loads `lib/`, so run `bun run build` first.
//
//   bun tools/cli-compaction-check.ts [--dsh desktop|<bin.js or executable>] [--only s1,s3] [--keep]
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compactSummaryOf } from "../src/compact-summary.js";
import { claudeSessionId, projectDirName } from "../src/adapter/transcript-watch.js";
import type { SessionEvent } from "../src/dsh.js";
import { readKeeperInfo } from "../src/process.js";

const REPO = resolve(import.meta.dirname, "..");
const DESKTOP_DSH = "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh";
const MODEL = "claude-haiku-4-5";
const SONNET = "claude-sonnet-5-5";
const WINDOW = 200_000;
const TEAM_BUNDLE = "@deepseek-ai/dsh-experimental-agent-team-profile";

const args = process.argv.slice(2);
/** The word after `name` on the command line, or undefined when the flag is not given. */
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dshArg = flag("--dsh") ?? "dsh";
const dshPath = dshArg === "desktop" ? DESKTOP_DSH : dshArg;
const dshCommand = dshPath.endsWith(".js") ? ["node", dshPath] : [dshPath];
const only = flag("--only")?.split(",");
const keep = args.includes("--keep");

let failed = 0;
let inconclusive = 0;
/** Print one line and count it when the expectation does not hold. */
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
};
/** A precondition the run did not reach: no verdict on what depends on it. */
const unmet = (label: string, detail: string) => {
  inconclusive++;
  console.log(`INCONCLUSIVE  ${label}  ${detail}`);
};

/** The launching environment pared down to what dsh and the CLI need. Run from inside a Claude
 *  Code session, the rest (its session id, messaging socket, child-session switches) reaches the
 *  CLI dsh spawns and makes it a child of that session. */
const BASE_ENV: Record<string, string> = Object.fromEntries(
  ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM"]
    .concat(
      ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"].flatMap((k) => [k, k.toLowerCase()]),
    )
    .flatMap((k) => {
      const v = process.env[k];
      return v === undefined ? [] : [[k, v]];
    }),
);

const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima".split(" ");
/** `count` lines of rotating words, about 25 tokens each. */
function lines(count: number, tag: string): string {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const row: string[] = [];
    for (let j = 0; j < WORDS.length; j++) row.push(WORDS[(i + j) % WORDS.length]!);
    out.push(`${tag} line ${i}: ${row.join(" ")}`);
  }
  return out.join("\n");
}

/** A prompt of about 80,000 tokens: past the 80,000 threshold with Claude Code's own prompt
 *  added, under the 134,464 a 0.9 ratio leaves on a 200k window. */
const BIG = `Here is a log for reference only; do not summarize it.\n${lines(3200, "log")}\n`;
/** About 25,000 tokens: a parent a forked child inherits from stays under the threshold. */
const MEDIUM = `Here is a log for reference only; do not summarize it.\n${lines(1000, "log")}\n`;

/** Three files of about 20,000 tokens each: under the Read tool's per-file cap. */
function writeReading(cwd: string) {
  for (const part of [1, 2, 3])
    writeFileSync(join(cwd, `part${part}.txt`), `${lines(1500, `part ${part}`)}\n`);
}

/** A loopback port free a moment ago, for the web server a scenario mounts. */
const freePort = () =>
  new Promise<number>((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      // SAFETY: a server listening on a TCP host answers its AddressInfo
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });

/** dsh's `acp` profile under `home`, with this checkout and `bundles` among its bundles. */
function linkProfile(home: string, env: NodeJS.ProcessEnv, bundles: string[]) {
  execFileSync(dshCommand[0]!, [...dshCommand.slice(1), "--profile", "acp", "--dump-config"], {
    env,
    stdio: "ignore",
  });
  const profile = join(home, "profiles", "acp");
  const manifestPath = join(profile, "package.json");
  // SAFETY: the profile manifest dsh just wrote; only `dsh.profile.bundles` is touched
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    dsh: { profile: { bundles: string[] } };
  };
  manifest.dsh.profile.bundles.push(...bundles, "dsh-oh-my-claude");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  mkdirSync(join(profile, "node_modules"), { recursive: true });
  symlinkSync(REPO, join(profile, "node_modules", "dsh-oh-my-claude"));
  if (bundles.length === 0) return;
  try {
    execFileSync(dshCommand[0]!, [...dshCommand.slice(1), "--profile", "acp", "--dump-config"], {
      env,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`the acp profile does not load with bundle ${bundles.join(", ")}`);
  }
}

/** A model a scenario switches to, with compaction-basic's threshold ratio for it. */
type Target = { provider: string; model: string; ratio: number };

/** One compaction-basic `modelPolicies` entry, as patch lines. */
const policy = (provider: string, model: string, ratio: number) => [
  `      - provider: ${provider}`,
  `        model: ${model}`,
  `        thresholdRatio: ${ratio}`,
  "        retainTokens: 2000",
];

/** The `--patch` overlay: the model, compaction-basic's threshold for it and for `targets`, and,
 *  with `webPort`, the web server and session controller the plugin's MCP bridge mounts on. */
function patchFile(
  root: string,
  ratio: number,
  targets: Target[],
  webPort?: number,
  disallow: string[] = [],
) {
  // The acp entry picks its sessions' model itself, ahead of agent-default-model.
  const out = [
    "- id: acp",
    "  config:",
    "    provider: claude-code",
    `    model: ${MODEL}`,
    "- id: agent-default-model",
    "  config:",
    "    provider: claude-code",
    `    model: ${MODEL}`,
    "- id: compaction-basic",
    "  config:",
    "    modelPolicies:",
    ...policy("claude-code", MODEL, ratio),
    ...targets.flatMap((t) => policy(t.provider, t.model, t.ratio)),
  ];
  if (disallow.length > 0)
    out.push("- id: oh-my-claude", "  config:", `    disallowedTools: [${disallow.join(", ")}]`);
  if (webPort !== undefined)
    out.push(
      "- insert:",
      "    - id: workspace",
      "      name: '@deepseek-ai/dsh-workspace'",
      "    - id: connection",
      "      name: '@deepseek-ai/dsh-client-connection'",
      "    - id: file-upload",
      "      name: '@deepseek-ai/dsh-client-file-upload'",
      "    - id: session-controller",
      "      name: '@deepseek-ai/dsh-api-session-controller'",
      "    - id: webserver",
      "      name: '@deepseek-ai/dsh-host-webserver'",
      "      config:",
      "        host: 127.0.0.1",
      `        port: ${webPort}`,
    );
  const path = join(root, "patch.yml");
  writeFileSync(path, `${out.join("\n")}\n`);
  return path;
}

/** The fields of an ACP answer this script reads: `session/new`'s id, `session/prompt`'s reason. */
type Answer = { sessionId?: string; stopReason?: string };
type Rpc = {
  id?: number;
  method?: string;
  params?: { options?: { optionId: string; kind?: string }[] };
  result?: Answer;
  error?: { message?: string };
};

/** A minimal Agent Client Protocol client over the dsh process's stdio. */
class Acp {
  child: ChildProcess;
  next = 1;
  waiting = new Map<number, { done: (r: Answer) => void; fail: (e: Error) => void }>();
  /** Start dsh's `acp` profile with `patch` laid over it; its stderr is kept in `stderrFile`. */
  constructor(env: NodeJS.ProcessEnv, patch: string, stderrFile: string) {
    this.child = spawn(
      dshCommand[0]!,
      [...dshCommand.slice(1), "--profile", "acp", "--patch", patch],
      { env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let errors = "";
    this.child.stderr?.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
      writeFileSync(stderrFile, errors);
    });
    let buffered = "";
    this.child.stdout?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
        const line = buffered.slice(0, at);
        buffered = buffered.slice(at + 1);
        if (line.trim()) this.receive(line);
      }
    });
  }

  /** One line from dsh: an answer to a request of ours, or a request of its own. A permission
   *  prompt is allowed, since the scenarios only read; anything else is refused. */
  receive(line: string) {
    let msg: Rpc;
    try {
      // SAFETY: a JSON-RPC line from dsh's ACP server; each field read is checked below
      msg = JSON.parse(line) as Rpc;
    } catch {
      return;
    }
    if (msg.method === undefined && msg.id !== undefined) {
      const waiter = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      if (msg.error) waiter?.fail(new Error(JSON.stringify(msg.error)));
      else waiter?.done(msg.result ?? {});
      return;
    }
    if (msg.method === "session/request_permission" && msg.id !== undefined) {
      const allow = msg.params?.options?.find((o) => o.kind?.startsWith("allow"));
      const outcome = allow
        ? { outcome: "selected", optionId: allow.optionId }
        : { outcome: "cancelled" };
      this.send({ jsonrpc: "2.0", id: msg.id, result: { outcome } });
    } else if (msg.id !== undefined) {
      this.send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported" } });
    }
  }

  /** Write one JSON-RPC message as a line on dsh's stdin. */
  send(msg: object) {
    this.child.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  /** Send a request and wait for its answer; rejects on an error answer or after `timeoutMs`. */
  request(method: string, params: object, timeoutMs = 600_000): Promise<Answer> {
    const id = this.next++;
    return new Promise((done, fail) => {
      const timer = setTimeout(
        () => fail(new Error(`${method}: no answer in ${timeoutMs} ms`)),
        timeoutMs,
      );
      this.waiting.set(id, {
        done: (r) => {
          clearTimeout(timer);
          done(r);
        },
        fail: (e) => {
          clearTimeout(timer);
          fail(new Error(`${method}: ${e.message}`));
        },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Hang up: dsh serves ACP until the client disconnects, then flushes and exits. */
  async close() {
    this.child.stdin?.end();
    const exited = new Promise<void>((done) => this.child.once("exit", () => done()));
    const timedOut = new Promise<boolean>((done) => setTimeout(() => done(true), 20_000));
    if ((await Promise.race([exited.then(() => false), timedOut])) === true) this.child.kill();
  }
}

/** One line of a dsh session log; the first one is the header, whose fields are its own. */
type Event = Pick<SessionEvent, "type" | "seq" | "time" | "data"> & {
  origin?: string;
  parentSession?: string;
};

/** Every session log under `home`, by session id. Read while dsh runs too, so a log it is still
 *  writing reads as far as it got, or not at all. */
function sessionLogs(home: string): Map<string, Event[]> {
  const out = new Map<string, Event[]>();
  const root = join(home, "sessions");
  for (const group of existsSync(root) ? readdirSync(root) : [])
    for (const id of readdirSync(join(root, group))) {
      const dir = join(root, group, id);
      const file = readdirSync(dir).find((f) => f.startsWith("session") && f.includes(".jsonl"));
      if (!file) continue;
      const path = join(dir, file);
      try {
        const text = path.endsWith(".zstd")
          ? execFileSync("zstd", ["-dc", path], { stdio: ["ignore", "pipe", "ignore"] }).toString()
          : readFileSync(path, "utf8");
        const events: Event[] = [];
        for (const l of text.split("\n").filter(Boolean))
          // SAFETY: dsh's own session log, one event object per line; the header has no data
          events.push({ data: {}, ...(JSON.parse(l) as Partial<Event>) } as Event);
        out.set(id, events);
      } catch {}
    }
  return out;
}

/** The prompt size each step reported, by turn, the way dsh's token meter reads it. */
function promptsByTurn(events: Event[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const e of events) {
    if (e.type !== "assistant/message") continue;
    // SAFETY: an assistant/message payload; its usage counters are numbers dsh normalized
    const data = e.data as {
      usage?: Record<string, number>;
      message?: { usage?: Record<string, number> };
    };
    const usage = data.usage ?? data.message?.usage;
    if (!usage) continue;
    const prompt =
      (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    const turn = Number(e.data.turn);
    out.set(turn, [...(out.get(turn) ?? []), prompt]);
  }
  return out;
}

/** The largest prompt `turn` reported, 0 when it reported none. */
const peak = (events: Event[], turn: number | undefined) =>
  Math.max(0, ...(promptsByTurn(events).get(turn ?? -1) ?? []));

type Compaction = {
  turn: number | null;
  seq: number;
  time: number;
  error?: string;
  summary?: string;
};

/** Every compaction dsh opened, with the turn that owned it (null for one run while idle). */
function compactions(events: Event[]): Compaction[] {
  const byId = new Map<string, Compaction>();
  for (const e of events) {
    const id = String(e.data.compactionId ?? "");
    if (e.type === "compaction/start")
      byId.set(id, {
        turn: e.data.turn === null ? null : Number(e.data.turn),
        seq: e.seq,
        time: e.time,
      });
    const c = byId.get(id);
    if (!c) continue;
    if (e.type === "compaction/summary") {
      // SAFETY: the summary blocks dsh recorded; only their text is joined
      const blocks = e.data.summary as { text?: string }[];
      c.summary = blocks.map((b) => b.text ?? "").join("");
    }
    if (e.type === "compaction/end" && e.data.error !== undefined)
      c.error = JSON.stringify(e.data.error);
  }
  return [...byId.values()];
}

/** Compactions as one line each, for a failure's detail. */
const shown = (all: Compaction[]) =>
  JSON.stringify(all.map((c) => ({ turn: c.turn, error: c.error?.slice(0, 80) })));

/** The turn numbers in the order they opened. */
const turnsOf = (events: Event[]) =>
  events.filter((e) => e.type === "turn/start").map((e) => Number(e.data.turn));

/** When `turn` ended, or undefined while it runs. */
const turnEnd = (events: Event[], turn: number) =>
  events.find((e) => e.type === "turn/end" && Number(e.data.turn) === turn);

/** The models the requests inside `turn` ran on, from the request headers it wrote. */
function modelsIn(events: Event[], turn: number): string[] {
  const start = events.find((e) => e.type === "turn/start" && Number(e.data.turn) === turn)?.seq;
  const end = turnEnd(events, turn)?.seq ?? Infinity;
  if (start === undefined) return [];
  return events
    .filter((e) => e.type === "request/header" && e.seq > start && e.seq < end)
    .map((e) => {
      // SAFETY: a request/header payload; the model is read as a string or left out
      const header = e.data.header as { config?: { model?: string } } | undefined;
      return header?.config?.model ?? "";
    });
}

/** The newest summary Claude Code wrote for this dsh session: from its own transcript, else from
 *  any under the cwd, since a compaction can carry a session on in a transcript of its own. */
function cliSummary(cwd: string, sessionId: string): string | undefined {
  const dir = join(homedir(), ".claude", "projects", projectDirName(cwd));
  if (!existsSync(dir)) return undefined;
  const own = join(dir, `${claudeSessionId(sessionId)}.jsonl`);
  let found = existsSync(own) ? compactSummaryOf(readFileSync(own, "utf8")) : undefined;
  if (found !== undefined) return found;
  for (const path of readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .toSorted((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs))
    found = compactSummaryOf(readFileSync(path, "utf8")) ?? found;
  return found;
}

/** The keepers this scenario's plugin started, each with its own and its Claude's pid. */
const keeperPids = (state: string) => {
  const root = join(state, "keepers");
  const dirs = existsSync(root) ? readdirSync(root).map((d) => join(root, d)) : [];
  return dirs.flatMap((d) => {
    const info = readKeeperInfo(d);
    return info ? [info] : [];
  });
};

/** Lines resume.log holds for this session's compactions. */
const routeLog = (state: string, sessionId: string) =>
  (existsSync(join(state, "resume.log")) ? readFileSync(join(state, "resume.log"), "utf8") : "")
    .split("\n")
    .filter((l) => l.includes(`compaction ${sessionId}:`));
/** How many of `log`'s lines mention `what`. */
const count = (log: string[], what: string) => log.filter((l) => l.includes(what)).length;

/** Whether a process with this pid still runs. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Poll `test` every 2 s for up to `ms`; resolves to its last answer. */
const waitFor = async (test: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 2000));
  return test();
};

type Run = {
  sessionId: string;
  state: string;
  home: string;
  /** Send a prompt and wait for its turn; resolves to its stop reason or the error dsh answered. */
  prompt: (text: string) => Promise<string>;
  /** Pick another model the way dsh's model picker does, through ACP's config option. */
  switchTo: (provider: string, model: string) => Promise<void>;
};
type Verify = {
  events: Event[];
  logs: Map<string, Event[]>;
  log: string[];
  state: string;
  cwd: string;
  sessionId: string;
  threshold: number;
  /** What each prompt ended with, in order. */
  ends: string[];
};
type Scenario = {
  name: string;
  /** compaction-basic's thresholdRatio for haiku on its 200k window, capped at 134,464 by the
   *  65,536-token headroom. 0.4 puts it at 80,000: over what the CLI keeps after a /compact
   *  (about 43,000 on haiku), under a prompt carrying BIG. */
  ratio: number;
  targets?: Target[];
  /** Mount what the plugin's MCP bridge needs, so Claude can call dsh tools. */
  bridge?: boolean;
  /** Extra profile bundles; a dsh that does not ship one cannot run the scenario. */
  bundles?: string[];
  /** Claude Code tools the plugin keeps from the CLI (its `disallowedTools`). */
  disallow?: string[];
  /** Extra environment for dsh and the CLI it spawns. */
  env?: Record<string, string>;
  /** Whether the session keeps one Claude process throughout; a model switch may respawn it. */
  oneProcess?: boolean;
  steps: (run: Run) => Promise<void>;
  verify: (v: Verify) => void;
};

const READ_ALL =
  "Use your Read tool to read part1.txt, part2.txt and part3.txt in the current directory, each in full.";
const OK = "Reply with exactly: OK";
const BIG_OK = `${BIG}Reply with exactly: OK`;

/** The checks a turn-start /compact must pass in `turn`: one /compact, any second ask refused,
 *  dsh holding the CLI's summary or finding its span smaller, the prompt after it compacted. */
function turnStartCompaction(
  name: string,
  v: Verify,
  session: { id: string; events: Event[]; log: string[] },
  turn: number,
) {
  const { events, log } = session;
  const all = compactions(events);
  const here = all.filter((c) => c.turn === turn);
  const done = here.filter((c) => c.error === undefined);
  check(`${name} one /compact on the CLI`, count(log, "ran /compact") === 1, log.join(" | "));
  check(`${name} no one-shot`, count(log, "one-shot") === 0, log.join(" | "));
  check(`${name} compacted at turn ${turn}'s start`, here.length > 0, shown(all));
  // After the pruner, the span dsh asks to replace can be smaller than a summary of the whole
  // conversation, and dsh turns the summary down; the CLI is compacted either way.
  check(
    `${name} dsh holds the CLI's summary, or found its span smaller`,
    done.length === 1
      ? done[0]!.summary?.trim() === cliSummary(v.cwd, session.id)?.trim()
      : done.length === 0 && here.some((c) => c.error?.includes("not smaller")),
    shown(all),
  );
  check(
    `${name} asking again in the same check was refused`,
    here.slice(1).every((c) => c.error?.includes("already")),
    shown(all),
  );
  const after = promptsByTurn(events).get(turn) ?? [];
  check(
    `${name} the CLI's prompt is compacted`,
    after.length > 0 && after.every((p) => p < v.threshold),
    `${after}`,
  );
}

/** The child session a parent spawned, with its own id, or undefined when there is none. */
function childOf(logs: Map<string, Event[]>, parent: string) {
  return [...logs.entries()].find(
    ([, events]) => events[0]?.origin === "subagent" && events[0]?.parentSession === parent,
  );
}

/** The turns a session ran itself: a forked child's log opens with the parent's turns it
 *  inherited, up to dsh's `session/end-seed` marker. */
function ownTurns(events: Event[]): number[] {
  const seed = events.find((e) => e.type === "session/end-seed")?.seq ?? -1;
  return events
    .filter((e) => e.type === "turn/start" && e.seq > seed)
    .map((e) => Number(e.data.turn));
}

/** Claude Code's own subagent tools: kept from the CLI so the model spawns dsh's children. */
const OWN_AGENTS = ["Agent", "Task", "SendMessage"];

/** s7 and s8: a forked child (a subagent, or a team member) crosses the threshold in its own turn,
 *  reading two files; `wake` sends it a second one. Its parent holds MEDIUM, under the threshold,
 *  so the child starts below it. */
function childScenario(
  name: string,
  spawnText: string,
  wakeText: string,
  bundles: string[] = [],
): Scenario {
  return {
    name,
    ratio: 0.4,
    bridge: true,
    bundles,
    disallow: OWN_AGENTS,
    oneProcess: false,
    steps: async ({ prompt, home, sessionId }) => {
      await prompt(`${MEDIUM}Reply with exactly: OK`);
      await prompt(spawnText);
      const ownTurnEnded = (n: number) => () => {
        const child = childOf(sessionLogs(home), sessionId)?.[1] ?? [];
        const own = ownTurns(child)[n];
        return own !== undefined && turnEnd(child, own) !== undefined;
      };
      await waitFor(ownTurnEnded(0), 300_000);
      // Give dsh's settlement and the parent's notice a moment to land in the logs.
      await new Promise((r) => setTimeout(r, 10_000));
      // dsh's tool-result pruner can meet its stale figure for a turn first (the child crossed by
      // reading files), so a second wake gives the compaction its turn.
      for (const n of [1, 2]) {
        await prompt(wakeText);
        await waitFor(ownTurnEnded(n), 300_000);
        if (compactions(childOf(sessionLogs(home), sessionId)?.[1] ?? []).length > 0) break;
      }
    },
    verify: (v) => {
      const entry = childOf(v.logs, v.sessionId);
      if (!entry) return unmet(`${name} child`, "no child session of the parent");
      const [childId, child] = entry;
      const childLog = routeLog(v.state, childId);
      const [own1, ...woken] = ownTurns(child);
      if (own1 === undefined) return unmet(`${name} child ran`, "the child ran no turn");
      if (peak(child, own1) < v.threshold)
        return unmet(`${name} child crossing`, `its first turn peaked at ${peak(child, own1)}`);
      const all = compactions(child);
      const end1 = turnEnd(child, own1);
      check(
        `${name} nothing ran on the child in or after its first turn`,
        all.every((c) => c.turn !== null && c.turn !== own1 && c.seq > (end1?.seq ?? 0)),
        shown(all),
      );
      const notice = v.events.find(
        (e) => sourceKind(e) === "subagent-settled" && e.time >= (end1?.time ?? 0),
      );
      const lag = notice ? notice.time - (end1?.time ?? 0) : Infinity;
      check(`${name} the parent heard at once`, lag < 15_000, `${lag} ms after the child's turn`);
      const at = all[0]?.turn;
      if (woken.length === 0)
        return unmet(
          `${name} child woken`,
          "no message reached the child: this dsh may not load tool-subagent-control's send_message",
        );
      if (at === undefined || at === null)
        return unmet(`${name} child compacted`, `no compaction in ${woken.length} woken turns`);
      check(
        `${name} compacted at a woken turn's start`,
        woken.slice(0, 2).includes(at),
        shown(all),
      );
      turnStartCompaction(name, v, { id: childId, events: child, log: childLog }, at);
    },
  };
}

/** The `kind` of a message's source, for a user/message event. */
function sourceKind(e: Event): string | undefined {
  if (e.type !== "user/message") return undefined;
  // SAFETY: a user/message payload; the source kind is read as a string or left out
  const source = (e.data.source ?? (e.data.message as { source?: unknown })?.source) as
    | { kind?: string }
    | undefined;
  return source?.kind;
}

const SCENARIOS: Scenario[] = [
  {
    name: "s1",
    ratio: 0.4,
    steps: async ({ prompt }) => {
      await prompt(BIG_OK);
      for (let i = 0; i < 2; i++) await prompt(OK);
    },
    verify: (v) => {
      const [t1, t2] = turnsOf(v.events);
      if (peak(v.events, t1) < v.threshold)
        return unmet("s1 crossing", `turn 1 peaked at ${peak(v.events, t1)}`);
      turnStartCompaction("s1", v, { id: v.sessionId, events: v.events, log: v.log }, t2!);
    },
  },
  {
    name: "s2",
    ratio: 0.4,
    bridge: true,
    steps: async ({ prompt, state, sessionId }) => {
      await prompt(OK);
      await prompt(
        `${BIG}Call the mcp__dsh__job_list tool exactly once. Then reply with exactly: OK`,
      );
      await waitFor(() => count(routeLog(state, sessionId), "ran /compact") > 0, 300_000);
      await prompt(OK);
    },
    verify: (v) => {
      const [t1, t2, t3] = turnsOf(v.events);
      const steps2 = promptsByTurn(v.events).get(t2!) ?? [];
      if (peak(v.events, t1) >= v.threshold)
        return unmet("s2 start below", `turn 1 already at ${peak(v.events, t1)}`);
      if (steps2.length < 2 || steps2[0]! < v.threshold)
        return unmet("s2 mid-turn crossing", `turn 2 steps reported ${steps2}`);
      const all = compactions(v.events);
      const end2 = turnEnd(v.events, t2!)?.seq ?? Infinity;
      const idle = all.filter((c) => c.turn === null && c.seq > end2);
      check(
        "s2 refused mid-turn and owed",
        all.some((c) => c.turn === t2 && c.error?.includes("mid-turn")) &&
          count(v.log, "owed until idle") > 0,
        v.log.join(" | "),
      );
      check(
        "s2 compacted once idle",
        idle.length === 1 && count(v.log, "ran /compact") === 1,
        shown(all),
      );
      check(
        "s2 dsh holds the CLI's summary",
        idle[0]?.error === undefined &&
          idle[0]?.summary?.trim() === cliSummary(v.cwd, v.sessionId)?.trim(),
        shown(all),
      );
      check("s2 no one-shot", count(v.log, "one-shot") === 0, "");
      check(
        "s2 turn 3 compacts nothing",
        !all.some((c) => c.turn === t3 && c.error === undefined),
        shown(all),
      );
      const after = promptsByTurn(v.events).get(t3!) ?? [];
      check(
        "s2 the CLI's prompt is compacted",
        after.every((p) => p < v.threshold),
        `${after}`,
      );
    },
  },
  {
    name: "s3",
    ratio: 0.4,
    // A 100,000-token auto-compact window puts Claude Code's threshold near 67,000 (the window less
    // its output and summary reserves): under dsh's 80,000, over what it keeps after compacting.
    // CLAUDE_AUTOCOMPACT_PCT_OVERRIDE did not take on 2.1.316 under stream-json.
    env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000" },
    steps: async ({ prompt, state, sessionId }) => {
      await prompt(`${READ_ALL} Then reply with only the last line of part3.txt.`);
      await waitFor(() => count(routeLog(state, sessionId), "reused") > 0, 120_000);
      await prompt(OK);
    },
    verify: (v) => {
      const cli = cliSummary(v.cwd, v.sessionId);
      if (cli === undefined || count(v.log, "ran /compact") > 0)
        return unmet(
          "s3 Claude Code compacted first",
          `dsh's threshold came first or nothing compacted: ${v.log.join(" | ") || "no compaction"}`,
        );
      const all = compactions(v.events);
      const idle = all.filter((c) => c.turn === null && c.error === undefined);
      check("s3 reused the CLI's own compaction", count(v.log, "reused") > 0, v.log.join(" | "));
      check(
        "s3 dsh holds the CLI's summary",
        idle.length === 1 && idle[0]!.summary?.trim() === cli.trim(),
        shown(all),
      );
      check(
        "s3 dsh's own check never fired",
        all.every((c) => c.turn === null),
        "",
      );
      check("s3 no one-shot", count(v.log, "one-shot") === 0, "");
    },
  },
  {
    name: "s4",
    ratio: 0.4,
    oneProcess: false,
    steps: async ({ prompt, switchTo }) => {
      await prompt(BIG_OK);
      await switchTo("claude-code", SONNET);
      await prompt(OK);
    },
    verify: (v) => {
      const [t1, t2] = turnsOf(v.events);
      if (peak(v.events, t1) < v.threshold)
        return unmet("s4 crossing", `turn 1 peaked at ${peak(v.events, t1)}`);
      const all = compactions(v.events);
      check("s4 the switched turn completed", v.ends[1] === "end_turn", v.ends.join(" | "));
      check(
        "s4 it ran on sonnet",
        modelsIn(v.events, t2!).includes(SONNET),
        `${modelsIn(v.events, t2!)}`,
      );
      check("s4 one /compact on the CLI", count(v.log, "ran /compact") === 1, v.log.join(" | "));
      // A second ask in the same check meets a pick still pending: the one-shot keeps a switch
      // from failing on a refused compaction.
      check(
        "s4 nothing refused while a pick waits",
        count(v.log, "refused") === 0 &&
          v.log.every((l) => !l.includes("one-shot") || l.includes("model switch pending")),
        v.log.join(" | "),
      );
      check(
        "s4 compacted at turn 2's start",
        all.some((c) => c.turn === t2),
        shown(all),
      );
    },
  },
  {
    name: "s5",
    ratio: 0.4,
    // Lists deepseek-flash among the models; its own request then fails on the key, after the
    // compaction this scenario is about.
    env: { DEEPSEEK_API_KEY: "sk-dummy-for-the-live-check" },
    steps: async ({ prompt, switchTo }) => {
      await prompt(BIG_OK);
      await switchTo("deepseek-official", "deepseek-flash");
      await prompt(OK);
    },
    verify: (v) => {
      const [t1] = turnsOf(v.events);
      if (peak(v.events, t1) < v.threshold)
        return unmet("s5 crossing", `turn 1 peaked at ${peak(v.events, t1)}`);
      if (v.log.length === 0) return unmet("s5 compaction asked for", "dsh asked for none");
      check("s5 nothing refused", count(v.log, "refused") === 0, v.log.join(" | "));
      check("s5 at most one /compact", count(v.log, "ran /compact") <= 1, v.log.join(" | "));
      check(
        "s5 the switch did not fail on compaction",
        !/Cannot switch|compaction failed/.test(v.ends[1] ?? ""),
        v.ends.join(" | "),
      );
      // The plugin sees a switch by the `model/selection` dsh writes for a pick, which DSH Desktop's
      // model picker does. An ACP client's pick lives in the bridge until the next request, so the
      // compaction ahead of it reads as one on Claude.
      if (!v.events.some((e) => e.type === "model/selection"))
        return unmet(
          "s5 the one-shot summarizer answered",
          `the ACP pick wrote no model/selection, so the switch was not visible: ${v.log.join(" | ")}`,
        );
      check(
        "s5 the one-shot summarizer answered",
        count(v.log, "one-shot, switching to deepseek-official") > 0 &&
          count(v.log, "ran /compact") === 0,
        v.log.join(" | "),
      );
    },
  },
  {
    name: "s6",
    // 0.9 caps at 134,464: a prompt carrying BIG stays under it, so the turn's own check passes.
    // Sonnet's threshold, 50,000 on its 1M window, is crossed only by pricing the switch.
    ratio: 0.9,
    targets: [{ provider: "claude-code", model: SONNET, ratio: 0.05 }],
    oneProcess: false,
    steps: async ({ prompt, switchTo }) => {
      await prompt(BIG_OK);
      await switchTo("claude-code", SONNET);
      await prompt(OK);
    },
    verify: (v) => {
      const [, t2] = turnsOf(v.events);
      check("s6 the switched turn completed", v.ends[1] === "end_turn", v.ends.join(" | "));
      check(
        "s6 it ran on sonnet",
        modelsIn(v.events, t2!).includes(SONNET),
        `${modelsIn(v.events, t2!)}`,
      );
      if (v.log.length === 0)
        return unmet("s6 compaction at the switch", "dsh priced no switch: rc.5 has no such hook");
      check("s6 one /compact on the CLI", count(v.log, "ran /compact") === 1, v.log.join(" | "));
      check("s6 nothing refused", count(v.log, "refused") === 0, v.log.join(" | "));
    },
  },
  childScenario(
    "s7",
    'Call the mcp__dsh__subagent_fork tool exactly once with description "fork check" and prompt "Use your Read tool to read part1.txt and part2.txt in the current directory, each in full. Then reply with exactly: DONE". Do not wait for it and call no other tool. Then reply with exactly: OK',
    'Call the mcp__dsh__send_message tool exactly once: agent_id is the id of the subagent you forked, message is "Reply with exactly: AGAIN". Call no other tool. Then reply with exactly: OK',
  ),
  childScenario(
    "s8",
    'Call the mcp__dsh__spawn_teammate tool exactly once with name "checker", description "compaction check", context "fork" and prompt "Use your Read tool to read part1.txt and part2.txt in the current directory, each in full. Then reply with exactly: DONE". Call no other tool. Then reply with exactly: OK',
    'Call the mcp__dsh__send_message tool exactly once with target "checker" and message "Reply with exactly: AGAIN". Call no other tool. Then reply with exactly: OK',
    [TEAM_BUNDLE],
  ),
  {
    // A forked child inherits a parent past the threshold: dsh compacts that history before the
    // child's first request, when it has no CLI to compact, so the one-shot summarizer answers and
    // the child's CLI starts from the summary.
    name: "s9",
    ratio: 0.4,
    bridge: true,
    disallow: OWN_AGENTS,
    oneProcess: false,
    steps: async ({ prompt, home, sessionId }) => {
      await prompt(BIG_OK);
      await prompt(
        'Call the mcp__dsh__subagent_fork tool exactly once with description "fork check" and prompt "Reply with exactly: DONE". Do not wait for it and call no other tool. Then reply with exactly: OK',
      );
      await waitFor(() => {
        const child = childOf(sessionLogs(home), sessionId)?.[1] ?? [];
        const own = ownTurns(child)[0];
        return own !== undefined && turnEnd(child, own) !== undefined;
      }, 300_000);
    },
    verify: (v) => {
      const entry = childOf(v.logs, v.sessionId);
      if (!entry) return unmet("s9 child", "no child session of the parent");
      const [childId, child] = entry;
      const childLog = routeLog(v.state, childId);
      const [own1] = ownTurns(child);
      if (own1 === undefined) return unmet("s9 child ran", "the child ran no turn");
      const all = compactions(child);
      check(
        "s9 the inherited history was compacted at the child's first turn",
        all.some((c) => c.turn === own1 && c.error === undefined),
        shown(all),
      );
      check(
        "s9 by the one-shot summarizer, with no CLI yet",
        count(childLog, "one-shot, no live process or turn on record") > 0 &&
          count(childLog, "ran /compact") === 0,
        childLog.join(" | "),
      );
      const after = promptsByTurn(child).get(own1) ?? [];
      check(
        "s9 the child's CLI started from the summary",
        after.length > 0 && after.every((p) => p < v.threshold),
        `${after}`,
      );
    },
  },
];

/** One scenario in its own throwaway directories, cleaned up after, keepers and transcripts too. */
async function runScenario(s: Scenario) {
  // Short on purpose: the keeper's socket lives under the state dir, and macOS's tmpdir() is long
  // enough to push it past the 104-byte unix socket path limit.
  const root = mkdtempSync(
    join(process.platform === "win32" ? tmpdir() : "/tmp", `omc-${s.name}-`),
  );
  const home = join(root, "home");
  const state = join(root, "state");
  const cwd = join(root, "cwd");
  for (const d of [home, state, cwd]) mkdirSync(d);
  const realCwd = realpathSync(cwd);
  writeReading(realCwd);
  const env = { ...BASE_ENV, DSH_HOME: home, DSH_OMC_STATE_DIR: state, ...s.env };
  const threshold = Math.floor(Math.min(WINDOW * s.ratio, WINDOW - 65_536));
  console.log(`\n== ${s.name} (${root}), dsh threshold ${threshold}`);
  let acp: Acp | undefined;
  let sessionId = "";
  try {
    linkProfile(home, env, s.bundles ?? []);
    const patch = patchFile(
      root,
      s.ratio,
      s.targets ?? [],
      s.bridge ? await freePort() : undefined,
      s.disallow,
    );
    acp = new Acp(env, patch, join(root, "dsh.stderr"));
    await acp.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 120_000);
    // The plugin registers its adapter once the services it injects are up, a few seconds after
    // dsh answers `initialize`; until then dsh has no `claude-code` provider.
    const end = Date.now() + 60_000;
    while (!sessionId) {
      try {
        sessionId =
          (await acp.request("session/new", { cwd: realCwd, mcpServers: [] })).sessionId ?? "";
        if (!sessionId) throw new Error("session/new answered no session id");
      } catch (error) {
        if (Date.now() > end || !String(error).includes("no adapter registered")) throw error;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    const pids = new Set<number>();
    const ends: string[] = [];
    const client = acp;
    const prompt = async (text: string) => {
      const started = Date.now();
      let ended: string;
      try {
        const answer = await client.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text }],
        });
        ended = answer.stopReason ?? "";
      } catch (error) {
        ended = String(error);
      }
      ends.push(ended);
      for (const k of keeperPids(state)) pids.add(k.claudePid);
      const took = Math.round((Date.now() - started) / 1000);
      console.log(`   prompt done in ${took} s (${ended.slice(0, 80)}): ${text.slice(-60)}`);
      return ended;
    };
    const switchTo = async (provider: string, model: string) => {
      await client.request("session/set_config_option", {
        sessionId,
        configId: "model",
        value: JSON.stringify([provider, model]),
      });
      console.log(`   picked ${provider}/${model}`);
    };
    await s.steps({ sessionId, state, home, prompt, switchTo });
    await acp.close();
    acp = undefined;
    if (s.oneProcess !== false)
      check(`${s.name} one Claude process throughout`, pids.size === 1, `claude pids ${[...pids]}`);
    const logs = sessionLogs(home);
    s.verify({
      events: logs.get(sessionId) ?? [],
      logs,
      log: routeLog(state, sessionId),
      state,
      cwd: realCwd,
      sessionId,
      threshold,
      ends,
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    if (s.bundles?.length && /bundle|Cannot find|not found|ERR_MODULE/i.test(why))
      unmet(
        `${s.name} ran`,
        `this dsh does not ship ${s.bundles.join(", ")}: ${why.slice(0, 160)}`,
      );
    else check(`${s.name} ran`, false, `${why}; dsh stderr: ${join(root, "dsh.stderr")}`);
  } finally {
    await acp?.close();
    const pids = keeperPids(state).flatMap((k) => [k.pid, k.claudePid]);
    for (const pid of pids)
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    // Claude writes its transcript as it exits, which would bring the project directory back.
    await waitFor(() => !pids.some(alive), 10_000);
    // The one-shot summarizer runs from the plugin's scratch directory, `aux` under its state dir.
    for (const dir of [realCwd, join(realpathSync(state), "aux")])
      rmSync(join(homedir(), ".claude", "projects", projectDirName(dir)), {
        recursive: true,
        force: true,
      });
    if (!keep) rmSync(root, { recursive: true, force: true });
  }
}

const built = join(REPO, "lib", "server", "adapter", "class.js");
if (
  !existsSync(built) ||
  statSync(built).mtimeMs < statSync(join(REPO, "src", "adapter", "class.ts")).mtimeMs
) {
  console.error("lib/ is older than src/: run `bun run build` first, dsh loads lib/");
  process.exit(2);
}
console.log(`dsh: ${dshCommand.join(" ")}`);
for (const s of SCENARIOS) if (!only || only.includes(s.name)) await runScenario(s);
console.log(`\n${failed} failed, ${inconclusive} inconclusive`);
process.exit(failed > 0 ? 1 : 0);
