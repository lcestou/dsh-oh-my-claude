import { chromium } from "/home/someone/Projects/pewtron/node_modules/playwright/index.mjs";
const [token, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const side = await p.locator("body").innerText();
console.log("sidebar hits:", side.split("\n").filter((l) => /todo|queue/i.test(l)).slice(0, 5).join(" || "));
// Workspaces start collapsed in a fresh profile: expand the one holding the session (arg 5, default someone).
const ws = p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${process.argv[5] ?? "someone"}$`) }).first();
const want = process.argv[4] ? new RegExp(process.argv[4], "i") : /Running|\bnow\b/;
// Only expand when the target is not already visible: clicking an expanded workspace collapses it.
if (await ws.count() && !(await p.locator('[role="treeitem"]').filter({ hasText: want }).count())) { await ws.click({ force: true }); await p.waitForTimeout(1200); }
const cand = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
if (await cand.count()) await cand.click({ force: true });
else await p.getByText(want).first().click({ force: true, timeout: 8000 }).catch((e) => console.log("click failed:", e.message.split("\n")[0]));
await p.waitForTimeout(3500);
const st = p.locator('[role="status"][aria-live="polite"]').first();
const n = await st.count();
console.log("status count:", n, n ? `text=${JSON.stringify(await st.innerText())} attr=${await st.getAttribute("data-dsh-oh-my-claude-turn")}` : "");
if (n) { await st.scrollIntoViewIfNeeded(); await st.screenshot({ path: out.replace(".png", "-crop.png") }); }
await p.screenshot({ path: out });
await b.close();
