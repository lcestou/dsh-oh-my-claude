import { stringOf } from "../decode.js";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { hub } from "../events.js";
import { remoteWorkspaceFor } from "../adapter/config.js";
import { ensureRunWatch } from "../adapter/test-gate.js";
import { UNHANDLED } from "./context.js";
import { SESSION_ID, suggestCommand } from "../test-gate.js";
import { gatePathIn, gatePutOf, readGateFile, readRunFile, runDirIn, testScriptIn, writeDismiss, writeJsonAtomic, } from "../test-gate-files.js";
/** A file's text, or undefined when it is missing or unreadable. */
const textOf = (path) => readFile(path, "utf8").catch(() => undefined);
/** The workspace's test command as `suggestCommand` guesses it from the files at its root.
 *  Reads at most six small files; never runs anything. */
async function suggestFor(cwd) {
    const names = await readdir(cwd).catch(() => []);
    return suggestCommand({
        testScript: testScriptIn(names.includes("package.json") ? await textOf(join(cwd, "package.json")) : undefined),
        lockfiles: names.filter((n) => /\.lockb?$|-lock\.yaml$/.test(n)),
        pyproject: names.includes("pyproject.toml")
            ? await textOf(join(cwd, "pyproject.toml"))
            : undefined,
        hasPytestIni: names.includes("pytest.ini"),
        cargoToml: names.includes("Cargo.toml"),
        goMod: names.includes("go.mod"),
        makefile: names.includes("Makefile") ? await textOf(join(cwd, "Makefile")) : undefined,
    });
}
/** The test gate group. Returns `UNHANDLED` when no block matched, so the dispatch tries the next. */
export function testGateRoutes(c) {
    const base = `${c.ROUTE_PREFIX}/test-gate`;
    const gatePath = gatePathIn(c.stateDir);
    // At mount, not at the first gated spawn: a keeper's CLI and its hook outlive a dsh-web restart.
    ensureRunWatch(runDirIn(c.stateDir), (session, run) => hub.publish({ kind: "test-gate", session, data: run }));
    /** Writes are serialised: two saves in two tabs would otherwise each drop the other's workspace. */
    let chain = Promise.resolve();
    /** Run `fn` after every write before it, whatever they returned. */
    const serial = (fn) => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => { });
        return next;
    };
    return async (req, res, url) => {
        if (url.pathname === base) {
            if (req.method === "GET") {
                const cwd = url.searchParams.get("cwd") ?? "";
                if (!isAbsolute(cwd)) {
                    return c.json(res, 400, { error: "an absolute cwd is required" });
                }
                // The hook runs on this box only, under /bin/sh, so a remote workspace and a Windows box
                // get no suggestion and no gate.
                const local = process.platform !== "win32" && remoteWorkspaceFor(cwd) === undefined;
                return c.json(res, 200, {
                    config: (await readGateFile(gatePath))[cwd] ?? null,
                    suggested: local ? ((await suggestFor(cwd)) ?? null) : null,
                    local,
                });
            }
            if (req.method === "PUT") {
                const put = gatePutOf(await c.readBody(req));
                if (!put || !isAbsolute(put.cwd)) {
                    return c.json(res, 400, { error: "an absolute cwd and a gate or null are required" });
                }
                const { cwd, config: entry } = put;
                // The hook runs only beside a local CLI; Settings hides the row elsewhere, and the route
                // refuses the same so a direct call cannot save a gate that would never run.
                if (entry !== null &&
                    (process.platform === "win32" || remoteWorkspaceFor(cwd) !== undefined)) {
                    return c.json(res, 400, { error: "the test gate runs only for a local workspace" });
                }
                await serial(async () => {
                    const all = await readGateFile(gatePath);
                    if (entry === null) {
                        delete all[cwd];
                    }
                    else {
                        all[cwd] = entry;
                    }
                    await writeJsonAtomic(gatePath, all);
                });
                // Every open Settings row for this workspace reads it again.
                hub.publish({ kind: "test-gate-config", session: null, data: { cwd } });
                return c.json(res, 200, { config: entry });
            }
            return c.json(res, 405, { error: "method not allowed" });
        }
        if (url.pathname === `${base}/run`) {
            const session = req.method === "GET"
                ? (url.searchParams.get("session") ?? "")
                : req.method === "POST"
                    ? (stringOf((await c.readBody(req)).session) ?? "")
                    : "";
            if (!SESSION_ID.test(session)) {
                return c.json(res, 400, { error: "a session id is required" });
            }
            const path = join(runDirIn(c.stateDir), `${session}.json`);
            const run = await readRunFile(path);
            if (req.method === "GET") {
                return c.json(res, 200, { run });
            }
            // POST: the card's close, in a file of its own so it never races the hook's writes; every
            // tab hides the card, and the next run shows again.
            if (run && !run.dismissed) {
                await writeDismiss(path, run.startedAt);
                hub.publish({ kind: "test-gate", session, data: { ...run, dismissed: true } });
            }
            return c.json(res, 200, { ok: true });
        }
        return UNHANDLED;
    };
}
//# sourceMappingURL=test-gate.js.map