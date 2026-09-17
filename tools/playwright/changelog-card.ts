// Dev-only check for the Changelog card in Settings (2026-09-17): the card sits directly above
// Report a problem, opens on a click, draws the releases the route answers, marks the installed
// one, turns backticks into code, and links to the file on GitHub; an empty answer reads as the
// no-file line with the same link. The route is answered from here with a fixture, so the client
// half is checked whether or not the server behind the page has the route; the real route is
// exercised by `bun src/changelog.test.ts` and by opening the card on a restarted dsh.
// Usage: PLAYWRIGHT_ROOT=~/Projects/pewtron bun tools/playwright/changelog-card.ts <token> [/tmp/pw]
import { dshUrl, launch, type Page } from "./pw.js";

const [token, out = "/tmp/pw"] = process.argv.slice(2);
const FULL_URL = "https://github.com/lcestou/dsh-oh-my-claude/blob/main/CHANGELOG.md";
const RELEASES = [
  {
    version: "1.1.2",
    date: "2026-09-15",
    intro: null,
    sections: [
      {
        kind: "Fixed",
        items: [
          "The six rows reach dsh's menu again, which renders into a portal on `document.body`.",
          "A second fix.",
        ],
      },
      { kind: "Added", items: ["One addition."] },
    ],
  },
  {
    version: "1.1.1",
    date: "2026-09-14",
    intro: "A one-line release.",
    sections: [{ kind: "Fixed", items: ["The only fix."] }],
  },
];

const failures: string[] = [];
const expect = (cond: boolean, what: string) => {
  if (!cond) failures.push(what);
};

const openSettings = async (p: Page) => {
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
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
};

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });

// A. Two releases: order, open, rows, pill, code, link; the report card unmoved and still working.
const p = await ctx.newPage();
await p.route("**/dsh-oh-my-claude/changelog", async (route) => {
  await route.fulfill({ json: { ok: true, version: "1.1.2", releases: RELEASES } });
});
await openSettings(p);
const card = p.locator("#dsh-oh-my-claude-changelog-card");
expect((await card.count()) === 1, "changelog card present");
expect((await card.getAttribute("data-omc-card")) === "closed", "changelog card starts closed");
const next = await p.evaluate(
  () => document.getElementById("dsh-oh-my-claude-changelog-card")?.nextElementSibling?.id ?? "",
);
expect(
  next === "dsh-oh-my-claude-report-card",
  `changelog card sits above the report card (${next})`,
);
await card.locator("button").first().click({ force: true });
await p.waitForTimeout(1200);
expect((await card.getAttribute("data-omc-card")) === "open", "changelog card opens");
expect((await p.locator("[data-omc-changelog-release]").count()) === 2, "two releases drawn");
const installed = p.locator('[data-omc-changelog-release="1.1.2"] [data-omc-changelog-installed]');
expect((await installed.count()) === 1, "installed pill on 1.1.2");
expect(
  (await p
    .locator('[data-omc-changelog-release="1.1.1"] [data-omc-changelog-installed]')
    .count()) === 0,
  "no installed pill on 1.1.1",
);
expect((await p.locator("[data-omc-changelog-kind]").count()) === 3, "three kind blocks");
// The visible text, not only the hooks: the kind label, the date and the version string.
const head = await p.locator('[data-omc-changelog-release="1.1.2"]').innerText();
for (const word of ["1.1.2", "2026-09-15", "Fixed", "Added"])
  expect(head.includes(word), `release row shows ${word}`);
expect((await p.locator("[data-omc-changelog] li").count()) === 4, "four items");
const codes = await p.locator("[data-omc-changelog] code").allInnerTexts();
expect(codes.join("|") === "document.body", `one code span (${codes.join("|")})`);
const intro = await p.locator('[data-omc-changelog-release="1.1.1"] p').allInnerTexts();
expect(intro.join("") === "A one-line release.", `intro paragraph drawn (${intro.join("")})`);
const link = p.locator("[data-omc-changelog-link]");
expect((await link.count()) === 1, "one link");
expect((await link.getAttribute("href")) === FULL_URL, "link points at the file on GitHub");
await card.screenshot({ path: `${out}/changelog-card.png` });
// The neighbour: still there, still opens.
const report = p.locator("#dsh-oh-my-claude-report-card");
expect((await report.count()) === 1, "report card present");
await report.locator("button").first().click({ force: true });
await p.waitForTimeout(1200);
expect((await p.locator("[data-omc-report-text]").count()) === 1, "report card still opens");
await p.locator("[data-omc-settings]").screenshot({ path: `${out}/changelog-settings.png` });
await p.unrouteAll({ behavior: "ignoreErrors" });

// B. No file on this install: the line and the link.
const p2 = await ctx.newPage();
await p2.route("**/dsh-oh-my-claude/changelog", async (route) => {
  await route.fulfill({ json: { ok: true, version: "1.1.2", releases: [] } });
});
await openSettings(p2);
await p2.locator("#dsh-oh-my-claude-changelog-card button").first().click({ force: true });
await p2.waitForTimeout(1200);
const empty = await p2.locator("[data-omc-changelog]").allInnerTexts();
expect(/No CHANGELOG\.md on this install\./.test(empty.join("")), `empty line (${empty.join("")})`);
expect((await p2.locator("[data-omc-changelog-link]").count()) === 1, "empty state keeps the link");
await p2
  .locator("#dsh-oh-my-claude-changelog-card")
  .screenshot({ path: `${out}/changelog-empty.png` });
await p2.unrouteAll({ behavior: "ignoreErrors" });

console.log(failures.length === 0 ? "PASS" : `FAIL: ${failures.join("; ")}`);
await ctx.close();
await b.close();
process.exit(failures.length === 0 ? 0 : 1);
