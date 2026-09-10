// Offline checks for the SKILL.md head parser: bun src/skills.test.ts.
import assert from "node:assert/strict";
import { parseSkillHead } from "./skills.js";

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

console.log("skills ok");
