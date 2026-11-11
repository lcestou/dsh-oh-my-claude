// Scratch directories for the test suites, removed when the test process exits. Test-only; imported
// by the suites and tools, never by the plugin. Before this, every run of `bun run test` left a few
// dozen `/tmp/omc-*` and `/tmp/dsh-*` directories behind, and a box that ran the suite often
// collected thousands.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** Best-effort removal of everything registered so far. Runs inside the exit handler, where a
 *  throw would replace the test's own exit code, so a path that will not go (already gone, a
 *  read-only tree a test left behind) is skipped in silence. */
const removeAll = (): void => {
  for (const path of made.splice(0)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // left for the next sweep of /tmp; the test's result matters more than one directory
    }
  }
};

/**
 * Registers `path` for removal when this process exits, whether the test passed, an assertion
 * threw, or the code called `process.exit`. Returns `path` unchanged so a site can wrap its own
 * path expression. A process killed by a signal (a `timeout` in the runner) skips exit handlers, so
 * its directories stay. The path need not exist yet; one that never appears is simply skipped.
 */
export function removeOnExit(path: string): string {
  if (made.length === 0) process.once("exit", removeAll);
  made.push(path);
  return path;
}

/** A new directory `<system temp>/<prefix>XXXXXX`, created now and removed at exit (see
 *  `removeOnExit`). Synchronous, so it fits both the sync and the `await mkdtemp` sites it replaces. */
export function tempDir(prefix: string): string {
  return removeOnExit(mkdtempSync(join(tmpdir(), prefix)));
}
