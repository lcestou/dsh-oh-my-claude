// Offline self-check: bun src/memory.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteMemory, dropIndexLine, listMemory, memorySummary, isMemoryName } from "./memory.js";

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

  const list = await listMemory(dir);
  assert.deepEqual(list.map((f) => f.name).toSorted(), ["MEMORY.md", "a.md", "b.md"]);
  assert.equal(list[0]?.name, "MEMORY.md", "index sorts first");
  assert.equal(list.find((f) => f.name === "a.md")?.summary, "fact a");

  await deleteMemory(dir, "a.md");
  assert.deepEqual((await listMemory(dir)).map((f) => f.name).toSorted(), ["MEMORY.md", "b.md"]);
  assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "# Index\n- [B](b.md) — two\n");
}

// A missing dir lists as empty rather than throwing.
assert.deepEqual(await listMemory("/nonexistent/omc-memory"), []);

console.log("memory.test: ok");
