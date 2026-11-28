// The test gate: a workspace's test command, run by a Stop hook the plugin passes in its own
// --settings, so a failing suite sends Claude back to work before its turn ends. The rules shared
// by the hook script (`test-gate-hook.ts`), the spawn, the translator's chat line, the routes and
// the client. Pure, with no node import, so the client bundle can take its values; parsing and
// files live in `test-gate-files.ts`.

/** One workspace's gate, as Settings saved it. `command` is only ever text the owner typed or
 *  accepted from a suggestion. What it runs is repo content Claude can edit, which is why the gate
 *  runs only in `GATE_MODES`. */
export interface TestGateConfig {
  enabled: boolean;
  command: string;
  /** How many times a failure sends Claude back to fix it before the turn is let end. */
  tries: number;
  /** The run is stopped past this, and the turn ends without a verdict. */
  timeoutSec: number;
}

/** `test-gate.json` under the state dir: one entry per workspace, keyed by its absolute path
 *  exactly as dsh names the session's cwd. A workspace with no entry has the gate off. */
export type TestGateFile = Record<string, TestGateConfig>;

export const TRIES_DEFAULT = 3;
export const TRIES_MAX = 5;
export const TIMEOUT_DEFAULT_SEC = 300;
export const TIMEOUT_MIN_SEC = 10;

/** Under the plugin's 30 min idle watchdog (`idleTimeoutMs`), which a silent hook would trip. */
export const TIMEOUT_MAX_SEC = 1200;

/** The longest failure tail handed to Claude, in characters (the last lines win). */
export const TAIL_CHARS = 4000;

/** dsh session ids are UUIDs; anything else never names a run file. */
export const SESSION_ID = /^[\w-]{1,128}$/;

/** Where one run ended. `fixing` blocked the stop; every other end let the turn finish. `held`:
 *  the session's permission mode is not one the gate runs in, so nothing ran. */
export const RUN_STATES = [
  "held",
  "running",
  "fixing",
  "passed",
  "gave-up",
  "timed-out",
  "broken",
  "stopped",
] as const;

export type RunState = (typeof RUN_STATES)[number];

/** `test-gate/<dsh session id>.json`: the session's latest run, written by the hook script and
 *  read by the dock card. `attempt` counts this turn's failures; it restarts at each user turn. */
export interface TestGateRun {
  state: RunState;
  attempt: number;
  tries: number;
  command: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  /** The last `TAIL_CHARS` of stdout and stderr together. */
  tail: string;
  /** Set by the card's close; the next run writes a fresh record without it. */
  dismissed?: boolean;
}

/** How the command's process ended, as the hook script saw it. */
export interface RunExit {
  code: number | null;
  timedOut: boolean;
  /** The CLI cancelled the hook (an interrupt, or its own timeout): SIGTERM reached the script. */
  stopped: boolean;
}

/** What one run decided: where it ended, the failure count after it, and whether it blocks. */
export interface Verdict {
  state: RunState;
  attempt: number;
  block: boolean;
}

/**
 * The verdict on one run. `stopHookActive` is the CLI's flag for "this stop follows a block", so
 * false starts the count again; probed on 2.1.332, the CLI itself never caps the loop (13 blocks
 * in a row all honoured), so this count is the only limit. Exit 126 and 127 (not executable, not
 * found) are the box's fault, not the code's, and never block: Claude cannot fix a missing binary
 * by editing the repo. Wrong case: a suite that exits 127 for a missing tool of its own is not
 * sent back either.
 */
export function decide(
  prevAttempt: number,
  stopHookActive: boolean,
  exit: RunExit,
  tries: number,
): Verdict {
  const before = stopHookActive ? prevAttempt : 0;

  if (exit.stopped) {
    return { state: "stopped", attempt: before, block: false };
  }

  if (exit.timedOut) {
    return { state: "timed-out", attempt: before, block: false };
  }

  if (exit.code === 0) {
    return { state: "passed", attempt: before, block: false };
  }

  if (exit.code === 126 || exit.code === 127) {
    return { state: "broken", attempt: before, block: false };
  }

  const attempt = before + 1;

  return attempt <= tries
    ? { state: "fixing", attempt, block: true }
    : { state: "gave-up", attempt: before, block: false };
}

/** The permission modes the gate runs in: the ones where Claude already runs commands without
 *  asking. Under acceptEdits or default, Claude could edit package.json's `test` script (an edit
 *  is approved there, a command is not) and the gate would run it unasked. Wrong case: a session
 *  in acceptEdits is never gated, though the owner switched the workspace on. */
export const GATE_MODES: ReadonlyArray<string> = ["bypassPermissions", "auto"];

/** The environment names the test run drops: dsh's own seam's rule (`SCRUBBED_NAME` and `DSH_*` in
 *  src/process.ts) plus a router's auth header. Not a security boundary: Claude's own Bash sees
 *  the full environment, and the login on disk (`CLAUDE_CONFIG_DIR`) stays. It keeps repo code
 *  from reading the plugin's keys by accident. */
const DROPPED_ENV = /KEY|PASSWORD|SECRET|TOKEN|^DSH_|^ANTHROPIC_CUSTOM_HEADERS$/i;

/** `env` without the names `DROPPED_ENV` matches, and without unset names. */
export function testEnv(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined && !DROPPED_ENV.test(e[0]),
    ),
  );
}

/** The longest a run may take on a box whose idle watchdog is `idleMs`: a minute under it, since
 *  a silent hook trips the watchdog (`idleTimeoutMs`, configurable, 30 min by default), and never
 *  past `TIMEOUT_MAX_SEC`. */
export const runCapSec = (idleMs: number): number =>
  Math.max(TIMEOUT_MIN_SEC, Math.min(TIMEOUT_MAX_SEC, Math.floor(idleMs / 1000) - 60));

/** The tag the block reason opens with, as the CLI prefixes it; the translator finds its line by it. */
const TAG = /^Stop hook feedback:\n\[test gate (\d+)\/(\d+)\]/;

/** What Claude reads when a run fails. English on purpose: it is a prompt, never translated. */
export function gateReason(attempt: number, tries: number, command: string, tail: string): string {
  return [
    `[test gate ${attempt}/${tries}] The tests failed, so your turn did not end.`,
    `Command: ${command}`,
    "Fix the cause of the failure below, then finish your turn; the tests run again when you stop.",
    "Do not weaken, skip or delete tests to make them pass.",
    "",
    tail.slice(-TAIL_CHARS),
  ].join("\n");
}

/** The attempt and limit from the CLI's synthetic "Stop hook feedback" user text, when the text is
 *  this gate's; undefined for another Stop hook's feedback or any other text. */
export function gateNoteOf(text: string): { attempt: number; tries: number } | undefined {
  const m = TAG.exec(text);

  return m ? { attempt: Number(m[1]), tries: Number(m[2]) } : undefined;
}

/** POSIX single quotes: the hook command is a shell line, and a path may hold spaces. */
const sq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** The Stop hook block merged into the spawn's --settings. `capSec` (`runCapSec`) is the longest
 *  the script lets a run take; the CLI's own timeout sits 30 s past it, so the script reports a
 *  timed-out run itself before any cancel. */
export function stopHookSettings(
  node: string,
  script: string,
  gatePath: string,
  runPath: string,
  cwd: string,
  capSec: number,
) {
  return {
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: [node, script, gatePath, runPath, cwd, String(capSec)].map(sq).join(" "),
            timeout: capSec + 30,
          },
        ],
      },
    ],
  };
}

/** What `suggestCommand` reads from the workspace root, absent when the workspace has none. */
export interface ProjectFiles {
  /** package.json's `scripts.test`. */
  testScript?: string | undefined;
  lockfiles: Array<string>;
  pyproject?: string | undefined;
  hasPytestIni?: boolean;
  cargoToml?: boolean;
  goMod?: boolean;
  makefile?: string | undefined;
}

/**
 * A test command guessed from the workspace's own files, for Settings to offer, never to run
 * unasked. First match wins: package.json's `test` script (through the lockfile's package
 * manager), pytest, cargo, go, a Makefile `test:` target. Wrong case: npm init's placeholder
 * (`echo "Error: no test specified" && exit 1`) is skipped, any other placeholder is offered.
 */
export function suggestCommand(f: ProjectFiles): string | undefined {
  const script = f.testScript?.trim();

  if (script && !script.includes("no test specified")) {
    if (f.lockfiles.includes("bun.lock") || f.lockfiles.includes("bun.lockb")) {
      return "bun run test";
    }

    if (f.lockfiles.includes("pnpm-lock.yaml")) {
      return "pnpm test";
    }

    if (f.lockfiles.includes("yarn.lock")) {
      return "yarn test";
    }

    return "npm test";
  }

  if (f.hasPytestIni || f.pyproject?.includes("[tool.pytest")) {
    return f.lockfiles.includes("uv.lock") ? "uv run pytest -q" : "pytest -q";
  }

  if (f.cargoToml) {
    return "cargo test";
  }

  if (f.goMod) {
    return "go test ./...";
  }

  if (f.makefile && /^test:/m.test(f.makefile)) {
    return "make test";
  }

  return undefined;
}

/** `x` rounded into `lo`..`hi`, or `d` when it is not a finite number. */
const fit = (x: number, d: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;

/** `e` with its numbers rounded into range and an empty command read as off, so a hand edit past
 *  a limit still runs at the limit rather than being refused. */
export function clampGate(e: TestGateConfig): TestGateConfig {
  const command = e.command.trim();

  return {
    enabled: e.enabled && command !== "",
    command,
    tries: fit(e.tries, TRIES_DEFAULT, 1, TRIES_MAX),
    timeoutSec: fit(e.timeoutSec, TIMEOUT_DEFAULT_SEC, TIMEOUT_MIN_SEC, TIMEOUT_MAX_SEC),
  };
}
