// Offline self-check: bun src/ssh-login.test.ts. Fake spawn, no ssh, no network.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteSshToken,
  readSshToken,
  startSshLogin,
  submitSshLoginCode,
  writeSshToken,
} from "./ssh-login.js";

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
  writeSshToken(dir, "nova", "sk-ant-oat01-abc");
  assert.equal(readSshToken(dir, "nova"), "sk-ant-oat01-abc");
  deleteSshToken(dir, "nova");
  assert.equal(readSshToken(dir, "nova"), undefined);
  rmSync(dir, { recursive: true, force: true });
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
  child.stdout.emit("data", Buffer.from("\n✓ created\nsk-ant-oat01-THE_token-01AAA\n"));
  child.emit("exit", 0);
  const res = await submit;
  assert.equal(res.done, true);
  assert.equal(res.token, "sk-ant-oat01-THE_token-01AAA");
  assert.ok(child.written.includes("thecode123"));
  // The carriage-return submit lands after the type (the Ink prompt ignores a bare newline).
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(child.written.includes("\r"));

  // After it has exited, a further submit reports no login in progress.
  assert.match((await submitSshLoginCode("nova", "again")).error ?? "", /no login in progress/);
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
  child.emit("exit", 1);
  const res = await submit;
  assert.equal(res.done, false);
  assert.match(res.error ?? "", /Failed to exchange/);
}

// A login that never prints a URL times out with the last line as the reason, not a hang.
{
  const spawnFn = (() => fakeChild()) as any;
  const start = await startSshLogin("deadbox", spawnFn, 300);
  assert.equal(start.url, undefined);
  assert.ok(start.error);
}

console.log("ok ssh-login");
