// Offline self-check: bun src/ssh-login.test.ts. Fake spawn, no ssh, no network.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteSshToken,
  pollSshLogin,
  readSshToken,
  sshTokenPath,
  startSshLogin,
  submitSshLoginCode,
  writeSshToken,
} from "./ssh-login.js";

/** A whole minted token: the ~100-char shape the store and the capture both insist on. */
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

// Token store round-trips through a private per-host file.
{
  const dir = mkdtempSync(join(tmpdir(), "omc-tok-"));
  assert.equal(readSshToken(dir, "nova"), undefined);
  writeSshToken(dir, "nova", FULL);
  assert.equal(readSshToken(dir, "nova"), FULL);
  // A truncated file — what a chunk-boundary capture used to store — reads as no login at all,
  // rather than being injected into the box's env and failing there with a 401.
  writeSshToken(dir, "nova", "sk-ant-oat01-P");
  assert.equal(readSshToken(dir, "nova"), undefined);
  writeSshToken(dir, "nova", FULL);
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
  assert.equal(
    sshTokenPath(dir, "../../etc/passwd"),
    "/var/dsh-state/ssh-tokens/etc-passwd",
    "a traversal attempt is one flat name under the token directory",
  );
  const long = sshTokenPath(dir, "a".repeat(200)).split("/").pop() ?? "";
  assert.equal(long.length, 64, "the name is bounded");
  // A host of nothing but punctuation would otherwise slug to an empty name, which would make the
  // token directory itself the file.
  assert.equal(sshTokenPath(dir, "///"), "/var/dsh-state/ssh-tokens/x");
}

// setup-token flow: the URL is parsed, the code is typed then submitted with CR, the minted token is
// captured on exit.
{
  let child: any;
  const spawnFn = ((_cmd: string, args: string[]) => {
    // -tt forces the remote PTY; the host and `claude setup-token` follow.
    assert.equal(args[0], "-tt");
    assert.ok(args.includes("nova"));
    assert.ok(args.some((a) => a.includes("setup-token")));
    child = fakeChild();
    setTimeout(
      () =>
        child.stdout.emit(
          "data",
          Buffer.from(
            "Browser didn't open? Use the url below to sign in\n" +
              "https://claude.com/cai/oauth/authorize?code=true&state=abc\n Paste code here >",
          ),
        ),
      5,
    );
    return child;
  }) as any;
  const start = await startSshLogin("nova", spawnFn, 2000);
  assert.match(
    start.url ?? "",
    /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&state=abc$/,
  );

  // A newline in the code is refused before it reaches stdin.
  assert.match((await submitSshLoginCode("nova", "a\nb")).error ?? "", /invalid/);

  // A clean code is typed; the token is parsed once the process prints it and exits.
  const submit = submitSshLoginCode("nova", "  thecode123  ", 2000);
  child.stdout.emit("data", Buffer.from(`\n✓ created\n${FULL}\n`));
  child.emit("close", 0);
  const res = await submit;
  assert.equal(res.done, true);
  assert.equal(res.token, FULL);
  assert.ok(child.written.includes("thecode123"));
  // The carriage-return submit lands after the type (the Ink prompt ignores a bare newline).
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(child.written.includes("\r"));

  // After it has exited with a token, a further submit or a poll answers with that token again: a
  // second ask must not undo a login that succeeded.
  assert.equal((await submitSshLoginCode("nova", "again")).token, FULL);
  assert.deepEqual(pollSshLogin("nova"), { pending: false, done: true, token: FULL });
  assert.deepEqual(pollSshLogin("never-started"), {
    pending: false,
    done: false,
    error: "no login in progress; start again",
  });
}

// A login nobody finishes is killed after its time to live, so an abandoned start does not hold a
// setup-token process for the life of the server.
{
  let child: any;
  const spawnFn = (() => {
    child = fakeChild();
    setTimeout(() => child.stdout.emit("data", Buffer.from("https://claude.com/t?state=1\n")), 5);
    return child;
  }) as any;
  // The start resolves on its 250ms poll, so the time to live has to outlast that first.
  await startSshLogin("box-ttl", spawnFn, 2000, "claude", 700);
  assert.equal(child.killed, false);
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(child.killed, true, "killed once the time to live passed");
}

// setup-token on a box that already has a login mints the token by itself: no code is ever pasted.
// The poll reads pending while it runs and hands over the token once it has printed one and exited.
{
  let child: any;
  const spawnFn = (() => {
    child = fakeChild();
    setTimeout(
      () =>
        child.stdout.emit(
          "data",
          Buffer.from(
            "https://claude.com/cai/oauth/authorize?code=true&state=s\nPaste code here if prompted >",
          ),
        ),
      5,
    );
    return child;
  }) as any;
  await startSshLogin("box0", spawnFn, 2000);
  assert.deepEqual(pollSshLogin("box0"), { pending: true });
  child.stdout.emit("data", Buffer.from(`\n✓ created\n${FULL}\n`));
  child.emit("close", 0);
  assert.deepEqual(pollSshLogin("box0"), { pending: false, done: true, token: FULL });
  assert.equal(child.written.length, 0, "nothing typed at a prompt that never needed a code");
  // Exited without a token: the poll carries the CLI's last line, not a false success.
  const spawn2 = (() => {
    child = fakeChild();
    setTimeout(() => child.stdout.emit("data", Buffer.from("https://claude.com/z?state=1\n")), 5);
    return child;
  }) as any;
  await startSshLogin("box0", spawn2, 2000);
  child.stdout.emit("data", Buffer.from("Failed to exchange authorization code\n"));
  child.emit("close", 1);
  const failed = pollSshLogin("box0");
  assert.ok(!failed.pending && failed.done === false);
  assert.match((failed.pending ? "" : failed.error) ?? "", /Failed to exchange/);
}

// A login that exits without a token is an honest error, not a false success.
{
  let child: any;
  const spawnFn = (() => {
    child = fakeChild();
    setTimeout(
      () => child.stdout.emit("data", Buffer.from("visit: https://claude.com/x?state=z\n")),
      5,
    );
    return child;
  }) as any;
  await startSshLogin("box2", spawnFn, 2000);
  const submit = submitSshLoginCode("box2", "code", 2000);
  child.stdout.emit("data", Buffer.from("Failed to exchange authorization code\n"));
  child.emit("close", 1);
  const res = await submit;
  assert.equal(res.done, false);
  assert.match(res.error ?? "", /Failed to exchange/);
}

// The token split across chunks with `exit` in between: exit is not the end of stdout, so the half
// that arrived first must not be stored as the login. The whole token lands once the stream closes.
{
  let child: any;
  const spawnFn = (() => {
    child = fakeChild();
    setTimeout(
      () => child.stdout.emit("data", Buffer.from("go to https://claude.com/y?state=q\n")),
      5,
    );
    return child;
  }) as any;
  await startSshLogin("box3", spawnFn, 2000);
  const submit = submitSshLoginCode("box3", "code", 3000);
  // A cut long enough that the first half is itself token-shaped: the length floor cannot save
  // this one, only waiting for the stream to close can.
  const cut = 60;
  child.stdout.emit("data", Buffer.from(`\n✓ created\n${FULL.slice(0, cut)}`));
  child.emit("exit", 0);
  await new Promise((r) => setTimeout(r, 400));
  child.stdout.emit("data", Buffer.from(`${FULL.slice(cut)}\n`));
  child.emit("close", 0);
  const res = await submit;
  assert.equal(res.done, true);
  assert.equal(res.token, FULL);
}

// A login that never prints a URL times out with the last line as the reason, not a hang.
{
  const spawnFn = (() => fakeChild()) as any;
  const start = await startSshLogin("deadbox", spawnFn, 300);
  assert.equal(start.url, undefined);
  assert.ok(start.error);
}

console.log("ok ssh-login");

// This box: the token file has a name no slug can produce, and setup-token runs under a local
// `script` PTY, with the platform deciding the argument order.
{
  const { THIS_BOX, setupTokenInvocation } = await import("./ssh-login.js");
  assert.equal(sshTokenPath("/var/dsh-state", THIS_BOX), "/var/dsh-state/ssh-tokens/.this-box");
  const linux = setupTokenInvocation(THIS_BOX, "claude", "linux");
  assert.equal(linux.command, "script");
  assert.deepEqual(linux.args.slice(0, 1), ["-qfc"]);
  assert.match(linux.args[1] ?? "", /claude setup-token$/);
  assert.match(
    linux.args[1] ?? "",
    /^BROWSER=true DISPLAY= WAYLAND_DISPLAY= /,
    "no tab of its own",
  );
  const mac = setupTokenInvocation(THIS_BOX, "claude", "darwin");
  assert.deepEqual(mac.args.slice(0, 4), ["-q", "/dev/null", "sh", "-c"]);
  const box = setupTokenInvocation("nova", "claude", "linux");
  assert.equal(box.command, "ssh");
  assert.equal(box.args[0], "-tt");
}
