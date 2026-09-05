import { chromium } from "/home/someone/Projects/pewtron/node_modules/playwright/index.mjs";
const [token, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(`http://127.0.0.1:3080/?token=${token}`, { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const side = await p.locator("body").innerText();
console.log("sidebar hits:", side.split("\n").filter((l) => /todo|queue/i.test(l)).slice(0, 5).join(" || "));
const cand = p.locator('[role="treeitem"]').filter({ hasText: /todo list/i }).first();
if (await cand.count()) await cand.click({ force: true });
else await p.getByText(/todo list/i).first().click({ force: true, timeout: 8000 }).catch((e) => console.log("click failed:", e.message.split("\n")[0]));
await p.waitForTimeout(3500);
const st = p.locator('[role="status"][aria-live="polite"]').first();
const n = await st.count();
console.log("status count:", n, n ? `text=${JSON.stringify(await st.innerText())} attr=${await st.getAttribute("data-dsh-oh-my-claude-turn")}` : "");
if (n) { await st.scrollIntoViewIfNeeded(); await st.screenshot({ path: out.replace(".png", "-crop.png") }); }
await p.screenshot({ path: out });
await b.close();
