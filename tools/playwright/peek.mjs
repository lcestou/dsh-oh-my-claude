// Dev-only check. Point PLAYWRIGHT_ROOT at any project that has Playwright installed.
const { chromium } = await import(`${process.env.PLAYWRIGHT_ROOT ?? process.cwd()}/node_modules/playwright/index.mjs`);
const [token] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
console.log((await p.locator("body").innerText()).split("\n").filter(Boolean).slice(0, 30).join(" | "));
console.log("treeitems:", await p.locator('[role="treeitem"]').count(), "links:", await p.locator("a[href*=session]").count());
await p.screenshot({ path: "/tmp/pw/peek.png" });
await b.close();
