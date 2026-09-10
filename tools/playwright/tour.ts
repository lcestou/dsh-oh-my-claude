// Dev-only: screenshots and two short clips of the plugin's features for the README, written to
// docs/media/. Point PLAYWRIGHT_ROOT at any project with Playwright installed; arg 1 is the dsh
// launch token; PW_SESSION (default "Getting started") names the session row to open.
//
// Shoot a session whose conversation is throwaway: the panel floats over the chat and the text
// behind it lands in the shot. The clip is a webm; the gif comes from it with the crop this script
// prints next to "crop", the seconds before the panel opens dropped:
//   ffmpeg -y -ss 8.4 -i .video/<clip>.webm \
//     -vf "crop=1024:316:376:556,fps=10,scale=640:-1:flags=lanczos,split[a][b];\
//          [a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" \
//     docs/media/panel-tabs.gif
import { type Box, type Context, type Locator, type Page, dshUrl, launch } from "./pw.js";

const token = process.argv[2];
const out = process.env.PW_OUT ?? "docs/media";
const sessionName = process.env.PW_SESSION ?? "Getting started";
// A session row only exists once its workspace is expanded, so name the workspace to click first.
const workspaceName = process.env.PW_WORKSPACE ?? "";
// The owner runs dsh dark; PW_LIGHT=1 shoots the light theme instead.
const scheme = process.env.PW_LIGHT ? "light" : "dark";
const b = await launch();
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);
const rows = (p: Page, text: string) => p.locator('[role="treeitem"]').filter({ hasText: text });
// Every crop below is measured off a real box. An unrendered locator answers null, and a crop built
// from one either throws on `.x` or silently shoots the wrong rectangle; name the selector instead.
const boxOf = async (loc: Locator, what: string): Promise<Box> => {
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${what}: nothing rendered to measure`);
  return box;
};
// Expand the workspace when one is named, then take the last row matching the session name: a
// workspace and its session often carry the same text, and the workspace row is always first.
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
const open = async (ctx: Context) => {
  const p = await ctx.newPage();
  await p.goto(dshUrl(token), { waitUntil: "networkidle" });
  await wait(p, 2500);
  await pick(p);
  return p;
};
const shot = async (p: Page, name: string, clip: Box) => {
  await p.screenshot({ path: `${out}/${name}.png`, clip });
  console.log("wrote", `${name}.png`);
};
// Crop to the panel plus the composer row under it. Reading the dialog's own box keeps the shot
// right when the panel changes size, which a fixed 760px window did not.
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
const panel = () => '[role="dialog"][aria-label="Oh My Claude"]';
const tab = (p: Page, name: string) => p.locator(`${panel()} [role="tab"]`, { hasText: name });
// dsh's sidebar width handle overlays the panel at some widths, so every click here is forced past
// the hit test rather than waiting 30s for an overlay that never moves.
const hit = async (loc: Locator) => {
  await loc.click({ force: true });
};

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
  for (const t of ["Memory", "Rewind", "Changes", "Asides"]) {
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
  const stats = p
    .locator("div")
    .filter({ hasText: /\d+ turns\s*·?\s*\d+ steps/ })
    .last();
  const sb = await stats.boundingBox();
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
  await shot(p, "phone-panel", { x: 0, y: 300, width: 390, height: 544 });
  await p.keyboard.press("Escape");
  await wait(p, 300);
  await ctx.close();
}
// Clips
const clips: [string, (p: Page) => Promise<void>][] = [
  // The crop this clip wants is printed with it: ffmpeg turns the webm into the gif afterwards.
  [
    "panel-tabs",
    async (p) => {
      await hit(p.locator('button[aria-label="Oh My Claude"]'));
      await wait(p, 1200);
      console.log("crop", JSON.stringify(await composerClip(p)));
      for (const t of ["Memory", "Rewind", "Changes", "Asides"]) {
        await hit(tab(p, t));
        await wait(p, 1400);
      }
      await p.keyboard.press("Escape");
      await wait(p, 600);
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
  await drive(p);
  const video = p.video();
  await ctx.close();
  const path = await video.path();
  console.log("clip", name, path);
}
await b.close();
