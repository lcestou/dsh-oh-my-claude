// Offline self-check: bun src/claude-home.test.ts. Real files under a temp dir, no CLI.
import { strict as assert } from "node:assert";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMirror, mirrorPlan } from "./claude-home.js";

// The plan: everything the real home has gets a link, `projects` never does, and an entry that came
// back as a real file is a repair rather than a second link.
assert.deepEqual(
  mirrorPlan(["settings.json", "projects", "commands", ".credentials.json"], []),
  { link: ["settings.json", "commands", ".credentials.json"], repair: [] },
  "an empty mirror links everything but projects",
);
assert.deepEqual(
  mirrorPlan(
    ["settings.json", ".credentials.json"],
    [{ name: "settings.json" }, { name: ".credentials.json", forked: true }],
  ),
  { link: [], repair: [".credentials.json"] },
  "a link that came back as a file is repaired, an intact one is left alone",
);

const tmp = await mkdtemp(join(tmpdir(), "dsh-claude-home-"));
const real = join(tmp, "claude");
const mirror = join(tmp, "mirror");
mkdirSync(join(real, "projects"), { recursive: true });
writeFileSync(join(real, "settings.json"), '{"a":1}\n', "utf8");
writeFileSync(join(real, ".credentials.json"), "real token\n", "utf8");

const log: string[] = [];
buildMirror(real, mirror, (level, msg) => log.push(`${level} ${msg}`));

// The login and the settings are the real files, read through the link.
assert.equal(readFileSync(join(mirror, "settings.json"), "utf8"), '{"a":1}\n');
assert.ok(lstatSync(join(mirror, "settings.json")).isSymbolicLink(), "settings is a link");
// Transcripts are the mirror's own directory: that is the whole point of it.
assert.ok(lstatSync(join(mirror, "projects")).isDirectory(), "projects is a real directory");
assert.ok(!lstatSync(join(mirror, "projects")).isSymbolicLink(), "projects is not linked back");

// A second build over a mirror that already holds is a no-op, not a pile of errors.
buildMirror(real, mirror, (level, msg) => log.push(`${level} ${msg}`));
assert.deepEqual(readdirSync(mirror).toSorted(), [
  ".credentials.json",
  "projects",
  "settings.json",
]);

// The CLI replaced the link with a file of its own: the new token belongs in the real home, and the
// mirror goes back to being a link, so a terminal `claude` logs in with the same credentials.
// A write *through* the link lands on the real file, which is the happy path; the fork is the CLI
// replacing the link itself, which is what a temp-file-plus-rename does.
rmSync(join(mirror, ".credentials.json"));
writeFileSync(join(mirror, ".credentials.json"), "refreshed token\n", "utf8");
buildMirror(real, mirror, (level, msg) => log.push(`${level} ${msg}`));
assert.equal(readFileSync(join(real, ".credentials.json"), "utf8"), "refreshed token\n");
assert.equal(readFileSync(join(real, ".credentials.json.bak"), "utf8"), "real token\n");
assert.ok(lstatSync(join(mirror, ".credentials.json")).isSymbolicLink(), "relinked after repair");
assert.ok(
  log.some((l) => l.startsWith("info claude home mirror: .credentials.json had forked")),
  "the repair is logged, not silent",
);

console.log("claude-home ok");
