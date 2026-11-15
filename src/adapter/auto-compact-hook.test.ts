// Claude Code's own compaction (the one it runs mid-turn when the context fills) gets the people
// section through a PreCompact hook in the settings the plugin passes, since nothing else reaches
// it. Checked: the hook is there for a session's process, prints exactly the people instructions,
// fires only on the `auto` trigger, and side calls (title, compaction one-shots) carry none.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { PEOPLE_INSTRUCTIONS } from "../compact-retain.js";
import { AUTO_COMPACT_HOOKS, buildArgs } from "./cli.js";
import { Config } from "./config.js";

const settingsOf = (args: string[]) => {
  const i = args.indexOf("--settings");
  return i === -1 ? undefined : JSON.parse(args[i + 1] ?? "");
};
const flags = new Set(["--settings", "--setting-sources", "--strict-mcp-config"]);

for (const isolate of [false, true]) {
  const settings = settingsOf(buildArgs({ model: "m", config: Config({ isolate }), flags }));
  assert.deepEqual(
    settings?.hooks,
    AUTO_COMPACT_HOOKS,
    `a session's process carries the hook (isolate ${isolate})`,
  );
  if (isolate) assert.equal(settings.autoMemoryEnabled, false, "isolate's own settings stay");
}
assert.equal(
  settingsOf(buildArgs({ model: "m", config: Config({}), flags, purpose: "session-title" }))?.hooks,
  undefined,
  "a side call runs no hook",
);
const rule = AUTO_COMPACT_HOOKS.PreCompact[0];
assert.equal(rule?.matcher, "auto", "the manual /compact already passes the text as its argument");
const command = rule?.hooks[0]?.command ?? "";
assert.equal(
  execFileSync("sh", ["-c", command], { encoding: "utf8" }),
  PEOPLE_INSTRUCTIONS,
  "the hook prints the instructions word for word",
);

console.log("auto-compact hook: ok");
