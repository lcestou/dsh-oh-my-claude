// Offline self-check: bun src/ssh-login.test.ts. Fake spawn, fake verify, no ssh, no network.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteSshToken,
  loginInvocation,
  pollSshLogin,
  readSshToken,
  sshTokenPath,
  startSshLogin,
  submitSshLoginCode,
  THIS_BOX,
} from "./ssh-login.js";

/** A whole token from the earlier setup-token flow: the ~100-char shape the store insists on. */
const FULL = `sk-ant-oat01-${"A_b9".repeat(20)}`;

/** A stand-in for a child process: stdout/stderr emit data, stdin records writes, exit is driven. */
function fakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [] as string[];
  child.stdin = { write: (s: string) => child.written.push(s) };
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

/** A spawner that emits `firstLine` on stdout shortly after start and hands the child back. */
function spawner(firstLine: string): { spawnFn: any; child: () => any } {
  let child: any;
  const spawnFn = (() => {
    child = fakeChild();
    setTimeout(() => child.stdout.emit("data", Buffer.from(firstLine)), 5);
    return child;
  }) as any;
  return { spawnFn, child: () => child };
}
const yes = async () => true;
const no = async () => false;

// Legacy token store: a token file from the setup-token days still reads back, a truncated one
// reads as no login, and Log out's delete leaves nothing.
{
  const dir = mkdtempSync(join(tmpdir(), "omc-tok-"));
  assert.equal(readSshToken(dir, "nova"), undefined);
  mkdirSync(join(dir, "ssh-tokens"), { recursive: true });
  writeFileSync(sshTokenPath(dir, "nova"), `${FULL}\n`);
  assert.equal(readSshToken(dir, "nova"), FULL);
  writeFileSync(sshTokenPath(dir, "nova"), "sk-ant-oat01-P\n");
  assert.equal(readSshToken(dir, "nova"), undefined, "a truncated file is not a login");
  writeFileSync(sshTokenPath(dir, "nova"), `${FULL}\n`);
  deleteSshToken(dir, "nova");
  assert.equal(readSshToken(dir, "nova"), undefined);
  rmSync(dir, { recursive: true, force: true });
}

// A host names its own token file. The host string reaches this from the panel's add-box form, so
// the file name is a slug rather than the host itself: nothing a form can type may put the token
// outside the state directory, and no host may be long enough to blow the file name.
{
  const dir = "/var/dsh-state";
  assert.equal(sshTokenPath(dir, "nova.local"), "/var/dsh-state/ssh-tokens/nova-local");
  assert.equal(sshTokenPath(dir, "NOVA"), "/var/dsh-state/ssh-tokens/nova", "case folds");
  assert.equal(
    sshTokenPath(dir, "user@host.example.com"),
    "/var/dsh-state/ssh-tokens/user-host-example-com",
  );
  assert.equal(sshTokenPath(dir, "../../etc/passwd"), "/var/dsh-state/ssh-tokens/etc-passwd");
  const long = sshTokenPath(dir, "a".repeat(200)).split("/").pop() ?? "";
  assert.ok(long.length <= 64);
  assert.equal(sshTokenPath(dir, THIS_BOX), "/var/dsh-state/ssh-tokens/.this-box");
}

// The paste path: the URL is parsed, the code is typed then submitted with CR, and once the process
// exits the box's own status decides the outcome.
{
  const { spawnFn, child } = spawner(
    "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc\nPaste code here if prompted >",
  );
  const start = await startSshLogin("nova", spawnFn, 2000);
  assert.match(
    start.url ?? "",
    /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&state=abc$/,
  );

  // A newline in the code is refused before it reaches stdin.
  assert.match((await submitSshLoginCode("nova", "a\nb", yes)).error ?? "", /invalid/);

  // A clean code is typed; the outcome waits for the exit, then asks the box.
  let asked = 0;
  const verify = async () => {
    asked++;
    return true;
  };
  const submit = submitSshLoginCode("nova", "  thecode123  ", verify, 2000);
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(child().written.includes("thecode123"));
  // The carriage-return submit lands after the type (the Ink prompt ignores a bare newline).
  assert.ok(child().written.includes("\r"));
  assert.equal(asked, 0, "the box is not asked while the process runs");
  child().stdout.emit("data", Buffer.from("\nLogin successful\n"));
  child().emit("close", 0);
  const res = await submit;
  assert.deepEqual(res, { done: true });
  assert.equal(asked, 1);

  // After it has exited, a further submit or a poll answers the same outcome without asking again.
  assert.deepEqual(await submitSshLoginCode("nova", "again", verify), { done: true });
  assert.deepEqual(await pollSshLogin("nova", verify), { pending: false, done: true });
  assert.equal(asked, 1, "verified once, answered from memory after");
  assert.deepEqual(await pollSshLogin("never-started", yes), {
    pending: false,
    done: false,
    error: "no login in progress; start again",
  });
}

// A login nobody finishes is killed after its time to live, so an abandoned start does not hold a
// login process for the life of the server.
{
  const { spawnFn, child } = spawner("https://claude.com/t?state=1\n");
  // The start resolves on its 250ms poll, so the time to live has to outlast that first.
  await startSshLogin("box-ttl", spawnFn, 2000, "claude", 700);
  assert.equal(child().killed, false);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(child().killed, true, "killed once the time to live passed");
}

// The loopback path: on a box with a browser the approval reaches the CLI itself and it exits with
// no code pasted. The poll reads pending while it runs and reports the box's answer once it exits.
{
  const { spawnFn, child } = spawner(
    "https://claude.com/cai/oauth/authorize?code=true&state=s\nPaste code here if prompted >",
  );
  await startSshLogin("box0", spawnFn, 2000);
  assert.deepEqual(await pollSshLogin("box0", yes), { pending: true });
  child().stdout.emit("data", Buffer.from("\nLogin successful\n"));
  child().emit("close", 0);
  assert.deepEqual(await pollSshLogin("box0", yes), { pending: false, done: true });
  assert.equal(child().written.length, 0, "nothing typed at a prompt that never needed a code");
}

// Exited but the box still says logged out: the poll carries the CLI's last line, not a false success.
{
  const { spawnFn, child } = spawner("go to https://claude.com/x?state=z\n");
  await startSshLogin("box2", spawnFn, 2000);
  const submit = submitSshLoginCode("box2", "code", no, 2000);
  child().stdout.emit("data", Buffer.from("Failed to exchange authorization code\n"));
  child().emit("close", 1);
  const res = await submit;
  assert.equal(res.done, false);
  assert.match(res.error ?? "", /Failed to exchange/);
  const failed = await pollSshLogin("box2", no);
  assert.ok(!failed.pending && failed.done === false);
}

// A login that never prints a URL times out with the last line as the reason, not a hang.
{
  const { spawnFn } = spawner("ssh: connect to host nova port 22: Connection refused\n");
  const start = await startSshLogin("box3", spawnFn, 400);
  assert.match(start.error ?? "", /Connection refused/);
}

// This box runs the login under a local `script` PTY, with the platform deciding the argument
// order; a box rides `ssh -tt`. Both run `claude auth login`, the CLI's own login, so the terminal
// on that box is logged in by the same act.
{
  const linux = loginInvocation(THIS_BOX, "claude", "linux");
  assert.equal(linux.command, "script");
  assert.deepEqual(linux.args.slice(0, 1), ["-qfc"]);
  assert.match(linux.args[1] ?? "", /BROWSER=true .*claude auth login$/);
  assert.equal(linux.args[2], "/dev/null");
  const mac = loginInvocation(THIS_BOX, "claude", "darwin");
  assert.deepEqual(mac.args.slice(0, 4), ["-q", "/dev/null", "sh", "-c"]);
  assert.match(mac.args[4] ?? "", /claude auth login$/);
  const box = loginInvocation("nova", "claude", "linux");
  assert.equal(box.command, "ssh");
  assert.equal(box.args[0], "-tt");
  assert.ok(box.args.some((a) => a.includes("claude auth login")));
}

console.log("ok ssh-login");
