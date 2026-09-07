// Offline self-check: bun src/permissions.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import {
  readPermissionRules,
  setPermissionRule,
  suggestRule,
  type PermissionKind,
} from "./permissions.js";

/** The text of a write that was meant to succeed; a failure fails the test where it happened. */
const written = (out: ReturnType<typeof setPermissionRule>): string => {
  if (out.error !== undefined) assert.fail(out.error);
  return out.text;
};

// A Bash command keeps its subcommand and drops its arguments; a flag is not a subcommand.
{
  assert.equal(suggestRule("Bash", { command: "git status --short" }), "Bash(git status:*)");
  assert.equal(suggestRule("Bash", { command: "npm run build" }), "Bash(npm run:*)");
  assert.equal(suggestRule("Bash", { command: "ls -la /tmp" }), "Bash(ls:*)");
  assert.equal(suggestRule("Bash", { command: "  make  " }), "Bash(make:*)");
  assert.equal(suggestRule("Bash", {}), "Bash", "no command, no specifier to invent");
}

// Anything carrying a file path becomes that path, whatever the tool is called.
{
  assert.equal(suggestRule("Read", { file_path: "/home/u/.zshrc" }), "Read(/home/u/.zshrc)");
  assert.equal(suggestRule("Write", { file_path: "/tmp/x" }), "Write(/tmp/x)");
  assert.equal(suggestRule("Edit", { file_path: "" }), "Edit", "an empty path is no path");
  assert.equal(suggestRule("WebSearch", { query: "x" }), "WebSearch", "bare name covers the tool");
}

// The three lists, and every way a file can fail to have them.
{
  const text = `{"permissions":{"allow":["Bash(ls:*)","Read(/tmp)"],"deny":["Bash(rm:*)"]}}`;
  const rules = readPermissionRules(text);
  assert.deepEqual(rules.allow, ["Bash(ls:*)", "Read(/tmp)"]);
  assert.deepEqual(rules.deny, ["Bash(rm:*)"]);
  assert.deepEqual(rules.ask, [], "a kind the file never set reads as empty");

  assert.deepEqual(readPermissionRules("{ broken").allow, [], "unparsable text reads as empty");
  assert.deepEqual(readPermissionRules("[]").allow, [], "an array is not a settings object");
  assert.deepEqual(readPermissionRules(`{"permissions":"none"}`).allow, []);
  assert.deepEqual(
    readPermissionRules(`{"permissions":{"allow":["Bash(ls:*)",7,null]}}`).allow,
    ["Bash(ls:*)"],
    "a non-string entry is dropped, the rest of the list stands",
  );
}

// Adding keeps every other key, creates the section when it is missing, and never duplicates.
{
  const first = setPermissionRule(`{"model":"opus"}`, "allow", "Bash(ls:*)", "add");
  assert.equal(first.error, undefined);
  assert.deepEqual(JSON.parse(written(first)), {
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
  });
  assert.ok(written(first).endsWith("}\n"), "written the way the CLI writes it");

  const again = setPermissionRule(written(first), "allow", "Bash(ls:*)", "add");
  assert.deepEqual(readPermissionRules(written(again)).allow, ["Bash(ls:*)"]);

  const other = setPermissionRule(written(first), "deny", "Bash(rm:*)", "add");
  assert.deepEqual(readPermissionRules(written(other)), {
    allow: ["Bash(ls:*)"],
    deny: ["Bash(rm:*)"],
    ask: [],
  });
}

// A rule the CLI would not read is refused here rather than written and ignored.
{
  for (const bad of ["", "  ", "Bash(ls", "npm run build", "*"]) {
    const out = setPermissionRule("{}", "allow", bad, "add");
    assert.ok(out.error !== undefined, `refused: ${JSON.stringify(bad)}`);
  }
  assert.equal(
    setPermissionRule("{}", "allow", "Bash", "add").error,
    undefined,
    "a bare tool name",
  );
  assert.equal(setPermissionRule("{ broken", "allow", "Bash", "add").error !== undefined, true);
}

// Removing the last rule of a kind takes the key, and the empty section, with it.
{
  const text = `{"model":"opus","permissions":{"allow":["Bash(ls:*)","Read(/tmp)"]}}`;
  const one = setPermissionRule(text, "allow", "Read(/tmp)", "remove");
  assert.deepEqual(JSON.parse(written(one)), {
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
  });

  const none = setPermissionRule(written(one), "allow", "Bash(ls:*)", "remove");
  assert.deepEqual(
    JSON.parse(written(none)),
    { model: "opus" },
    "no empty array, no empty section",
  );

  const kept = setPermissionRule(
    `{"permissions":{"allow":["Bash(ls:*)"],"deny":["Bash(rm:*)"]}}`,
    "allow",
    "Bash(ls:*)",
    "remove",
  );
  assert.deepEqual(JSON.parse(written(kept)), { permissions: { deny: ["Bash(rm:*)"] } });

  const absent = setPermissionRule(`{"model":"opus"}`, "ask", "Bash(ls:*)", "remove");
  assert.deepEqual(JSON.parse(written(absent)), { model: "opus" }, "removing what is not there");
  const kinds: PermissionKind[] = ["allow", "deny", "ask"];
  for (const kind of kinds)
    assert.equal(setPermissionRule("{}", kind, "Bash", "remove").error, undefined);
}

console.log("permissions ok");
