/**
 * Registers `path` for removal when this process exits, whether the test passed, an assertion
 * threw, or the code called `process.exit`. Returns `path` unchanged so a site can wrap its own
 * path expression. A process killed by a signal (a `timeout` in the runner) skips exit handlers, so
 * its directories stay. The path need not exist yet; one that never appears is simply skipped.
 */
export declare function removeOnExit(path: string): string;
/** A new directory `<system temp>/<prefix>XXXXXX`, created now and removed at exit (see
 *  `removeOnExit`). Synchronous, so it fits both the sync and the `await mkdtemp` sites it replaces. */
export declare function tempDir(prefix: string): string;
