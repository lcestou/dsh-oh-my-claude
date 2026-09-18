// Offline self-check: bun src/remote-fs.test.ts. No CLI, no host, no network — the scripts are
// pure strings and the local branch writes under a temp dir.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import {
  ABSENT,
  afterMark,
  childPath,
  copyScript,
  dirsScript,
  listDirsAt,
  listNamesAt,
  listScript,
  makeDirAt,
  makeDirScript,
  homeAt,
  readAt,
  readScript,
  sizeScript,
  tailScript,
  readTextAt,
  removeAt,
  removeScript,
  splitDirs,
  splitRead,
  writeAt,
  writeScript,
  copyToAt,
} from "./remote-fs.js";
import type { SubprocessHandle } from "./process.js";

// Every path is single-quoted, so a space or a quote in a workspace path stays one argument.
{
  const path = "/home/a b/it's/settings.json";
  const read = readScript(path);
  assert.ok(read.includes("'/home/a b/it'\\''s/settings.json'"), "path is quoted in the read");
  assert.ok(read.endsWith(`else exit ${ABSENT}; fi`), "a missing file exits with the absent code");
  assert.ok(read.includes("stat -c %Y") && read.includes("stat -f %m"), "GNU and BSD stat");

  assert.equal(listScript("/w/dir"), "if [ -d '/w/dir' ]; then ls -A -- '/w/dir'; fi");
  const size = sizeScript(path);
  assert.ok(size.includes("stat -c %s") && size.includes("stat -f %z"), "GNU and BSD size");
  assert.ok(size.endsWith(`else exit ${ABSENT}; fi`), "a missing file exits with the absent code");
  assert.equal(tailScript("/w/t.jsonl", 41), "tail -c +42 -- '/w/t.jsonl' 2>/dev/null || true");
  assert.equal(removeScript("/w/x.md"), "rm -f -- '/w/x.md'");
  assert.equal(makeDirScript("/w/new dir"), "mkdir -- '/w/new dir'");

  // The picker's level script: an empty dir opens the box's own home, and an unreadable level exits
  // with the absent code rather than printing this PC's path.
  const dirs = dirsScript("/w/a b");
  assert.ok(dirs.startsWith("cd -- '/w/a b' 2>/dev/null || exit 44;"), "the level is quoted");
  assert.ok(dirs.includes("pwd;"), "the resolved level comes first");
  assert.ok(dirsScript("").startsWith('cd -- "$HOME"'), "an empty level means the box's home");
  assert.ok(dirs.endsWith("; exit 0"), "a level whose last child is a file still exits 0");

  // A write keeps a .bak and lands through a temp file, so a dropped connection cannot leave half
  // a settings file the CLI would refuse to start on.
  const write = writeScript("/w/.claude/settings.json", "e30K");
  assert.ok(write.startsWith("mkdir -p '/w/.claude'"), "the parent is created first");
  assert.ok(write.includes("cp -- '/w/.claude/settings.json' '/w/.claude/settings.json.bak'"));
  // The temp name carries the remote shell's pid: two writes to one path at once would otherwise
  // share it, and the second `mv` would find the file the first one already moved.
  assert.ok(write.includes("t='/w/.claude/settings.json.tmp'.$$"));
  assert.ok(write.includes("printf %s 'e30K' | base64 -d > \"$t\""));
  assert.ok(write.includes("mv -- \"$t\" '/w/.claude/settings.json'"));
  // The write answers its own mtime: reading it back would cost a second connection and report on a
  // file that may have moved on since.
  assert.ok(write.endsWith("echo 0; }"), "the write ends by printing the mtime it left");
}

// The level script prints the resolved path, then $HOME, then one child directory per line.
{
  assert.deepEqual(splitDirs("/home/me/p\n/home/me\nsrc\n.git\n"), {
    path: "/home/me/p",
    home: "/home/me",
    names: [".git", "src"],
  });
  assert.deepEqual(splitDirs("/\n/root\n"), { path: "/", home: "/root", names: [] });
  assert.equal(childPath("/", "etc"), "/etc", "the root's slash is not doubled");
  assert.equal(childPath("/home/me", "p"), "/home/me/p");
}

// The read script answers the mtime on its own line, then the file verbatim: content with blank
// lines and no trailing newline has to come back untouched.
{
  assert.deepEqual(splitRead('1700000000\n{\n  "a": 1\n}\n'), {
    text: '{\n  "a": 1\n}\n',
    mtimeMs: 1_700_000_000_000,
  });
  assert.deepEqual(splitRead("0\n"), { text: "", mtimeMs: 0 });
  // An mtime line the box could not produce reads as unknown rather than NaN.
  assert.equal(splitRead("\nbody").mtimeMs, 0);
}

// A login shell prints its rc files' chatter before our script gets a word in, and that noise used
// to be read as the mtime, a file name or $HOME. Everything before the marker is the box talking.
{
  assert.equal(afterMark("Welcome to box!\n\u0001omc\u00011700000000\nhi\n"), "1700000000\nhi\n");
  assert.equal(afterMark("\u0001omc\u0001"), "", "a script that printed nothing still answers");
  // No marker at all: ssh never ran the script, so there is no answer to read and the caller hears
  // about the box instead of reading a banner as an empty file.
  assert.equal(afterMark("ssh: connect to host box port 22: No route to host\n"), null);
  assert.equal(afterMark(""), null);
}

// The local branch: a box with no sshHost goes straight to the filesystem.
{
  const dir = await mkdtemp(join(tmpdir(), "omc-remote-fs-"));
  const box = {};
  const file = join(dir, "nested", "settings.json");

  assert.equal(await readTextAt(box, file), null, "a missing file reads as null");
  // A directory read as a file is not "absent": an unreadable file must not look like a missing one.
  await assert.rejects(() => readAt(box, dir), "a read that is not ENOENT throws");
  assert.deepEqual(await listNamesAt(box, join(dir, "gone")), [], "a missing dir lists empty");

  const mtime = await writeAt(box, file, '{"a":1}');
  assert.equal(await readFile(file, "utf8"), '{"a":1}\n', "the write ends with a newline");
  assert.ok(mtime > 0, "the write answers the mtime the editor checks against");
  const read = await readAt(box, file);
  assert.equal(read?.text, '{"a":1}\n');
  assert.equal(read?.mtimeMs, mtime);

  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "memory", "a.md"), "A");
  assert.deepEqual(await listNamesAt(box, join(dir, "memory")), ["a.md"]);

  await removeAt(box, join(dir, "memory", "a.md"));
  assert.deepEqual(await listNamesAt(box, join(dir, "memory")), []);
  await removeAt(box, join(dir, "memory", "a.md")); // gone already: not an error

  // The picker's level lists directories only, and a level that is not there is null rather than
  // an empty directory: the dialog says so instead of showing an empty box.
  const level = await listDirsAt(box, dir);
  assert.deepEqual(level?.names, ["memory", "nested"], "files are left out of a level");
  assert.equal(level?.path, dir);
  assert.equal(await listDirsAt(box, join(dir, "gone")), null);
}

// makeDirAt on the local box is a plain mkdir, not mkdir -p: the picker's New folder button makes
// one directory where the user is looking, and a typo in a deep path is an error rather than a tree
// of empty directories nobody asked for.
{
  const dir = await mkdtemp(join(tmpdir(), "omc-mkdir-"));
  const box = {};
  await makeDirAt(box, join(dir, "newfolder"));
  assert.ok((await listDirsAt(box, dir))?.names.includes("newfolder"));
  await assert.rejects(() => makeDirAt(box, join(dir, "no", "parent", "exists")));
}

// homeAt answers this box's own home only when there is no ssh host. Every user-scope settings path
// is built on it, so a box's `~/.claude/settings.json` must never be resolved against this home; the
// remote branch asks the box for its `$HOME` and is covered by the script tests above.
{
  assert.equal(await homeAt({}), homedir());
}

// copyToAt streams a local file to a box over stdin and answers the far path. No host here: the
// runner is a fake that records what it was handed and plays the far shell's part.
{
  const script = copyScript("ab12cd34-my file.zip", 34);
  assert.ok(
    script.startsWith('d="$HOME"/.local/state/dsh-oh-my-claude/attachments && mkdir -p "$d"'),
    "the far dir is under the far $HOME, left for the far shell to expand",
  );
  assert.ok(script.includes(`p="$d"/'ab12cd34-my file.zip'`), "the name is single-quoted");
  assert.ok(
    script.includes(
      't="$p.tmp.$$"; cat > "$t" && [ "$(($(wc -c < "$t")))" -eq 34 ] && mv -- "$t" "$p" || { rm -f -- "$t";',
    ),
    "the temp file takes the real name only at its full size, and a short one is removed",
  );
  assert.ok(script.includes('if [ -e "$p" ]; then cat >/dev/null;'), "an existing file is kept");
  assert.ok(script.endsWith('printf %s "$p"'), "the script's answer is the absolute far path");

  const tmp = await mkdtemp(join(tmpdir(), "omc-copy-test-"));
  const local = join(tmp, "payload.bin");
  const payload = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13, 0]);
  await writeFile(local, payload);
  const FAR = "/home/far/.local/state/dsh-oh-my-claude/attachments/x.bin";

  type Play = { stdout: string; stderr?: string; exitCode: number | null; hang?: boolean };
  const calls: { host: string; script: string; received: Buffer; terminated: boolean }[] = [];
  /** A far shell that answers `play` once its stdin has ended. */
  const runner =
    (play: Play) =>
    (host: string, script: string): SubprocessHandle => {
      const chunks: Buffer[] = [];
      const call = { host, script, received: Buffer.alloc(0), terminated: false };
      calls.push(call);
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settle: (v: { exitCode: number | null; signal: string | null }) => void = () => {};
      const done = new Promise<{ exitCode: number | null; signal: string | null }>((r) => {
        settle = r;
      });
      const stdin = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
        final(cb) {
          call.received = Buffer.concat(chunks);
          cb();
          if (play.hang) return;
          if (play.stderr) stderr.write(play.stderr);
          stdout.end(play.stdout);
          stderr.end();
          settle({ exitCode: play.exitCode, signal: null });
        },
      });
      return {
        stdin,
        stdout,
        stderr,
        done,
        terminate() {
          call.terminated = true;
          stdout.end();
          stderr.end();
          settle({ exitCode: null, signal: "SIGTERM" });
        },
      };
    };

  // The far shell's banner comes before the marker and must not end up in the path.
  const ok = runner({ stdout: `Welcome to far!\n\u0001omc\u0001${FAR}`, exitCode: 0 });
  assert.equal(await copyToAt({ sshHost: "far" }, local, "x.bin", 5_000, ok), FAR);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.host, "far");
  assert.ok(
    calls[0]?.script.startsWith("printf '\u0001omc\u0001'; d="),
    "the marker is printed first",
  );
  assert.ok(
    calls[0]?.script.endsWith(copyScript("x.bin", payload.length)),
    "the script run is copyScript's",
  );
  assert.deepEqual(
    calls[0]?.received,
    payload,
    "the far side received the file's bytes, all of them",
  );

  // A far failure is named by the box and its stderr, not by a broken pipe.
  const denied = runner({
    stdout: "\u0001omc\u0001",
    stderr: "mkdir: Permission denied\n",
    exitCode: 1,
  });
  await assert.rejects(
    copyToAt({ sshHost: "far" }, local, "x.bin", 5_000, denied),
    /far: mkdir: Permission denied$/,
  );
  // Exit 0 with no marker is a shell that never reached the script.
  const mute = runner({ stdout: "Welcome to far!\n", exitCode: 0 });
  await assert.rejects(
    copyToAt({ sshHost: "far" }, local, "x.bin", 5_000, mute),
    /printed no answer/,
  );

  // Refused before any connection: a name that is not one segment, no box, no local file.
  const before = calls.length;
  for (const bad of ["", ".", "..", "a/b", "../x", "a\nb"])
    await assert.rejects(copyToAt({ sshHost: "far" }, local, bad, 5_000, ok), /is not a file name/);
  await assert.rejects(copyToAt({}, local, "x.bin", 5_000, ok), /no box to copy to/);
  await assert.rejects(
    copyToAt({ sshHost: "far" }, join(tmp, "gone.bin"), "x.bin", 5_000, ok),
    /ENOENT/,
  );
  assert.equal(calls.length, before, "none of the refused calls opened a connection");

  // A far side that never answers is ended at the cap.
  const stuck = runner({ stdout: "", exitCode: 0, hang: true });
  await assert.rejects(copyToAt({ sshHost: "far" }, local, "x.bin", 50, stuck));
  assert.equal(calls.at(-1)?.terminated, true, "the cap terminates the ssh");
  console.log("copy-to-box ok");
}

console.log("remote-fs ok");
