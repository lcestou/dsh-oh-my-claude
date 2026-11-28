#!/usr/bin/env bun
// Live check: the plugin's own `retarget` changes the effort level of a real, running `claude`
// process without replacing it.
//
// The offline suite fakes the CLI's answers, so it cannot say whether the installed binary takes
// `apply_flag_settings`. This starts a real `claude -p` in a scratch directory, hands its pipes to
// the adapter as the process it would drive, and asks the adapter for each level in turn. After
// each one the level is read back from the CLI by this script, not by the adapter, and the pid is
// compared with the one it started with. Control requests only: no prompt is sent, so no model is
// called and nothing is spent.
//
//   DSH_OMC_STATE_DIR=$(mktemp -d) bun tools/effort-switch-check.ts [model]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, Config } from "../src/adapter.js";
import { appliedEffort, isClaudeEvent, toJsonValue } from "../src/process.js";
import type { ClaudeEvent, ClaudeProcessSpec } from "../src/process.js";
import type { ControlledProcess } from "../src/adapter/types.js";
import { fakePluginContext } from "../src/test-context.js";

const model = process.argv[2] ?? "claude-opus-5-5";
const cwd = mkdtempSync(join(tmpdir(), "omc-effort-check-"));

const child = spawn(
  "claude",
  [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--model",
    model,
  ],
  { cwd, stdio: ["pipe", "pipe", "inherit"] },
);

const pid = child.pid;

const spec: ClaudeProcessSpec = {
  cwd,
  model,
  effort: null,
  mode: "default",
  sessionId: null,
  temporary: true,
};

/** What the adapter needs of a process to retarget it: its spec and key, a way to write a line, and
 *  the listener it installs for control responses. Everything else a real one has is unused here. */
const proc: ControlledProcess = {
  spec,
  key: JSON.stringify(spec),
  // Unset until the adapter installs its listener on the first control request.
  controlListener: undefined,
  write: (line: string) => child.stdin.write(line),
};

/** Answers to this script's own requests, apart from the adapter's. */
const mine = new Map<string, (event: ClaudeEvent) => void>();
let buffered = "";

child.stdout.on("data", (chunk: Buffer) => {
  buffered += chunk.toString();

  for (let at = buffered.indexOf("\n"); at >= 0; at = buffered.indexOf("\n")) {
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // A line of the CLI's stream-json output; only `type` and `response` are read here, and the
    // adapter's own listener checks what it takes from it.
    if (!isClaudeEvent(raw) || raw.type !== "control_response") {
      continue;
    }

    const event = raw;

    const waiter = mine.get(event.response?.request_id ?? "");

    if (waiter) {
      waiter(event);
    } else {
      proc.controlListener?.(event);
    }
  }
});

let asked = 0;

/** The effort the CLI itself says is in force, asked for directly. */
const effortNow = (): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    const id = `check-${++asked}`;
    const timer = setTimeout(() => reject(new Error("no answer to get_settings in 15 s")), 15_000);
    mine.set(id, (event) => {
      clearTimeout(timer);
      resolve(
        event.type === "control_response"
          ? appliedEffort(toJsonValue(event.response?.response))
          : undefined,
      );
    });
    child.stdin.write(
      `${JSON.stringify({ type: "control_request", request_id: id, request: { subtype: "get_settings" } })}\n`,
    );
  });

// The adapter reads none of dsh's services on this path; `retarget` and `control` use only the
// process handed to them and the logger. Any other service throws `not faked` if reached.
const ctx = fakePluginContext({ on() {}, logger: { info() {}, warn() {} } });
const adapter = new ClaudeCodeAdapter(ctx, Config({}));

let failed = 0;

/** Print one line and count it when the expectation does not hold. */
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) {
    failed++;
  }

  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`);
};

try {
  console.log(`claude pid ${pid}, model ${model}, started with no --effort`);
  console.log(`effort at start: ${await effortNow()}`);

  for (const level of ["low", "high", "medium", "max"]) {
    const kept = await adapter.retarget(proc, { ...proc.spec, effort: level });
    const now = await effortNow();
    check(
      `switch to ${level}`,
      kept && now === level && child.pid === pid && child.exitCode === null,
      `adapter kept the process: ${kept}; CLI reports: ${now}; pid still ${child.pid}, running: ${child.exitCode === null}`,
    );
  }

  const before = await effortNow();
  const kept = await adapter.retarget(proc, { ...proc.spec, effort: "bogus" });
  check(
    "a level the CLI does not know",
    !kept && (await effortNow()) === before,
    `adapter asked for a relaunch: ${!kept}; CLI still at: ${await effortNow()}`,
  );
  const cleared = await adapter.retarget(proc, { ...proc.spec, effort: null });
  check("back to the model's default", !cleared, `adapter asked for a relaunch: ${!cleared}`);
} finally {
  child.kill();
  rmSync(cwd, { recursive: true, force: true });
}

console.log(failed === 0 ? "all checks passed" : `${failed} check(s) failed`);

process.exit(failed === 0 ? 0 : 1);
