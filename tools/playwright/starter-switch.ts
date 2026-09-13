// Dev-only check: the Prompt starter switch is the second control under the Oh My Claude settings
// title (under Claude look) and is on by default. Point PLAYWRIGHT_ROOT at any project with Playwright installed;
// arg 1 is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]').first();
console.log("settings control:", await gear.count());
await gear.click();
await p.waitForTimeout(800);
await p
  .getByText(/^Oh My Claude$/)
  .first()
  .click();
await p.waitForTimeout(800);
const heading = p.locator("#dsh-oh-my-claude-heading");
const theme = p.locator("[data-omc-theme-switch]");
const sw = p.locator("[data-omc-starter-switch]");
const box = p.locator('[data-omc-starter-switch] [role="switch"]');
const h = await heading.boundingBox();
const t = await theme.boundingBox();
const s = await sw.boundingBox();
console.log("switch count:", await sw.count(), "checked:", await box.getAttribute("aria-checked"));
console.log(
  "heading bottom:",
  h && Math.round(h.y + h.height),
  "theme top:",
  t && Math.round(t.y),
  "switch top:",
  s && Math.round(s.y),
);
console.log(
  (await theme.count()) === 1 && t && s && h && t.y >= h.y + h.height && s.y >= t.y + t.height
    ? "PASS: Claude look first, Prompt starter under it"
    : "FAIL",
);
// Round trip through the store: off, reload, still off; on, reload, still on.
const state = async () => {
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await gear.click();
  await p.waitForTimeout(600);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click();
  await p.waitForTimeout(600);
  return box.getAttribute("aria-checked");
};
await box.click();
await p.waitForTimeout(600);
const offAfterReload = await state();
await box.click();
await p.waitForTimeout(600);
const onAfterReload = await state();
console.log("off persisted:", offAfterReload, "on persisted:", onAfterReload);
console.log(
  offAfterReload === "false" && onAfterReload === "true"
    ? "PASS: switch round trip"
    : "FAIL: round trip",
);
await p.screenshot({ path: "/tmp/pw/starter-switch.png" });
await b.close();
