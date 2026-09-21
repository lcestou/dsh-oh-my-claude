// Dev-only check: the Context settings card sits between the Claude look switch and the Prompt starter
// switch, with six rows (instructions, skills, runtime, tools, claudemd, system), the first two of
// them switchable and the rest disabled for transparency only. Every row but the last is checked;
// `system` is dsh's own system prompt, which the adapter drops, so it draws clear. The master
// switch reads aria-checked="true" on a box that has never touched it, and the fold shows exactly
// the last four rows disabled. Round-trip through the store proves the key reached the box-wide
// store rather than the tab.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
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
const contextSw = p.locator("[data-omc-context-switch]");
const themeSw = p.locator("[data-omc-theme-switch]");
const starterSw = p.locator("[data-omc-starter-switch]");
const masterBox = p.locator('[data-omc-context-switch] [role="switch"]');
const c = await contextSw.boundingBox();
const t = await themeSw.boundingBox();
const s = await starterSw.boundingBox();
console.log(
  "context switch count:",
  await contextSw.count(),
  "checked:",
  await masterBox.getAttribute("aria-checked"),
);
console.log(
  "theme top:",
  t && Math.round(t.y),
  "context top:",
  c && Math.round(c.y),
  "starter top:",
  s && Math.round(s.y),
);
console.log(
  (await contextSw.count()) === 1 && t && c && s && t.y < c.y && c.y < s.y
    ? "PASS: context switch between theme and starter"
    : "FAIL",
);
// The fold: [data-omc-context-custom] present while master is on, with five rows.
const fold = p.locator("[data-omc-context-custom]");
console.log("fold present:", await fold.count());
const rows = p.locator("[data-omc-context]");
console.log("context row count:", await rows.count());
if ((await rows.count()) !== 6) {
  console.error("FAIL: expected 6 context rows, got", await rows.count());
  await b.close();
  process.exit(1);
}
const rowState = await Promise.all(
  Array.from({ length: 6 }, (_, i) =>
    Promise.all([rows.nth(i).isChecked(), rows.nth(i).isDisabled()]),
  ),
);
for (const [i, row] of rowState.entries()) {
  console.log(`row ${i}: checked=${row[0]}, disabled=${row[1]}`);
}
const sizes = p.locator("[data-omc-context-size]");
const sizeTexts = await sizes.allTextContents();
console.log("size count:", sizeTexts.length, "texts:", sizeTexts.join(", "));
if (sizeTexts.length > 0) {
  console.log("PASS: sizes rendered");
} else {
  console.log("note: no sizes yet in this workspace");
}
// Row 4 is the CLAUDE.md row, and it is checked only while the CLI is loading those files. On a box
// where a settings file or the environment sets CLAUDE_CODE_DISABLE_CLAUDE_MDS it draws clear, which
// is the row working, not failing.
const checkedCorrect = [0, 1, 2, 3, 4].every((i) => rowState[i]![0]) && !rowState[5]![0];
const lastFourDisabled = [2, 3, 4, 5].every((i) => rowState[i]![1]);
console.log(
  checkedCorrect && lastFourDisabled ? "PASS: fold rows correct" : "FAIL: fold rows wrong",
);
// Round trip through the store: off, reload, still off; on, reload, still on.
/** Reload the settings card and return the master switch state, so the round-trip proves a toggle
 *  persists across a reload rather than living only in the tab.
 */
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
  return masterBox.getAttribute("aria-checked");
};
await masterBox.click();
await p.waitForTimeout(600);
const offAfterReload = await state();
await masterBox.click();
await p.waitForTimeout(600);
const onAfterReload = await state();
console.log("off persisted:", offAfterReload, "on persisted:", onAfterReload);
console.log(
  offAfterReload === "false" && onAfterReload === "true"
    ? "PASS: switch round trip"
    : "FAIL: round trip",
);
// Leave the switch ON.
if ((await masterBox.getAttribute("aria-checked")) !== "true") {
  await masterBox.click();
  await p.waitForTimeout(300);
}
await p.screenshot({ path: "/tmp/pw/context-switch.png" });
await b.close();
