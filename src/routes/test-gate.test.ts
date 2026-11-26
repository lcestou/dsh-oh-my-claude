// The test gate routes over a real socket: a suggestion from the workspace's files, a save that
// keeps other workspaces, a clear, and a run's close written back to its file.
import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonValue } from "../dsh.js";
import { testGateRoutes } from "./test-gate.js";
import { setRemoteWorkspaces } from "../adapter/config.js";

const root = mkdtempSync(join(tmpdir(), "omc-gate-routes-"));
const stateDir = join(root, "state");
const ws = join(root, "ws");
mkdirSync(ws);
writeFileSync(join(ws, "package.json"), '{"scripts":{"test":"vitest"}}');
writeFileSync(join(ws, "pnpm-lock.yaml"), "");

/** The request body as JSON, `{}` when empty. */
const readBody = async (req: IncomingMessage) => {
  let s = "";
  for await (const c of req) s += String(c);
  // SAFETY: the test sends only JSON objects
  return (s ? JSON.parse(s) : {}) as { [key: string]: JsonValue };
};
const route = testGateRoutes({
  ROUTE_PREFIX: "/p",
  stateDir,
  json: (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  },
  readBody,
});
const server = createServer((req, res) => {
  void route(req, res, new URL(req.url ?? "/", "http://x")).then((r) => {
    if (typeof r === "symbol") res.writeHead(404).end();
  });
}).listen(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;
/** One request, answered as JSON. */
const call = async (method: string, path: string, body?: object) =>
  (await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json())) as Record<string, unknown>;

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
const file = JSON.parse(readFileSync(join(stateDir, "test-gate.json"), "utf8")) as object;
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
  ((await call("GET", "/p/test-gate/run?session=s1")).run as { dismissed?: boolean }).dismissed,
  true,
);
assert.equal(
  (await call("GET", "/p/test-gate/run?session=../x")).error !== undefined,
  true,
  "no path out of the run dir",
);
server.close();
console.log("test-gate routes ok");
