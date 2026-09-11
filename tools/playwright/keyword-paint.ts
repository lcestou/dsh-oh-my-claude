// Dev-only check: what the composer paints for `ultracode` and `ultrathink`. Types one sentence
// carrying a bare keyword, a quoted one and `ultrathink`, then reads the CSS Highlight registry
// back: the bare word takes the autoAccept purple, the quoted one takes nothing, and `ultrathink`
// takes the rainbow. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the
// dsh launch token.
import { dshUrl, launch } from "./pw.js";

const SENTENCE = 'ultracode here, not "ultracode" quoted, and ultrathink too';

const token = process.argv[2];
const b = await launch();
const ctx = await b.newContext({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
const item = p
  .locator('[role="treeitem"]')
  .filter({ hasText: /Running|\bnow\b|\d+min/ })
  .first();
if (await item.count()) {
  await item.click({ force: true });
  await p.waitForTimeout(2500);
}
const composer = p.locator('[data-composer-input] [contenteditable="true"], [data-composer-input]');
await composer.first().click();
for (const ch of SENTENCE) await p.keyboard.press(ch === " " ? "Space" : ch);
await p.waitForTimeout(600);

// Which characters of the composer's text each highlight covers, by index into the sentence.
const painted = await p.evaluate(() => {
  const host = document.querySelector("[data-composer-input]");
  const out = new Map<string, string>();
  // The eight base colours and their shimmer twins: the seven rainbow steps then ultracode's purple.
  if (host)
    for (let i = 0; i < 8; i++)
      for (const name of [`omc-rainbow-${i}`, `omc-rainbow-s${i}`]) {
        const hl = CSS.highlights.get(name);
        if (!hl) continue;
        const chars: string[] = [];
        for (const range of hl) if (host.contains(range.startContainer)) chars.push(`${range}`);
        if (chars.length) out.set(name, chars.join(""));
      }
  return { text: host?.textContent ?? "", painted: [...out] };
});
console.log(JSON.stringify(painted, null, 2));
await p.screenshot({ path: `${process.env.PW_OUT ?? "/tmp"}/keyword-paint.png`, fullPage: false });
await ctx.close();
await b.close();
