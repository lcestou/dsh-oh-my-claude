// Dev-only check: the Skills tab in the Oh My Claude panel lists skills grouped by scope and folds
// the CLI's /skill-doctor report. Both routes are stubbed, so it runs on any box and changes
// nothing. It asserts the three [data-omc-skills-scope] sections render, the search narrows them,
// and the Skill costs fold shows the report in [data-omc-skill-doctor] (or wraps a failure).
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch, type JsonDoc } from "./pw.js";

const token = process.argv[2];

const skillsBody: JsonDoc = {
  skills: [
    { name: "unslop", scope: "user", path: "/u/unslop/SKILL.md", description: "cut ai tells" },
    {
      name: "filler-01",
      scope: "user",
      path: "/u/filler-01/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-02",
      scope: "user",
      path: "/u/filler-02/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-03",
      scope: "user",
      path: "/u/filler-03/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-04",
      scope: "user",
      path: "/u/filler-04/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-05",
      scope: "user",
      path: "/u/filler-05/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-06",
      scope: "user",
      path: "/u/filler-06/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-07",
      scope: "user",
      path: "/u/filler-07/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-08",
      scope: "user",
      path: "/u/filler-08/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-09",
      scope: "user",
      path: "/u/filler-09/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-10",
      scope: "user",
      path: "/u/filler-10/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "filler-11",
      scope: "user",
      path: "/u/filler-11/SKILL.md",
      description: "pads the list past the twelve that show the search box",
    },
    {
      name: "design-pass",
      scope: "project",
      path: "/p/design-pass/SKILL.md",
      description: "plan a change",
    },
    {
      name: "flux",
      scope: "plugin:image",
      path: "/pl/flux/SKILL.md",
      description: "local image gen",
    },
  ],
};

const cases: { name: string; body: JsonDoc; pre: boolean; text: string }[] = [
  {
    name: "report",
    body: { ok: true, report: "Skills loaded this session\n  unslop  userSettings  3×" },
    pre: true,
    text: "Skills loaded this session",
  },
  {
    name: "decline",
    body: { ok: false, declined: true, error: "No user skills to report." },
    pre: true,
    text: "No user skills",
  },
  {
    name: "error",
    body: { ok: false, error: "the skill report timed out" },
    pre: false,
    text: "Couldn't read the skill report",
  },
  {
    name: "partial",
    body: {
      ok: true,
      report: "Skills loaded this session\n  unslop  userSettings  3×",
      partial: true,
    },
    pre: true,
    text: "user skills only",
  },
];

const b = await launch();
let failed = false;
for (const c of cases) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.route("**/dsh-oh-my-claude/skills?*", async (route) => {
    await route.fulfill({ json: skillsBody });
  });
  await p.route("**/dsh-oh-my-claude/skill-doctor?*", async (route) => {
    await route.fulfill({ json: c.body });
  });
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  // Open a session so the panel has one to read.
  const want = /Running|\bnow\b|\d+min/;
  const wsItem = p.locator('[role="treeitem"]').first();
  if (await wsItem.count()) {
    await wsItem.click({ force: true });
    await p.waitForTimeout(1000);
  }
  const sessionRow = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
  if (await sessionRow.count()) {
    await sessionRow.click({ force: true });
    await p.waitForTimeout(1500);
  }
  // Open the panel from the composer spark, then the Skills tab.
  await p.locator('button[aria-label="Oh My Claude"]').first().click();
  await p.waitForTimeout(600);
  await p.locator("#omc-tab-Skills").click();
  await p.waitForTimeout(1000);
  const scopeCounts = await Promise.all(
    ["user", "project", "plugin"].map((s) => p.locator(`[data-omc-skills-scope="${s}"]`).count()),
  );
  const scopesOk = scopeCounts.every((n) => n === 1);
  // Search narrows to the matching section only (report case, so it runs once).
  let searchOk = true;
  if (c.name === "report") {
    await p
      .locator('[data-omc-skills=""] input[type="search"]')
      .fill("unslop")
      .catch(() => {});
    await p.waitForTimeout(400);
    const userAfter = await p.locator('[data-omc-skills-scope="user"]').count();
    const projectAfter = await p.locator('[data-omc-skills-scope="project"]').count();
    searchOk = userAfter === 1 && projectAfter === 0;
    await p
      .locator('[data-omc-skills=""] input[type="search"]')
      .fill("")
      .catch(() => {});
    await p.waitForTimeout(300);
  }
  // The Skill costs fold: open it, then read its report.
  await p.locator("[data-omc-skill-doctor-fold] > summary").click();
  await p.waitForTimeout(1500);
  const pre = p.locator("[data-omc-skill-doctor]");
  const foldText = await p
    .locator("[data-omc-skill-doctor-fold]")
    .innerText()
    .catch(() => "");
  const preCount = await pre.count();
  const hasText = foldText.includes(c.text);
  const ok = scopesOk && searchOk && hasText && (c.pre ? preCount === 1 : preCount === 0);
  console.log(
    `${c.name}: scopes=${scopeCounts.join(",")} search=${searchOk} pre=${preCount} hasText=${hasText} -> ${ok ? "PASS" : "FAIL"}`,
  );
  if (!ok) failed = true;
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
