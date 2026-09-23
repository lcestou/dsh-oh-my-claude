// Dev-only: proves the working line repeats above the composer while the turn header's line is off
// screen or not drawn. Needs a Claude session running right now in the workspace PW_WORKSPACE names
// (default oh-my-claude); PW_SESSION names its sidebar row, else the first row dsh labels Running.
// Reads the dockStatusAlways hint and reports it, since it changes what "hidden" should read.
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token;
// arg 2 an optional screenshot path.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw/dock-status.png"] = process.argv.slice(2);
const name = process.env.PW_SESSION;
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
p.on("console", (m) => {
  if (/oh-my-claude/.test(m.text())) console.log("PAGE:", m.text().slice(0, 200));
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// dsh's row says "Running" (运行中 in Chinese) while the session works. The workspace row is only
// clicked when no such row shows, since clicking an expanded workspace collapses it.
const runningRows = p.locator('[role="treeitem"]').filter({ hasText: /Running|运行中/ });
if ((await runningRows.count()) === 0) {
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: process.env.PW_WORKSPACE ?? "oh-my-claude" })
    .first();
  if (await ws.count()) await ws.click({ force: true });
  await p.waitForTimeout(1500);
}
const row = name
  ? p.locator('[role="treeitem"]').filter({ hasText: name }).first()
  : runningRows.first();
console.log("running Claude row:", await row.count());
if ((await row.count()) === 0) {
  console.log("no running Claude session to check against");
  await b.close();
  process.exit(1);
}
await row.click();
await p.waitForTimeout(4000);
const always = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/hints");
  const h: { dockStatusAlways?: boolean } = await r.json();
  return h.dockStatusAlways === true;
});
console.log("dockStatusAlways:", always);
const dock = p.locator("[data-omc-dock-status]");
const headerLine = p.locator("[data-dsh-oh-my-claude-turn]:not([data-omc-dock-status] *)");
const drawn = (await headerLine.count()) > 0;
console.log("header line drawn:", drawn);
if (drawn) {
  await headerLine.first().scrollIntoViewIfNeeded();
  await p.waitForTimeout(1200);
  console.log(
    "dock with header visible:",
    await dock.count(),
    always ? "(always on)" : "(expect 0)",
  );
  // Scroll the chat column's nearest scrolling ancestor to its very bottom, past the header.
  await p.evaluate(() => {
    const flows = document.querySelectorAll<HTMLElement>("[data-chat-flow]");
    let box: HTMLElement | null = flows[flows.length - 1]?.parentElement ?? null;
    while (box !== null && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    if (box !== null) box.scrollTop = box.scrollHeight;
  });
  await p.waitForTimeout(1500);
}
const n = await dock.count();
console.log("dock with header away or absent:", n, "(expect 1)");
if (n > 0) {
  const text = await dock.first().innerText();
  console.log("dock text:", JSON.stringify(text.slice(0, 80)));
  if (drawn) {
    const headerText = await headerLine.first().innerText();
    console.log("same verb:", text.split("…")[0] === headerText.split("…")[0]);
  }
}
await p.screenshot({ path: out });
await b.close();
