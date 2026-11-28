// Which config dir and which login a local Claude is pointed at. Handed CLAUDE_CONFIG_DIR, even
// for `~/.claude`, the CLI renames its macOS Keychain login to `Claude Code-credentials-<hash>` and
// moves `.claude.json` into the dir, so a mount configured with `configDir: ~/.claude` failed every
// turn with "Not logged in" on a Mac whose Boxes row showed it logged in (#328).
import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SubprocessRuntime } from "../dsh.js";
import { fakePluginContext, fakeSubprocessHandle } from "../test-context.js";

// CLAUDE_HOME is read once at import: the cases below are about a dsh started without the variable.
delete process.env.CLAUDE_CONFIG_DIR;

const { ClaudeCodeAdapter } = await import("./class.js");
const { Config } = await import("./config.js");
const { childEnv, seamSpawner, SECURE_STORAGE_ENV } = await import("../process.js");
const { cliEnvFor } = await import("../sessions.js");
const { secureStorageDir } = await import("../state.js");

// The constructor and localEnvOverride read the event hook and nothing else.
const ctx = fakePluginContext({ on() {} });

/** The env a local spawn of a mount built from `config` adds, or {} when it adds nothing. */
const envOf = (config: Record<string, unknown>) =>
  new ClaudeCodeAdapter(ctx, Config(config)).localEnvOverride() ?? {};

const home = join(homedir(), ".claude");

for (const dir of ["~/.claude", "~/.claude/", home]) {
  assert.equal(
    envOf({ configDir: dir }).CLAUDE_CONFIG_DIR,
    undefined,
    `configDir ${dir} is the CLI's own default: no CLAUDE_CONFIG_DIR, so its plain login is found`,
  );
}

// Panel calls are handed the mount's resolved home, which keeps a trailing slash from the config.
for (const dir of [home, `${home}/`]) {
  assert.equal(cliEnvFor(dir).CLAUDE_CONFIG_DIR, undefined, `nor for a panel call with ${dir}`);
}

const work = join(homedir(), ".claude-work");

assert.equal(
  envOf({ configDir: "~/.claude-work" }).CLAUDE_CONFIG_DIR,
  work,
  "another dir is exported",
);

assert.equal(
  envOf({ configDir: "~/.claude-work" })[SECURE_STORAGE_ENV],
  undefined,
  "and its login is its own, under its own name",
);

assert.equal(cliEnvFor(work).CLAUDE_CONFIG_DIR, work);

// The transcript mirror runs the CLI under a dir of the plugin's own; the login stays the real one's.
const mirrored = envOf({ ownTranscripts: true });

assert.ok(mirrored.CLAUDE_CONFIG_DIR?.endsWith("claude-home"), "the mirror is the config dir");

assert.equal(mirrored[SECURE_STORAGE_ENV], "", "the default login is the CLI's empty-string entry");

const mirroredWork = envOf({ ownTranscripts: true, configDir: "~/.claude-work" });

assert.equal(mirroredWork[SECURE_STORAGE_ENV], work, "another dir's login is named by that dir");

assert.equal(
  secureStorageDir(home, "/elsewhere"),
  home,
  "dsh's own CLAUDE_CONFIG_DIR hashes ~/.claude too",
);

// The empty value has to reach the CLI: an empty override removes every other name.
const child = childEnv({ KEEP: "1", DROP: "x" }, { DROP: "", [SECURE_STORAGE_ENV]: "" });

assert.equal(child.DROP, undefined, "an empty override still removes a name");

assert.equal(child[SECURE_STORAGE_ENV], "", "but the secure-storage dir keeps its empty value");

let seamEnv: NodeJS.ProcessEnv = {};

// The seam double records the spawn request; the handle it answers is never read here.
const seam: Pick<SubprocessRuntime, "spawn"> = {
  spawn: (req) => {
    seamEnv = req.env ?? {};

    return fakeSubprocessHandle();
  },
};

seamSpawner(seam, { DROP: "x" })("claude", [], "/w", { DROP: "", [SECURE_STORAGE_ENV]: "" });

assert.equal(seamEnv.DROP, undefined, "the seam drops an emptied name");

assert.equal(seamEnv[SECURE_STORAGE_ENV], "", "and keeps the secure-storage dir's empty value");

console.log("login env ok");
