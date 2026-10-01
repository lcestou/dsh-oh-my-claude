// Offline self-check: bun src/memory.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteMemory,
  dropIndexLine,
  listMemory,
  memoryRoot,
  memorySummary,
  isMemoryName,
} from "./memory.js";

// Names: bare .md files only, no paths.
assert.equal(isMemoryName("MEMORY.md"), true);
assert.equal(isMemoryName("feedback-no-trailers.md"), true);
assert.equal(isMemoryName("../settings.json"), false);
assert.equal(isMemoryName("a/b.md"), false);
assert.equal(isMemoryName("notes.txt"), false);
assert.equal(isMemoryName(".hidden.md"), false);

// Summary comes from the frontmatter description, nothing else.
assert.equal(
  memorySummary(
    "---\nname: x\ndescription: never add trailers\nmetadata:\n  type: feedback\n---\nbody",
  ),
  "never add trailers",
);
assert.equal(memorySummary("# Claude Memory Index\n- [a](a.md)"), "");

// Index line removal keeps every other line, including ones naming a different file.
assert.equal(
  dropIndexLine("# Index\n- [A](a.md) — one\n- [B](b.md) — two\n", "a.md"),
  "# Index\n- [B](b.md) — two\n",
);

{
  const dir = await mkdtemp(join(tmpdir(), "omc-memory-"));
  await writeFile(join(dir, "MEMORY.md"), "# Index\n- [A](a.md) — one\n- [B](b.md) — two\n");
  await writeFile(join(dir, "a.md"), "---\ndescription: fact a\n---\nA");
  await writeFile(join(dir, "b.md"), "---\ndescription: fact b\n---\nB");
  await writeFile(join(dir, "scratch.txt"), "ignored");

  const list = await listMemory({}, dir);
  assert.deepEqual(list.map((f) => f.name).toSorted(), ["MEMORY.md", "a.md", "b.md"]);
  assert.equal(list[0]?.name, "MEMORY.md", "index sorts first");
  assert.equal(list.find((f) => f.name === "a.md")?.summary, "fact a");

  await deleteMemory({}, dir, "a.md");
  assert.deepEqual((await listMemory({}, dir)).map((f) => f.name).toSorted(), [
    "MEMORY.md",
    "b.md",
  ]);
  assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "# Index\n- [B](b.md) — two\n");
}

// memoryRoot: the checkout root for a subdirectory, the main checkout for a linked worktree, and
// the directory itself for everything that only looks like one. The layout is what
// `git worktree add` writes, built by hand so the check needs no git.
{
  const tmp = await mkdtemp(join(tmpdir(), "omc-memory-root-"));
  const main = join(tmp, "main");
  const wt = join(tmp, "wt");
  const admin = join(main, ".git", "worktrees", "wt");
  await mkdir(admin, { recursive: true });
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(admin, "gitdir"), `${join(wt, ".git")}\n`);
  await mkdir(join(wt, "src"), { recursive: true });
  await writeFile(join(wt, ".git"), `gitdir: ${admin}\n`);
  await mkdir(join(main, "src", "deep"), { recursive: true });

  assert.equal(await memoryRoot({}, main), main);
  assert.equal(await memoryRoot({}, join(main, "src", "deep")), main, "a subdirectory");
  assert.equal(await memoryRoot({}, wt), main, "a worktree shares its main checkout's memory");
  assert.equal(await memoryRoot({}, join(wt, "src")), main, "and so does a directory inside it");

  const plain = join(tmp, "plain", "dir");
  await mkdir(plain, { recursive: true });
  assert.equal(await memoryRoot({}, plain), plain, "outside a repository the cwd is the key");

  // A submodule's `.git` file names a git dir with no `commondir`: it keeps its own key.
  const sub = join(main, "vendor", "lib");
  await mkdir(sub, { recursive: true });
  await mkdir(join(main, ".git", "modules", "lib"), { recursive: true });
  await writeFile(join(sub, ".git"), `gitdir: ${join(main, ".git", "modules", "lib")}\n`);
  assert.equal(await memoryRoot({}, sub), sub);

  // A `.git` file that names someone else's worktree entry is not that worktree: the back-link
  // names `wt`, so a directory that copies the pointer does not get `main`'s memories.
  const copy = join(tmp, "copy");
  await mkdir(copy);
  await writeFile(join(copy, ".git"), `gitdir: ${admin}\n`);
  assert.equal(await memoryRoot({}, copy), copy);
}

// A missing dir lists as empty rather than throwing.
assert.deepEqual(await listMemory({}, "/nonexistent/omc-memory"), []);

console.log("memory.test: ok");
