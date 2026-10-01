// Offline self-check: bun src/repo.test.ts. No CLI, no git, no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localSettingsRoot, projectKey, projectLevels, repoRoot } from "./repo.js";

// repoRoot: the checkout root for a subdirectory, the main checkout for a linked worktree, and
// the directory itself for everything that only looks like one. The layout is what
// `git worktree add` writes, built by hand so the check needs no git.
{
  // realpath: the worktree check resolves symlinks, and a temp dir can sit behind one.
  const tmp = await realpath(await mkdtemp(join(tmpdir(), "omc-repo-root-")));
  const main = join(tmp, "main");
  const wt = join(tmp, "wt");
  const admin = join(main, ".git", "worktrees", "wt");
  await mkdir(admin, { recursive: true });
  await writeFile(join(admin, "commondir"), "../..\n");
  await writeFile(join(admin, "gitdir"), `${join(wt, ".git")}\n`);
  await mkdir(join(wt, "src"), { recursive: true });
  await writeFile(join(wt, ".git"), `gitdir: ${admin}\n`);
  await mkdir(join(main, "src", "deep"), { recursive: true });

  assert.equal(await repoRoot({}, main), main);
  assert.equal(await repoRoot({}, join(main, "src", "deep")), main, "a subdirectory");
  assert.equal(await repoRoot({}, wt), main, "a worktree answers its main checkout");
  assert.equal(await repoRoot({}, join(wt, "src")), main, "and so does a directory inside it");

  const plain = join(tmp, "plain", "dir");
  await mkdir(plain, { recursive: true });
  assert.equal(await repoRoot({}, plain), plain, "outside a repository the cwd is the key");

  // A submodule's `.git` file names a git dir with no `commondir`: it keeps its own key.
  const sub = join(main, "vendor", "lib");
  await mkdir(sub, { recursive: true });
  await mkdir(join(main, ".git", "modules", "lib"), { recursive: true });
  await writeFile(join(sub, ".git"), `gitdir: ${join(main, ".git", "modules", "lib")}\n`);
  assert.equal(await repoRoot({}, sub), sub);

  // A `.git` file that names someone else's worktree entry is not that worktree: the back-link
  // names `wt`, so a directory that copies the pointer does not get `main`'s memories.
  const copy = join(tmp, "copy");
  await mkdir(copy);
  await writeFile(join(copy, ".git"), `gitdir: ${admin}\n`);
  assert.equal(await repoRoot({}, copy), copy);

  // projectLevels: the session's directory and those above it up to its own checkout root, which
  // for a worktree is the worktree, not the main checkout.
  assert.deepEqual(await projectLevels({}, join(main, "src", "deep")), [
    join(main, "src", "deep"),
    join(main, "src"),
    main,
  ]);
  assert.deepEqual(await projectLevels({}, join(wt, "src")), [join(wt, "src"), wt]);
  // Outside a repository the walk carries on upwards, and the home directory ends it unlisted.
  const home = join(tmp, "home");
  await mkdir(join(home, "notes", "a"), { recursive: true });
  assert.deepEqual(await projectLevels({}, join(home, "notes", "a"), home), [
    join(home, "notes", "a"),
    join(home, "notes"),
  ]);
  assert.deepEqual(
    await projectLevels({}, home, home),
    [],
    "the home directory has no project level",
  );
  assert.equal((await projectLevels({}, plain))[0], plain);

  // localSettingsRoot: the repository root for a subdirectory and for a worktree, the directory
  // itself outside a repository, on Windows, and when the root is the home directory.
  assert.equal(await localSettingsRoot({}, join(main, "src", "deep")), main);
  assert.equal(await localSettingsRoot({}, wt), main);
  assert.equal(await localSettingsRoot({}, main), main);
  assert.equal(await localSettingsRoot({}, plain), plain);
  assert.equal(await localSettingsRoot({}, join(main, "src"), "win32"), join(main, "src"));
  assert.equal(
    await localSettingsRoot({}, join(main, "src"), process.platform, main),
    join(main, "src"),
  );
}

// projectKey: forward slashes on a Windows host only, and never for a path on an SSH box.
assert.equal(projectKey({}, "C:\\src\\main", "win32"), "C:/src/main");
assert.equal(projectKey({}, "/src/main", "linux"), "/src/main");
assert.equal(projectKey({ sshHost: "box" }, "/srv/a\\b", "win32"), "/srv/a\\b");

console.log("repo.test: ok");
