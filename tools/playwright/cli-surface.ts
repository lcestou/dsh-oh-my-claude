// Dev-only check for the 2026-10-20 CLI-surface pass: the Suggested next prompt switch is on the
// Settings card and reads on until flipped (and the flip survives a reload), a page with no
// suggestion draws no suggestion card, and the Tasks tab with no live task draws no live-task
// section while its empty line still shows. Point PLAYWRIGHT_ROOT at any project with Playwright
// installed; arg 1 is the dsh launch token, arg 2 a directory for the screenshots.
import { dshUrl, launch } from "./pw.js";
const [token, out = "/tmp/pw"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
const errors: string[] = [];
p.on("console", (m) => {
  const text = m.text();
  if (/error/i.test(text) && /omc|oh-my-claude/i.test(text)) errors.push(text.slice(0, 160));
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failed += 1;
};
/** Open Settings → Oh My Claude and return the suggestion switch's `aria-checked`. On dsh 0.2.1
 *  Settings sits in the account menu at the foot of the sidebar; an older dsh had a gear with
 *  its own label, which the first selector still covers. Both languages of each name. */
const openSettings = async () => {
  const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]');
  if ((await gear.count()) > 0) await gear.first().click();
  else {
    await p
      .locator('button[aria-label="Account menu"], button[aria-label="账户菜单"]')
      .first()
      .click();
    await p.waitForTimeout(500);
    await p
      .getByText(/^(Settings|设置)$/)
      .first()
      .click();
  }
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click();
  await p.waitForTimeout(800);
  return p.locator('[data-omc-suggestion-switch] [role="switch"]').getAttribute("aria-checked");
};
expect(
  "no suggestion card on a page without a suggestion",
  (await p.locator("[data-omc-suggestion-card]").count()) === 0,
);
const first = await openSettings();
expect(
  "one suggestion switch on the Settings card",
  (await p.locator("[data-omc-suggestion-switch]").count()) === 1,
);
expect("the switch reads on by default", first === "true");
await p.screenshot({ path: `${out}/cli-surface-settings.png` });
await p.locator('[data-omc-suggestion-switch] [role="switch"]').click();
await p.waitForTimeout(600);
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const after = await openSettings();
expect("the flip survives a reload", after === "false");
await p.locator('[data-omc-suggestion-switch] [role="switch"]').click();
await p.waitForTimeout(600);
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
expect("flipped back on", (await openSettings()) === "true");
// The panel's Tasks tab on a blank session: no live-task section, the empty line still there.
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const spark = p.locator('button[aria-label="Oh My Claude"]').first();
if ((await spark.count()) > 0) {
  await spark.click();
  await p.waitForTimeout(800);
  await p
    .getByRole("tab", { name: /Tasks|任务/ })
    .first()
    .click();
  await p.waitForTimeout(1500);
  expect(
    "no live-task section without a task",
    (await p.locator("[data-omc-live-tasks]").count()) === 0,
  );
  expect(
    "the Tasks tab still says it is empty",
    (await p.locator("[data-omc-tasks-empty]").count()) === 1,
  );
  await p.screenshot({ path: `${out}/cli-surface-tasks.png` });
} else {
  console.log("SKIP: no ✻ button on the landing page; the Tasks tab check needs an open session");
}
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(500);
await openSettings();
expect(
  "the switch is on the card at 390 px too",
  (await p.locator("[data-omc-suggestion-switch]").count()) === 1,
);
await p.screenshot({ path: `${out}/cli-surface-390.png` });
expect("no plugin console errors", errors.length === 0);
if (errors.length > 0) console.log(errors.join("\n"));
await b.close();
process.exit(failed === 0 ? 0 : 1);
