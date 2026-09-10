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

// Second half: save the draft so Forget appears, arm it (label becomes "Sure?"), let it revert;
// the Save draft chip beside it must not move and the dock must not grow.
await p
  .getByRole("button", { name: /^Save draft$/ })
  .first()
  .click();
await p.waitForTimeout(800);
const forget = p.getByRole("button", { name: /Forget$/ }).first();
const saveChip = p.getByRole("button", { name: /Save draft|Saved/ }).first();
const at = async () => ({
  forgetW: (await forget.boundingBox())?.width,
  saveX: (await saveChip.boundingBox())?.x,
  dockH: (await dock.boundingBox())?.height,
});
// After the save the chip reads Saved and is greyed until the composer differs from the opener.
console.log(
  "after save:",
  await saveChip.innerText(),
  "disabled=",
  await saveChip.getAttribute("disabled"),
);
await composer.fill("hello again");
await p.waitForTimeout(800);
console.log("composer now:", JSON.stringify(await composer.innerText()));
console.log(
  "after edit:",
  await saveChip.innerText(),
  "disabled=",
  await saveChip.getAttribute("disabled"),
);
await composer.fill("hello");
await p.waitForTimeout(300);
const rest = await at();
await forget.click();
await p.waitForTimeout(300);
const armed = await at();
await p.waitForTimeout(5300); // ConfirmButton disarms itself after 5 s
const reverted = await at();
console.log("rest    ", JSON.stringify(rest));
console.log("armed   ", JSON.stringify(armed));
console.log("reverted", JSON.stringify(reverted));
const same = (a: typeof rest, c: typeof rest) =>
  a.forgetW === c.forgetW && a.saveX === c.saveX && a.dockH === c.dockH;
console.log(
  same(rest, armed) && same(rest, reverted) ? "PASS: Forget holds width" : "FAIL: Forget shifts",
);
// Leave the session as it was: confirm Forget to drop the saved opener.
await forget.click();
await p.waitForTimeout(200);
await forget.click();
await b.close();
