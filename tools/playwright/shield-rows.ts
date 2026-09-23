// Dev-only: proves the permission control still opens dsh's access menu. Task 1 moved the control
// into dsh's `conversation.input.permission` slot (an AccessTrigger), so dsh renders the menu and
// its access modes itself; the old DOM-mutating AccessShield is now only the fallback when an older
// dsh refuses the slot. A dsh upgrade can still silently drop the slot, so this proves the menu
// still opens and shows the access rows. Point PLAYWRIGHT_ROOT at any project with Playwright
// installed; arg 1 is the dsh launch token; PW_SESSION names the session row to open.
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const name = process.env.PW_SESSION ?? "recipe";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => {
  const t = m.text();
  if (/oh-my-claude/.test(t)) console.log("PAGE:", t.slice(0, 200));
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const row = p.locator('[role="treeitem"]').filter({ hasText: name }).first();
console.log("row count", await row.count());
await row.click({ force: true });
await p.waitForTimeout(4000);
const shield = p
  .locator('button[aria-label^="Access mode"], button[aria-label^="Claude permission"]')
  .first();
console.log(
  "shield count",
  await shield.count(),
  "aria",
  await shield.getAttribute("aria-label"),
  "text",
  (await shield.textContent())?.trim(),
);
await shield.click();
await p.waitForTimeout(1500);
// dsh renders the access rows as a radio group; the group size is the number of access modes.
const radio = p.locator('[role="menu"] [role="menuitemradio"]');
const items = await radio.allTextContents();
const setsize = await radio.first().getAttribute("aria-setsize");
console.log("access modes:", JSON.stringify(items.map((t) => t.trim())));
console.log("radio setsize:", setsize);
console.log("menu html head:", (await p.locator('[role="menu"]').last().innerHTML()).slice(0, 700));
console.log(
  setsize && Number(setsize) > 0
    ? "VERDICT: access menu opened, " + setsize + " modes"
    : "VERDICT: access menu did not open",
);
await b.close();
