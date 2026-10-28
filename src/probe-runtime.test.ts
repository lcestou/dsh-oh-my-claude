// The runtime probe on a logged-out box: Claude Code's `auth status` prints its JSON and exits 1,
// and the local probe runs it beside `--version`. The row must read "not logged in" with the
// version it found, never a "Command failed" that hides both.
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeRuntime } from "./sessions.js";

const dir = await mkdtemp(join(tmpdir(), "omc-probe-"));
const claude = join(dir, "claude");
await writeFile(
  claude,
  [
    "#!/bin/sh",
    'case "$1" in',
    '  --version) echo "9.9.9 (Claude Code)";;',
    '  auth) printf \'{"loggedIn": false, "authMethod": "none"}\\n\'; exit 1;;',
    "esac",
  ].join("\n"),
);
await chmod(claude, 0o755);
const status = await probeRuntime(dir, claude, "");
assert.equal(status.version, "9.9.9 (Claude Code)", "the version survives a failing auth status");
assert.equal(status.loggedIn, false, "the JSON the failing command printed is still read");
assert.equal(status.error, undefined, "a logged-out box is not a failed probe");
assert.equal(status.binary, claude);
await rm(dir, { recursive: true, force: true });
console.log("probe runtime ok");
