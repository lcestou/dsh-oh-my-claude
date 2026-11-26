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
export declare const TRIES_DEFAULT = 3;
export declare const TRIES_MAX = 5;
export declare const TIMEOUT_DEFAULT_SEC = 300;
export declare const TIMEOUT_MIN_SEC = 10;
/** Under the plugin's 30 min idle watchdog (`idleTimeoutMs`), which a silent hook would trip. */
export declare const TIMEOUT_MAX_SEC = 1200;
/** The longest failure tail handed to Claude, in characters (the last lines win). */
export declare const TAIL_CHARS = 4000;
/** dsh session ids are UUIDs; anything else never names a run file. */
export declare const SESSION_ID: RegExp;
/** Where one run ended. `fixing` blocked the stop; every other end let the turn finish. `held`:
 *  the session's permission mode is not one the gate runs in, so nothing ran. */
export declare const RUN_STATES: readonly ["held", "running", "fixing", "passed", "gave-up", "timed-out", "broken", "stopped"];
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
export declare function decide(prevAttempt: number, stopHookActive: boolean, exit: RunExit, tries: number): Verdict;
/** The permission modes the gate runs in: the ones where Claude already runs commands without
 *  asking. Under acceptEdits or default, Claude could edit package.json's `test` script (an edit
 *  is approved there, a command is not) and the gate would run it unasked. Wrong case: a session
 *  in acceptEdits is never gated, though the owner switched the workspace on. */
export declare const GATE_MODES: readonly string[];
/** `env` without the names `DROPPED_ENV` matches, and without unset names. */
export declare function testEnv(env: Readonly<Record<string, string | undefined>>): {
    [k: string]: string;
};
/** The longest a run may take on a box whose idle watchdog is `idleMs`: a minute under it, since
 *  a silent hook trips the watchdog (`idleTimeoutMs`, configurable, 30 min by default), and never
 *  past `TIMEOUT_MAX_SEC`. */
export declare const runCapSec: (idleMs: number) => number;
/** What Claude reads when a run fails. English on purpose: it is a prompt, never translated. */
export declare function gateReason(attempt: number, tries: number, command: string, tail: string): string;
/** The attempt and limit from the CLI's synthetic "Stop hook feedback" user text, when the text is
 *  this gate's; undefined for another Stop hook's feedback or any other text. */
export declare function gateNoteOf(text: string): {
    attempt: number;
    tries: number;
} | undefined;
/** The Stop hook block merged into the spawn's --settings. `capSec` (`runCapSec`) is the longest
 *  the script lets a run take; the CLI's own timeout sits 30 s past it, so the script reports a
 *  timed-out run itself before any cancel. */
export declare function stopHookSettings(node: string, script: string, gatePath: string, runPath: string, cwd: string, capSec: number): {
    Stop: {
        hooks: {
            type: string;
            command: string;
            timeout: number;
        }[];
    }[];
};
/** What `suggestCommand` reads from the workspace root, absent when the workspace has none. */
export interface ProjectFiles {
    /** package.json's `scripts.test`. */
    testScript?: string | undefined;
    lockfiles: string[];
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
export declare function suggestCommand(f: ProjectFiles): string | undefined;
/** `e` with its numbers rounded into range and an empty command read as off, so a hand edit past
 *  a limit still runs at the limit rather than being refused. */
export declare function clampGate(e: TestGateConfig): TestGateConfig;
