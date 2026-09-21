// Dev-only check: the Claude look switch is the first control under the Oh My Claude settings
// title, on by default, and drives the page: off hands a markdown link and the send button to
// dsh's colours, a picked accent recolours both, Reset brings the orange back, and each state
// survives a reload. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the
// dsh launch token, arg 2 (or PW_WORKSPACE) the workspace row to expand.
import { dshUrl, launch, type Page } from "./pw.js";

const token = process.argv[2];
const wsName = process.argv[3] ?? process.env.PW_WORKSPACE ?? "oh-my-claude";
const ORANGE = "rgb(217, 119, 87)";
const BLUE = "rgb(51, 102, 204)";
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();

/** Navigate to dsh and open the workspace then its first non-empty session, so the theme switch is
 *  exercised in a real session context.
 */
const openSession = async () => {
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: new RegExp(`^${wsName}$`) })
    .first();
  if (await ws.count()) {
    await ws.click({ force: true });
    await p.waitForTimeout(1200);
  }
  const rows = p.locator('[role="treeitem"]');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText()).trim();
    if (t !== wsName && t !== "") {
      await rows.nth(i).click({ force: true });
      break;
    }
  }
  await p.waitForTimeout(3000);
};
/** A probe link under the markdown rules, the send button, the spark: their computed colours. */
const colours = (page: Page) =>
  page.evaluate(() => {
    const host = document.createElement("div");
    host.className = "omc_markdown_probe";
    host.innerHTML = '<a href="#">l</a>';
    document.body.appendChild(host);
    const missing = "missing";
    // dsh's send button: the primary button whose ancestry holds the composer box. Found the way
    // the plugin finds it, not by the plugin's own mark, which is gone in the off state.
    const box = document.querySelector("[contenteditable]");
    const send =
      Array.from(document.querySelectorAll<HTMLElement>('button[class*="_primary"]')).find((el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
          if (box && a.contains(box)) return true;
        return false;
      }) ?? null;
    const css = (el: Element | null, prop: string) =>
      el ? getComputedStyle(el).getPropertyValue(prop).trim() : missing;
    const out = {
      claude: document.body.getAttribute("data-omc-claude") ?? "none",
      theme: document.body.getAttribute("data-omc-theme") ?? "absent",
      link: css(host.querySelector("a"), "color"),
      send: css(send, "background-color"),
      spark: css(document.querySelector('button[aria-label="Oh My Claude"] svg'), "fill"),
    };
    host.remove();
    return out;
  });
/** Open the Oh My Claude settings card through Settings, the entry every theme state check starts
 *  from.
 */
const openSettings = async () => {
  const gear = p.locator('button[aria-label*="Settings" i], a[aria-label*="Settings" i]').first();
  await gear.click();
  await p.waitForTimeout(800);
  await p
    .getByText(/^Oh My Claude$/)
    .first()
    .click();
  await p.waitForTimeout(800);
};
/** Close the settings card with Escape, returning the page to the session between states. */
const closeSettings = async () => {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
};

await openSession();
const before = await colours(p);
console.log("before:", JSON.stringify(before));
await openSettings();
const heading = p.locator("#dsh-oh-my-claude-heading");
const theme = p.locator("[data-omc-theme-switch]");
const starter = p.locator("[data-omc-starter-switch]");
const sw = p.locator('[data-omc-theme-switch] [role="switch"]');
const h = await heading.boundingBox();
const t = await theme.boundingBox();
const s = await starter.boundingBox();
console.log(
  "theme switch count:",
  await theme.count(),
  "checked:",
  await sw.getAttribute("aria-checked"),
  "heading bottom:",
  h && Math.round(h.y + h.height),
  "theme top:",
  t && Math.round(t.y),
  "starter top:",
  s && Math.round(s.y),
);
const placed =
  (await theme.count()) === 1 && h && t && s && t.y >= h.y + h.height && s.y >= t.y + t.height;
console.log(placed ? "PASS: Claude look first, on by default" : "FAIL: placement");

// Off: the link and the send button leave the orange; the fold under the switch disappears.
await sw.click();
await p.waitForTimeout(800);
const foldWhileOff = await p.locator("[data-omc-theme-custom]").count();
await closeSettings();
const off = await colours(p);
console.log("off:", JSON.stringify(off), "fold while off:", foldWhileOff);
console.log(
  off.theme === "" &&
    off.link !== ORANGE &&
    off.send !== ORANGE &&
    off.send !== "missing" &&
    foldWhileOff === 0
    ? "PASS: off hands the page to dsh"
    : "FAIL: off",
);

// Reload: still off.
await openSession();
const offReloaded = await colours(p);
console.log(offReloaded.theme === "" ? "PASS: off survives a reload" : "FAIL: off after reload");

// On again, then a blue accent through the picker.
await openSettings();
await sw.click();
await p.waitForTimeout(800);
await p.locator("[data-omc-theme-custom] summary").click();
await p.waitForTimeout(300);
const picker = p.locator("[data-omc-theme-accent]");
await picker.fill("#3366cc");
await p.waitForTimeout(800);
const resetShown = await p.locator("[data-omc-theme-reset]").count();
await closeSettings();
const blue = await colours(p);
console.log("blue:", JSON.stringify(blue), "reset shown:", resetShown);
console.log(
  blue.link === BLUE && blue.send === BLUE && blue.spark === BLUE && resetShown === 1
    ? "PASS: accent flows to link, send and spark"
    : "FAIL: accent",
);

// Reload: still blue. Then Reset: orange again, and the page matches where it started.
await openSession();
const blueReloaded = await colours(p);
console.log(blueReloaded.link === BLUE ? "PASS: accent survives a reload" : "FAIL: accent reload");
await openSettings();
await p.locator("[data-omc-theme-custom] summary").click();
await p.waitForTimeout(300);
await p.locator("[data-omc-theme-reset]").click();
await p.waitForTimeout(800);
await closeSettings();
const after = await colours(p);
console.log("after:", JSON.stringify(after));
console.log(
  after.link === before.link && after.send === before.send && after.spark === before.spark
    ? "PASS: reset restores the start"
    : "FAIL: reset",
);
await p.screenshot({ path: "/tmp/pw/theme-switch.png" });
await b.close();
