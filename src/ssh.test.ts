// Offline self-check: bun src/ssh.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import { controlSocketDir, shq, sshInvocation } from "./process.js";
import { sshBoxProviderId, validateRemoteWorkspaceInput, validateSshBoxes } from "./sessions.js";

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
  const inv = sshInvocation("nova", "claude", ["-p", "--input-format", "stream-json"], "/home/u/w");
  assert.equal(inv.command, "ssh");
  // Options first, then the host and the script. The set of options is asserted below rather than
  // by index, so adding one does not move the two words that matter.
  assert.equal(inv.args.at(-2), "nova");
  const opts = inv.args.slice(0, -2).join(" ");
  for (const opt of [
    "BatchMode=yes",
    "ConnectTimeout=10",
    "ControlMaster=auto",
    "ControlPersist=60",
    "ServerAliveInterval=15",
    "ServerAliveCountMax=4",
  ])
    assert.match(opts, new RegExp(`-o ${opt.replace("=", "=")}`), `ssh carries ${opt}`);
  // One shared connection for every read of a box: the CLAUDE.md walk alone is ~25 of them.
  const control = /ControlPath=(\S+)cm-%C/.exec(opts);
  assert.ok(control, "ssh carries a ControlPath");
  // ssh refuses the socket, and every read of the box with it, when the name runs past 107 bytes.
  assert.ok(`${control[1]}cm-`.length + 40 + ".XXXXXXXXXXXXXXXX".length <= 107, "socket path fits");
  const script = inv.args.at(-1);
  assert.equal(
    script,
    "cd '/home/u/w' 2>/dev/null || cd \"$HOME\"; exec env MCP_TOOL_TIMEOUT='3600000' " +
      "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING='1' CLAUDE_CODE_ENTRYPOINT='dsh-oh-my-claude' " +
      "'claude' '-p' '--input-format' 'stream-json'",
  );
}

// A cwd or arg with a space or quote stays inside one quoted token — no word splitting on the remote.
// A missing remote path falls back to $HOME instead of failing the spawn.
{
  const inv = sshInvocation("u@h", "claude", ["--add-dir", "/a b/c'd"], "/tmp/a b");
  const script = inv.args.at(-1);
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
  assert.equal(validateSshBoxes("nope").error, "SSH boxes must be an array");
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

// validateRemoteWorkspaceInput accepts a clean {name, host, absolute path} and rejects the bad ways.
{
  const ok = validateRemoteWorkspaceInput({ name: "Foo", host: "nova", remoteCwd: "/home/u/foo" });
  assert.deepEqual(ok.value, { name: "Foo", host: "nova", remoteCwd: "/home/u/foo" });
  assert.match(validateRemoteWorkspaceInput({ host: "h", remoteCwd: "/x" }).error ?? "", /name/);
  assert.match(
    validateRemoteWorkspaceInput({ name: "x", host: "bad host", remoteCwd: "/x" }).error ?? "",
    /ssh host/,
  );
  // A relative path is refused: a quoted `cd` cannot resolve it and `~` never expands.
  assert.match(
    validateRemoteWorkspaceInput({ name: "x", host: "h", remoteCwd: "rel/path" }).error ?? "",
    /absolute/,
  );
  assert.match(
    validateRemoteWorkspaceInput({ name: "x", host: "h", remoteCwd: "~/foo" }).error ?? "",
    /absolute/,
  );
  // A newline cannot break out of the single-quoted remote path.
  assert.match(
    validateRemoteWorkspaceInput({ name: "x", host: "h", remoteCwd: "/a\nrm -rf /" }).error ?? "",
    /invalid/,
  );
}

console.log("ok ssh");

// The socket directory: short enough for a `%C` name, or nothing rather than a failing ssh.
{
  const made: string[] = [];
  const make = (dir: string) => made.push(dir);
  const state = "/home/someone/.local/state/dsh-oh-my-claude";
  // The runtime dir wins: it is short, on tmpfs, and cleared at logout.
  assert.equal(controlSocketDir("/run/user/1000", state, make), "/run/user/1000/omc-ssh");
  // Without one, the state dir is one byte too long for the socket, so nothing is shared.
  assert.equal(controlSocketDir(undefined, state, make), undefined);
  // A shorter home fits, and is used.
  assert.equal(
    controlSocketDir(undefined, "/home/u/.local/state/omc", make),
    "/home/u/.local/state/omc/ssh",
  );
  // An unwritable runtime dir falls through to the state dir instead of failing every ssh.
  assert.equal(
    controlSocketDir("/run/user/1000", "/home/u/.local/state/omc", (dir) => {
      if (dir.startsWith("/run")) throw new Error("read-only");
      made.push(dir);
    }),
    "/home/u/.local/state/omc/ssh",
  );
  assert.deepEqual(made, [
    "/run/user/1000/omc-ssh",
    "/home/u/.local/state/omc/ssh",
    "/home/u/.local/state/omc/ssh",
  ]);
}
console.log("ssh control socket ok");
