#!/usr/bin/env bun
// Live check: every flag the plugin would hand a `claude` binary is a flag that binary has.
//
// The offline suite fakes the CLI, so it cannot see a box whose `claude` is older than this PC's.
// That gap shipped twice: `--forward-subagent-text` went to a 2.1.123 binary that exits 1 on an
// unknown option, and the probe that should have caught it measured the local binary because the
// box was resolved from an empty sshHost. This runs against the real binaries.
//
//   bun tools/live-cli-check.ts                 # flag audit: local, plus every box a remote workspace names
//   bun tools/live-cli-check.ts lilly nova      # those hosts instead
//   bun tools/live-cli-check.ts --live          # also run one real `claude -p` turn per target (spends tokens)
//
// TypeScript, unlike its neighbours under `tools/`, because it is the one check that imports the
// plugin's own API: typed, a rename in `src/` fails `bun run typecheck` instead of this file quietly
// probing nothing.
//
// A host that cannot be reached is skipped, not failed; a mismatch is a failure.
import { execFile, spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Config, buildArgs, probeCli } from "../lib/server/adapter.js";
import { sshInvocation } from "../lib/server/process.js";
import { readRemoteWorkspaces } from "../lib/server/sessions.js";
import { readSshToken } from "../lib/server/ssh-login.js";
import { STATE_DIR } from "../lib/server/state.js";

/** The four counters the turn pill is built from. */
type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};
const COUNTERS = [
  "input_tokens",
  "output_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
] as const;

/** The CLI's own closing frame, the only one this check reads. */
type ResultFrame = {
  type: "result";
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  session_id?: string;
  usage?: Usage;
};
type TurnOutcome =
  | { result: ResultFrame; error?: undefined }
  | { error: string; result?: undefined };

const args = process.argv.slice(2);
const live = args.includes("--live");
const hostArgs = args.filter((a) => !a.startsWith("--"));

/** The boxes to check when none are named: whichever hosts the remote workspaces point at. */
async function knownHosts(): Promise<string[]> {
  const workspaces = await readRemoteWorkspaces(join(STATE_DIR, "remote-workspaces.json"));
  return [...new Set(workspaces.map((w) => w.host).filter(Boolean))];
}

/** One real turn through the flags just probed. Resolves to the CLI's own result frame.
 * A box runs it the way the plugin does — same ssh invocation, same stored login — so a token this
 * PC holds for the box is used there, rather than the check reporting the box as logged out. */
function runTurn(
  host: string | undefined,
  argv: string[],
  timeoutMs = 180000,
): Promise<TurnOutcome> {
  const inv = host
    ? sshInvocation(host, "claude", argv, process.cwd(), readSshToken(STATE_DIR, host))
    : { command: "claude", args: argv };
  return new Promise<TurnOutcome>((resolve) => {
    const child = spawn(inv.command, inv.args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ error: `no result frame in ${timeoutMs / 1000}s` });
    }, timeoutMs);
    child.stdout.on("data", (b) => (out += String(b)));
    child.stderr.on("data", (b) => (err += String(b)));
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = out
        .split("\n")
        .flatMap<ResultFrame>((l) => {
          try {
            // SAFETY: the caller keeps only frames whose `type` it recognises, so a line that
            // parses to something else is dropped one step later rather than trusted here.
            return [JSON.parse(l) as ResultFrame];
          } catch {
            return [];
          }
        })
        .find((f) => f.type === "result");
      if (!result)
        resolve({ error: `exit ${code}: ${err.trim().split("\n").pop() ?? "no output"}` });
      else resolve({ result });
    });
    child.stdin.end(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "Reply with the single word OK." }],
        },
      }) + "\n",
    );
  });
}

/**
 * The same turn's tokens as Claude Code's own transcript records them, summed over its assistant
 * messages.
 *
 * The transcript is written by a different path than the result frame the plugin forwards, so the
 * two agreeing is corroboration rather than one number repeated: the turn pill shows what the CLI
 * itself billed. Undefined when the transcript for that session is not on this box, which is every
 * remote host.
 */
async function transcriptUsage(sessionId: string): Promise<Usage | undefined> {
  const root = join(homedir(), ".claude", "projects");
  for (const project of await readdir(root).catch(() => [])) {
    const text = await readFile(join(root, project, `${sessionId}.jsonl`), "utf8").catch(
      () => undefined,
    );
    if (text === undefined) continue;
    // One assistant message is logged more than once; its id is what makes it a single sample.
    const byId = new Map<string, Usage>();
    for (const line of text.split("\n")) {
      try {
        // SAFETY: only the two shapes below are read off it, each through a typeof-checked sum.
        const entry = JSON.parse(line) as {
          type?: string;
          message?: { id?: string; usage?: Usage };
        };
        if (entry.type !== "assistant") continue;
        const { id, usage } = entry.message ?? {};
        if (id !== undefined && usage !== undefined) byId.set(id, usage);
      } catch {
        continue;
      }
    }
    const total: Usage = {};
    for (const key of COUNTERS)
      total[key] = [...byId.values()].reduce((sum, u) => sum + (u[key] ?? 0), 0);
    return total;
  }
  return undefined;
}

let failures = 0;
for (const host of ["", ...(hostArgs.length > 0 ? hostArgs : await knownHosts())]) {
  const name = host || "local";
  const { flags, version } = await probeCli(execFile, "claude", host || undefined);
  if (flags === null) {
    console.log(`skip ${name}: no answer from \`claude --help\``);
    continue;
  }
  // The turn a session spawns: stdin input, a session id, the MCP bridge and an appended prompt,
  // which is the widest flag set the plugin ever builds.
  const argv = buildArgs({
    model: undefined,
    config: Config({}),
    flags,
    session: { id: "00000000-0000-4000-8000-000000000000", resuming: false },
    system: "check",
    mcp: { url: "http://127.0.0.1:1/mcp", key: "k" },
  });
  const unknown = argv.filter((a) => a.startsWith("--") && !flags.has(a));
  if (unknown.length > 0) {
    console.log(`FAIL ${name} (${version}): ${unknown.join(" ")} not in this binary's --help`);
    failures++;
    continue;
  }
  console.log(
    `ok   ${name} (${version}): ${argv.filter((a) => a.startsWith("--")).length} flags accepted`,
  );
  if (!live) continue;
  // One real turn, with the bridge and the session id dropped: nothing here serves MCP, and a
  // fixed session id would collide on a second run.
  const turnArgs = buildArgs({ model: undefined, config: Config({}), flags });
  const { result, error } = await runTurn(host || undefined, turnArgs);
  if (error !== undefined || result.is_error) {
    console.log(`FAIL ${name}: turn failed: ${error ?? JSON.stringify(result).slice(0, 200)}`);
    failures++;
  } else {
    console.log(`ok   ${name}: turn ran, ${result.num_turns} turn(s), ${result.duration_ms}ms`);
    // The turn pill is this frame's `usage`, forwarded untouched. Corroborate it against the
    // transcript before trusting a number the whole cost readout is built on.
    const ledger =
      result.session_id === undefined ? undefined : await transcriptUsage(result.session_id);
    const frame = result.usage;
    if (ledger === undefined || frame === undefined) {
      console.log(`skip ${name}: no transcript on this box to check usage against`);
    } else {
      const off = COUNTERS.filter((k) => (frame[k] ?? 0) !== ledger[k]);
      if (off.length > 0) {
        const shown = off.map((k) => `${k} ${frame[k] ?? 0} vs ${ledger[k]}`).join(", ");
        console.log(`FAIL ${name}: result frame disagrees with its own transcript: ${shown}`);
        failures++;
      } else {
        const total = COUNTERS.reduce((sum, k) => sum + (frame[k] ?? 0), 0);
        console.log(`ok   ${name}: usage matches the transcript, ${total} tok over the turn`);
      }
    }
  }
}
process.exit(failures > 0 ? 1 : 0);
