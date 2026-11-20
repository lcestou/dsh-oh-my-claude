// The account list's rules: names that slug to a provider id nothing else holds, and config dirs
// that are absolute or `~`-rooted, normalised to one spelling, and never this box's own login.
import { strict as assert } from "node:assert";
import { homedir } from "node:os";
import {
  ACCOUNTS_MAX,
  accountHome,
  boxProviderId,
  defaultAccountDir,
  normalizeAccountDir,
  validateAccounts,
  type AccountRules,
} from "./accounts.js";
import { sshBoxProviderId } from "./sessions.js";
import { resolveClaudeHome } from "./state.js";

/** The rules for a box whose user is `u`, with `over` replacing any of them. */
const rules = (over: Partial<AccountRules> = {}): AccountRules => ({
  home: "/home/u",
  defaultHome: "/home/u/.claude",
  takenIds: new Map(),
  takenHomes: new Map(),
  ...over,
});

// Ids and default dirs.
{
  assert.equal(boxProviderId("Work"), "claude-code-work");
  assert.equal(boxProviderId("  My Team! "), "claude-code-my-team");
  assert.equal(sshBoxProviderId("My Team!"), boxProviderId("My Team!"), "ssh boxes share the rule");
  assert.equal(defaultAccountDir("Work Two"), "~/.claude-work-two");
  assert.equal(defaultAccountDir("!!"), "");
}

// Dir spelling: one form per folder, so the CLI's Keychain entry name never moves.
{
  assert.equal(normalizeAccountDir("~/.claude-work/"), "~/.claude-work");
  assert.equal(normalizeAccountDir(" /srv//claude/work// "), "/srv/claude/work");
  assert.equal(normalizeAccountDir("~"), "~");
  assert.equal(
    normalizeAccountDir(".claude-work"),
    undefined,
    "relative resolves against dsh's cwd",
  );
  assert.equal(normalizeAccountDir("~/a/../b"), undefined);
  assert.equal(normalizeAccountDir("~/a\nb"), undefined);
  assert.equal(normalizeAccountDir("~user/x"), undefined, "another user's home is not expanded");
  // The spawn resolves the saved form with resolveClaudeHome; both must give the same string.
  for (const dir of ["~/.claude-work", "/srv/claude/work"])
    assert.equal(accountHome(dir, homedir()), resolveClaudeHome(dir));
  assert.equal(
    accountHome("~/.claude-work", "/home/u/"),
    "/home/u/.claude-work",
    "$HOME with a slash",
  );
  assert.equal(accountHome("~/x", "/"), "/x");
}

// A good list, a blank dir taking the default.
{
  const v = validateAccounts(
    [
      { name: "Work", configDir: "" },
      { name: "Side", configDir: "/x/side/" },
    ],
    rules(),
  );
  assert.deepEqual(v, {
    accounts: [
      { name: "Work", configDir: "~/.claude-work" },
      { name: "Side", configDir: "/x/side" },
    ],
  });
}

// Each refusal names its reason.
{
  /** The refusal key validateAccounts gives `input`, or "ok" when it passes. */
  const key = (input: Array<{ name: string; configDir?: string }>, r = rules()) => {
    const v = validateAccounts(
      input.map((a) => ({ name: a.name, configDir: a.configDir ?? "" })),
      r,
    );
    return "refusal" in v ? v.refusal.key : "ok";
  };
  assert.equal(key([{ name: "" }]), "accountName");
  assert.equal(key([{ name: "x".repeat(41) }]), "accountName");
  assert.equal(key([{ name: "--" }]), "accountName");
  assert.equal(key([{ name: "Work" }, { name: "work" }]), "accountTaken");
  assert.equal(
    key([{ name: "Nova" }], rules({ takenIds: new Map([["claude-code-nova", "Nova"]]) })),
    "accountTaken",
    "an SSH box or a hand-written mount already holds the id",
  );
  assert.equal(key([{ name: "Work", configDir: "claude-work" }]), "accountDir");
  assert.equal(key([{ name: "Work", configDir: "~" }]), "accountDirHome");
  assert.equal(key([{ name: "Work", configDir: "/" }]), "accountDirHome");
  assert.equal(key([{ name: "Work", configDir: "~/.claude/" }]), "accountDirDefault");
  assert.equal(
    key([
      { name: "A", configDir: "~/x" },
      { name: "B", configDir: "/home/u/x" },
    ]),
    "accountDirTaken",
  );
  assert.equal(
    key([{ name: "A", configDir: "~/w" }], rules({ takenHomes: new Map([["/home/u/w", "Work"]]) })),
    "accountDirTaken",
  );
  assert.equal(
    key(Array.from({ length: ACCOUNTS_MAX + 1 }, (_, i) => ({ name: `a${i}` }))),
    "accountsMax",
  );
}
console.log("accounts ok");
