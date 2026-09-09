// Offline self-check: bun src/hold.test.ts. No ssh, no box: the scripts are asserted as text and
// the handle is driven through a fake runner that plays the far side.
import { strict as assert } from "node:assert";
import { PassThrough, Writable } from "node:stream";
import {
  ERR,
  EXIT,
  GONE,
  READY,
  holdAttachScript,
  holdHandle,
  holdKillScript,
  holdName,
  holdStartScript,
  parseHoldLine,
  reattachDelay,
  type RunOnBox,
} from "./hold.js";
import type { SubprocessHandle } from "./process.js";

// One dir per spawn: same session, different stamp, different name; the hash part is stable.
assert.notEqual(holdName("claude-code-box", "s1", 1), holdName("claude-code-box", "s1", 2));
assert.equal(
  holdName("claude-code-box", "s1", 1).slice(0, 16),
  holdName("claude-code-box", "s1", 2).slice(0, 16),
);

// The start script: far dir under $HOME, FIFO, setsid'd inner sh that holds the FIFO read-write,
// the exit code recorded, the pid file, and the cli plus its env single-quoted for the far shell.
{
  const s = holdStartScript("abc-1", "/srv/app", "claude", ["-p", "--add-dir", "/a b'c"], "tok");
  assert.match(
    s,
    /^d="\$HOME"\/\.local\/state\/dsh-oh-my-claude\/hold\/'abc-1'; mkdir -p "\$d" && mkfifo "\$d"\/in \|\| exit 70; /,
  );
  assert.match(s, /cd '\/srv\/app' 2>\/dev\/null \|\| cd "\$HOME"; /);
  assert.match(
    s,
    /setsid sh -c '.*' "\$d" 1>>"\$d"\/out\.log 2>>"\$d"\/err\.log & echo \$! >"\$d"\/pid; /,
  );
  assert.match(s, /exec 0<>"\$0"\/in; env /, "the inner sh opens the FIFO read-write for the cli");
  // The inner script is single-quoted once more for the far shell, so each of its own quotes
  // reads '\'' there; the far `sh -c` sees the inner text back as written.
  assert.match(s, /CLAUDE_CODE_OAUTH_TOKEN='\\''tok'\\''/, "the token rides in the inner env");
  assert.ok(s.includes("/a b"), "the argument with a quote is carried");
  assert.match(s, /echo \$\? >"\$0"\/exit/, "the exit code lands in the far dir");
  assert.match(s, new RegExp(`printf '${READY} %s\\\\n' "\\$!"$`), "answers the leader's pid");
}

// The attach script: gone dir exits 44, READY first, stdin into the FIFO, tail from the offset
// (1-based) bound to the leader's pid, stderr replayed, the exit line last.
{
  const s = holdAttachScript("abc-1", 120);
  assert.match(s, new RegExp(`\\[ -f "\\$d"/pid \\] \\|\\| exit ${GONE}; `));
  assert.match(s, new RegExp(`printf '${READY}\\\\n'; exec 3<&0; cat <&3 >"\\$d"/in & c=\\$!; `));
  assert.match(
    s,
    /if \[ -f "\$d"\/exit \]; then tail -c \+121 "\$d"\/out\.log; else tail -c \+121 -f --pid="\$p" "\$d"\/out\.log; fi; kill "\$c" 2>\/dev\/null; /,
    "an exit file ends the tail whatever the pid says",
  );
  assert.match(s, new RegExp(`sed 's/\\^/${ERR}/'`));
  assert.match(
    s,
    new RegExp(`printf '${EXIT}%s\\\\n' "\\$\\(cat "\\$d"/exit 2>/dev/null \\|\\| echo 255\\)"$`),
  );
  assert.match(
    holdAttachScript("abc-1", 0),
    /tail -c \+1 -f/,
    "offset 0 reads from the first byte",
  );
}
assert.match(
  holdKillScript("n"),
  /kill -TERM -- -"\$p" 2>\/dev\/null; sleep 5; kill -KILL -- -"\$p"/,
);

// Line sorting: nothing counts before READY (a login banner), then output, stderr and the exit.
assert.equal(parseHoldLine("Welcome to box", false), undefined);
assert.deepEqual(parseHoldLine(READY, false), { kind: "ready" });
assert.deepEqual(parseHoldLine('{"type":"result"}', true), {
  kind: "out",
  line: '{"type":"result"}',
});
assert.deepEqual(parseHoldLine(`${ERR}boom`, true), { kind: "err", line: "boom" });
assert.deepEqual(parseHoldLine(`${EXIT}3`, true), { kind: "exit", code: 3 });
assert.deepEqual(parseHoldLine(`${EXIT}`, true), { kind: "exit", code: 255 });
assert.deepEqual([0, 1, 2, 3, 9].map(reattachDelay), [2000, 4000, 8000, 15_000, 15_000]);

// A fake far side: each run() is one ssh whose output the test feeds and whose end the test decides.
interface FakeSsh {
  script: string;
  out: PassThrough;
  written: string[];
  end: (code: number) => void;
}
const fakeRunner = (): { run: RunOnBox; sshes: FakeSsh[] } => {
  const sshes: FakeSsh[] = [];
  const run: RunOnBox = (script) => {
    const out = new PassThrough();
    const err = new PassThrough();
    const written: string[] = [];
    let finish: ((v: { exitCode: number | null; signal: string | null }) => void) | undefined;
    const done = new Promise<{ exitCode: number | null; signal: string | null }>((r) => {
      finish = r;
    });
    const fake: FakeSsh = {
      script,
      out,
      written,
      end: (code) => {
        out.end();
        finish?.({ exitCode: code, signal: null });
      },
    };
    sshes.push(fake);
    return {
      stdin: new Writable({
        write(chunk, _e, cb) {
          written.push(String(chunk));
          cb();
        },
      }),
      stdout: out,
      stderr: err,
      done,
      terminate: () => {},
    };
  };
  return { run, sshes };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

// The handle: a prompt written before READY waits and lands after it; output moves the offset by
// the file's bytes; an ssh that ends without an exit line reattaches from that offset (the test
// waits out the 2 s delay); the exit line ends the handle with the far exit code, and stderr
// replayed after it reaches the stderr stream before the end.
{
  const { run, sshes } = fakeRunner();
  const offsets: number[] = [];
  const lines: string[] = [];
  const errs: string[] = [];
  let exited = 0;
  const h = holdHandle(
    run,
    "abc-1",
    10,
    (o) => offsets.push(o),
    () => exited++,
  );
  h.stdout.on("data", (d) => lines.push(String(d)));
  h.stderr.on("data", (d) => errs.push(String(d)));
  assert.equal(sshes.length, 1);
  assert.match(sshes[0]!.script, /tail -c \+11 /, "first attach reads from the recorded offset");
  h.stdin.write('{"type":"user"}\n');
  await tick();
  assert.deepEqual(sshes[0]!.written, [], "nothing goes into the FIFO before READY");
  sshes[0]!.out.write("banner line\n");
  sshes[0]!.out.write(`${READY}\n`);
  await tick();
  assert.deepEqual(sshes[0]!.written, ['{"type":"user"}\n'], "the queued prompt lands after READY");
  sshes[0]!.out.write('{"a":1}\n{"b":"é"}\n'); // 7 + 1 and 10 + 1 bytes in the file (é is two)
  await tick();
  assert.deepEqual(lines, ['{"a":1}\n', '{"b":"é"}\n']);
  assert.deepEqual(offsets, [18, 29]);
  // The ssh drops with no exit line: the CLI is still there, come back from byte 29.
  sshes[0]!.end(255);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(sshes.length, 2, "reattached once");
  assert.match(sshes[1]!.script, /tail -c \+30 /, "from the offset the last attach reached");
  assert.equal(exited, 0, "a dropped ssh is not an exit");
  h.stdin.write("steer\n");
  sshes[1]!.out.write(`${READY}\n`);
  await tick();
  assert.deepEqual(sshes[1]!.written, ["steer\n"]);
  sshes[1]!.out.write(`${ERR}last words\n${EXIT}7\n`);
  await tick();
  const outcome = await h.done;
  assert.deepEqual(outcome, { exitCode: 7, signal: null });
  assert.deepEqual(errs, ["last words\n"]);
  assert.equal(exited, 1);
  sshes[1]!.end(0);
  await tick();
  assert.equal(sshes.length, 2, "no reattach after the exit line");
}

// A fragment with no newline when the ssh drops is neither shown nor counted: the next attach
// reads it whole from the last full line's offset.
{
  const { run, sshes } = fakeRunner();
  const offsets: number[] = [];
  const lines: string[] = [];
  const h = holdHandle(run, "frag-1", 0, (o) => offsets.push(o));
  h.stdout.on("data", (d) => lines.push(String(d)));
  sshes[0]!.out.write(`${READY}\n{"a":1}\n{"par`);
  await tick();
  assert.deepEqual(lines, ['{"a":1}\n'], "the fragment is not a line");
  assert.deepEqual(offsets, [8]);
  sshes[0]!.end(255);
  await new Promise((r) => setTimeout(r, 2100));
  assert.match(sshes[1]!.script, /tail -c \+9 /, "reattached from the last full line");
  sshes[1]!.out.write(`${READY}\n{"part":2}\n${EXIT}0\n`);
  await tick();
  assert.deepEqual(lines, ['{"a":1}\n', '{"part":2}\n'], "the line arrives whole the second time");
  assert.equal((await h.done).exitCode, 0);
}

// A far dir that is gone ends the handle at once, as a failure, with no reattach loop.
{
  const { run, sshes } = fakeRunner();
  const h = holdHandle(run, "gone-1", 0, () => {});
  const errs: string[] = [];
  h.stderr.on("data", (d) => errs.push(String(d)));
  sshes[0]!.end(GONE);
  const outcome = await h.done;
  assert.equal(outcome.signal, "hold-gone");
  assert.match(errs.join(""), /far session directory is gone/);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(sshes.length, 1, "no reattach for a dir that is gone");
}

// terminate() runs the kill script on a second ssh; the exit still arrives through the attached one.
{
  const { run, sshes } = fakeRunner();
  const h = holdHandle(run, "k-1", 0, () => {});
  sshes[0]!.out.write(`${READY}\n`);
  await tick();
  h.terminate();
  assert.equal(sshes.length, 2);
  assert.match(sshes[1]!.script, /kill -TERM -- -"\$p"/);
  h.terminate();
  assert.equal(sshes.length, 2, "a second terminate does not run a second kill");
  sshes[0]!.out.write(`${EXIT}143\n`);
  assert.equal((await h.done).exitCode, 143);
}

// The scripts for real, on this box: a fake `claude` under a temp $HOME, started by the start
// script through `sh -c` and driven through the attach script, so the FIFO, setsid, tail --pid and
// the exit file are exercised the way the far shell will run them. Skipped where `setsid` is absent.
{
  const { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { nodeSpawner } = await import("./process.js");
  let hasSetsid = true;
  try {
    execFileSync("setsid", ["--version"], { stdio: "ignore" });
  } catch {
    hasSetsid = false;
  }
  if (hasSetsid) {
    const home = mkdtempSync(join(tmpdir(), "omc-hold-home-"));
    const cli = join(home, "fake-claude");
    // Echoes each stdin line back as a result line; "quit" ends it with code 5.
    writeFileSync(
      cli,
      '#!/bin/sh\nwhile IFS= read -r l; do [ "$l" = quit ] && exit 5; printf \'{"got":%s}\\n\' "$l"; done\n',
    );
    chmodSync(cli, 0o755);
    const sh = (script: string) => nodeSpawner("sh", ["-c", script], home, { HOME: home });
    const name = holdName("claude-code-box", "e2e", 7);
    const start = sh(holdStartScript(name, "/nonexistent", cli, []));
    let startOut = "";
    start.stdout.on("data", (d) => (startOut += String(d)));
    start.stdin.end();
    assert.equal((await start.done).exitCode, 0, "start script exits 0");
    assert.match(startOut, new RegExp(`^${READY} \\d+\\n$`), "start answers READY and the pid");
    // The leader outlives this process by design (that is the hold). Whatever the assertions below
    // do, it and its fake cli are ended here, by the pgid the start script made it the leader of.
    const leader = Number(startOut.trim().split(" ")[1]);
    process.on("exit", () => {
      try {
        process.kill(-leader, "SIGTERM");
      } catch {
        // already gone: the happy path ends it through "quit"
      }
    });
    const dir = join(home, ".local", "state", "dsh-oh-my-claude", "hold", name);
    assert.ok(existsSync(join(dir, "in")) && existsSync(join(dir, "pid")), "far dir is laid out");
    // First attach: write, read, drop the ssh; second attach from the offset sees only what is new.
    const offsets: number[] = [];
    const seen: string[] = [];
    const h1 = holdHandle(sh, name, 0, (o) => offsets.push(o));
    h1.stdout.on("data", (d) => seen.push(String(d)));
    h1.stdin.write("1\n");
    for (let i = 0; i < 100 && seen.length === 0; i++) await tick();
    assert.deepEqual(seen, ['{"got":1}\n'], "the fake cli answered through the FIFO and the log");
    const off = offsets.at(-1)!;
    assert.equal(
      off,
      readFileSync(join(dir, "out.log")).length,
      "offset is the file's byte length",
    );
    // Ending the attach's shell is the ssh dropping; the cli keeps its FIFO and its log.
    const h2 = holdHandle(sh, name, off, () => {});
    const seen2: string[] = [];
    h2.stdout.on("data", (d) => seen2.push(String(d)));
    h2.stdin.write("2\n");
    for (let i = 0; i < 100 && seen2.length === 0; i++) await tick();
    assert.deepEqual(seen2, ['{"got":2}\n'], "a second attach reads only from its offset");
    h2.stdin.write("quit\n");
    const outcome = await h2.done;
    assert.equal(outcome.exitCode, 5, "the exit code comes through the exit file");
    h1.terminate();
    console.log("hold e2e ok");
  }
}

// A real SubprocessHandle shape is what the runner must answer; the fake above is one.
const sample: SubprocessHandle = fakeRunner().run("true");
assert.ok(sample.done instanceof Promise);

console.log("hold ok");
