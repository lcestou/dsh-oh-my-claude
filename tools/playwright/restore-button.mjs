import { chromium } from "/home/someone/Projects/pewtron/node_modules/playwright/index.mjs";
const token = process.argv[2]; const out = process.argv[3] ?? "/tmp/pw/page.png";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// try: open a new blank session via any "new" control
const newBtn = p.locator('button[aria-label*="New" i], button:has-text("New session"), a[href*="new"]').first();
if (await newBtn.count()) { await newBtn.click(); await p.waitForTimeout(2000); }
const restore = p.getByRole("button", { name: /Restore Claude session/i }).first();
console.log("restore buttons:", await restore.count());
if (await restore.count()) { await restore.click(); await p.waitForTimeout(1200); }
await p.screenshot({ path: out });
console.log("url:", p.url());
await b.close();
