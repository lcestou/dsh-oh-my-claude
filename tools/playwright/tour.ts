// Dev-only: screenshots and two short clips of the plugin's features for the README, written to
// docs/media/. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh
// launch token; PW_SESSION (default "Getting started") names the session row to open.
//
// Shoot a session whose conversation is throwaway: the panel floats over the chat and the text
// behind it lands in the shot. A clip is recorded as a webm at the desktop size and the script
// turns it into the gif itself with ffmpeg (on PATH): cropped to the panel, trimmed to the span the
// drive marks, so the gif opens on the panel already up and ends on the tab it started on, which
// is what makes the loop seamless. DSH_ORIGIN points the shoot at a scratch dsh, which is how a
// throwaway session is kept out of the box's own sidebar.
import { execFileSync } from "node:child_process";
import { type Box, type Context, type Locator, type Page, dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const out = process.env.PW_OUT ?? "docs/media";
const sessionName = process.env.PW_SESSION ?? "Getting started";
// A session row only exists once its workspace is expanded, so name the workspace to click first.
const workspaceName = process.env.PW_WORKSPACE ?? "";
// The owner runs dsh dark; PW_LIGHT=1 shoots the light theme instead.
const scheme = process.env.PW_LIGHT ? "light" : "dark";
const b = await launch();
/** Wait a fixed number of milliseconds after a navigation or click, the one delay the shots rely on
 *  to let the panel render.
 */
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);
/** Select the workspace/session rows matching a text, so a session name can be opened by its
 *  treeitem label.
 */
const rows = (p: Page, text: string) => p.locator('[role="treeitem"]').filter({ hasText: text });
// Every crop below is measured off a real box. An unrendered locator answers null, and a crop built
// from one either throws on `.x` or silently shoots the wrong rectangle; name the selector instead.
/** Return a locator's bounding box, throwing when nothing rendered, so a crop built from a null box
 *  cannot silently measure the wrong area.
 */
const boxOf = async (loc: Locator, what: string): Promise<Box> => {
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${what}: nothing rendered to measure`);
  return box;
};
// Expand the workspace when one is named, then take the last row matching the session name: a
// workspace and its session often carry the same text, and the workspace row is always first.
/** Open the session row named for this run, expanding a named workspace first when the session text
 *  is shared with it, then clicking the last match.
 */
const pick = async (p: Page) => {
  const target = rows(p, sessionName);
  if (workspaceName) {
    for (let i = 0; i < 3 && (await target.count()) === 0; i++) {
      await rows(p, workspaceName).first().click({ force: true });
      await wait(p, 1500);
    }
  }
  if ((await target.count()) === 0) throw new Error(`no session row matching ${sessionName}`);
  // A workspace and its session can carry the same text and the workspace row is always first.
  await target.last().click({ force: true });
  await wait(p, 3500);
};
// The panel and dsh's context popover are translucent, so the chat behind them bleeds through
// their rows and the shot reads as two layers of text. While either dialog is open the
// conversation is hidden; the shield menu and the stats row, shot with nothing open, keep it.
const HIDE_CHAT_BEHIND_PANEL =
  'body:has([role="dialog"]) [data-slot="conversation.view"]{visibility:hidden}';
/** Hide the conversation behind the open panel for the rest of this page's shots. */
const stage = (p: Page) => p.addStyleTag({ content: HIDE_CHAT_BEHIND_PANEL });
// When the page behind a clip was created, which is also when its video starts; a clip's gif span
// is measured from here.
let pageOpenedAt = 0;
/** Open a new page at dsh and drive it to a picked session, waiting for the network to idle so the
 *  panel is ready to shoot; also stamps `pageOpenedAt`, the clock a clip's gif span is cut on.
 */
const open = async (ctx: Context) => {
  const p = await ctx.newPage();
  pageOpenedAt = Date.now();
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await stage(p);
  await wait(p, 2500);
  await pick(p);
  return p;
};
/** Write a screenshot to the output directory under a name with a clip, logging the file so a
 *  failed write is visible in the run.
 */
const shot = async (p: Page, name: string, clip: Box) => {
  await p.screenshot({ path: `${out}/${name}.png`, clip });
  console.log("wrote", `${name}.png`);
};
// Crop to the panel plus the composer row under it. Reading the dialog's own box keeps the shot
// right when the panel changes size, which a fixed 760px window did not.
/** Compute the crop for a panel-plus-composer shot from real boxes, so the frame follows the
 *  panel's size instead of a fixed window that would miss rows.
 */
const composerClip = async (p: Page, h = 420, left = 60): Promise<Box> => {
  const button = await boxOf(p.locator('button[aria-label="Oh My Claude"]'), "the panel button");
  const dialog = await p
    .locator(panel())
    .boundingBox()
    .catch(() => null);
  const pad = 14;
  // Only two pixels above the panel: the rows over it are the conversation this box is running.
  const padTop = 2;
  const top = dialog ? Math.min(dialog.y, button.y) : button.y - h + 60;
  const bottom = button.y + button.height;
  const x0 = dialog ? Math.min(dialog.x, button.x - left) : button.x - left;
  const x1 = dialog ? Math.max(dialog.x + dialog.width, button.x + 700) : button.x + 700;
  return {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, top - padTop),
    width: Math.min(x1 - x0 + pad * 2, 1400 - Math.max(0, x0 - pad)),
    height: bottom - top + pad + padTop,
  };
};
/** Return the selector for the plugin panel dialog, the single anchor every shot and tab targets.
 */
const panel = () => '[role="dialog"][aria-label="Oh My Claude"]';
/** Select a panel tab by its role and visible text, so a tab is clicked by what a reader sees, not
 *  a generated class.
 */
const tab = (p: Page, name: string) => p.locator(`${panel()} [role="tab"]`, { hasText: name });
// dsh's sidebar width handle overlays the panel at some widths, so every click here is forced past
// the hit test rather than waiting 30s for an overlay that never moves.
/** Force-click a locator past any sidebar overlay, so a click does not hang waiting for a hit test
 *  that never clears.
 */
const hit = async (loc: Locator) => {
  await loc.click({ force: true });
};

// Clips first: the stills dismiss the pinned side question once Asides is shot, and the clip's
// Asides tab should show the card as it was answered, not as dismissed.
// Clips. A drive that returns a span and a crop becomes a gif; one that returns nothing stays a webm.
/** What a clip's drive hands back: the crop in page pixels and the gif's span in milliseconds since
 *  the page opened.
 */
type Gif = { crop: Box; start: number; end: number };
/** Milliseconds since the clip's page opened, the clock the gif span is cut on. */
const since = () => Date.now() - pageOpenedAt;
/** Whole pixels for ffmpeg's crop filter, which refuses fractions. */
const px = (n: number) => Math.round(n);
const clips: [string, (p: Page) => Promise<Gif | undefined>][] = [
  [
    "panel-tabs",
    async (p) => {
      await hit(p.locator('button[aria-label="Oh My Claude"]'));
      await wait(p, 1200);
      const crop = await composerClip(p);
      // Memory first and Memory last: the gif starts and ends on the same tab, so the loop reads
      // as one more switch instead of a cut. The span starts once the panel has settled on it.
      await hit(tab(p, "Memory"));
      await wait(p, 500);
      const start = since();
      await wait(p, 1000);
      for (const t of ["Rewind", "Changes", "Asides"]) {
        await hit(tab(p, t));
        await wait(p, 1600);
      }
      // The recording runs about a second behind this clock (measured 2026-10-13: a cut 300 ms
      // after a 1.6 s hold still showed the tab fading in), so the closing hold is long and the
      // cut lands on a settled frame that matches the first one.
      await hit(tab(p, "Memory"));
      await wait(p, 2600);
      const end = since() - 300;
      await p.keyboard.press("Escape");
      await wait(p, 600);
      return { crop, start, end };
    },
  ],
  [
    "shield-menu",
    async (p) => {
      const s = p
        .locator('button[aria-label^="Claude permission"], button[aria-label^="Access mode"]')
        .first();
      await hit(s);
      await wait(p, 1200);
      const m = p.locator('[role="menu"]').last();
      await m.locator('[role="menuitem"]', { hasText: /^Plan/ }).hover();
      await wait(p, 700);
      await m.locator('[role="menuitem"]', { hasText: /^Accept edits/ }).hover();
      await wait(p, 700);
      await p.keyboard.press("Escape");
      await wait(p, 600);
    },
  ],
];
for (const [name, drive] of clips) {
  // Record at the desktop size (the sidebar row must be reachable) and crop in ffmpeg afterwards.
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 900 },
    colorScheme: scheme,
    recordVideo: { dir: `${out}/.video`, size: { width: 1400, height: 900 } },
  });
  const p = await open(ctx);
  const gif = await drive(p);
  const video = p.video();
  await ctx.close();
  const path = await video.path();
  console.log("clip", name, path);
  if (!gif) continue;
  // The video is 1:1 with page pixels, so the crop measured on the page applies as is. Ten frames
  // a second and a diff palette keep a 640-wide clip of a few seconds under a megabyte.
  const c = gif.crop;
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-ss",
    (gif.start / 1000).toFixed(2),
    "-t",
    ((gif.end - gif.start) / 1000).toFixed(2),
    "-i",
    path,
    "-vf",
    `crop=${px(c.width)}:${px(c.height)}:${px(c.x)}:${px(c.y)},fps=10,scale=640:-1:flags=lanczos,` +
      "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    `${out}/${name}.gif`,
  ]);
  console.log("wrote", `${name}.gif`);
}
// Desktop stills
if (!process.env.PW_CLIPS_ONLY) {
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  const p = await open(ctx);
  await hit(p.locator('button[aria-label="Oh My Claude"]'));
  await wait(p, 1500);
  // Asides first: its shot wants the answered side question, and the pinned card of that same
  // question would otherwise sit behind every other shot, so it is dismissed right after.
  await hit(tab(p, "Asides"));
  await wait(p, 1500);
  await shot(p, "panel-asides", await composerClip(p));
  await p.keyboard.press("Escape");
  await wait(p, 400);
  const pinned = p.locator('button[aria-label="Dismiss side question"]');
  if (await pinned.count()) {
    await hit(pinned.first());
    await wait(p, 600);
  }
  await hit(p.locator('button[aria-label="Oh My Claude"]'));
  await wait(p, 1500);
  for (const t of ["Memory", "Rewind", "Changes"]) {
    await hit(tab(p, t));
    await wait(p, 1500);
    await shot(p, `panel-${t.toLowerCase()}`, await composerClip(p));
  }
  // The MCP list is whatever servers this box has, so the shot is of the Add form instead.
  await hit(tab(p, "MCP"));
  await wait(p, 1500);
  const addServer = p.locator(`${panel()} button`, { hasText: /^Add server/ }).first();
  if (await addServer.count()) {
    await hit(addServer);
    await wait(p, 1200);
    await p.locator(`${panel()} input[placeholder="Server name"]`).fill("recipes-db");
    await p.locator(`${panel()} input[placeholder^="Command"]`).fill("bunx");
    await p
      .locator(`${panel()} textarea[placeholder^="Args"]`)
      .fill("@example/recipes-mcp\n--db\n./recipes.sqlite");
    await wait(p, 600);
    // Crop to the form alone: the server list under it belongs to whoever runs the tour. The row of
    // selects is wider than the panel reports, so the crop follows the widest control, not the panel.
    const top = await boxOf(p.locator(`${panel()} select`).first(), "the MCP form's first select");
    const add = await boxOf(
      p.locator(`${panel()} button`, { hasText: /^Add$/ }).first(),
      "the MCP Add button",
    );
    const box = await boxOf(p.locator(panel()), "the panel");
    let right = top.x + top.width;
    for (const f of await p
      .locator(`${panel()} select, ${panel()} input, ${panel()} textarea`)
      .all()) {
      const fb = await f.boundingBox();
      if (fb) right = Math.max(right, fb.x + fb.width);
    }
    // Never past the panel's own edge: what is beyond it is the conversation this box is running.
    right = Math.min(right + 24, box.x + box.width - 2);
    await shot(p, "panel-mcp", {
      x: top.x - 12,
      y: top.y - 16,
      width: right - top.x + 12,
      height: add.y + add.height - top.y + 32,
    });
  }
  await p.keyboard.press("Escape");
  await wait(p, 400);
  const shield = p
    .locator('button[aria-label^="Claude permission"], button[aria-label^="Access mode"]')
    .first();
  await hit(shield);
  await wait(p, 1200);
  // Frame the menu itself, not a fixed window above the composer: anything higher is the conversation.
  {
    const m = await boxOf(p.locator('[role="menu"]').last(), "the shield menu");
    const bt = await boxOf(p.locator('button[aria-label="Oh My Claude"]'), "the panel button");
    const x0 = Math.min(m.x, bt.x - 240);
    const x1 = Math.max(m.x + m.width, bt.x + 700);
    // A few pixels inside the menu's own top edge: its box starts under the shadow, and the row
    // above it belongs to the conversation.
    const y = m.y + 8;
    await shot(p, "shield-menu", {
      x: Math.max(0, x0 - 14),
      y,
      width: Math.min(x1 - x0 + 28, 1400 - Math.max(0, x0 - 14)),
      height: bt.y + bt.height - y + 16,
    });
  }
  await p.keyboard.press("Escape");
  await wait(p, 300);
  // dsh 0.2.1 draws the footer stats in a dock marked `data-composer-dock`, which is also where
  // the plugin's cost pill lands. Its slot child has no box of its own (display: contents).
  const sb = await p.locator("[data-composer-dock]").first().boundingBox();
  if (sb)
    await shot(p, "cost-row", {
      x: sb.x - 10,
      y: sb.y - 40,
      width: Math.min(sb.width + 20, 1000),
      height: sb.height + 56,
    });
  // dsh's context ring: the only aria-haspopup button drawn as two concentric circles.
  const ring = p.locator('button[aria-haspopup="dialog"]:has(circle + circle)').first();
  if (await ring.count()) {
    await hit(ring);
    await wait(p, 2500);
    const d = p.locator('[role="dialog"]').last();
    const db = await d.boundingBox();
    if (db)
      await shot(p, "context-usage", {
        x: db.x - 10,
        y: db.y + 46,
        width: db.width + 20,
        height: db.height - 46,
      });
    await p.keyboard.press("Escape");
  }
  await ctx.close();
}
// Phone stills
if (!process.env.PW_CLIPS_ONLY) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
  });
  const p = await ctx.newPage();
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await stage(p);
  await wait(p, 2500);
  await p.setViewportSize({ width: 1400, height: 900 });
  await wait(p, 1000);
  await pick(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await wait(p, 2000);
  await hit(p.locator('button[aria-label="Oh My Claude"]'));
  await wait(p, 1500);
  await hit(tab(p, "Memory"));
  await wait(p, 1200);
  // From just above the sheet to the bottom of the screen: the rows above it are the conversation,
  // and a fixed top left a third of the shot empty on a short session.
  {
    const d = await boxOf(p.locator(panel()), "the phone sheet");
    const y = Math.max(0, Math.round(d.y) - 12);
    await shot(p, "phone-panel", { x: 0, y, width: 390, height: 844 - y });
  }
  await p.keyboard.press("Escape");
  await wait(p, 300);
  await ctx.close();
}
await b.close();
