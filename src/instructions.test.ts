// Offline self-check: bun src/instructions.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importsIn, instructionCandidates, listInstructions } from "./instructions.js";

// The paths the walk is warmed with, in load order: managed, user, then every ancestor root-first.
// One that drifts out of this list is one the walk waits a whole ssh round trip for.
{
  assert.deepEqual(instructionCandidates("/a/b", "/home/u/.claude"), [
    "/etc/claude-code/CLAUDE.md",
    "/home/u/.claude/CLAUDE.md",
    "/CLAUDE.md",
    "/.claude/CLAUDE.md",
    "/CLAUDE.local.md",
    "/a/CLAUDE.md",
    "/a/.claude/CLAUDE.md",
    "/a/CLAUDE.local.md",
    "/a/b/CLAUDE.md",
    "/a/b/.claude/CLAUDE.md",
    "/a/b/CLAUDE.local.md",
  ]);
}

// What counts as an `@` import, and what the CLI would leave alone.
{
  assert.deepEqual(importsIn("see @./notes.md and @~/global.md"), ["./notes.md", "~/global.md"]);
  assert.deepEqual(importsIn("@/etc/claude-code/CLAUDE.md"), ["/etc/claude-code/CLAUDE.md"]);
  assert.deepEqual(importsIn("@docs/queue.md"), ["docs/queue.md"], "a bare relative path counts");
  assert.deepEqual(importsIn("@a\\ b.md"), ["a b.md"], "an escaped space stays in the path");
  assert.deepEqual(importsIn("@notes.md#section"), ["notes.md"], "a fragment is not part of it");

  assert.deepEqual(importsIn("mail me@example.com"), [], "an address is not an import");
  assert.deepEqual(importsIn("`@./notes.md`"), [], "inside a code span");
  assert.deepEqual(importsIn("```\n@./notes.md\n```"), [], "inside a fence");
  assert.deepEqual(importsIn("<!-- @./notes.md -->"), [], "inside a comment");
  assert.deepEqual(importsIn("@@handle and @*glob and @/"), [], "none of these name a file");
  assert.deepEqual(importsIn("two @a.md @b.md"), ["a.md", "b.md"], "more than one per line");
}

{
  const dir = await mkdtemp(join(tmpdir(), "omc-instructions-"));

  // Build a minimal hierarchy:
  // dir/
  //   user/CLAUDE.md (User scope)
  //   project/
  //     CLAUDE.md (Project scope, contains @user-ref.md import)
  //     .claude/
  //       CLAUDE.md (Project scope)
  //       rules/
  //         rule1.md (Project scope)
  //     CLAUDE.local.md (Local scope)
  //   user-ref.md (imported from project/CLAUDE.md, shows as Project scope with importedBy)

  const userDot = join(dir, "user");
  const projectDir = join(dir, "project");
  const projectDot = join(projectDir, ".claude");
  const projectRules = join(projectDot, "rules");

  await mkdir(userDot, { recursive: true });
  await mkdir(projectRules, { recursive: true });

  await writeFile(join(userDot, "CLAUDE.md"), "# User CLAUDE\nUser scope file.");
  await writeFile(
    join(projectDir, "CLAUDE.md"),
    "# Project CLAUDE\nContains an import:\n@../user-ref.md",
  );
  await writeFile(join(projectDot, "CLAUDE.md"), "# Project .claude/CLAUDE\n");
  await writeFile(join(projectRules, "rule1.md"), "# Rule 1\n");
  await writeFile(join(projectDir, "CLAUDE.local.md"), "# Local CLAUDE\nLocal scope.");
  await writeFile(join(dir, "user-ref.md"), "# Imported file\nImported via @.");

  // List instructions from projectDir, with userDot as the claude home.
  // We're not testing /etc/claude-code (Managed) because the path is system-level.
  const instructions = await listInstructions(projectDir, userDot);

  // Sort by path for stable assertion.
  const sorted = instructions.toSorted((a, b) => a.path.localeCompare(b.path));

  // Expected files:
  // - join(userDot, "CLAUDE.md") with kind User
  // - join(projectDir, "CLAUDE.md") with kind Project
  // - join(projectDot, "CLAUDE.md") with kind Project
  // - join(projectRules, "rule1.md") with kind Project
  // - join(projectDir, "CLAUDE.local.md") with kind Local
  // - join(dir, "user-ref.md") with kind Project, importedBy = join(projectDir, "CLAUDE.md")

  // Filter to just our test files (no /etc/claude-code, which won't exist).
  const paths = sorted.map((f) => f.path);
  assert(paths.includes(join(userDot, "CLAUDE.md")), "User CLAUDE.md should be present");
  assert(paths.includes(join(projectDir, "CLAUDE.md")), "Project root CLAUDE.md should be present");
  assert(
    paths.includes(join(projectDot, "CLAUDE.md")),
    "Project .claude/CLAUDE.md should be present",
  );
  assert(paths.includes(join(projectRules, "rule1.md")), "Project rule1.md should be present");
  assert(
    paths.includes(join(projectDir, "CLAUDE.local.md")),
    "Project CLAUDE.local.md should be present",
  );
  assert(paths.includes(join(dir, "user-ref.md")), "Imported user-ref.md should be present");

  // Check kinds.
  const byPath = new Map(sorted.map((f) => [f.path, f]));
  assert.equal(byPath.get(join(userDot, "CLAUDE.md"))?.kind, "User");
  assert.equal(byPath.get(join(projectDir, "CLAUDE.md"))?.kind, "Project");
  assert.equal(byPath.get(join(projectDot, "CLAUDE.md"))?.kind, "Project");
  assert.equal(byPath.get(join(projectRules, "rule1.md"))?.kind, "Project");
  assert.equal(byPath.get(join(projectDir, "CLAUDE.local.md"))?.kind, "Local");
  assert.equal(byPath.get(join(dir, "user-ref.md"))?.kind, "Project");

  // Check importedBy.
  assert.equal(
    byPath.get(join(dir, "user-ref.md"))?.importedBy,
    join(projectDir, "CLAUDE.md"),
    "user-ref.md should be marked as imported by project/CLAUDE.md",
  );

  // Check sizes and mtimes are non-zero.
  for (const f of sorted) {
    assert(f.size > 0, `${f.path} should have size > 0`);
    assert(f.mtime > 0, `${f.path} should have mtime > 0`);
  }
}

{
  // Test that missing files are skipped.
  const dir = await mkdtemp(join(tmpdir(), "omc-instructions-missing-"));
  const projectDir = join(dir, "project");
  const userDot = join(dir, "user");

  await mkdir(projectDir);
  await mkdir(userDot);

  // Create one file in the hierarchy, others will be missing.
  await writeFile(join(projectDir, "CLAUDE.md"), "# Only file");

  const instructions = await listInstructions(projectDir, userDot);

  // Should only have the one file we created (and no /etc/claude-code Managed files).
  const projectFiles = instructions.filter((f) => f.kind === "Project");
  assert.equal(projectFiles.length, 1);
  assert.equal(projectFiles[0]?.path.endsWith("CLAUDE.md"), true);
}

{
  // Test @ import with relative paths.
  const dir = await mkdtemp(join(tmpdir(), "omc-instructions-import-"));
  const projectDir = join(dir, "project");
  const userDot = join(dir, "user");

  await mkdir(projectDir);
  await mkdir(userDot);

  // Create files. projectDir/CLAUDE.md imports ../shared.md which is in dir/.
  await writeFile(join(projectDir, "CLAUDE.md"), "# Project\nImport:\n@../shared.md");
  await writeFile(join(dir, "shared.md"), "# Shared");

  const instructions = await listInstructions(projectDir, userDot);

  const paths = instructions.map((f) => f.path);
  assert(paths.includes(join(dir, "shared.md")), "Relative @ import should be resolved");

  const shared = instructions.find((f) => f.path === join(dir, "shared.md"));
  assert.equal(shared?.importedBy, join(projectDir, "CLAUDE.md"));
}

{
  // Test depth limit: a chain of @imports with depth > 5 should stop.
  const dir = await mkdtemp(join(tmpdir(), "omc-instructions-depth-"));
  const projectDir = join(dir, "project");
  const userDot = join(dir, "user");

  await mkdir(projectDir);
  await mkdir(userDot);

  // A chain f0 -> f1 -> ... -> f6, all in `dir` so the imports are `@./fN.md`.
  // CLAUDE.md imports f0 at depth 1 and f4 is depth 5, the last depth the walk follows imports
  // from, so f5 is never reached and neither is f6 behind it.
  for (let i = 0; i <= 6; i++) {
    const path = join(dir, `f${i}.md`);
    const content = i === 0 ? "# F0\n@./f1.md" : i < 6 ? `# F${i}\n@./f${i + 1}.md` : `# F${i}\n`;
    await writeFile(path, content);
  }

  await writeFile(join(projectDir, "CLAUDE.md"), `# Project\n@../f0.md`);

  const instructions = await listInstructions(projectDir, userDot);
  const paths = instructions.map((f) => f.path);

  // f0 through f4, depths 1 through 5.
  for (let i = 0; i <= 4; i++) {
    assert(paths.includes(join(dir, `f${i}.md`)), `f${i}.md should be present (depth ${i + 1})`);
  }

  // f5 and f6 should NOT be present (f5 is depth 6, f6 is unreachable).
  assert(!paths.includes(join(dir, "f5.md")), "f5.md is past the depth limit");
  assert(!paths.includes(join(dir, "f6.md")), "f6.md is behind f5.md and unreachable");
}

{
  // Test cycle detection: a cycle should not loop forever.
  const dir = await mkdtemp(join(tmpdir(), "omc-instructions-cycle-"));
  const projectDir = join(dir, "project");
  const userDot = join(dir, "user");

  await mkdir(projectDir);
  await mkdir(userDot);

  // Create a cycle: f0 -> f1 -> f0
  await writeFile(join(dir, "f0.md"), "# F0\n@./f1.md");
  await writeFile(join(dir, "f1.md"), "# F1\n@./f0.md");

  await writeFile(join(projectDir, "CLAUDE.md"), `# Project\n@../f0.md`);

  const instructions = await listInstructions(projectDir, userDot);
  const paths = instructions.map((f) => f.path);

  // Both f0 and f1 should be present exactly once.
  assert.equal(
    paths.filter((p) => p.endsWith("f0.md")).length,
    1,
    "f0.md should appear exactly once",
  );
  assert.equal(
    paths.filter((p) => p.endsWith("f1.md")).length,
    1,
    "f1.md should appear exactly once",
  );
}

console.log("instructions.test: ok");
