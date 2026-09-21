// Dev-only check: the cost pill in dsh's stats row lights up on hover, opens its dialog on click,
// and does the same from a phone tap. Point PLAYWRIGHT_ROOT at any project that has Playwright.
// Usage: bun tools/playwright/cost-pill.ts <token> [/tmp/pw/cost-pill]
import { dshUrl, launch, type Page } from "./pw.js";

const [token, out = "/tmp/pw/cost-pill"] = process.argv.slice(2);
const b = await launch();

/** Open a session that shows the cost pill: the workspace named by PW_WORKSPACE, else the first.
 *  A phone keeps the tree behind dsh's "Open sidebar" button, which closes again on each pick. */
async function openCostSession(p: Page): Promise<boolean> {
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const sidebar = p.getByRole("button", { name: "Open sidebar" });
  const showTree = async () => {
    if (await sidebar.count()) {
      await sidebar.click({ force: true });
      await p.waitForTimeout(800);
    }
  };
  await showTree();
  const wsName = process.env.PW_WORKSPACE;
  const ws = (
    wsName
      ? p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${wsName}$`) })
      : p.locator('[role="treeitem"]')
  ).first();
  if (await ws.count()) {
    await ws.click({ force: true });
    await p.waitForTimeout(1200);
  }
  for (let i = 1; i < 8; i++) {
    await showTree();
    const row = p.locator('[role="treeitem"]').nth(i);
    if (!(await row.count())) break;
    await row.click({ force: true });
    await p.waitForTimeout(2500);
    if (await p.locator("[data-omc-cost-pill]").count()) return true;
  }
  return false;
}

/** Drive one environment's cost pill through hover, click and escape, logging its attributes and
 *  dialogs so a phone and desktop are each exercised.
 */
async function check(p: Page, tag: string): Promise<void> {
  const pill = p.locator("[data-omc-cost-pill]").first();
  console.log(`${tag} pill:`, await pill.count(), JSON.stringify(await pill.innerText()));
  console.log(
    `${tag} attrs:`,
    await pill.getAttribute("aria-haspopup"),
    await pill.getAttribute("aria-expanded"),
    JSON.stringify(await pill.getAttribute("aria-label")),
  );
  await pill.hover();
  await p.waitForTimeout(500);
  const pb = await pill.boundingBox();
  if (pb)
    await p.screenshot({
      path: `${out}-${tag}-hover.png`,
      clip: { x: Math.max(0, pb.x - 200), y: pb.y - 60, width: 600, height: pb.height + 80 },
    });
  await pill.click();
  await p.waitForTimeout(1200);
  const dlg = p.locator("[data-omc-cost-dialog]");
  const db = await dlg.boundingBox();
  console.log(
    `${tag} dialog:`,
    await dlg.count(),
    "expanded:",
    await pill.getAttribute("aria-expanded"),
    "box:",
    JSON.stringify(db),
    "text:",
    JSON.stringify((await dlg.innerText().catch(() => "")).replace(/\n/g, " | ")),
  );
  if (db && pb)
    await p.screenshot({
      path: `${out}-${tag}-open.png`,
      clip: {
        x: Math.max(0, Math.min(db.x, pb.x) - 20),
        y: db.y - 20,
        width: Math.max(db.width, pb.width) + 200,
        height: pb.y + pb.height - db.y + 40,
      },
    });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  console.log(`${tag} after escape:`, await dlg.count(), await pill.getAttribute("aria-expanded"));
}

const desktop = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
if (await openCostSession(desktop)) await check(desktop, "desktop");
else console.log("desktop: no session with a cost pill found");

const phone = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const pp = await phone.newPage();
if (await openCostSession(pp)) await check(pp, "phone");
else console.log("phone: no session with a cost pill found");
await phone.close();
await b.close();
