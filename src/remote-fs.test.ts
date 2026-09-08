// Offline self-check: bun src/remote-fs.test.ts. No CLI, no host, no network — the scripts are
// pure strings and the local branch writes under a temp dir.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ABSENT,
  listNamesAt,
  listScript,
  readAt,
  readScript,
  readTextAt,
  removeAt,
  removeScript,
  splitRead,
  writeAt,
  writeScript,
} from "./remote-fs.js";

// Every path is single-quoted, so a space or a quote in a workspace path stays one argument.
{
  const path = "/home/a b/it's/settings.json";
  const read = readScript(path);
  assert.ok(read.includes("'/home/a b/it'\\''s/settings.json'"), "path is quoted in the read");
  assert.ok(read.endsWith(`else exit ${ABSENT}; fi`), "a missing file exits with the absent code");
  assert.ok(read.includes("stat -c %Y") && read.includes("stat -f %m"), "GNU and BSD stat");

  assert.equal(listScript("/w/dir"), "if [ -d '/w/dir' ]; then ls -A -- '/w/dir'; fi");
  assert.equal(removeScript("/w/x.md"), "rm -f -- '/w/x.md'");

  // A write keeps a .bak and lands through a temp file, so a dropped connection cannot leave half
  // a settings file the CLI would refuse to start on.
  const write = writeScript("/w/.claude/settings.json", "e30K");
  assert.ok(write.startsWith("mkdir -p '/w/.claude'"), "the parent is created first");
  assert.ok(write.includes("cp -- '/w/.claude/settings.json' '/w/.claude/settings.json.bak'"));
  assert.ok(write.includes("printf %s 'e30K' | base64 -d > '/w/.claude/settings.json.tmp'"));
  assert.ok(write.includes("mv -- '/w/.claude/settings.json.tmp' '/w/.claude/settings.json'"));
  // The write answers its own mtime: reading it back would cost a second connection and report on a
  // file that may have moved on since.
  assert.ok(write.endsWith("echo 0; }"), "the write ends by printing the mtime it left");
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
}

console.log("remote-fs ok");
