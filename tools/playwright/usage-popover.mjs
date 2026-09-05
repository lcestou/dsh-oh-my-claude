// Dev-only check. Point PLAYWRIGHT_ROOT at any project that has Playwright installed.
const { chromium } = await import(`${process.env.PLAYWRIGHT_ROOT ?? process.cwd()}/node_modules/playwright/index.mjs`);
const [token, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const want = /Running|\bnow\b|\d+min/;
const ws = p.locator('[role="treeitem"]').filter({ hasText: /^someone$/ }).first();
if (await ws.count() && !(await p.locator('[role="treeitem"]').filter({ hasText: want }).count())) { await ws.click({ force: true }); await p.waitForTimeout(1200); }
const item = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
if (await item.count()) { await item.click({ force: true }); await p.waitForTimeout(2500); }
const ring = p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first();
console.log("ring:", await ring.count());
if (await ring.count()) {
  await ring.hover(); await p.waitForTimeout(800);
  await p.screenshot({ path: out.replace(".png", "-hover.png"), clip: { x: 700, y: 300, width: 700, height: 600 } });
  await ring.click(); await p.waitForTimeout(1500);
  const dlg = p.locator('[role="dialog"]').last();
  console.log("dialog:", await dlg.count(), "text:", JSON.stringify((await dlg.innerText().catch(() => "")).slice(0, 300)));
  if (await dlg.count()) await dlg.screenshot({ path: out });
}
await b.close();
