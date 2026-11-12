// An ssh box answers for its own routing: what its settings say, read through the real scripts
// run by a local shell with a throwaway home, and what the kept answers do between asks.
import { strict as assert } from "node:assert";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { tempDir } from "../test-tmp.js";
import {
  askBoxRoute,
  type BoxRunner,
  boxRouteKnown,
  boxRouteOf,
  boxRouteState,
  forgetBoxRoutes,
  parseBoxEnv,
  parseBoxProbe,
} from "./box-route.js";

const MARK = "\n<<omc-box-route>>\n";

// The three layers merge lowest first: shell, user file, managed file.
{
  const out = [
    "ANTHROPIC_BASE_URL=http://shell:1\nANTHROPIC_DEFAULT_HAIKU_MODEL_NAME=From Shell",
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:15721",
        ANTHROPIC_AUTH_TOKEN: "sk-router-key",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "GLM 4.6",
      },
    }),
    JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Managed Name" } }),
    "",
  ].join(MARK);
  const read = parseBoxEnv(out);
  assert.equal(read?.env.baseUrl, "http://127.0.0.1:15721", "the user file outranks the shell");
  assert.equal(read?.env.aliasNames.sonnet, "Managed Name", "the managed file outranks both");
  assert.equal(read?.env.aliasNames.haiku, "From Shell");
  assert.equal(read?.env.aliasModels.sonnet, "glm-4.6");
  assert.equal(read?.ownWindow, false);
  assert.ok(!JSON.stringify(read).includes("sk-router-key"), "the router's key is not kept");
}
// A window the box states itself, by settings key or by variable.
assert.equal(parseBoxEnv(["", '{"autoCompactWindow":90000}', "", ""].join(MARK))?.ownWindow, true);
assert.equal(
  parseBoxEnv(["CLAUDE_CODE_MAX_CONTEXT_TOKENS=64000", "", "", ""].join(MARK))?.ownWindow,
  true,
);
// No files at all is a box with no router; an answer cut short is no answer.
assert.deepEqual(parseBoxEnv(["", "", "", ""].join(MARK))?.env.baseUrl, undefined);
assert.equal(parseBoxEnv(["", "{}"].join(MARK)), undefined);
assert.equal(parseBoxEnv(""), undefined);

// The probe: Anthropic's request id in the header, a router's own body, nothing at all.
assert.equal(
  parseBoxProbe(
    'HTTP/1.1 100 Continue\r\n\r\nHTTP/2 401\r\nrequest-id: req_011CTestAbCdEfGhIjKlMnOp\r\n\r\n{"type":"error","error":{"type":"authentication_error"}}',
  ),
  true,
);
assert.equal(parseBoxProbe('HTTP/1.1 401 Unauthorized\r\n\r\n{"detail":"unauthorized"}'), false);
assert.equal(parseBoxProbe("HTTP/1.1 404 Not Found\r\n\r\nnot json"), false);
assert.equal(parseBoxProbe(""), undefined);
assert.equal(parseBoxProbe(undefined), undefined);

/** The far shell, played by a local one whose home is `home`. The host is not used. */
const shellAt =
  (home: string): BoxRunner =>
  (_host, script) =>
    new Promise((resolve) =>
      execFile(
        "sh",
        ["-c", script],
        { env: { HOME: home, PATH: process.env.PATH }, timeout: 10_000 },
        (e, out) => resolve(e ? undefined : String(out)),
      ),
    );

// The real scripts against a router that answers: the box reads as routed, by its own address.
{
  const server = createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ detail: "unauthorized" }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  // SAFETY: a listening TCP server's address is the object form
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const home = tempDir("omc-box-route-");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({
      env: { ANTHROPIC_BASE_URL: `http://${host}`, ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "GLM 4.6" },
    }),
  );
  const routed = await askBoxRoute("box", shellAt(home));
  assert.equal(routed?.env.baseUrl, `http://${host}`);
  assert.equal(routed?.env.aliasNames.sonnet, "GLM 4.6");
  let curl = true;
  try {
    execFileSync("curl", ["--version"], { stdio: "ignore" });
  } catch {
    curl = false;
  }
  // Without curl the endpoint cannot be asked from the box, and the state stays unknown.
  if (routed) assert.deepEqual(boxRouteState(routed), { state: curl ? "routed" : "unknown", host });
  server.close();

  // A box with no settings file talks straight to Anthropic.
  const plain = await askBoxRoute("box", shellAt(tempDir("omc-box-plain-")));
  assert.deepEqual(plain && boxRouteState(plain), { state: "direct" });
}

// Kept answers: a listing never waits, is told when the box's answer lands, and an unreachable
// box is kept as unknown instead of being asked on every listing.
{
  forgetBoxRoutes();
  let asked = 0;
  const run: BoxRunner = async () => {
    asked += 1;
    return ["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME=Big", "", "", ""].join(MARK);
  };
  const changed = new Promise<void>((done) => {
    assert.equal(boxRouteKnown("nova", done, run), undefined, "nothing kept yet");
  });
  await changed;
  assert.equal(boxRouteKnown("nova", () => {}, run)?.env.aliasNames.opus, "Big");
  assert.equal((await boxRouteOf("nova", run))?.env.aliasNames.opus, "Big");
  assert.equal(asked, 1, "a fresh answer is not asked for again");

  let dead = 0;
  const down: BoxRunner = async () => {
    dead += 1;
    return undefined;
  };
  assert.equal(await boxRouteOf("gone", down), undefined);
  assert.equal(
    boxRouteKnown("gone", () => {}, down),
    undefined,
  );
  assert.equal(dead, 1, "an unreachable box is asked once per interval");
}
