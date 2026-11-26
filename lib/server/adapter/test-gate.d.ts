import { stopHookSettings, type TestGateRun } from "../test-gate.js";
/** The built hook script, one level up in `lib/server/`. Only a path: under the test runner it
 *  names a `.js` that does not exist, and nothing there spawns it. */
export declare const HOOK_SCRIPT: string;
/** The Stop hook block for a session's spawn, or undefined when the workspace's gate is off, the
 *  session id cannot name a run file, or the box is Windows (the hook runs `/bin/sh` and kills a
 *  process group). Read per spawn, so a switch flipped in Settings is seen by the next process; the
 *  command, tries and timeout are read again by the hook at each stop. `idleMs` is the adapter's
 *  idle watchdog, which caps how long a run may take (`runCapSec`). */
export declare function gateHookFor(stateDir: string, cwd: string, session: string | undefined, idleMs: number): Promise<ReturnType<typeof stopHookSettings> | undefined>;
/**
 * Watch `dir` for `<session>.json` writes and call `onRun` with each one read back. The hook
 * writes through a temp file and a rename, so the rename's event carries the final name; the
 * `.tmp` names are skipped. Changes inside 50 ms for one file are read once. Creates `dir` when it
 * is missing. Returns the stop function. Wrong case: a write made while the plugin was down is
 * not replayed; the card's first read (`GET /test-gate/run`) covers a tab opened after it.
 */
export declare function watchRuns(dir: string, onRun: (session: string, run: TestGateRun) => void): () => void;
/** Start `watchRuns` once per process; later calls are no-ops, whichever adapter makes them. */
export declare function ensureRunWatch(dir: string, onRun: (session: string, run: TestGateRun) => void): void;
