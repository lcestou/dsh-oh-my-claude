// Dev-only check: the Claude Code update card above the composer. The session's side-questions
// reply is rewritten on the way to the page so the server appears to know a newer release for the
// box, the POST is answered "busy" and the next GET answers a finished run, without touching the
// server: the real routes would run `claude update` on this box. The card must appear naming the
// box and both versions with an Update button; the click must turn the button into "Updating…"
// and then "Updated" with the text saying which version landed. A second pass names an ssh box.
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token,
// arg 2 a directory for the screenshots, arg 3 (or PW_WORKSPACE) the workspace holding a Claude
// session.
import { dshUrl, launch, type JsonDoc } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const wsName = process.argv[4] ?? process.env.PW_WORKSPACE;
const b = await launch();
let failed = false;

for (const box of [
  { host: "", label: "this box", expect: /This box runs 2\.1\.273/ },
  { host: "lilly", label: "lilly", expect: /lilly runs 2\.1\.273/ },
]) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  let posted = 0;
  let startedAt = 0;
  await p.route("**/dsh-oh-my-claude/side-questions?*", async (route) => {
    const r = await route.fetch();
    const real = await r.json();
    await route.fulfill({
      response: r,
      json: {
        ...real,
        claudeUpdate: { host: box.host, label: box.label, installed: "2.1.273", latest: "2.1.274" },
      },
    });
  });
  await p.route("**/dsh-oh-my-claude/claude-update?*", async (route) => {
    // What the faked GET answers: the state shape the Tune rows and the card read.
    const state: JsonDoc = {
      host: box.host,
      label: box.label,
      installed: "2.1.273",
      latest: "2.1.274",
      channel: "latest",
      auto: false,
      busy: false,
      log: [],
    };
    if (route.request().method() === "POST") {
      posted++;
      return route.fulfill({ json: { ...state, busy: true } });
    }
    // The first GET after the click still sees the run; the next one sees it finished.
    const done = posted > 0 && Date.now() - startedAt > 2000;
    await route.fulfill({
      json: done
        ? {
            ...state,
            installed: "2.1.274",
            busy: false,
            log: [{ at: Date.now(), from: "2.1.273", to: "2.1.274", by: "button", ok: true }],
          }
        : { ...state, busy: posted > 0 },
    });
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
  const card = p.locator('[data-omc-update-card="2.1.274"]');
  const shown = await card.count();
  const idle = shown ? await card.first().innerText() : "";
  let busyLabel = "";
  let doneText = "";
  let doneLabel = "";
  if (shown) {
    await card.first().scrollIntoViewIfNeeded();
    await card.first().screenshot({ path: `${out}/claude-update-card-${box.label}.png` });
    const button = p.locator('[data-testid="dsh-oh-my-claude-card-update"]').first();
    startedAt = Date.now();
    await button.click();
    await p.waitForTimeout(500);
    busyLabel = await button.innerText();
    await p.waitForTimeout(6500);
    doneText = await card.first().innerText();
    doneLabel = await button.innerText();
    await card.first().screenshot({ path: `${out}/claude-update-card-${box.label}-done.png` });
  }
  const ok =
    shown === 1 &&
    /Claude Code 2\.1\.274 is out/.test(idle) &&
    box.expect.test(idle) &&
    /Updating/.test(busyLabel) &&
    /Updated/.test(doneLabel) &&
    new RegExp(`Updated ${box.label} to 2\\.1\\.274`).test(doneText);
  console.log(
    `${ok ? "PASS" : "FAIL"} box=${box.label} card=${shown} idle=${JSON.stringify(idle.split("\n")[0])} busy=${JSON.stringify(busyLabel)} done=${JSON.stringify(doneLabel)} text=${JSON.stringify(doneText.split("\n")[0])}`,
  );
  if (!ok) failed = true;
  await p.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
