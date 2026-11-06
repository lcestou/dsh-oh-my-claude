// spawnModeFor, keeperOwner, ownsKeeper and the seam's credential pass-through (#241): the config
// key wins, the switch decides otherwise, Windows never gets a keeper, an untagged keeper is
// anyone's, and `spawn: dsh` hands Claude the credential names dsh's seam would drop.
import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import type { SubprocessHandle, SubprocessSpawnSpec } from "../dsh.js";
import {
  CHILD_ENV,
  claudeDirs,
  credentialEnv,
  seamSpawner,
  type ClaudeProcessSpec,
} from "../process.js";
import { configuredSpawn, flipOnly, keeperOwner, ownsKeeper, spawnModeFor } from "./spawn-mode.js";
import { specKey } from "./turn.js";

assert.equal(spawnModeFor(undefined, false, "linux"), "keeper", "switch on: keeper");
assert.equal(spawnModeFor(undefined, true, "linux"), "dsh", "switch off: dsh's seam");
assert.equal(spawnModeFor("node", false, "linux"), "node", "the config key beats switch on");
assert.equal(spawnModeFor("dsh", false, "darwin"), "dsh", "the config key beats switch on");
assert.equal(spawnModeFor("keeper", true, "linux"), "dsh", "a pasted spawn: keeper locks nothing");
assert.equal(spawnModeFor("keeper", false, "linux"), "keeper");
assert.equal(spawnModeFor(undefined, false, "win32"), "node", "no keeper on Windows");
assert.equal(spawnModeFor("keeper", false, "win32"), "node", "not even when configured");
assert.equal(spawnModeFor(undefined, true, "win32"), "dsh", "off is the seam on Windows too");
assert.equal(configuredSpawn("keeper"), null, "keeper is the default, not a lock");
assert.equal(configuredSpawn(undefined), null);
assert.equal(configuredSpawn("node"), "node");

const kept: ClaudeProcessSpec = {
  cwd: "/w",
  model: "m",
  effort: null,
  mode: "default",
  sessionId: "s",
  temporary: false,
};
assert.ok(flipOnly(specKey(kept), undefined, { ...kept, child: "dsh" }), "switch flipped off");
assert.ok(flipOnly(specKey({ ...kept, child: "dsh" }), "dsh", kept), "switch flipped on");
assert.ok(!flipOnly(specKey(kept), undefined, kept), "nothing changed: not a flip");
assert.ok(
  !flipOnly(specKey(kept), undefined, { ...kept, model: "other", child: "dsh" }),
  "a model change rides along: respawn as before",
);

assert.equal(keeperOwner({ dir: "/home/u/.dsh/profiles/web" }), "/home/u/.dsh/profiles/web");
assert.equal(keeperOwner({ dir: "" }), undefined, "an empty dir is no tag");
assert.equal(keeperOwner(undefined), undefined);
assert.ok(ownsKeeper("/a", "/a"), "same profile: ours");
assert.ok(!ownsKeeper("/a", "/b"), "another profile's keeper is left alone");
assert.ok(ownsKeeper("/a", undefined), "a keeper from before the tag is adopted");
assert.ok(ownsKeeper(undefined, "/b"), "a dsh with no profile context adopts as before");

assert.deepEqual(
  credentialEnv({
    ANTHROPIC_API_KEY: "k",
    GH_TOKEN: "g",
    MAX_THINKING_TOKENS: "8000",
    DSH_SPEECH_TOKEN: "d",
    PATH: "/bin",
    EMPTY_TOKEN: undefined,
  }),
  { ANTHROPIC_API_KEY: "k", GH_TOKEN: "g", MAX_THINKING_TOKENS: "8000" },
  "what the seam drops comes back, except DSH_* names; ordinary names are left to the seam",
);
let spec: SubprocessSpawnSpec | undefined;
const idle: SubprocessHandle = {
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  done: new Promise(() => {}),
  terminate() {},
  waitForExit: async () => {},
};
seamSpawner(
  {
    spawn: (s) => {
      spec = s;
      return idle;
    },
  },
  { ANTHROPIC_AUTH_TOKEN: "t", PATH: "/usr/bin:/bin" },
)("claude", ["-p"], "/w");
const env = spec?.env ?? {};
assert.equal(env.ANTHROPIC_AUTH_TOKEN, "t", "an ANTHROPIC_AUTH_TOKEN login reaches Claude");
for (const k of Object.keys(CHILD_ENV)) assert.ok(k in env, `${k} is set`);
if (process.platform !== "win32") {
  assert.ok(env.PATH?.startsWith("/usr/bin:/bin"), "the inherited PATH comes first");
  for (const dir of claudeDirs())
    assert.ok(
      env.PATH?.split(":").includes(dir),
      `the seam child finds ${dir}, as a node child does`,
    );
}
console.log("spawn-mode ok");
