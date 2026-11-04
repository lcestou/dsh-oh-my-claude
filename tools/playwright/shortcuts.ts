// Dev-only check: the composer shortcuts. Opens a new session in the first workspace, then: Esc Esc
// in the empty composer (expects the panel on its Rewind tab), Escape to close it, Ctrl+R (expects
// the history card, reads its rows or its error), Escape to close it, Ctrl+/ (expects dsh's
// Keyboard shortcuts dialog to list the plugin's three rows), and the Settings card's Shortcuts
// group, which it screenshots. Prints what it found at each step. Point PLAYWRIGHT_ROOT at any
// project with Playwright installed; arg 1 is the dsh launch token, arg 2 the screenshot path.
import { dshUrl, launch } from "./pw.js";

const [token, shot] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
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
const box = p.locator("[data-composer-input]").first();
await box.click();

// Esc Esc: the panel opens on Rewind.
await p.keyboard.press("Escape");
await p.waitForTimeout(120);
await p.keyboard.press("Escape");
await p.waitForTimeout(900);
const rewindTab = p.locator("#omc-tab-Rewind");
console.log(
  "esc esc: rewind tab",
  (await rewindTab.count()) > 0 ? await rewindTab.getAttribute("aria-selected") : "absent",
);
await p.keyboard.press("Escape");
await p.waitForTimeout(600);
await box.click();

// Ctrl+R: the history card, its rows or its error.
await p.keyboard.press("Control+r");
// The fold of a busy workspace takes up to a second; two more are slack.
await p.waitForTimeout(3000);
const card = p.locator("[data-omc-history-search]");
console.log("ctrl+r: card", await card.count());
if ((await card.count()) > 0) {
  console.log(
    " focused:",
    await p.evaluate(() => document.activeElement?.getAttribute("aria-label")),
  );
  console.log(
    " scope:",
    await p.locator("[data-omc-history-scope]").getAttribute("data-omc-history-scope"),
  );
  console.log(" rows:", await p.locator("[data-omc-history-row]").count());
  console.log(" text:", (await card.innerText()).replace(/\s+/g, " ").slice(0, 300));
  await p.keyboard.press("Control+s");
  await p.waitForTimeout(1200);
  console.log(
    " after ctrl+s scope:",
    await p.locator("[data-omc-history-scope]").getAttribute("data-omc-history-scope"),
    "rows:",
    await p.locator("[data-omc-history-row]").count(),
  );
  // The second pair of scope keys, for browsers that own Ctrl+S (Zen, Arc): forward, then back.
  for (const key of ["Control+ArrowDown", "Control+ArrowUp"]) {
    await p.keyboard.press(key);
    await p.waitForTimeout(1200);
    console.log(
      ` after ${key} scope:`,
      await p.locator("[data-omc-history-scope]").getAttribute("data-omc-history-scope"),
    );
  }
  // Esc closes from anywhere in the page, not only from the field: blur it first.
  // SAFETY: the active element is the card's input, an HTMLElement, and `blur` is optional-chained
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  console.log(" after esc from body: card", await card.count());
  await p.keyboard.press("Control+r");
  await p.waitForTimeout(1200);
  await p.keyboard.type("a");
  await p.waitForTimeout(300);
  console.log(" after 'a' rows:", await p.locator("[data-omc-history-row]").count());
  await p.keyboard.press("Tab");
  await p.waitForTimeout(400);
  console.log(
    " after tab: card",
    await card.count(),
    "box:",
    JSON.stringify((await box.innerText()).slice(0, 80)),
  );
  console.log(
    " focused after:",
    await p.evaluate(() => document.activeElement?.hasAttribute("data-composer-input")),
  );
}

// dsh's Keyboard shortcuts dialog lists the plugin's rows.
await p.keyboard.press("Control+Slash");
await p.waitForTimeout(1200);
const dialog = p.locator('[role="dialog"]').last();
const dialogText = (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ");
// Both languages, the way the Settings lookup below matches both.
const ROWS: [string, string][] = [
  ["Prompt recall", "提示词回溯"],
  ["History search", "历史搜索"],
  ["Edit last prompt", "编辑上一条提示词"],
];
for (const [en, zh] of ROWS)
  console.log(`shortcuts dialog has "${en}":`, dialogText.includes(en) || dialogText.includes(zh));
await p.keyboard.press("Escape");
await p.waitForTimeout(600);

// The Settings group. dsh 0.2.2 keeps Settings under the account menu.
await p.locator('[aria-label="Account menu"]').first().click();
await p.waitForTimeout(600);
await p
  .getByText(/^(Settings|设置)$/)
  .first()
  .click();
await p.waitForTimeout(800);
await p
  .getByText(/^Oh My Claude$/)
  .first()
  .click();
await p.waitForTimeout(800);
const group = p.locator("[data-omc-shortcut-switches]");
console.log("settings group:", await group.count());
if ((await group.count()) > 0) {
  await group.scrollIntoViewIfNeeded();
  console.log(" text:", (await group.innerText()).replace(/\s+/g, " ").slice(0, 400));
  if (shot) await group.screenshot({ path: shot });
}
await b.close();
