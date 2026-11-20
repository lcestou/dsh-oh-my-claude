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
assert.equal(
  keychainService("/Users/a/.claude", "/Users/a/.claude"),
  "Claude Code-credentials-523c3e50",
  "with CLAUDE_CONFIG_DIR set the CLI hashes even the default dir",
);
console.log("keychain service ok");
