// Offline self-check: bun src/ssh.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import { shq, sshInvocation } from "./process.js";
import { sshBoxProviderId, validateSshBoxes } from "./sessions.js";

// shq wraps in single quotes and escapes embedded quotes.
{
  assert.equal(shq("claude"), "'claude'");
  assert.equal(shq("/a b/c"), "'/a b/c'");
  assert.equal(shq("it's"), "'it'\\''s'");
  assert.equal(shq(""), "''");
}

// sshInvocation builds `ssh -o BatchMode=yes -o ConnectTimeout=10 <host> <script>`, carrying the
// remote cwd and CHILD_ENV, with every piece single-quoted so a path with a space cannot break out.
{
  const inv = sshInvocation(
    "nova",
    "claude",
    ["-p", "--input-format", "stream-json"],
    "/home/u/w",
  );
  assert.equal(inv.command, "ssh");
  assert.deepEqual(inv.args.slice(0, 5), [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "nova",
  ]);
  const script = inv.args[5];
  assert.equal(
    script,
    "cd '/home/u/w' 2>/dev/null || cd \"$HOME\"; exec env MCP_TOOL_TIMEOUT='3600000' " +
      "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING='1' 'claude' '-p' '--input-format' 'stream-json'",
  );
}

// A cwd or arg with a space or quote stays inside one quoted token — no word splitting on the remote.
// A missing remote path falls back to $HOME instead of failing the spawn.
{
  const inv = sshInvocation("u@h", "claude", ["--add-dir", "/a b/c'd"], "/tmp/a b");
  const script = inv.args[5];
  assert.ok(script);
  assert.match(script, /^cd '\/tmp\/a b' 2>\/dev\/null \|\| cd "\$HOME"; /);
  assert.match(script, /'--add-dir' '\/a b\/c'\\''d'$/);
}

// sshBoxProviderId slugs a name into a `claude-code-` id: lowercase, non-alnum runs to one dash.
{
  assert.equal(sshBoxProviderId("Nova"), "claude-code-nova");
  assert.equal(sshBoxProviderId("Build Box 2"), "claude-code-build-box-2");
  assert.equal(sshBoxProviderId("  a.b_c  "), "claude-code-a-b-c");
}

// validateSshBoxes cleans a good list and rejects the ways it can be bad.
{
  const ok = validateSshBoxes([
    { name: "Nova", host: "nova" },
    { name: "Prod", host: "u@h" },
  ]);
  assert.deepEqual(ok.boxes, [
    { name: "Nova", host: "nova" },
    { name: "Prod", host: "u@h" },
  ]);
  assert.equal(validateSshBoxes("nope").error, "ssh boxes must be an array");
  assert.match(validateSshBoxes([{ name: "", host: "h" }]).error ?? "", /needs a name/);
  assert.match(validateSshBoxes([{ name: "x", host: "" }]).error ?? "", /host is required/);
  // A host with a shell metacharacter is refused rather than passed to ssh.
  assert.match(validateSshBoxes([{ name: "x", host: "h; rm -rf /" }]).error ?? "", /invalid/);
  // Two names that slug to one id collide.
  assert.match(
    validateSshBoxes([
      { name: "A B", host: "h1" },
      { name: "a-b", host: "h2" },
    ]).error ?? "",
    /already uses that name/,
  );
  // Same host twice is refused.
  assert.match(
    validateSshBoxes([
      { name: "one", host: "h" },
      { name: "two", host: "h" },
    ]).error ?? "",
    /duplicate host/,
  );
}

console.log("ok ssh");
