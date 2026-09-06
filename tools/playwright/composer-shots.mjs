// Dev-only check: composer screenshots at desktop and phone widths plus the Oh My Claude button's box. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
const { chromium } = await import(`${process.env.PLAYWRIGHT_ROOT}/node_modules/playwright/index.mjs`);
const token = process.argv[2];
const b = await chromium.launch({ headless: true });
for (const [name, vp, mobile] of [["desktop", { width: 1400, height: 900 }, false], ["mobile", { width: 390, height: 844 }, true]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const want = /Running|\bnow\b|\d+min/;
  const item = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
  if (await item.count()) { await item.click({ force: true }); await p.waitForTimeout(2500); }
  const btn = p.locator('button[aria-label="Oh My Claude"]');
  const n = await btn.count();
  const bb = n ? await btn.first().boundingBox() : null;
  console.log(name, "button:", n, bb && JSON.stringify({ x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width) }));
  if (n) {
    await btn.click();
    await p.waitForTimeout(800);
    const dialog = p.locator('[role="dialog"][aria-label="Oh My Claude"]');
    const dBox = await dialog.boundingBox();
    console.log(name, "dialog box:", dBox && JSON.stringify({ x: Math.round(dBox.x), y: Math.round(dBox.y), w: Math.round(dBox.width), h: Math.round(dBox.height) }));
    const tabs = await p.locator('[role="tab"]').allInnerTexts();
    console.log(name, "tabs:", JSON.stringify(tabs));
  }
  const composer = p.locator('textarea, [contenteditable="true"]').first();
  const cb = await composer.boundingBox();
  console.log(name, "composer box:", cb && JSON.stringify({ x: Math.round(cb.x), y: Math.round(cb.y), w: Math.round(cb.width), h: Math.round(cb.height) }));
  await p.screenshot({ path: `${process.env.PW_OUT ?? "/tmp"}/composer-${name}.png`, fullPage: false });
  await ctx.close();
}
await b.close();
