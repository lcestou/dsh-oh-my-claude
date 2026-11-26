// The test gate's routes: a workspace's gate as Settings reads and saves it, with a command
// suggested from the project's files, and a session's latest run for the dock card.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { JsonValue } from "../dsh.js";
import { hub } from "../events.js";
import { remoteWorkspaceFor } from "../adapter/config.js";
import { ensureRunWatch } from "../adapter/test-gate.js";
import { type RouteHandler, UNHANDLED } from "./context.js";
import { SESSION_ID, suggestCommand } from "../test-gate.js";
import {
  gatePathIn,
  gatePutOf,
  readGateFile,
  readRunFile,
  runDirIn,
  testScriptIn,
  writeDismiss,
  writeJsonAtomic,
} from "../test-gate-files.js";

/** What the group needs from the session routes. */
export interface TestGateRouteCtx {
  ROUTE_PREFIX: string;
  stateDir: string;
  json: (res: ServerResponse, status: number, value: object) => void;
  readBody: (req: IncomingMessage) => Promise<{ [key: string]: JsonValue }>;
}

/** A file's text, or undefined when it is missing or unreadable. */
const textOf = (path: string) => readFile(path, "utf8").catch(() => undefined);

/** The workspace's test command as `suggestCommand` guesses it from the files at its root.
 *  Reads at most six small files; never runs anything. */
async function suggestFor(cwd: string): Promise<string | undefined> {
  const names = await readdir(cwd).catch((): string[] => []);
  return suggestCommand({
    testScript: testScriptIn(
      names.includes("package.json") ? await textOf(join(cwd, "package.json")) : undefined,
    ),
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
export function testGateRoutes(c: TestGateRouteCtx): RouteHandler {
  const base = `${c.ROUTE_PREFIX}/test-gate`;
  const gatePath = gatePathIn(c.stateDir);
  // At mount, not at the first gated spawn: a keeper's CLI and its hook outlive a dsh-web restart.
  ensureRunWatch(runDirIn(c.stateDir), (session, run) =>
    hub.publish({ kind: "test-gate", session, data: run }),
  );
  /** Writes are serialised: two saves in two tabs would otherwise each drop the other's workspace. */
  let chain: Promise<unknown> = Promise.resolve();
  /** Run `fn` after every write before it, whatever they returned. */
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return async (req, res, url) => {
    if (url.pathname === base) {
      if (req.method === "GET") {
        const cwd = url.searchParams.get("cwd") ?? "";
        if (!isAbsolute(cwd)) return c.json(res, 400, { error: "an absolute cwd is required" });
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
        if (!put || !isAbsolute(put.cwd))
          return c.json(res, 400, { error: "an absolute cwd and a gate or null are required" });
        const { cwd, config: entry } = put;
        await serial(async () => {
          const all = await readGateFile(gatePath);
          if (entry === null) delete all[cwd];
          else all[cwd] = entry;
          await writeJsonAtomic(gatePath, all);
        });
        // Every open Settings row for this workspace reads it again.
        hub.publish({ kind: "test-gate-config", session: null, data: { cwd } });
        return c.json(res, 200, { config: entry });
      }
      return c.json(res, 405, { error: "method not allowed" });
    }
    if (url.pathname === `${base}/run`) {
      const session =
        req.method === "GET"
          ? (url.searchParams.get("session") ?? "")
          : req.method === "POST"
            ? String((await c.readBody(req)).session ?? "")
            : "";
      if (!SESSION_ID.test(session)) return c.json(res, 400, { error: "a session id is required" });
      const path = join(runDirIn(c.stateDir), `${session}.json`);
      const run = await readRunFile(path);
      if (req.method === "GET") return c.json(res, 200, { run });
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
