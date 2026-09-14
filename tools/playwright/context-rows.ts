// Dev-only check: in a Claude Code session, dsh's chat no longer draws a row for context the CLI
// never got. The system-prompt row is folded away whatever the switches say, because this plugin
// has never passed dsh's own system prompt on; an injected-context row is folded only while its
// switch is off. Both are still in the DOM, so this counts rows against visible rows rather than
// looking for their absence.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed. Arg 1 is the dsh launch token,
// arg 2 a pattern matching the session row to open, arg 3 the workspace holding it.
import { dshUrl, launch } from "./pw.js";

const [token, sessionPattern = "Running|\\bnow\\b", wsName] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

// Workspaces start collapsed in a fresh profile; clicking an expanded one would collapse it, so
// this only expands when the session row is not on screen already.
const want = new RegExp(sessionPattern, "i");
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
const row = p.locator('[role="treeitem"]').filter({ hasText: want }).first();
if (!(await row.count())) {
  console.log("FAIL: no session row matching", sessionPattern);
  await b.close();
  process.exit(1);
}
await row.click({ force: true });
await p.waitForTimeout(3500);

// Read the computed display rather than asking Playwright whether a row is visible: the mask works
// by `display:none` and that is the thing to assert, while Playwright's own visibility also answers
// false for a row that is merely scrolled out of the loaded view.
const rows = await p.evaluate(() =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-chat-flow-kind]")).map((el) => ({
    kind: el.dataset["chatFlowKind"] ?? "",
    hidden: getComputedStyle(el).display === "none",
    label: el.querySelector("[data-context-source]")?.textContent ?? "",
  })),
);
for (const r of rows) {
  if (r.kind === "system-prompt" || r.kind === "context") {
    console.log(`${r.hidden ? "folded " : "drawn  "} ${r.kind} ${r.label}`);
  }
}
const system = rows.filter((r) => r.kind === "system-prompt");
// The runtime snapshot goes to the CLI whatever the switches say, so its row must stay drawn.
const snapshot = rows.filter((r) => r.label === "@deepseek-ai/dsh-system-prompt");
console.log(
  system.length === 0
    ? "SKIP: this session logged no system prompt row"
    : system.every((r) => r.hidden)
      ? "PASS: dsh system prompt row folded away"
      : "FAIL: dsh system prompt row still drawn",
);
console.log(
  snapshot.length === 0
    ? "SKIP: no runtime snapshot row in the loaded window"
    : snapshot.every((r) => !r.hidden)
      ? "PASS: runtime snapshot row still drawn"
      : "FAIL: runtime snapshot row folded away, and it was sent",
);
await p.screenshot({ path: "/tmp/pw/context-rows.png" });
await b.close();
