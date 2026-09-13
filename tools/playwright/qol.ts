// Dev-only check for the 2026-09-13 batch: the Settings section's new controls (the spend line,
// the Remember model switch, the Report a problem card) and the archive row menu. The report route
// is answered from here with a fixed text, so the client half is checked whether or not the server
// running behind the page has the route yet; the real route is exercised by `bun src/report.test.ts`
// and by opening the card on a restarted dsh. Point PLAYWRIGHT_ROOT at any project with Playwright.
// Usage: bun tools/playwright/qol.ts <token> [/tmp/pw]
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const REPORT = "dsh-oh-my-claude 1.1.0\ndsh: 0.1.5-rc.2\nLogin: logged in · claude.ai\n";
const ISSUES = "https://github.com/lcestou/dsh-oh-my-claude/issues/new";
const b = await launch();
const ctx = await b.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: "dark",
  permissions: ["clipboard-read", "clipboard-write"],
});
const p = await ctx.newPage();
await p.route("**/dsh-oh-my-claude/report?*", async (route) => {
  await route.fulfill({ json: { ok: true, text: REPORT, issues: ISSUES } });
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
await p
  .locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]')
  .first()
  .click({ force: true });
await p.waitForTimeout(800);
await p
  .getByText(/^Oh My Claude$/)
  .first()
  .click({ force: true });
await p.waitForTimeout(1500);

const failures: string[] = [];
const expect = (cond: boolean, what: string) => {
  if (!cond) failures.push(what);
};

// The two new Settings rows sit under the switches.
expect((await p.locator("[data-omc-spend-field]").count()) === 1, "spend field present");
expect(
  (await p.locator("[data-omc-workspace-model-switch] [role=switch]").count()) === 1,
  "workspace model switch present",
);
const section = p.locator("[data-omc-settings]");
await section.screenshot({ path: `${out}/qol-settings.png` });

// Report a problem: the card opens, the text lands in the box, the issue link carries it.
const reportCard = p.locator("#dsh-oh-my-claude-report-card");
expect((await reportCard.count()) === 1, "report card present");
await reportCard.locator("button").first().click({ force: true });
await p.waitForTimeout(1200);
const box = p.locator("[data-omc-report-text]");
const text = (await box.count()) ? await box.inputValue() : "";
expect(text === REPORT, `report text shown (${JSON.stringify(text.slice(0, 40))})`);
const issue = p.locator("[data-omc-report-issue]");
const href = (await issue.count()) ? ((await issue.getAttribute("href")) ?? "") : "";
expect(href.startsWith(`${ISSUES}?body=`), `issue link carries the body (${href.slice(0, 60)})`);
expect((await p.locator("[data-omc-report-host]").count()) === 1, "hostname checkbox present");
await p.locator("[data-omc-report-copy]").first().click();
await p.waitForTimeout(300);
const clip = await p.evaluate(() => navigator.clipboard.readText());
expect(clip === REPORT, "copy puts the text on the clipboard");
await reportCard.screenshot({ path: `${out}/qol-report.png` });

// The archive list: a readable row has a menu with the three actions.
const sessionsCard = p.locator("#dsh-oh-my-claude-sessions-card");
await sessionsCard.locator("button").first().click({ force: true });
await p.waitForTimeout(3000);
const menuButton = p.locator("[data-omc-row-menu]").first();
if (await menuButton.count()) {
  await menuButton.scrollIntoViewIfNeeded();
  await menuButton.click();
  await p.waitForTimeout(600);
  const items = await p.locator('[role="menuitem"], [role="option"]').allInnerTexts();
  const joined = items.join(" | ");
  expect(/Download \.jsonl/.test(joined), `menu has Download .jsonl (${joined})`);
  expect(/Export as Markdown/.test(joined), "menu has Export as Markdown");
  expect(/Copy resume command/.test(joined), "menu has Copy resume command");
  await p.screenshot({ path: `${out}/qol-row-menu.png` });
  await p.keyboard.press("Escape");
} else {
  console.log("note: no readable archive row on this box, row menu not exercised");
}

console.log(failures.length === 0 ? "PASS" : `FAIL: ${failures.join("; ")}`);
await p.unrouteAll({ behavior: "ignoreErrors" });
await ctx.close();
await b.close();
process.exit(failures.length === 0 ? 0 : 1);
