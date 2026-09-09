// Dev-only: proves the six Claude permission rows still reach dsh's access-shield menu. dsh owns
// that menu, so a dsh upgrade can silently drop our injection (0.1.5 removed the aria-expanded
// attribute the observer used to gate on). Point PLAYWRIGHT_ROOT at any project with Playwright
// installed; arg 1 is the dsh launch token; PW_SESSION names the session row to open.
const { chromium } = await import(`${process.env.PLAYWRIGHT_ROOT}/node_modules/playwright/index.mjs`);
const token = process.argv[2];
const name = process.env.PW_SESSION ?? "recipe";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => { const t = m.text(); if (/oh-my-claude/.test(t)) console.log("PAGE:", t.slice(0, 200)); });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const row = p.locator('[role="treeitem"]').filter({ hasText: name }).first();
console.log("row count", await row.count());
await row.click({ force: true });
await p.waitForTimeout(4000);
const shield = p.locator('button[aria-label^="Access mode"], button[aria-label^="Claude permission"]').first();
console.log("shield count", await shield.count(), "aria", await shield.getAttribute("aria-label"), "text", (await shield.textContent())?.trim());
await shield.click();
await p.waitForTimeout(1500);
const items = await p.locator('[role="menu"] [role="menuitem"]').allTextContents();
console.log("menu items:", JSON.stringify(items));
const marked = await p.locator('[role="menu"] [data-mode]').count();
console.log("our injected rows:", marked);
const wraps = await p.locator("[role='menu'] [class*='itemWrap']").count();
console.log("itemWrap count:", wraps);
console.log("menu html head:", (await p.locator('[role="menu"]').last().innerHTML()).slice(0, 700));
await b.close();
