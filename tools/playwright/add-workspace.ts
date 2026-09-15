// Dev-only: proves the Add workspace takeover still engages. dsh owns the sidebar "+" and its own
// Select Workspace Directory dialog, so a dsh upgrade can silently hand the click back to dsh: the
// dialog still opens, it is just dsh's, and the box dropdown is gone. Ours is the one with
// `omc-db-dialog` on it. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is
// the dsh launch token.
import { execFileSync } from "node:child_process";
import { dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
p.on("console", (m) => {
  const t = m.text();
  if (/oh-my-claude|uiWorkspace|ssh-boxes/.test(t)) console.log("PAGE:", t.slice(0, 300));
});
// DSH_ORIGIN drives the same check through a reverse proxy, which is a different browser trust
// authority than loopback and a place a plugin route can be answered differently.
const origin = process.env.DSH_ORIGIN;
await p.goto(origin ? `${origin}/?token=${token}` : dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

// What the takeover needs before it will register its listener at all.
const seen = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/ssh-boxes");
  return { status: r.status, body: (await r.text()).slice(0, 300) };
});
console.log("ssh-boxes:", seen.status, seen.body);

const plus = p.locator('button[aria-label="Add workspace"]');
console.log("add button count:", await plus.count());
await plus.first().click();
await p.waitForTimeout(1500);

// Ours carries its own class; dsh's carries a CSS-module hash we must not select on.
const ours = await p.locator(".omc-db-dialog").count();
const dialogs = await p.locator('[role="dialog"]').count();
const labels = await p.locator('[role="dialog"]').allTextContents();
console.log("our dialog:", ours, "dialogs open:", dialogs);
console.log("dialog text:", JSON.stringify(labels.map((t) => t.slice(0, 120))));
if (ours === 0)
  console.log("VERDICT: takeover did not engage, dsh's own dialog answered the click");
else console.log("VERDICT: takeover engaged");

// A build writes lib/client.js, which dsh hot-loads into every open tab. Nothing about that is
// hypothetical: a tab that has been open across a plugin build is the tab the owner is using, so
// the takeover has to survive one. DSH_HMR runs that leg, since it rewrites lib/.
if (process.env.DSH_HMR) {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  execFileSync("bun", ["run", "build:client"], { cwd: process.cwd() });
  await p.waitForTimeout(6000);
  const plus2 = p.locator('button[aria-label="Add workspace"]');
  console.log("after hot reload, add button count:", await plus2.count());
  await plus2.first().click();
  await p.waitForTimeout(1500);
  const ours2 = await p.locator(".omc-db-dialog").count();
  console.log(
    ours2 === 0
      ? "VERDICT after hot reload: takeover lost, dsh's own dialog answered the click"
      : "VERDICT after hot reload: takeover survived",
  );
}
await b.close();
