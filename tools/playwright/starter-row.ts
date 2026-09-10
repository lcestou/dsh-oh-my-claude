// Dev-only check: the starter dock under a blank session's composer must not change height when
// the Save draft chip appears on the first keystroke. Point PLAYWRIGHT_ROOT at any project with
// Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const newBtn = p
  .locator('button[aria-label*="New" i], button:has-text("New session"), a[href*="new"]')
  .first();
if (await newBtn.count()) {
  await newBtn.click();
  await p.waitForTimeout(2000);
}
const dock = p.locator("[data-omc-dock]").first();
const composer = p.locator('textarea, [contenteditable="true"]').first();
const measure = async () => {
  const d = await dock.boundingBox();
  const c = await composer.boundingBox();
  return { dockH: d?.height, dockY: d?.y, composerY: c?.y };
};
const before = await measure();
await composer.fill("hello");
await p.waitForTimeout(600);
const after = await measure();
console.log("before", JSON.stringify(before));
console.log("after ", JSON.stringify(after));
console.log(
  before.dockH === after.dockH && before.composerY === after.composerY
    ? "PASS: no shift"
    : "FAIL: shifted",
);
await b.close();
