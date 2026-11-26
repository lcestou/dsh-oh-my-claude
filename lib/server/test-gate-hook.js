// The test gate's Stop hook, run by Claude Code as
//   <node> test-gate-hook.js <gate file> <run file> <workspace> <longest run, seconds>
// once per attempt to end a turn. Reads the hook input on stdin, runs the workspace's command in
// its own process group, writes the run file the dock card reads, and prints a block decision
// when the tests failed and tries remain. Exits 0 in every other case, including its own errors:
// a broken gate must never trap a turn.
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { GATE_MODES, TAIL_CHARS, decide, gateReason, testEnv, } from "./test-gate.js";
import { hookInputOf, readGateFile, readRunFile, writeJsonAtomic } from "./test-gate-files.js";
/** Reads all of stdin; the CLI writes the hook input there and closes it. */
async function stdinText() {
    let s = "";
    for await (const chunk of process.stdin)
        s += String(chunk);
    return s;
}
/** Runs `command` under /bin/sh in `cwd` as its own process group, keeping the last output, and
 *  stops the whole group on the timeout or when the CLI cancels the hook with SIGTERM (what an
 *  interrupt sends, probed on 2.1.332). Settles on the shell's `exit`, not on `close`: a suite that
 *  leaves a server running in the background holds the pipes open, and `close` would wait for it.
 *  The group is killed and the pipes dropped as soon as the shell exits. Wrong case: a grandchild
 *  that left the group with setsid outlives the run. Never rejects: a spawn error reads as 127. */
function runCommand(command, cwd, timeoutSec) {
    const child = spawn("/bin/sh", ["-c", command], {
        cwd,
        env: testEnv(process.env),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    /** Appends one stream's chunk through that stream's own decoder, so a character split across
     *  two chunks is joined rather than turned into U+FFFD. */
    const keeper = () => {
        const decoder = new StringDecoder("utf8");
        return (b) => {
            tail = (tail + decoder.write(b)).slice(-TAIL_CHARS * 2);
        };
    };
    child.stdout.on("data", keeper());
    child.stderr.on("data", keeper());
    let timedOut = false;
    let stopped = false;
    const killGroup = () => {
        try {
            if (child.pid)
                process.kill(-child.pid, "SIGKILL");
        }
        catch {
            // already gone
        }
    };
    const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
    }, timeoutSec * 1000);
    process.once("SIGTERM", () => {
        stopped = true;
        killGroup();
    });
    return new Promise((resolve) => {
        child.on("error", () => {
            clearTimeout(timer);
            resolve({ code: 127, timedOut, stopped, tail });
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            killGroup();
            child.stdout.destroy();
            child.stderr.destroy();
            resolve({ code, timedOut, stopped, tail: tail.slice(-TAIL_CHARS) });
        });
    });
}
/** One hook call end to end; resolves with what to print (empty for none). */
async function main(gatePath, runPath, cwd, capSec) {
    const { stopHookActive: active, permissionMode } = hookInputOf(await stdinText());
    const gate = (await readGateFile(gatePath))[cwd];
    if (!gate?.enabled)
        return "";
    const before = active ? ((await readRunFile(runPath))?.attempt ?? 0) : 0;
    const base = { command: gate.command, tries: gate.tries, startedAt: Date.now() };
    // A session that asks before commands: the gate would run repo content Claude may have edited
    // without asking, so it runs nothing and the card says why.
    if (!GATE_MODES.includes(permissionMode)) {
        await writeJsonAtomic(runPath, { ...base, state: "held", attempt: 0, tail: "" });
        return "";
    }
    await writeJsonAtomic(runPath, { ...base, state: "running", attempt: before, tail: "" });
    const limit = Math.min(gate.timeoutSec, Number.isFinite(capSec) ? capSec : gate.timeoutSec);
    const exit = await runCommand(gate.command, cwd, limit);
    const v = decide(before, active, exit, gate.tries);
    const run = {
        ...base,
        state: v.state,
        attempt: v.attempt,
        endedAt: Date.now(),
        exitCode: exit.code,
        tail: exit.tail,
    };
    await writeJsonAtomic(runPath, run);
    if (!v.block)
        return "";
    const reason = gateReason(v.attempt, gate.tries, gate.command, exit.tail);
    return JSON.stringify({ decision: "block", reason });
}
const [gatePath, runPath, cwd, cap] = process.argv.slice(2);
// Exits once the answer is written: a SIGTERM handler replaces node's own exit, and a stray
// handle must never keep the hook alive past the CLI's cancel.
if (gatePath && runPath && cwd)
    main(gatePath, runPath, cwd, Number(cap))
        .then((out) => {
        if (out)
            process.stdout.write(out, () => process.exit(0));
        else
            process.exit(0);
    })
        .catch((error) => {
        process.stderr.write(`test gate: ${error.message}\n`, () => process.exit(0));
    });
//# sourceMappingURL=test-gate-hook.js.map