// The test gate's I/O edge: the parsers for its files, the hook's stdin and the save request, the
// per-workspace gate file, the run files, and the atomic write both sides use. The hook script
// imports this as a standalone node process, like keeper.ts, so it imports nothing but `node:`
// modules and the pure `test-gate.ts`: dsh's own packages (schemastery among them) resolve only
// inside dsh's loader, and an npm install's profile holds the plugin alone. That is why the
// parsing is by hand here, and why this file is on the `no-runtime-typeof` list.
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { RUN_STATES, TIMEOUT_DEFAULT_SEC, TRIES_DEFAULT, clampGate } from "./test-gate.js";
import type { RunState, TestGateConfig, TestGateFile, TestGateRun } from "./test-gate.js";

/** A parsed JSON value: what `JSON.parse` can hand back. */
type Json = string | number | boolean | null | Array<Json> | { [key: string]: Json };

/** A plain JSON object, not an array or null. */
const isObj = (v: Json | undefined): v is { [key: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `v` when it is a finite number, else `d`. */
const num = (v: Json | undefined, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;

/** `JSON.parse` that answers undefined for text that is not JSON. */
const parse = (text: string): Json | undefined => {
  try {
    // SAFETY: JSON.parse returns only the JSON value shapes `Json` spells out
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
};

/** Whether `s` is one of the run states. */
const isState = (s: string): s is RunState => RUN_STATES.some((r) => r === s);

/** The gate file under a state dir. */
export const gatePathIn = (stateDir: string): string => join(stateDir, "test-gate.json");

/** The run directory under a state dir: one `<session>.json` per gated session. */
export const runDirIn = (stateDir: string): string => join(stateDir, "test-gate");

/** A gate from JSON this plugin did not write (a request body, a hand-edited file), clamped; or
 *  undefined when `enabled` is not a boolean or `command` not a string. Missing numbers take the
 *  defaults. */
export function gateEntryOf(v: Json | undefined): TestGateConfig | undefined {
  if (!isObj(v) || typeof v.enabled !== "boolean" || typeof v.command !== "string") {
    return undefined;
  }

  return clampGate({
    enabled: v.enabled,
    command: v.command,
    tries: num(v.tries, TRIES_DEFAULT),
    timeoutSec: num(v.timeoutSec, TIMEOUT_DEFAULT_SEC),
  });
}

/** A save request: the workspace and its gate, or null to clear it; undefined when the body is
 *  neither. A body with no `config` at all is refused, not read as a clear. */
export function gatePutOf(body: {
  [key: string]: Json;
}): { cwd: string; config: TestGateConfig | null } | undefined {
  if (typeof body.cwd !== "string" || !("config" in body)) {
    return undefined;
  }

  if (body.config === null) {
    return { cwd: body.cwd, config: null };
  }

  const config = gateEntryOf(body.config);

  return config ? { cwd: body.cwd, config } : undefined;
}

/** The whole gate file; a missing or unreadable one is an empty map (every gate off), and an
 *  entry that does not parse is dropped on its own. */
export async function readGateFile(path: string): Promise<TestGateFile> {
  const all = parse(await readFile(path, "utf8").catch(() => "{}"));
  const out: TestGateFile = {};

  if (isObj(all)) {
    for (const [k, v] of Object.entries(all)) {
      const e = gateEntryOf(v);

      if (e) {
        out[k] = e;
      }
    }
  }

  return out;
}

/** The card's close for the run file at `path`: a file of its own beside the run, holding the
 *  dismissed run's `startedAt`, so the close never rewrites the run the hook may be writing. */
const dismissPathOf = (path: string) => path.replace(/\.json$/, ".dismissed");

/** Record the close of the run that started at `startedAt`; a later run is not affected. */
export async function writeDismiss(path: string, startedAt: number): Promise<void> {
  await writeFile(dismissPathOf(path), String(startedAt));
}

/** A run file from disk, with `dismissed` set when its close was recorded, or null when it is
 *  missing, half written or not a run. */
export async function readRunFile(path: string): Promise<TestGateRun | null> {
  const v = parse(await readFile(path, "utf8").catch(() => ""));

  if (!isObj(v) || typeof v.state !== "string" || !isState(v.state)) {
    return null;
  }

  if (typeof v.command !== "string") {
    return null;
  }

  const run: TestGateRun = {
    state: v.state,
    attempt: num(v.attempt, 0),
    tries: num(v.tries, TRIES_DEFAULT),
    command: v.command,
    startedAt: num(v.startedAt, 0),
    tail: typeof v.tail === "string" ? v.tail : "",
  };

  if (typeof v.endedAt === "number") {
    run.endedAt = v.endedAt;
  }

  if (typeof v.exitCode === "number" || v.exitCode === null) {
    run.exitCode = v.exitCode;
  }

  const closed = await readFile(dismissPathOf(path), "utf8").catch(() => "");

  if (closed !== "" && closed === String(run.startedAt)) {
    run.dismissed = true;
  }

  return run;
}

/** What the gate reads of the hook's stdin. */
export interface HookInput {
  stopHookActive: boolean;
  permissionMode: string;
}

/** The two hook input fields the gate reads: whether this stop follows a block, and the
 *  session's permission mode (probed on 2.1.332: `default`, `acceptEdits`, `bypassPermissions`,
 *  `plan`). Input it cannot read gives false and an empty mode, which the gate does not run in. */
export function hookInputOf(text: string): HookInput {
  const v = parse(text);

  if (!isObj(v)) {
    return { stopHookActive: false, permissionMode: "" };
  }

  return {
    stopHookActive: v.stop_hook_active === true,
    permissionMode: typeof v.permission_mode === "string" ? v.permission_mode : "",
  };
}

/** package.json's `test` script, or undefined when there is none or the file does not parse. */
export function testScriptIn(packageJson: string | undefined): string | undefined {
  const v = packageJson === undefined ? undefined : parse(packageJson);
  const scripts = isObj(v) ? v.scripts : undefined;

  return isObj(scripts) && typeof scripts.test === "string" ? scripts.test : undefined;
}

/** Write `data` as JSON through a temp file and a rename, so a reader never sees half a file. */
export async function writeJsonAtomic(
  path: string,
  data: TestGateFile | TestGateRun,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // A random part: two writes from one process at once must not share a temp file.
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}
