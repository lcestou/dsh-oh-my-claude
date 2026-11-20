// Dev-only check: accounts in Settings → Boxes. Two tabs on one dsh; tab A adds an account and tab
// B, which never reloads, must show the row, then lose it when tab A removes it. Also: the row is
// a logged-out account under This box, Log in shows a sign-in link and is cancelled without
// signing in, the account is in the model picker list, a bad dir is refused with the server's
// text, and shots at desktop and 390 px in light and dark land in SHOTS_DIR. Run it against a
// scratch dsh only (DSH_ORIGIN): it writes accounts.json there. Arg 1 is the dsh launch token.
import { dshUrl, launch, type Page } from "./pw.js";

const token = process.argv[2];
const shots = process.env.SHOTS_DIR ?? "/tmp/omc-accounts-shots";
const NAME = "Omc Check";
const PROVIDER = "claude-code-omc-check";
const ROW = `[data-omc-account="${PROVIDER}"]`;
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
/** POST to an accounts route from the page, answering status and body text. */
const call = (p: Page, path: string, body: Record<string, string>) =>
  p.evaluate(
    async ([route, json]) => {
      const r = await fetch(`/dsh-oh-my-claude/accounts${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      });
      return { status: r.status, text: await r.text() };
    },
    [path, JSON.stringify(body)],
  );
/** Replace the saved SSH box list from the page, the way another tab's save would; answers ok. */
const putSsh = (p: Page, boxes: Array<{ name: string; host: string }>) =>
  p.evaluate(
    (json) =>
      fetch("/dsh-oh-my-claude/ssh-boxes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: json,
      }).then((r) => r.ok),
    JSON.stringify({ boxes }),
  );
/** The saved SSH box list, read from the page. */
const readSsh = (p: Page): Promise<Array<{ name: string; host: string }>> =>
  p.evaluate(() =>
    fetch("/dsh-oh-my-claude/ssh-boxes")
      .then((r) => r.json())
      .then((b: { boxes?: Array<{ name: string; host: string }> }) =>
        (b.boxes ?? []).map((x) => ({ name: x.name, host: x.host })),
      ),
  );
/** Open Settings → Oh My Claude and unfold the Boxes card, in either language. */
const openBoxes = async (p: Page) => {
  await p.goto(dshUrl(token), { waitUntil: "load" });
  await p.waitForTimeout(2500);
  // Settings sits in the account menu at the foot of the sidebar since dsh 0.2.1; an older dsh had
  // a gear with its own label, which the first selector still covers.
  const gear = p.locator(
    'button[aria-label*="Settings" i], a[aria-label*="Settings" i], button[aria-label*="设置"]',
  );
  if ((await gear.count()) > 0) await gear.first().click({ force: true });
  else {
    await p
      .locator('button[aria-label="Account menu"], button[aria-label="账户菜单"]')
      .first()
      .click();
    await p.waitForTimeout(500);
    await p
      .getByText(/^(Settings|设置)$/)
      .first()
      .click();
  }
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click({ force: true });
  await p.waitForTimeout(1500);
  const card = p.locator('#dsh-oh-my-claude-boxes[data-omc-card="closed"] button[aria-expanded]');
  if ((await card.count()) > 0) await card.first().click({ force: true });
  await p.waitForTimeout(1200);
};

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const a = await ctx.newPage();
const other = await ctx.newPage();
await openBoxes(a);
await openBoxes(other);
// A run that died half way left its account behind; clear it before counting.
await call(a, "/remove", { provider: PROVIDER });
await a.waitForTimeout(1500);
try {
  expect(
    "the Add account line is under This box",
    (await a.locator("[data-omc-account-open]").count()) === 1,
  );
  await a.locator("[data-omc-account-open]").click();
  await a.locator("[data-omc-account-name]").fill(NAME);
  expect(
    "the dir field suggests ~/.claude-<slug>",
    (await a.locator("[data-omc-account-dir]").getAttribute("placeholder")) ===
      "~/.claude-omc-check",
  );
  await a.locator("[data-omc-account-dir]").fill("relative/dir");
  await a.locator("[data-omc-account-add]").click();
  await a.waitForTimeout(1200);
  expect(
    "a relative dir is refused on screen",
    (await a.locator('[data-omc-accounts] [role="alert"]').count()) === 1,
  );
  await a.locator("[data-omc-account-dir]").fill("");
  await a.locator("[data-omc-account-add]").click();
  await a.waitForTimeout(2500);
  expect("tab A shows the new row", (await a.locator(ROW).count()) === 1);
  expect(
    "the row reads as logged out",
    (await a.locator(`${ROW} [data-omc-account-login="out"]`).count()) === 1,
  );
  await other.waitForTimeout(2500);
  expect("tab B shows it with no reload", (await other.locator(ROW).count()) === 1);
  // An SSH box saved elsewhere reaches tab B's SSH rows too, so B's next add cannot PUT it away.
  const sshRows = '[data-testid="dsh-oh-my-claude-ssh-box-row"]';
  const sshBefore = await readSsh(a);
  const rowsBefore = await other.locator(sshRows).count();
  try {
    expect(
      "an SSH box saves from tab A",
      await putSsh(a, [...sshBefore, { name: "Omc Ssh Check", host: "omc-ssh-check.invalid" }]),
    );
    await other.waitForTimeout(2500);
    expect(
      "tab B's SSH rows follow with no reload",
      (await other.locator(sshRows).count()) === rowsBefore + 1,
    );
  } finally {
    await putSsh(a, sshBefore);
  }
  const models = await a.evaluate(() =>
    fetch("/dsh-oh-my-claude/models?all=1").then((r) => r.text()),
  );
  expect("the account is in the picker's box list", models.includes(PROVIDER));
  await a.locator(`[data-omc-account-login-start="${PROVIDER}"]`).click();
  await a.waitForTimeout(6000);
  expect(
    "Log in shows a sign-in link",
    (await a.locator(`${ROW} a[href^="https://claude.com/"]`).count()) === 1,
  );
  for (const [w, scheme] of [
    [1400, "light"],
    [1400, "dark"],
    [390, "light"],
    [390, "dark"],
  ] as const) {
    const shot = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const p = await shot.newPage();
    await openBoxes(p);
    await p.locator(ROW).first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${shots}/accounts-${w}-${scheme}.png`, fullPage: true });
    const width = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(`no sideways scroll at ${w} ${scheme}`, width <= w);
    await shot.close();
  }
} finally {
  await call(a, "/remove", { provider: PROVIDER });
}
await a.waitForTimeout(2000);
await other.waitForTimeout(2000);
expect("tab A lost the row", (await a.locator(ROW).count()) === 0);
expect("tab B lost it too, with no reload", (await other.locator(ROW).count()) === 0);
await b.close();
process.exit(failed ? 1 : 0);
