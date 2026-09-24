// Dev-only: drives the selection bar on a live dsh. Opens the Claude session PW_SESSION names (a
// sidebar row's text; pick an idle one, since Quote writes into its composer and the check clears
// it again), selects text in the newest reply and asserts the bar's rules: shows for a reply, not
// for the composer, a trailing boundary at offset 0 still counts, Quote writes a Markdown quote,
// Close hides it. PLAYWRIGHT_ROOT names a project with Playwright; arg 1 is dsh's launch token;
// PW_WIDTH and PW_SCHEME pick the viewport (1280, dark by default). Screenshots go to /tmp/pw/.
import { dshUrl, launch, type Page } from "./pw.js";

const [token] = process.argv.slice(2);
const name = process.env.PW_SESSION;
const width = Number(process.env.PW_WIDTH ?? 1280);
const scheme = process.env.PW_SCHEME === "light" ? "light" : "dark";
const narrow = width < 600;
const tag = `${width}-${scheme}`;
let failed = 0;

/** Prints one check's line and counts it when it fails, so the run exits non-zero on any miss. */
const check = (label: string, ok: boolean, got: string | number | boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}`);
};

/** Selects text in the page through the DOM, the way a drag or a long-press would leave it. */
const select = (p: Page, how: "reply" | "composer" | "trailing") =>
  p.evaluate((mode) => {
    const replies = document.querySelectorAll('[data-chat-flow-kind="assistant-step"] p');
    const last = replies[replies.length - 1];
    const composer = document.querySelector("[data-composer-input]");
    const sel = document.getSelection();
    if (sel === null) return "no selection api";
    sel.removeAllRanges();
    const range = document.createRange();
    if (mode === "composer") {
      if (composer === null) return "no composer";
      composer.textContent = "typed words in the box";
      range.selectNodeContents(composer);
    } else {
      if (last === undefined) return "no reply paragraph";
      range.setStart(last, 0);
      // A triple-click ends at offset 0 of the next block; the composer seat is the one after the
      // newest reply's last paragraph.
      if (mode === "trailing" && composer !== null) range.setEnd(composer, 0);
      else range.setEnd(last, last.childNodes.length);
    }
    sel.addRange(range);
    return sel.toString().slice(0, 60);
  }, how);

const b = await launch();
const ctx = await b.newContext({
  viewport: { width, height: narrow ? 844 : 800 },
  colorScheme: scheme,
  isMobile: narrow,
  hasTouch: narrow,
});
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// A phone keeps the tree behind dsh's "Open sidebar" button (打开侧边栏 in Chinese dsh).
const sidebar = p.getByRole("button", { name: /Open sidebar|打开侧边栏/ });
if (narrow && (await sidebar.count())) {
  await sidebar.first().click({ force: true });
  await p.waitForTimeout(800);
}
if (!name) {
  console.log("set PW_SESSION to an idle Claude session's sidebar text");
  await b.close();
  process.exit(1);
}
let row = p.locator('[role="treeitem"]').filter({ hasText: name }).first();
if ((await row.count()) === 0) {
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: process.env.PW_WORKSPACE ?? "oh-my-claude" })
    .first();
  if (await ws.count()) await ws.click({ force: true });
  await p.waitForTimeout(1500);
  row = p.locator('[role="treeitem"]').filter({ hasText: name }).first();
}
check("session row found", (await row.count()) === 1, await row.count());
await row.click({ force: true });
await p.waitForTimeout(4000);
// Opened on a phone, dsh's sidebar stays docked and squeezes the chat; its own toggle folds it away.
const collapse = p.getByRole("button", { name: /Collapse sidebar|收起侧边栏/ });
if (narrow && (await collapse.count())) {
  await collapse.first().click({ force: true });
  await p.waitForTimeout(800);
}
const bar = p.locator("[data-omc-selection-bar]");
const replies = p.locator('[data-chat-flow-kind="assistant-step"]');
check("control: reply nodes on screen", (await replies.count()) > 0, await replies.count());

const picked = await select(p, "reply");
await p.waitForTimeout(500);
check("bar shows for a reply selection", (await bar.count()) === 1, picked);
if ((await bar.count()) === 1) {
  const preview = await p.locator("[data-omc-selection-preview]").innerText();
  check(
    "preview starts with the selection",
    preview.startsWith(picked.replace(/\s+/g, " ").trim().slice(0, 20)),
    preview.slice(0, 60),
  );
  await p.screenshot({ path: `/tmp/pw/selection-bar-${tag}.png` });
}

await p.evaluate(() => document.getSelection()?.removeAllRanges());
await p.waitForTimeout(500);
check("bar hides when the selection collapses", (await bar.count()) === 0, await bar.count());

await select(p, "trailing");
await p.waitForTimeout(500);
check("a trailing boundary at offset 0 still counts", (await bar.count()) === 1, await bar.count());

await p.locator("[data-omc-selection-close]").click();
await p.waitForTimeout(300);
check("Close hides the bar", (await bar.count()) === 0, await bar.count());

await select(p, "reply");
await p.waitForTimeout(500);
await p.locator("[data-omc-selection-quote]").click();
await p.waitForTimeout(600);
const draft = await p.locator("[data-composer-input]").innerText();
check(
  "Quote writes a Markdown quote into the composer",
  draft.trimStart().startsWith(">"),
  draft.slice(0, 60),
);
check("the bar is gone after Quote", (await bar.count()) === 0, await bar.count());
const focused = await p.evaluate(
  () => document.activeElement?.hasAttribute("data-composer-input") === true,
);
check("the composer has focus after Quote", focused, focused);
await p.screenshot({ path: `/tmp/pw/selection-quoted-${tag}.png` });
// Leave the idle session's composer as it was found.
await p.locator("[data-composer-input]").click();
await p.keyboard.press("ControlOrMeta+A");
await p.keyboard.press("Backspace");
await p.waitForTimeout(300);

// Last, since it writes into the composer's text directly.
await select(p, "composer");
await p.waitForTimeout(500);
check("no bar for text selected in the composer", (await bar.count()) === 0, await bar.count());
await p.keyboard.press("ControlOrMeta+A");
await p.keyboard.press("Backspace");

await b.close();
console.log(failed === 0 ? "selection bar: all checks passed" : `selection bar: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
