// An account's login runs on this box with the account's config dir in its environment, so the CLI
// writes the credentials there, and it is held under its own key: This box's login and an account's
// can run at once without one killing the other.
import { strict as assert } from "node:assert";
import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { cancelSshLogin, pollSshLogin, startSshLogin, THIS_BOX } from "./ssh-login.js";

let killed = 0;

/** A child that prints the sign-in URL and records the options it was spawned with. */
const seen: Array<{ command: string; env?: NodeJS.ProcessEnv }> = [];

const spawnFn: NonNullable<Parameters<typeof startSshLogin>[1]> = (command, _args, opts) => {
  seen.push({ command, env: opts.env });
  // startSshLogin reads stdout/stderr events, `kill` and `on`, nothing else.
  const stdout = new PassThrough();

  // Own properties: the runtime's ChildProcess serves its streams through getters.
  const child = Object.defineProperties(new ChildProcess(), {
    stdout: { value: stdout },
    stderr: { value: new PassThrough() },
    stdin: { value: new PassThrough() },
    kill: {
      value: () => {
        killed++;

        return true;
      },
    },
  });

  setTimeout(
    () => stdout.emit("data", Buffer.from("visit: https://claude.com/cai/oauth/authorize?x=1\n")),
    5,
  );

  return child;
};

const env = { ...process.env, CLAUDE_CONFIG_DIR: "/tmp/omc-acct/work" };

const started = await startSshLogin(THIS_BOX, spawnFn, 2000, "claude", 700, {
  key: "account:claude-code-work",
  env,
});

assert.match(started.url ?? "", /^https:\/\/claude\.com\//);

assert.equal(seen[0]?.command, "script", "this box's login runs under script, not ssh");

assert.equal(
  seen[0]?.env?.CLAUDE_CONFIG_DIR,
  "/tmp/omc-acct/work",
  "the account's dir reaches the CLI",
);

assert.equal((await pollSshLogin("account:claude-code-work", async () => true)).pending, true);

assert.equal(
  (await pollSshLogin(THIS_BOX, async () => true)).pending,
  false,
  "This box has no login in progress: the account's is held under its own key",
);

// Remove cancels a login it would otherwise leave running into a dir no row shows.
cancelSshLogin("account:claude-code-work");

assert.equal(killed, 1, "the held login's process is killed");

assert.equal((await pollSshLogin("account:claude-code-work", async () => true)).pending, false);

cancelSshLogin("account:claude-code-work");

assert.equal(killed, 1, "a second cancel finds nothing");

console.log("ssh-login-account ok");
