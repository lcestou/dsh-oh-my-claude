// Offline checks for the SKILL.md head parser: bun src/skills.test.ts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isWritableSkillScope,
  listSkills,
  parseSkillHead,
  skillTargetPath,
  skillTemplate,
  validSkillName,
} from "./skills.js";

{
  const plain =
    "---\nname: unslop\ndescription: Cut AI tells from any writing. Must always apply.\n---\n# Body\n";
  assert.deepEqual(parseSkillHead(plain), {
    name: "unslop",
    description: "Cut AI tells from any writing. Must always apply.",
  });
  const quoted = "---\nname: \"flux\"\ndescription: 'Local AI image generation'\n---\n";
  assert.deepEqual(parseSkillHead(quoted), {
    name: "flux",
    description: "Local AI image generation",
  });
  const block =
    "---\nname: research\ndescription: >\n  Investigate a question against primary sources.\n  Second line.\n---\n";
  assert.equal(
    parseSkillHead(block).description,
    "Investigate a question against primary sources.",
  );
  assert.deepEqual(parseSkillHead("# No frontmatter\nname: nope\n"), {}, "no fence, nothing read");
  assert.deepEqual(parseSkillHead("---\ntitle: x\n---\n"), {}, "fence without the two keys");
}

{
  assert.equal(validSkillName("unslop"), true);
  assert.equal(validSkillName("my-skill-2"), true);
  assert.equal(validSkillName("Unslop"), false);
  assert.equal(validSkillName("../evil"), false);
  assert.equal(validSkillName("a/b"), false);
  assert.equal(validSkillName(""), false);
  assert.equal(validSkillName("-lead"), false);
  assert.equal(validSkillName("x".repeat(65)), false);
  assert.equal(isWritableSkillScope("user"), true);
  assert.equal(isWritableSkillScope("project"), true);
  assert.equal(isWritableSkillScope("plugin:foo"), false);
  assert.ok(skillTemplate("foo", "bar").startsWith("---\n"));
  assert.ok(skillTemplate("foo", "bar").includes("name: foo"));
  assert.ok(skillTemplate("foo", "bar").includes("description: bar"));
  assert.ok(skillTemplate("foo", "").includes("One line: what this skill does"));
  assert.equal(
    skillTargetPath("user", "foo", "/home/u/.claude", undefined),
    "/home/u/.claude/skills/foo/SKILL.md",
  );
  assert.equal(
    skillTargetPath("project", "foo", "/h/.claude", "/w"),
    "/w/.claude/skills/foo/SKILL.md",
  );
  assert.equal(skillTargetPath("project", "foo", "/h/.claude", undefined), null);
  assert.equal(skillTargetPath("plugin:x", "foo", "/h/.claude", "/w"), null);
  assert.equal(skillTargetPath("user", "../x", "/home/u/.claude", undefined), null);
}

// Project skills come from the session's directory and from each directory above it up to the
// checkout root, so a session opened in a subdirectory lists the repository's skills too. A
// directory above the checkout is not a level, and neither is a sibling.
{
  const tmp = await mkdtemp(join(tmpdir(), "omc-skills-"));
  const root = join(tmp, "repo");
  const sub = join(root, "packages", "app");
  const skill = async (dir: string, name: string) => {
    await mkdir(join(dir, ".claude", "skills", name), { recursive: true });
    await writeFile(
      join(dir, ".claude", "skills", name, "SKILL.md"),
      `---\nname: ${name}\ndescription: d\n---\n`,
    );
  };
  await mkdir(join(root, ".git"), { recursive: true });
  await skill(sub, "own");
  await skill(root, "shared");
  await skill(tmp, "outside");
  await skill(join(root, "other"), "sibling");
  const listed = await listSkills(sub, join(tmp, "claude-home"));
  assert.deepEqual(
    listed.map((s) => `${s.scope}:${s.name}`),
    ["project:own", "project:shared"],
  );
}

console.log("skills ok");
