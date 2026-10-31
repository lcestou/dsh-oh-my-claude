// Dev-only check: prompt recall in the composer. Opens an idle Claude session, empties the composer,
// then Up (recalls the newest prompt), Up (older), Down (newer), a typed character plus Up (the
// edit lock holds), and leaves the composer empty. Prints what the box held after each key and the
// time the first recall took. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1
// is the dsh launch token.
import { dshUrl, launch } from "./pw.js";

const [token] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// A new session in the first workspace: nothing sends, and recall has to fall back to the
// workspace's newest transcript, the fresh-session path.
const items = p.locator('[role="treeitem"]');
const total = await items.count();
let picked = -1;
for (let i = 0; i < total; i++) {
  if ((await items.nth(i).innerText()).startsWith("New Session")) {
    picked = i;
    break;
  }
}
if (picked < 0) throw new Error(`no New Session among ${total} tree items`);
await items.nth(picked).click({ force: true });
await p.waitForTimeout(2500);
console.log("url:", p.url());
const box = p.locator("[data-composer-input]").first();
await box.click();
await p.keyboard.press("Control+A");
await p.keyboard.press("Backspace");
await p.waitForTimeout(300);
/** The composer's text as a person sees it, trimmed. */
const held = async () => (await box.innerText()).trim();
console.log("empty:", JSON.stringify(await held()));
const t0 = Date.now();
await p.keyboard.press("ArrowUp");
await p.waitForTimeout(1500);
const first = await held();
console.log(`up (${Date.now() - t0 - 1500}ms+):`, JSON.stringify(first.slice(0, 80)));
// In a filled box Up moves the caret up a visual line first; the step comes from the top line.
let second = first;
let ups = 0;
while (second === first && ups < 8) {
  await p.keyboard.press("ArrowUp");
  await p.waitForTimeout(250);
  second = await held();
  ups++;
}
console.log(
  `up x${ups}:`,
  JSON.stringify(second.slice(0, 80)),
  second === first ? "(NO STEP)" : "(older)",
);
let back = second;
let downs = 0;
while (back === second && downs < 8) {
  await p.keyboard.press("ArrowDown");
  await p.waitForTimeout(250);
  back = await held();
  downs++;
}
console.log(
  `down x${downs}:`,
  JSON.stringify(back.slice(0, 80)),
  back === first ? "(= first)" : "(DIFFERS)",
);
await p.keyboard.press("End");
await p.keyboard.type("x");
await p.keyboard.press("ArrowUp");
await p.waitForTimeout(400);
const locked = await held();
console.log(
  "typed x, up:",
  JSON.stringify(locked.slice(0, 80)),
  locked === `${first}x` || locked.endsWith("x") ? "(edit kept)" : "(STEPPED AWAY)",
);
await p.keyboard.press("Control+A");
await p.keyboard.press("Backspace");
await p.waitForTimeout(300);
await p.keyboard.press("ArrowDown");
await p.waitForTimeout(300);
console.log("cleared, down:", JSON.stringify(await held()));
await p.keyboard.press("ArrowUp");
await p.waitForTimeout(600);
console.log("up from empty again:", JSON.stringify((await held()).slice(0, 80)));
await p.keyboard.press("ArrowDown");
await p.waitForTimeout(400);
console.log("down to empty:", JSON.stringify(await held()));
await p.screenshot({ path: `${process.env.PW_OUT ?? "/tmp"}/recall.png` });
await b.close();
