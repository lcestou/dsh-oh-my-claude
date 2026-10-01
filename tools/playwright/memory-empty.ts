// Dev-only check: the Memory tab's empty state names the directory the server read, and a list
// that could not be fetched shows the failure instead of reading as empty. The route is stubbed,
// so it runs on any box and changes nothing. Each case is shot at desktop and phone width into
// the directory given as arg 2 (keep it outside the repository). The shots come out in whichever
// theme the box's dsh is set to: dsh takes its theme from its own setting, not from the browser,
// so asking the browser for light changes nothing.
//
// Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh launch token.
import { dshUrl, launch, type JsonDoc } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);

const DIR = "/home/me/.claude/projects/-home-me-Projects-app/memory";

/** One stubbed reply and what the tab has to show for it. */
interface Case {
  name: string;
  status: number;
  body: JsonDoc;
  /** Text the tab must show. */
  shows: string;
  /** Whether the directory line is drawn. */
  dir: boolean;
}

const cases: Case[] = [
  { name: "empty", status: 200, body: { dir: DIR, files: [] }, shows: "Looked in", dir: true },
  {
    name: "failed",
    status: 400,
    body: { error: "cwd must be a directory a dsh session is open in" },
    shows: "cwd must be a directory",
    dir: false,
  },
  {
    name: "listed",
    status: 200,
    body: {
      dir: DIR,
      files: [{ name: "MEMORY.md", size: 120, mtime: 1_790_000_000_000, summary: "index" }],
    },
    shows: "MEMORY.md",
    dir: false,
  },
];

const views = [
  { name: "desktop", viewport: { width: 1400, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
] as const;

const b = await launch();
let failed = false;
for (const c of cases)
  for (const view of views) {
    const ctx = await b.newContext({ viewport: view.viewport, colorScheme: "dark" });
    const p = await ctx.newPage();
    await p.route("**/dsh-oh-my-claude/memory?*", async (route) => {
      await route.fulfill({ status: c.status, json: c.body });
    });
    await p.goto(dshUrl(token), { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    // Open a session so the panel has one to read.
    const wsItem = p.locator('[role="treeitem"]').first();
    if (await wsItem.count()) {
      await wsItem.click({ force: true });
      await p.waitForTimeout(1000);
    }
    const sessionRow = p
      .locator('[role="treeitem"]')
      .filter({ hasText: /Running|\bnow\b|\d+min/ })
      .first();
    if (await sessionRow.count()) {
      await sessionRow.click({ force: true });
      await p.waitForTimeout(1500);
    }
    await p.locator('button[aria-label="Oh My Claude"]').first().click();
    await p.waitForTimeout(600);
    await p.locator("#omc-tab-Memory").click();
    await p.waitForTimeout(1000);

    const panel = p.locator('[role="tabpanel"]').first();
    const text = await panel.innerText().catch(() => "");
    const dirLine = p.locator('[data-omc-memory-dir=""]');
    const dirShown = (await dirLine.count()) === 1;
    // The line shows the path under `~`, and carries the whole of it for a hover.
    const dirOk = c.dir
      ? dirShown &&
        (await dirLine.innerText()).includes("~/.claude/projects") &&
        (await dirLine.getAttribute("title")) === DIR
      : !dirShown;
    // Nothing in the panel may run past the viewport's right edge at phone width.
    const box = c.dir ? await dirLine.boundingBox() : null;
    const fits = box === null || box.x + box.width <= view.viewport.width;
    const ok = text.includes(c.shows) && dirOk && fits;
    if (!ok) failed = true;
    const shot = `${out}/memory-${c.name}-${view.name}.png`;
    await p.screenshot({ path: shot });
    console.log(
      `${ok ? "ok  " : "FAIL"} ${c.name} ${view.name}: shows=${text.includes(c.shows)} dir=${dirOk} fits=${fits}`,
    );
    await p.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  }
await b.close();
if (failed) process.exit(1);
