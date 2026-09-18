// Dev-only: proves the Remote workspaces card and dsh's sidebar stay in step. Three legs:
//   1. a workspace added through the plugin's route reaches the open card with no reload (the
//      picker's path, minus the dialog);
//   2. the same workspace deleted from dsh's sidebar menu is gone from the card when Settings is
//      opened again. dsh deletes in its own registry and never tells the plugin, so this leg is
//      red on a server without the GET reconcile, which is the control for it;
//   3. a workspace removed through the route leaves the open card with no reload.
// Needs one saved ssh box; the folder it pins does not have to exist there, since nothing is
// spawned. Leg 2 reads dsh's English menu ("Workspace actions for …", "Delete workspace"): dsh's
// markup is not ours, so when those are not found the labels seen are printed and the leg is
// skipped, not failed. Point PLAYWRIGHT_ROOT at any project with Playwright installed.
// Usage: bun tools/playwright/remote-ws-sync.ts <token>
import { dshUrl, launch, type Page } from "./pw.js";

const token = process.argv[2];
const NAME = "omc-sync-check";
const ROW = '[data-testid="dsh-oh-my-claude-remote-ws-row"]';
const failures: string[] = [];

type Reply = { status: number; text: string };
const call = (p: Page, method: string, body?: Record<string, string>): Promise<Reply> =>
  p.evaluate(
    async ([m, json]) => {
      const init: RequestInit = { method: m, headers: { "content-type": "application/json" } };
      if (json !== "") init.body = json;
      const r = await fetch("/dsh-oh-my-claude/remote-workspaces", init);
      return { status: r.status, text: await r.text() };
    },
    [method, body === undefined ? "" : JSON.stringify(body)],
  );
/** Remove every row this check made, on this run or one that died half way. */
const sweep = async (p: Page) => {
  const listed = await call(p, "GET");
  const rows: { name: string; path: string }[] = JSON.parse(listed.text).workspaces ?? [];
  for (const w of rows.filter((row) => row.name === NAME))
    await call(p, "DELETE", { path: w.path });
};
const openCard = async (p: Page) => {
  await p
    .locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]')
    .first()
    .click({ force: true });
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click({ force: true });
  await p.waitForTimeout(1500);
  // The card folds; its rows exist only while it is open. The heading is always there.
  const heading = p.getByText(/^Remote workspaces$/);
  if ((await heading.count()) === 0)
    await p.locator("#dsh-oh-my-claude-boxes button").first().click({ force: true });
  await p.waitForTimeout(800);
  if ((await heading.count()) === 0) failures.push("the Boxes card did not open");
};
/** Poll for a row count without reloading; that no reload is needed is the point. */
const settles = async (p: Page, want: number, ms: number) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await p.locator(ROW, { hasText: NAME }).count()) === want) return true;
    await p.waitForTimeout(150);
  }
  return false;
};

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2000);

const host = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/ssh-boxes");
  const body: { boxes?: { host: string }[] } = await r.json();
  return body.boxes?.[0]?.host ?? "";
});
if (!host) {
  console.log("SKIPPED: no ssh box is saved, so there is no box to pin a workspace to");
  await b.close();
  process.exit(0);
}

try {
  await sweep(p);
  await openCard(p);
  console.log("host:", host, "rows of other workspaces:", await p.locator(ROW).count());
  if (!(await settles(p, 0, 2000))) failures.push("setup: a leftover row would not go");

  // Leg 1: an add reaches the open card.
  let started = Date.now();
  const added = await call(p, "POST", { name: NAME, host, remoteCwd: `/tmp/${NAME}` });
  if (added.status !== 200) failures.push(`leg 1: POST answered ${added.status} ${added.text}`);
  else if (await settles(p, 1, 3000)) console.log(`leg 1 ok: row after ${Date.now() - started} ms`);
  else failures.push("leg 1: the added workspace never reached the card without a reload");

  // Leg 2: a delete from the sidebar's own menu. Settings covers the sidebar, so it is closed for
  // the click and opened again after, which is a fresh GET: the server reconcile is what is tested.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(800);
  const item = p.locator('[role="treeitem"]', { hasText: NAME }).first();
  const actions = item.locator('button[aria-label^="Workspace actions for"]').first();
  if ((await item.count()) === 0) failures.push("leg 2: the sidebar has no row for the workspace");
  else if ((await actions.count()) === 0) {
    const seen = await item.locator("button").all();
    const labels = await Promise.all(seen.map((x) => x.getAttribute("aria-label")));
    console.log("leg 2 SKIPPED: no actions button; the row's buttons:", JSON.stringify(labels));
  } else {
    await item.hover();
    await actions.click({ force: true });
    await p.waitForTimeout(600);
    const menu = p.locator('[role="menuitem"]');
    const del = menu.filter({ hasText: /delete/i }).first();
    if ((await del.count()) === 0)
      console.log("leg 2 SKIPPED: menu reads", JSON.stringify(await menu.allInnerTexts()));
    else {
      await del.click();
      await p.waitForTimeout(600);
      const confirm = p.locator('[role="dialog"] button', { hasText: /delete/i });
      if ((await confirm.count()) > 0) await confirm.last().click();
      await p.waitForTimeout(1200);
      if ((await item.count()) > 0) failures.push("leg 2: the sidebar still lists the workspace");
      await openCard(p);
      if (await settles(p, 0, 3000)) console.log("leg 2 ok: a sidebar delete left no row behind");
      else failures.push("leg 2: deleted in the sidebar, and the card still lists it");
    }
  }

  // Leg 3: a removal through the route leaves the open card. Added again first, since leg 2 took it.
  if ((await p.getByText(/^Remote workspaces$/).count()) === 0) await openCard(p);
  await sweep(p);
  await call(p, "POST", { name: NAME, host, remoteCwd: `/tmp/${NAME}` });
  if (!(await settles(p, 1, 3000))) failures.push("leg 3: setup, the row never came back");
  started = Date.now();
  await sweep(p);
  if (await settles(p, 0, 3000)) console.log(`leg 3 ok: row gone after ${Date.now() - started} ms`);
  else failures.push("leg 3: the removed workspace is still on the card");
} finally {
  await sweep(p).catch(() => {});
  await b.close();
}

if (failures.length > 0) {
  for (const f of failures) console.log("FAIL:", f);
  process.exit(1);
}
console.log("remote-ws-sync ok");
