// The adapter's side of the test gate: the Stop hook block a session's spawn gets, and the run
// files followed as the hook script writes them (one watcher for the whole plugin, each change read
// back and handed to the adapter to publish). Kept apart from `test-gate-files.ts` because it names
// the hook script, which imports that module.
import { watch, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SESSION_ID, runCapSec, stopHookSettings } from "../test-gate.js";
import { gatePathIn, readGateFile, readRunFile, runDirIn } from "../test-gate-files.js";
/** The built hook script, one level up in `lib/server/`. Only a path: under the test runner it
 *  names a `.js` that does not exist, and nothing there spawns it. */
export const HOOK_SCRIPT = fileURLToPath(new URL("../test-gate-hook.js", import.meta.url));
/** The Stop hook block for a session's spawn, or undefined when the workspace's gate is off, the
 *  session id cannot name a run file, or the box is Windows (the hook runs `/bin/sh` and kills a
 *  process group). Read per spawn, so a switch flipped in Settings is seen by the next process; the
 *  command, tries and timeout are read again by the hook at each stop. `idleMs` is the adapter's
 *  idle watchdog, which caps how long a run may take (`runCapSec`). */
export async function gateHookFor(stateDir, cwd, session, idleMs) {
    if (process.platform === "win32" || !session || !SESSION_ID.test(session)) {
        return undefined;
    }
    const gate = (await readGateFile(gatePathIn(stateDir)))[cwd];
    if (!gate?.enabled) {
        return undefined;
    }
    return stopHookSettings(process.execPath, HOOK_SCRIPT, gatePathIn(stateDir), join(runDirIn(stateDir), `${session}.json`), cwd, runCapSec(idleMs));
}
/**
 * Watch `dir` for `<session>.json` writes and call `onRun` with each one read back. The hook
 * writes through a temp file and a rename, so the rename's event carries the final name; the
 * `.tmp` names are skipped. Changes inside 50 ms for one file are read once. Creates `dir` when it
 * is missing. Returns the stop function. Wrong case: a write made while the plugin was down is
 * not replayed; the card's first read (`GET /test-gate/run`) covers a tab opened after it.
 */
export function watchRuns(dir, onRun) {
    mkdirSync(dir, { recursive: true });
    const timers = new Map();
    /** Read one settled run file and hand it on; a file that is gone or torn reads as nothing. */
    const deliver = async (name) => {
        const run = await readRunFile(join(dir, name));
        if (run) {
            onRun(name.slice(0, -".json".length), run);
        }
    };
    const w = watch(dir, { persistent: false }, (_event, name) => {
        if (name === null || !name.endsWith(".json")) {
            return;
        }
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => {
            timers.delete(name);
            // Fire and forget: the timer has nothing to hand the result to.
            void deliver(name);
        }, 50));
    });
    return () => {
        w.close();
        for (const t of timers.values()) {
            clearTimeout(t);
        }
    };
}
/** The one watcher this process runs, started when the routes mount, so a hook still running
 *  under a keeper across a dsh-web restart is heard. */
let running;
/** Start `watchRuns` once per process; later calls are no-ops, whichever adapter makes them. */
export function ensureRunWatch(dir, onRun) {
    running ??= watchRuns(dir, onRun);
}
//# sourceMappingURL=test-gate.js.map