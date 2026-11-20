// Dev-only check: box colours. Two tabs on one dsh; tab A adds an account, both tabs grow a colour
// swatch on This box and on the account in Boxes, and a label span shaped like dsh's
// `renderModelLabel` (data-provider-id plus data-model-id, the span the picker rows and the
// composer chip use) reads the accent for This box and a different automatic shade for the
// account. A colour picked in tab A's Boxes row paints the label and shows in tab B with no reload
// and in Customize's Box colours list; Reset there brings the shade back; the "Claude model names"
// theme switch off drops the tint. Shots at desktop and 390 px in light and dark land in
// SHOTS_DIR. Run it against a scratch dsh only (DSH_ORIGIN): it writes accounts.json and hints
// there. Arg 1 is the dsh launch token.
import { dshUrl, launch, type Page } from "./pw.js";

const token = process.argv[2];
const shots = process.env.SHOTS_DIR ?? "/tmp/omc-box-colours-shots";
const PROVIDER = "claude-code-omc-colour";
const ACCENT = "rgb(217, 119, 87)";
const PICK = "#3366ff";
const PICK_RGB = "rgb(51, 102, 255)";
// The Boxes card's own swatches: Customize, folded or not, carries a second set further up the page.
const IN_BOXES = "#dsh-oh-my-claude-boxes";
let failed = 0;
/** One line per expectation; a miss counts toward the exit code. */
const expect = (label: string, ok: boolean, seen = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || !seen ? "" : ` (saw ${seen})`}`);
};
/** POST JSON to a plugin route from the page; answers the status. */
const post = (p: Page, path: string, body: Record<string, string | number | boolean | null>) =>
  p.evaluate(
    ([route, json]) =>
      fetch(`/dsh-oh-my-claude${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: json,
      }).then((r) => r.status),
    [path, JSON.stringify(body)],
  );
/** Open Settings → Oh My Claude and unfold the Boxes card, in either language. */
const openBoxes = async (p: Page) => {
  await p.goto(dshUrl(token), { waitUntil: "load" });
  await p.waitForTimeout(2500);
  // Settings sits in the account menu at the foot of the sidebar since dsh 0.2.1.
  const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]');
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
/** The computed text colour of a label span shaped like dsh's, for `provider`. The span is added
 *  once per page and per provider and stays, so a later read sees the sheet as it is then. */
const labelColour = (p: Page, provider: string) =>
  p.evaluate((id) => {
    let el = document.querySelector<HTMLElement>(`[data-omc-check-label="${id}"]`);
    if (!el) {
      el = document.createElement("span");
      el.setAttribute("data-omc-check-label", id);
      el.setAttribute("data-provider-id", id);
      el.setAttribute("data-model-id", "claude-haiku-5-5");
      el.textContent = "Haiku";
      document.body.appendChild(el);
    }
    return getComputedStyle(el).color;
  }, provider);

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const a = await ctx.newPage();
const other = await ctx.newPage();
await openBoxes(a);
await openBoxes(other);
await post(a, "/accounts/remove", { provider: PROVIDER });
await post(a, "/hints", { [`boxColour:${PROVIDER}`]: null, themeModelsOff: null });
await a.waitForTimeout(1500);
try {
  expect(
    "adding the account answers 200",
    (await post(a, "/accounts", { name: "Omc Colour", configDir: "/tmp/omc-box-colours-cfg" })) ===
      200,
  );
  await a.waitForTimeout(3000);
  for (const [tab, p] of [
    ["tab A", a],
    ["tab B", other],
  ] as const) {
    expect(
      `${tab}: This box has a swatch`,
      (await p.locator(`${IN_BOXES} [data-omc-box-colour="claude-code"]`).count()) === 1,
    );
    expect(
      `${tab}: the account has a swatch, with no reload`,
      (await p.locator(`${IN_BOXES} [data-omc-box-colour="${PROVIDER}"]`).count()) === 1,
    );
  }
  const thisBox = await labelColour(a, "claude-code");
  const auto = await labelColour(a, PROVIDER);
  expect("This box's model names keep the accent", thisBox === ACCENT, thisBox);
  expect(
    "the account's model names get a shade of their own",
    auto !== ACCENT && auto !== "",
    auto,
  );
  await a.locator(`${IN_BOXES} [data-omc-box-colour="${PROVIDER}"]`).fill(PICK);
  await a.waitForTimeout(2500);
  const picked = await labelColour(a, PROVIDER);
  expect("a colour picked in Boxes paints the account's names", picked === PICK_RGB, picked);
  expect(
    "tab B's swatch follows with no reload",
    (await other.locator(`${IN_BOXES} [data-omc-box-colour="${PROVIDER}"]`).inputValue()) === PICK,
  );
  const pickedB = await labelColour(other, PROVIDER);
  expect("and tab B's names too", pickedB === PICK_RGB, pickedB);
  // Customize sits under the theme switch on the same page; unfold it.
  await a.locator("[data-omc-theme-custom] > summary").first().click();
  await a.waitForTimeout(800);
  expect(
    "Customize lists This box and the account",
    (await a
      .locator(
        `[data-omc-box-colours] [data-omc-box-colour-row="claude-code"], [data-omc-box-colours] [data-omc-box-colour-row="${PROVIDER}"]`,
      )
      .count()) === 2,
  );
  expect(
    "Customize's swatch shows the pick from Boxes",
    (await a.locator(`[data-omc-box-colours] [data-omc-box-colour="${PROVIDER}"]`).inputValue()) ===
      PICK,
  );
  await a.locator(`[data-omc-box-colours] [data-omc-box-colour-reset="${PROVIDER}"]`).click();
  await a.waitForTimeout(2500);
  const back = await labelColour(a, PROVIDER);
  expect("Reset brings the automatic shade back", back === auto, back);
  for (const [w, scheme] of [
    [1400, "dark"],
    [1400, "light"],
    [390, "dark"],
    [390, "light"],
  ] as const) {
    const shot = await b.newContext({
      viewport: { width: 1400, height: 900 },
      colorScheme: scheme,
    });
    const p = await shot.newPage();
    await openBoxes(p);
    await p.setViewportSize({ width: w, height: 900 });
    await p.waitForTimeout(800);
    await p.locator('[data-testid="dsh-oh-my-claude-self-box-row"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${shots}/boxes-${w}-${scheme}.png` });
    await p.locator("[data-omc-theme-custom] > summary").first().click();
    await p.waitForTimeout(600);
    await p.locator("[data-omc-box-colours]").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${shots}/customize-${w}-${scheme}.png` });
    const width = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(`no sideways scroll at ${w} ${scheme}`, width <= w, String(width));
    await shot.close();
  }
  await post(a, "/hints", { themeModelsOff: true });
  await a.evaluate(() => window.dispatchEvent(new Event("omc-hints")));
  await a.waitForTimeout(2500);
  const off = await labelColour(a, PROVIDER);
  expect("the model-names switch off drops the box tint too", off !== auto && off !== ACCENT, off);
} finally {
  await post(a, "/hints", { [`boxColour:${PROVIDER}`]: null, themeModelsOff: null });
  await post(a, "/accounts/remove", { provider: PROVIDER });
}
await a.waitForTimeout(2500);
expect(
  "removing the account takes its swatch away in tab B",
  (await other.locator(`${IN_BOXES} [data-omc-box-colour="${PROVIDER}"]`).count()) === 0,
);
await b.close();
process.exit(failed ? 1 : 0);
