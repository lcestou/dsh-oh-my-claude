// Dev-only check: the Claude Code update card above the composer. The session's side-questions
// reply is rewritten on the way to the page so the server appears to know a newer release for the
// box, the POST is answered "busy" and the next GET answers a finished run, without touching the
// server: the real routes would run `claude update` on this box. The card must appear naming the
// box and both versions with an Update button; the click must turn the button into "Updating…"
// and then "Updated" with the text saying which version landed. A second pass names an ssh box; a
// third has the faked run come back declined, and a fourth dismisses the idle card and asserts the
// skip the server would have recorded.
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token,
// arg 2 a directory for the screenshots, arg 3 (or PW_WORKSPACE) the workspace holding a Claude
// session.
import { dshUrl, launch, type JsonDoc } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const wsName = process.argv[4] ?? process.env.PW_WORKSPACE;
const b = await launch();
let failed = false;

for (const box of [
  { host: "", label: "this box", expect: /This box runs 2\.1\.273/, mode: "done" },
  { host: "devbox", label: "devbox", expect: /devbox runs 2\.1\.273/, mode: "done" },
  { host: "", label: "this box", expect: /This box runs 2\.1\.273/, mode: "declined" },
  { host: "", label: "this box", expect: /This box runs 2\.1\.273/, mode: "dismiss" },
] as const) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
  const p = await ctx.newPage();
  let posted = 0;
  let startedAt = 0;
  const bodies: string[] = [];
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
      bodies.push(route.request().postData() ?? "");
      return route.fulfill({ json: { ...state, busy: true } });
    }
    // The first GET after the click still sees the run; the next one sees it finished.
    const done = posted > 0 && Date.now() - startedAt > 2000;
    const entry: JsonDoc =
      box.mode === "declined"
        ? {
            at: Date.now(),
            from: "2.1.273",
            to: "2.1.273",
            by: "button",
            ok: false,
            note: "Claude is up to date!",
          }
        : { at: Date.now(), from: "2.1.273", to: "2.1.274", by: "button", ok: true };
    await route.fulfill({
      json: done
        ? { ...state, installed: String(entry.to), busy: false, log: [entry] }
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
  let gone = 0;
  if (shown && box.mode === "dismiss") {
    await p.locator('[aria-label="Dismiss until the next release"]').first().click();
    // Past one more poll: the rewrite keeps naming the release, and the card must stay down.
    await p.waitForTimeout(3600);
    gone = (await card.count()) === 0 ? 1 : 0;
  } else if (shown) {
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
    await card.first().screenshot({
      path: `${out}/claude-update-card-${box.label}-${box.mode}.png`,
    });
  }
  const idleOk = shown === 1 && /Claude Code 2\.1\.274 is out/.test(idle) && box.expect.test(idle);
  const ok =
    box.mode === "dismiss"
      ? idleOk && gone === 1 && bodies.includes('{"skip":"2.1.274"}')
      : box.mode === "declined"
        ? idleOk &&
          /Updating/.test(busyLabel) &&
          doneLabel === "Not updated" &&
          /Claude Code declined: Claude is up to date!/.test(doneText)
        : idleOk &&
          /Updating/.test(busyLabel) &&
          /Updated/.test(doneLabel) &&
          new RegExp(`Updated ${box.label} to 2\\.1\\.274`).test(doneText) &&
          bodies.includes('{"run":true}');
  console.log(
    `${ok ? "PASS" : "FAIL"} mode=${box.mode} box=${box.label} card=${shown} idle=${JSON.stringify(idle.split("\n")[0])} busy=${JSON.stringify(busyLabel)} done=${JSON.stringify(doneLabel)} gone=${gone} posts=${JSON.stringify(bodies)} text=${JSON.stringify(doneText.split("\n")[0])}`,
  );
  if (!ok) failed = true;
  await p.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
