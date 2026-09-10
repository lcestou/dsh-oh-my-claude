// Dev-only check. Point PLAYWRIGHT_ROOT at any project that has Playwright installed.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw/usage-popover.png"] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const want = /Running|\bnow\b|\d+min/;
// Workspace to expand: PW_WORKSPACE, else the first workspace row.
const wsName = process.env.PW_WORKSPACE;
const ws = (
  wsName
    ? p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${wsName}$`) })
    : p.locator('[role="treeitem"]')
).first();
if (
  (await ws.count()) &&
  !(await p.locator('[role="treeitem"]').filter({ hasText: want }).count())
) {
  await ws.click({ force: true });
  await p.waitForTimeout(1200);
}
const item = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
if (await item.count()) {
  await item.click({ force: true });
  await p.waitForTimeout(2500);
}
const ring = p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first();
console.log("ring:", await ring.count());
if (await ring.count()) {
  await ring.hover();
  await p.waitForTimeout(800);
  await p.screenshot({
    path: out.replace(".png", "-hover.png"),
    clip: { x: 700, y: 300, width: 700, height: 600 },
  });
  await ring.click();
  await p.waitForTimeout(1500);
  const dlg = p.locator('[role="dialog"]').last();
  console.log(
    "dialog:",
    await dlg.count(),
    "text:",
    JSON.stringify((await dlg.innerText().catch(() => "")).slice(0, 300)),
  );
  if (await dlg.count()) await dlg.screenshot({ path: out });
}
await b.close();
