// Dev-only check: the Skill costs card in Settings → Oh My Claude runs the CLI's /skill-doctor and
// shows its text. The route is stubbed with each reply shape (ok, decline, error, partial), so this
// runs on any box and changes nothing. It asserts the report and decline render in the
// [data-omc-skill-doctor] <pre>, a failure is wrapped with "Couldn't read", and the <pre> scrolls.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch, type JsonDoc } from "./pw.js";

const token = process.argv[2];
const cases: { name: string; body: JsonDoc; pre: boolean; text: string }[] = [
  {
    name: "report",
    body: {
      ok: true,
      report: "Skills loaded this session\n\n  skill  source  uses\n  a  userSettings  0×",
    },
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
    body: { ok: true, report: "Skills loaded this session\n  a  userSettings  0×", partial: true },
    pre: true,
    text: "user skills only",
  },
];

const b = await launch();
let failed = false;
for (const c of cases) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.route("**/dsh-oh-my-claude/skill-doctor?*", async (route) => {
    await route.fulfill({ json: c.body });
  });
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  // Open a session so the card has one to report on.
  const want = /Running|\bnow\b|\d+min/;
  const ws = p.locator('[role="treeitem"]').first();
  if (await ws.count()) {
    await ws.click({ force: true });
    await p.waitForTimeout(1000);
  }
  const row = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
  if (await row.count()) {
    await row.click({ force: true });
    await p.waitForTimeout(1500);
  }
  const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]').first();
  await gear.click();
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click();
  await p.waitForTimeout(800);
  await p.locator("#dsh-oh-my-claude-skill-doctor-card > button").first().click();
  await p.waitForTimeout(1500);
  const pre = p.locator("[data-omc-skill-doctor]");
  const body = await p
    .locator("#dsh-oh-my-claude-skill-doctor-card")
    .innerText()
    .catch(() => "");
  const preCount = await pre.count();
  const hasText = body.includes(c.text);
  let scrolls = true;
  if (c.pre && preCount) {
    const box = await pre.first().boundingBox();
    const scrollH = await p.evaluate(
      () => document.querySelector<HTMLElement>("[data-omc-skill-doctor]")?.scrollHeight ?? 0,
    );
    scrolls = box ? scrollH >= box.height : false;
  }
  const ok = hasText && (c.pre ? preCount === 1 : preCount === 0) && scrolls;
  console.log(
    `${c.name}: pre=${preCount} hasText=${hasText} scrolls=${scrolls} -> ${ok ? "PASS" : "FAIL"}`,
  );
  if (!ok) failed = true;
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
