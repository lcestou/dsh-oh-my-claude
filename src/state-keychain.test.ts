// Each config dir's login is its own macOS Keychain entry, named the way Claude Code 2.1.328 names
// it, so the plugin's usage and model reads find an account's login on a Mac too.
import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { keychainService } from "./state.js";

assert.equal(keychainService(join(homedir(), ".claude"), undefined), "Claude Code-credentials");

assert.equal(
  keychainService("/Users/a/.claude-work", undefined),
  "Claude Code-credentials-c7ed87c8",
  "an account's dir: the plain name, a dash and 8 hex of its sha256",
);

// This box's own default dir, so the hash is the only thing that can tell the two cases apart.
const def = join(homedir(), ".claude");

assert.notEqual(
  keychainService(def, def),
  "Claude Code-credentials",
  "with CLAUDE_CONFIG_DIR set the CLI hashes even the default dir",
);

assert.match(keychainService(def, def), /^Claude Code-credentials-[0-9a-f]{8}$/);

console.log("keychain service ok");
