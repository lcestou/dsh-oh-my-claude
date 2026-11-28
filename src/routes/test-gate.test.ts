// The test gate routes over a real socket: a suggestion from the workspace's files, a save that
// keeps other workspaces, a clear, and a run's close written back to its file.
import { strict as assert } from "node:assert";
import type { IncomingMessage } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "../dsh.js";
import { testGateRoutes } from "./test-gate.js";
import { setRemoteWorkspaces } from "../adapter/config.js";
import { fieldsOf, objectOf, parseJson, serveRoutes } from "../test-context.js";

const root = mkdtempSync(join(tmpdir(), "omc-gate-routes-"));
const stateDir = join(root, "state");
const ws = join(root, "ws");

mkdirSync(ws);

writeFileSync(join(ws, "package.json"), '{"scripts":{"test":"vitest"}}');

writeFileSync(join(ws, "pnpm-lock.yaml"), "");

/** The request body as JSON, `{}` when empty. */
const readBody = async (req: IncomingMessage) => {
  let s = "";

  for await (const c of req) {
    s += String(c);
  }

  // The test sends only JSON objects.
  return s ? objectOf(parseJson(s)) : {};
};

const route = testGateRoutes({
  ROUTE_PREFIX: "/p",
  stateDir,
  json: (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  },
  readBody,
});

// The group answers what it handles; anything else is a 404, as the web server would send.
const { send } = await serveRoutes(() => async (req, res) => {
  const r = await route(req, res, new URL(req.url ?? "/", "http://x"));

  if (typeof r === "symbol") {
    res.writeHead(404).end();
  }
});

/** One request, answered as JSON. */
const call = async (method: string, path: string, body?: JsonValue) =>
  objectOf(
    parseJson(
      (await send(method, path, body === undefined ? undefined : JSON.stringify(body))).text,
    ),
  );

const q = `/p/test-gate?cwd=${encodeURIComponent(ws)}`;

assert.deepEqual(await call("GET", q), { config: null, suggested: "pnpm test", local: true });

await call("PUT", "/p/test-gate", {
  cwd: "/other",
  config: { enabled: true, command: "make test" },
});

await call("PUT", "/p/test-gate", {
  cwd: ws,
  config: { enabled: true, command: "pnpm test", tries: 2 },
});

assert.deepEqual((await call("GET", q)).config, {
  enabled: true,
  command: "pnpm test",
  tries: 2,
  timeoutSec: 300,
});

await call("PUT", "/p/test-gate", { cwd: ws, config: null });

const file = objectOf(parseJson(readFileSync(join(stateDir, "test-gate.json"), "utf8")));

assert.deepEqual(Object.keys(file), ["/other"], "a clear drops only its own workspace");

assert.equal(
  (await call("PUT", "/p/test-gate", { cwd: ws, config: { command: 1 } })).error !== undefined,
  true,
);

// A gate for a remote workspace would never run (the hook runs beside a local CLI): refused.
setRemoteWorkspaces([
  { name: "far", host: "nova", remoteCwd: "/srv/far", path: "/remote/far", workspaceId: "w-far" },
]);

assert.equal(
  (
    await call("PUT", "/p/test-gate", {
      cwd: "/remote/far",
      config: { enabled: true, command: "true", tries: 3, timeoutSec: 60 },
    })
  ).error,
  "the test gate runs only for a local workspace",
);

setRemoteWorkspaces([]);

assert.deepEqual(await call("GET", "/p/test-gate/run?session=s1"), { run: null });

mkdirSync(join(stateDir, "test-gate"), { recursive: true });

writeFileSync(
  join(stateDir, "test-gate", "s1.json"),
  JSON.stringify({ state: "gave-up", attempt: 3, tries: 3, command: "x", startedAt: 1, tail: "" }),
);

await call("POST", "/p/test-gate/run", { session: "s1" });

assert.equal((await call("GET", "/p/test-gate/run?session=s1")).run && true, true);

assert.equal(
  fieldsOf((await call("GET", "/p/test-gate/run?session=s1")).run, { dismissed: "boolean?" })
    .dismissed,
  true,
);

assert.equal(
  (await call("GET", "/p/test-gate/run?session=../x")).error !== undefined,
  true,
  "no path out of the run dir",
);

console.log("test-gate routes ok");
