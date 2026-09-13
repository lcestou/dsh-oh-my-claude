// Dev-only check: the login card above the composer. The session's side-questions reply is
// rewritten on the way to the page so the server appears to have recorded a failed login on this
// box, and the login start route is answered with a fake sign-in link; the card must appear with a
// Log in button, and the click must show the link and the paste box. Point PLAYWRIGHT_ROOT at any
// project with Playwright installed; arg 1 is the dsh launch token, arg 2 a directory for the
// screenshot, arg 3 (or PW_WORKSPACE) the workspace holding a Claude session.
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const wsName = process.argv[4] ?? process.env.PW_WORKSPACE;
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.route("**/dsh-oh-my-claude/side-questions?*", async (route) => {
  const r = await route.fetch();
  const real = await r.json();
  await route.fulfill({
    response: r,
    json: { ...real, loginNeeded: { host: "", label: "this box" } },
  });
});
// Answered without touching the server: the real route would start `claude setup-token` on this
// box, which opens a sign-in tab on the desktop. The poll is answered "pending" for the same reason.
await p.route("**/dsh-oh-my-claude/ssh-boxes/login/start", async (route) => {
  await route.fulfill({
    json: { url: "https://claude.com/cai/oauth/authorize?code=true&state=check" },
  });
});
await p.route("**/dsh-oh-my-claude/ssh-boxes/login/poll", async (route) => {
  await route.fulfill({ json: { pending: true } });
});
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// Open a session in the named workspace (or the first), so the composer dock mounts.
const ws = (
  wsName
    ? p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^${wsName}$`) })
    : p.locator('[role="treeitem"]')
).first();
if (await ws.count()) {
  await ws.click({ force: true });
  await p.waitForTimeout(1200);
}
const row = p.locator('[role="treeitem"]').nth(1);
if (await row.count()) await row.click({ force: true });
await p.waitForTimeout(4000);
const card = p.locator("[data-omc-login-card]");
const shown = await card.count();
const text = shown ? await card.first().innerText() : "";
let steps = 0;
if (shown) {
  await card.first().scrollIntoViewIfNeeded();
  await card.first().screenshot({ path: `${out}/login-card.png` });
  await p.locator('[data-testid="dsh-oh-my-claude-card-login"]').first().click();
  await p.waitForTimeout(1500);
  steps = await card.first().locator('a[href*="claude.com"]').count();
  await card.first().screenshot({ path: `${out}/login-card-steps.png` });
}
const ok = shown === 1 && /logged out/.test(text) && steps === 1;
console.log(
  `${ok ? "PASS" : "FAIL"} card=${shown} text=${JSON.stringify(text.split("\n")[0])} link=${steps}`,
);
await p.unrouteAll({ behavior: "ignoreErrors" });
await ctx.close();
await b.close();
process.exit(ok ? 0 : 1);
