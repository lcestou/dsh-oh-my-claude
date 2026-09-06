// Dev-only: screenshots and two short clips of the plugin's features for the README, written to
// docs/media/. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh
// launch token; PW_SESSION (default "Getting started") names the session row to open.
const { chromium } = await import(`${process.env.PLAYWRIGHT_ROOT}/node_modules/playwright/index.mjs`);
const token = process.argv[2];
const out = process.env.PW_OUT ?? "docs/media";
const sessionName = process.env.PW_SESSION ?? "Getting started";
const b = await chromium.launch({ headless: true });
const wait = (p, ms) => p.waitForTimeout(ms);
const open = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
  await wait(p, 2500);
  const row = p.locator('[role="treeitem"]').filter({ hasText: sessionName }).first();
  if (await row.count()) { await row.click({ force: true }); await wait(p, 3500); }
  return p;
};
const shot = async (p, name, clip) => { await p.screenshot({ path: `${out}/${name}.png`, clip }); console.log("wrote", `${name}.png`); };
const composerClip = async (p, h = 420, left = 60) => { const box = await p.locator('button[aria-label="Oh My Claude"]').boundingBox(); return { x: Math.max(0, box.x - left), y: Math.max(0, box.y - h + 60), width: 760, height: h }; };
const panel = () => '[role="dialog"][aria-label="Oh My Claude"]';
const tab = (p, name) => p.locator(`${panel()} [role="tab"]`, { hasText: name });

// Desktop stills
if (!process.env.PW_CLIPS_ONLY) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  const p = await open(ctx);
  await p.locator('button[aria-label="Oh My Claude"]').click(); await wait(p, 1500);
  for (const t of ["Memory", "Rewind", "Changes", "MCP"]) { await tab(p, t).click(); await wait(p, 1500); await shot(p, `panel-${t.toLowerCase()}`, await composerClip(p)); }
  await p.keyboard.press("Escape"); await wait(p, 400);
  const shield = p.locator('button[aria-label^="Claude permission"], button[aria-label^="Access mode"]').first();
  await shield.click(); await wait(p, 1200); await shot(p, "shield-menu", await composerClip(p, 380, 400)); await p.keyboard.press("Escape"); await wait(p, 300);
  const stats = p.locator("div").filter({ hasText: /\d+ turns · \d+ steps/ }).last();
  const sb = await stats.boundingBox(); if (sb) await shot(p, "cost-row", { x: sb.x - 10, y: sb.y - 40, width: Math.min(sb.width + 20, 1000), height: sb.height + 56 });
  // dsh's context ring: the only aria-haspopup button drawn as two concentric circles.
  const ring = p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first();
  if (await ring.count()) { await ring.click(); await wait(p, 2500); const d = p.locator('[role="dialog"]').last(); const db = await d.boundingBox(); if (db) await shot(p, "context-usage", { x: db.x - 10, y: db.y - 10, width: db.width + 20, height: db.height + 20 }); await p.keyboard.press("Escape"); }
  await ctx.close();
}
// Phone stills
if (!process.env.PW_CLIPS_ONLY) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" }); await wait(p, 2500);
  await p.setViewportSize({ width: 1400, height: 900 }); await wait(p, 1000);
  const row = p.locator('[role="treeitem"]').filter({ hasText: sessionName }).first();
  if (await row.count()) { await row.click({ force: true }); await wait(p, 3000); }
  await p.setViewportSize({ width: 390, height: 844 }); await wait(p, 2000);
  await p.locator('button[aria-label="Oh My Claude"]').click(); await wait(p, 1500); await tab(p, "Memory").click(); await wait(p, 1200);
  await shot(p, "phone-panel", { x: 0, y: 300, width: 390, height: 544 }); await p.keyboard.press("Escape"); await wait(p, 300);
  const stats = p.locator("div").filter({ hasText: /\d+ turns · \d+ steps/ }).last();
  if (await stats.count()) { await stats.hover(); await wait(p, 1200); await shot(p, "phone-cost-bubble", { x: 0, y: 560, width: 390, height: 284 }); }
  await ctx.close();
}
// Clips
for (const [name, drive] of [
  ["panel-tabs", async (p) => { await p.locator('button[aria-label="Oh My Claude"]').click(); await wait(p, 1200); for (const t of ["Memory", "Rewind", "Changes", "MCP"]) { await tab(p, t).click(); await wait(p, 1400); } await p.keyboard.press("Escape"); await wait(p, 600); }],
  ["shield-menu", async (p) => { const s = p.locator('button[aria-label^="Claude permission"], button[aria-label^="Access mode"]').first(); await s.click(); await wait(p, 1200); const m = p.locator('[role="menu"]').last(); await m.locator('[role="menuitem"]', { hasText: /^Plan/ }).hover(); await wait(p, 700); await m.locator('[role="menuitem"]', { hasText: /^Accept edits/ }).hover(); await wait(p, 700); await p.keyboard.press("Escape"); await wait(p, 600); }],
]) {
  // Record at the desktop size (the sidebar row must be reachable) and crop in ffmpeg afterwards.
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, recordVideo: { dir: `${out}/.video`, size: { width: 1400, height: 900 } } });
  const p = await open(ctx);
  await drive(p);
  const video = p.video();
  await ctx.close();
  const path = await video.path();
  console.log("clip", name, path);
}
await b.close();
