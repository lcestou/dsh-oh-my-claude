// Logging This box out stops This box's sessions and leaves an account's alone: an account is a
// local mount with a config dir of its own, so its login is not the one that went away.
import { strict as assert } from "node:assert";
import { ADAPTER_CURRENT, type PluginContext } from "../dsh.js";
import type { ClaudeProcess } from "../process.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { registryKey } from "./types.js";

// SAFETY: the registry symbol is the plugin's own key on globalThis, filled here as apply does
const g = globalThis as typeof globalThis & {
  [ADAPTER_CURRENT]?: Map<string, ClaudeCodeAdapter>;
};
const mounts = (g[ADAPTER_CURRENT] ??= new Map());
// SAFETY: the constructor reads `on` and nothing else from a context it is not mounted with
const ctx = { on() {} } as unknown as PluginContext;
const main = new ClaudeCodeAdapter(ctx, Config({}));
const work = new ClaudeCodeAdapter(
  ctx,
  Config({ providerId: "claude-code-work", providerName: "Work", configDir: "/tmp/omc-lk/work" }),
);
mounts.set(main.providerId, main);
mounts.set(work.providerId, work);

/** A live process stand-in that records its kill. */
const fake = () => {
  const p = {
    alive: true,
    killed: false,
    steers: new Map(),
    kill() {
      p.killed = true;
      p.alive = false;
    },
  };
  // SAFETY: logoutBox and liveCount read `alive` and call `kill`; the card reads `steers`
  return p as typeof p & ClaudeProcess;
};
const mine = fake();
const theirs = fake();
main.processes.set(registryKey(main.providerId, "s-main"), mine);
work.processes.set(registryKey(work.providerId, "s-work"), theirs);

assert.equal(main.loginKey, "", "the default mount is this box's login");
assert.equal(work.loginKey, "dir:/tmp/omc-lk/work", "an account is its own config dir");
assert.equal(main.liveCount(""), 1, "this box counts its own session only");
assert.equal(main.liveCount("dir:/tmp/omc-lk/work"), 1, "the account counts its own");
main.logoutBox("");
assert.equal(mine.killed, true, "This box's session stops");
assert.equal(theirs.killed, false, "the account's session keeps running");

// A turn on the account that fails for want of a login asks for the account's login, by name and
// provider id, and logging that account in clears it; This box's login does not.
{
  // SAFETY: noteTurnLogin reads is_error and api_error_status, nothing else, for a 401
  const refused = { type: "result", is_error: true, api_error_status: 401 } as never;
  work.noteTurnLogin("s-work", refused);
  assert.deepEqual(work.loginNeeded.get("s-work"), {
    host: "dir:/tmp/omc-lk/work",
    label: "Work",
    provider: "claude-code-work",
  });
  main.loginDone("");
  assert.ok(work.loginNeeded.has("s-work"), "This box's login leaves the account's card up");
  main.loginDone("dir:/tmp/omc-lk/work");
  assert.equal(work.loginNeeded.has("s-work"), false, "the account's login takes it down");
}
main.processes.delete(registryKey(work.providerId, "s-work"));
mounts.delete(work.providerId);
mounts.delete(main.providerId);
console.log("login-key ok");
