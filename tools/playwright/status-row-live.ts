// Dev-only check, and it runs a real turn: the working line's two states nobody had watched
// happen. "thought for Ns" shows for two seconds after a thinking burst closes, and the line
// tints toward the CLI's stall red once the stream has been silent for ten seconds.
//
// It opens a new session in the workspace PW_WORKSPACE names (default oh-my-claude), sends one
// prompt that needs thought and no tools, and samples the line every 150 ms. Part-way through it
// stops the session's `claude` process with SIGSTOP for 16 s, which is what a stalled API looks
// like from the plugin's side, then lets it run on. The session stays in the sidebar afterwards.
// Point PLAYWRIGHT_ROOT at any project with Playwright.
// Usage: bun tools/playwright/status-row-live.ts <token> [/tmp/pw/status-row]
import { execFileSync } from "node:child_process";
import { dshUrl, launch } from "./pw.js";

const [token, out = "/tmp/pw/status-row"] = process.argv.slice(2);
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "load" });
await p.waitForTimeout(3000);
const wsName = process.env.PW_WORKSPACE ?? "oh-my-claude";
const ws = p
  .locator('[role="treeitem"]')
  .filter({ hasText: new RegExp(`^${wsName}$`) })
  .first();
if (await ws.count()) await ws.click({ force: true });
await p.waitForTimeout(1000);
await p.locator('button[aria-label="New session"]').first().click();
await p.waitForTimeout(2000);

/** The `claude -p` processes running now, by pid, haiku one-shots left out. */
const claudePids = (): Set<number> => {
  const rows = execFileSync("ps", ["-eo", "pid,args"]).toString().split("\n");
  const pids = rows
    .filter((r) => /claude .*stream-json/.test(r) && !/haiku/.test(r))
    .map((r) => Number(r.trim().split(/\s+/)[0]));
  return new Set(pids);
};
const before = claudePids();

const NONCE = `row${Date.now() % 100000}`;
const composer = p.locator('textarea, [contenteditable="true"]').first();
await composer.fill(
  `Do not use any tools. Think it through step by step before you answer: how many primes are there below 400, and what is their sum? Then explain your method in about 300 words. (${NONCE})`,
);
await p.keyboard.press("Enter");
const sentAt = Date.now();

/** One reading of the working line: its text and the tint it carries, if any. */
type Sample = { at: number; text: string; tint: string; stopped: boolean };
const samples: Sample[] = [];
let stopped = false;
let pid: number | undefined;
let stoppedAt = 0;
let resumedAt = 0;
/** Read the line as the page shows it now; empty text when no line is drawn. */
const read = (): Promise<{ text: string; tint: string }> =>
  p.evaluate(() => {
    const lines = [...document.querySelectorAll<HTMLElement>("[data-omc-turn-line]")];
    const el = lines.at(-1);
    return {
      text: el?.innerText.replace(/\s+/g, " ").trim() ?? "",
      tint: el?.style.getPropertyValue("--omc-row-bg") ?? "",
    };
  });

try {
  while (Date.now() - sentAt < 150_000) {
    const now = await read();
    samples.push({ at: Date.now() - sentAt, ...now, stopped });
    // Stop the process once the line has been up for four seconds, so the stall starts mid-reply.
    if (pid === undefined && Date.now() - sentAt > 4000 && now.text !== "") {
      pid = [...claudePids()].find((x) => !before.has(x));
      if (pid !== undefined) {
        process.kill(pid, "SIGSTOP");
        stopped = true;
        stoppedAt = Date.now() - sentAt;
      }
    }
    if (stopped && Date.now() - sentAt - stoppedAt > 16_000) {
      // SAFETY: `stopped` is only set after `pid` was found
      process.kill(pid!, "SIGCONT");
      stopped = false;
      resumedAt = Date.now() - sentAt;
      await p.screenshot({ path: `${out}-after-stall.png` });
    }
    if (resumedAt > 0 && now.text === "" && Date.now() - sentAt - resumedAt > 6000) break;
    if (
      stopped &&
      Date.now() - sentAt - stoppedAt > 13_000 &&
      Date.now() - sentAt - stoppedAt < 13_400
    )
      await p.screenshot({ path: `${out}-stalled.png` });
    await p.waitForTimeout(150);
  }
} finally {
  // Never leave a real process frozen behind a failed check.
  if (pid !== undefined) {
    try {
      process.kill(pid, "SIGCONT");
    } catch {
      // already gone
    }
  }
}

const words = [
  ...new Set(samples.map((s) => /\(([^)]*)\)/.exec(s.text)?.[1]?.split(" · ").at(-1) ?? "")),
];
const thought = samples.find((s) => /thought for \d+s|思考了/.test(s.text));
const tinted = samples.filter((s) => s.tint !== "");
const stallTinted = tinted.filter((s) => s.stopped);
const firstStall = stallTinted[0];
console.log(`process stopped: pid ${pid ?? "not found"}, from ${stoppedAt} ms to ${resumedAt} ms`);
console.log(`samples: ${samples.length}, with a line: ${samples.filter((s) => s.text).length}`);
console.log("last words in the bracket:", JSON.stringify(words.filter(Boolean).slice(0, 12)));
console.log(
  thought
    ? `PASS  thought-for line seen at ${thought.at} ms: ${JSON.stringify(thought.text)}`
    : "MISS  no thought-for line in any sample",
);
console.log(
  firstStall
    ? `PASS  tint while stopped: first at ${firstStall.at - stoppedAt} ms into the stop, ${stallTinted.length} samples, last ${stallTinted.at(-1)?.tint}`
    : "MISS  no tint while the process was stopped",
);
const afterResume = samples.filter(
  (s) => resumedAt > 0 && s.at > resumedAt + 1500 && s.text !== "",
);
console.log(
  `after resume: ${afterResume.length} samples with a line, ${afterResume.filter((s) => s.tint !== "").length} still tinted`,
);
console.log("line at the end:", JSON.stringify(samples.at(-1)?.text ?? ""));
await b.close();
