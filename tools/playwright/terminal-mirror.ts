// Dev-only check: a dsh session picked up outside dsh shows the terminal exchange in the tab within
// seconds, and the next dsh message knows what was said there. Point PLAYWRIGHT_ROOT at any project
// with Playwright installed; arg 1 is the dsh launch token. The "terminal" is `claude -p --resume`
// run from the session's directory with CLAUDE_CODE_ENTRYPOINT=terminal-check, a stamp the CLI keeps
// as given and the plugin reads as a person's, where print mode's own sdk-cli would be skipped.
// PW_WORKSPACE names the sidebar workspace to open the session in; with PW_REMOTE_HOST and
// PW_REMOTE_CWD the transcript and the terminal side live on that SSH box instead.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeSessionId, projectDirName } from "../../src/adapter.js";
import { readSshToken } from "../../src/ssh-login.js";
import { STATE_DIR } from "../../src/state.js";
import { dshUrl, launch } from "./pw.js";

const [token] = process.argv.slice(2);
const out = process.env.PW_OUT ?? "/tmp/pw";
const remoteHost = process.env.PW_REMOTE_HOST;
const remoteCwd = process.env.PW_REMOTE_CWD;
const TERMINAL_ENV = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "terminal-check" };
// A box's account is logged in through the token the plugin keeps for it, the same one its spawn
// hands the remote claude; a plain ssh shell there has no login of its own.
const boxLogin = remoteHost ? readSshToken(STATE_DIR, remoteHost) : undefined;
const TERMINAL_PREFIX = `CLAUDE_CODE_ENTRYPOINT=terminal-check${boxLogin ? ` CLAUDE_CODE_OAUTH_TOKEN=${boxLogin}` : ""}`;
/** Run a shell line where the transcript lives: here, or on the box over ssh. */
const sh = (line: string, timeout = 180_000) =>
  remoteHost
    ? spawnSync("ssh", [remoteHost, line], { encoding: "utf8", timeout })
    : spawnSync("sh", ["-c", line], { encoding: "utf8", timeout, env: TERMINAL_ENV });
const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const WORD = `KUMQUAT${Date.now() % 1000}`;
const sessionsRoot = join(homedir(), ".dsh", "sessions");
const projects = join(homedir(), ".claude", "projects");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In remote mode only the workspace that stands for that box's directory holds the session; its
 *  key carries the host and the path. */
const wsKey =
  remoteHost && remoteCwd
    ? `${remoteHost}__${remoteCwd.split("/").filter(Boolean).join("-")}`
    : undefined;

/** The Claude transcript of a dsh session and the cwd its rows name. */
function transcriptOf(dshId: string): { path: string; cwd: string } | undefined {
  const claudeId = claudeSessionId(dshId);
  if (remoteHost && remoteCwd) {
    const path = `$HOME/.claude/projects/${projectDirName(remoteCwd)}/${claudeId}.jsonl`;
    const r = sh(`test -s ${path} && echo yes`);
    return r.stdout.trim() === "yes" ? { path, cwd: remoteCwd } : undefined;
  }
  for (const dir of readdirSync(projects)) {
    const path = join(projects, dir, `${claudeId}.jsonl`);
    try {
      const text = readFileSync(path, "utf8");
      const m = /"cwd":"([^"]+)"/.exec(text);
      if (m?.[1] && projectDirName(m[1]) === dir) return { path, cwd: m[1] };
    } catch {
      // not this project dir
    }
  }
  return undefined;
}

const ownReplies = (path: string) =>
  remoteHost
    ? Number(sh(`grep -c '"entrypoint":"dsh-oh-my-claude"' ${path} || true`).stdout.trim()) || 0
    : readFileSync(path, "utf8")
        .split("\n")
        .filter(
          (l) => l.includes('"entrypoint":"dsh-oh-my-claude"') && l.includes('"type":"assistant"'),
        ).length;
/** The stamps on the transcript's rows, to see what a box's CLI writes for the plugin's child. */
const stamps = (path: string) =>
  sh(`grep -oh '"entrypoint":"[^"]*"' ${path} | sort | uniq -c`)
    .stdout.trim()
    .replaceAll("\n", " ");

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto(dshUrl(token), { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
// The mirror ships off, so the check that exercises it turns it on first. This goes through the page
// because the plugin's own routes answer 401 to a token passed in the query string, while the page
// already carries dsh's session cookie.
const mirrorWas = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/terminal-sync");
  // SAFETY: the plugin's own route answers `{ enabled: boolean }`. The one field read is compared
  // against `true`, so a body of any other shape reads as off rather than being trusted as typed.
  return ((await r.json()) as { enabled?: boolean }).enabled === true;
});
const mirrorOn = await p.evaluate(async () => {
  const r = await fetch("/dsh-oh-my-claude/terminal-sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  return r.ok;
});
console.log(`terminal mirror turned on for this check: ${mirrorOn}`);
if (!mirrorOn) console.log("FAIL: could not turn the mirror on; the rest of this check is moot");
// New Session lands in whichever workspace dsh has selected, and expanding a workspace header does
// not select it — clicking a session inside it does. So to target PW_WORKSPACE reliably: expand it,
// click its first session row (that selects the workspace), then New Session. The workspace headers
// are dsh's own workspace titles, so a treeitem whose text is not one of those is a session row.
// SAFETY: dsh's own workspace storage; only the title of each workspace is read, as a string.
const wsStore = JSON.parse(
  readFileSync(join(homedir(), ".dsh", "storages", "workspace.json"), "utf8"),
) as { tables?: { workspaces?: Record<string, { title?: string }> } };
const wsTitles = new Set(
  Object.values(wsStore.tables?.workspaces ?? {}).flatMap((w) => (w.title ? [w.title] : [])),
);
const clickFirstSessionUnder = async (workspace: string): Promise<boolean> => {
  const items = p.locator('[role="treeitem"]');
  const texts = await items.allInnerTexts();
  const start = texts.findIndex((t) => t.trim().startsWith(workspace));
  if (start === -1) return false;
  for (let i = start + 1; i < texts.length; i++) {
    const line = texts[i]!.trim().split("\n")[0]!.trim();
    if (wsTitles.has(line)) break; // reached the next workspace: no sessions under this one
    await items.nth(i).click({ force: true });
    return true;
  }
  return false;
};
if (process.env.PW_WORKSPACE) {
  const ws = p
    .locator('[role="treeitem"]')
    .filter({ hasText: new RegExp(`^${process.env.PW_WORKSPACE}`) })
    .first();
  if (await ws.count()) {
    // The header toggles expand/collapse, and it may start either way. Try to select a session
    // under it; if none is visible, the click collapsed an open workspace, so click again and retry.
    const selectUnder = async () => {
      if (process.env.PW_SESSION && process.env.PW_SESSION !== "*") {
        const row = p
          .locator('[role="treeitem"]')
          .filter({ hasText: new RegExp(process.env.PW_SESSION!) })
          .first();
        if (!(await row.count())) return false;
        await row.click({ force: true });
        return true;
      }
      return clickFirstSessionUnder(process.env.PW_WORKSPACE!);
    };
    await ws.click({ force: true });
    await p.waitForTimeout(1200);
    if (!(await selectUnder())) {
      await ws.click({ force: true });
      await p.waitForTimeout(1200);
      if (!(await selectUnder())) {
        throw new Error(`no session under workspace ${process.env.PW_WORKSPACE} to select it`);
      }
    }
    await p.waitForTimeout(2000);
  } else console.log("workspace not found:", process.env.PW_WORKSPACE);
}
// A fresh session in the now-selected workspace, unless PW_SESSION alone means reuse that one.
if (!process.env.PW_SESSION || process.env.PW_NEW) {
  await p
    .locator('button[aria-label*="New" i], button:has-text("New Session"), a[href*="new"]')
    .first()
    .click();
  await p.waitForTimeout(2000);
}
const composer = p.locator('textarea, [contenteditable="true"]').first();
const send = async (text: string) => {
  await composer.fill(text);
  await p.keyboard.press("Enter");
};
const NONCE = `check${Date.now() % 100000}`;
await send(`Reply with the single word OK. (${NONCE})`);

// The first turn names the session and writes its transcript; wait for our own reply row.
// The session's id: the dsh log that holds the nonce the first message carried. Newest-by-mtime
// is not it: a workspace click can leave a blank session behind that is newer than the one typed in.
const withNonce = (): string | undefined => {
  for (const ws of readdirSync(sessionsRoot)) {
    if (wsKey && !ws.includes(wsKey)) continue;
    let ids: string[];
    try {
      ids = readdirSync(join(sessionsRoot, ws));
    } catch {
      continue;
    }
    for (const id of ids) {
      const log = join(sessionsRoot, ws, id, "session.v3.jsonl.zstd");
      const r = spawnSync("sh", ["-c", `zstd -dc ${log} 2>/dev/null | grep -q ${NONCE}`]);
      if (r.status === 0) return id;
    }
  }
  return undefined;
};
let session = { id: withNonce() ?? "", mtime: 0 };
for (let i = 0; i < 60 && (!session.id || !transcriptOf(session.id)); i++) {
  await sleep(1000);
  session = { id: withNonce() ?? "", mtime: 0 };
}
if (!session.id) throw new Error("no dsh session log carries the nonce");
const t = transcriptOf(session.id);
if (!t) throw new Error(`no transcript for dsh session ${session.id}`);
console.log("dsh session:", session.id, "transcript:", t.path, "cwd:", t.cwd);
for (let i = 0; i < 60 && ownReplies(t.path) === 0; i++) await sleep(1000);
await sleep(4000); // the turn's end starts the watcher (the sweep would too, within 30 s)
console.log("own reply rows after turn 1:", ownReplies(t.path), "| stamps:", stamps(t.path));

// Terminal side: one exchange on the same Claude session, from its directory.
const term = sh(
  `cd ${q(t.cwd)} && ${TERMINAL_PREFIX} claude -p --resume ${claudeSessionId(session.id)} --model haiku ${q(`Remember the word ${WORD}. Reply OK.`)}`,
);
console.log(
  "terminal reply:",
  JSON.stringify(term.stdout.trim()),
  term.stderr.trim().slice(0, 200),
);

// The mirror turn: the terminal's prompt as a user message, its reply as the assistant's, and
// no Claude run for it (our own reply rows stay as they were).
const repliesBefore = ownReplies(t.path);
let body = "";
// A box is polled every 30 s, so its mirror takes up to that plus the settle; here it is inotify.
const mirrorWait = remoteHost ? 80 : 20;
for (let i = 0; i < mirrorWait; i++) {
  await sleep(1000);
  body = await p.locator("body").innerText();
  if (body.includes(`Remember the word ${WORD}`)) break;
}
const mirrored = body.includes(`Remember the word ${WORD}`) && !body.includes("⇄");
console.log("mirror turn in tab as plain messages:", mirrored);
await p.screenshot({ path: `${out}/terminal-mirror-1.png` });

// A second terminal exchange that uses a tool: the call and its result draw inline.
const TAG = `MIRRORTOOL${Date.now() % 1000}`;
// --allowedTools takes a list, so the prompt goes to -p directly or it reads as a tool name.
const term2 = sh(
  `cd ${q(t.cwd)} && ${TERMINAL_PREFIX} claude --resume ${claudeSessionId(session.id)} --model haiku --allowedTools Bash -p ${q(`Run this exact shell command with the Bash tool and then reply with its output only: echo ${TAG}`)}`,
);
console.log("terminal reply 2:", JSON.stringify(term2.stdout.trim()));
let body2 = "";
for (let i = 0; i < mirrorWait + 5; i++) {
  await sleep(1000);
  body2 = await p.locator("body").innerText();
  if (body2.includes(`echo ${TAG}`) && /Bash/.test(body2)) break;
}
const tooled = body2.includes(`echo ${TAG}`) && /Bash/.test(body2);
console.log("tool exchange mirrored with its call drawn:", tooled);
const untouched = ownReplies(t.path) === repliesBefore;
console.log("no Claude run for the mirrors:", untouched);
await p.screenshot({ path: `${out}/terminal-mirror-1b.png` });
body = body2;

// The next dsh message resumes from the transcript and knows the word.
const replies = ownReplies(t.path);
await send("Which word were you asked to remember, outside this tab? Answer with that word only.");
for (let i = 0; i < 90 && ownReplies(t.path) <= replies; i++) await sleep(1000);
await sleep(3000);
const after = await p.locator("body").innerText();
const known = after.split(WORD).length - 1 > body.split(WORD).length - 1;
console.log("dsh reply knows the word:", known);
await p.screenshot({ path: `${out}/terminal-mirror-2.png` });
// Put the setting back as it was found. It ships off, and a dev check has no business leaving an
// experimental feature switched on in the owner's dsh.
const restored = await p.evaluate(async (keep: boolean) => {
  const r = await fetch("/dsh-oh-my-claude/terminal-sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: keep }),
  });
  return r.ok;
}, mirrorWas);
console.log(`terminal mirror put back to ${mirrorWas}: ${restored}`);
if (!restored) console.log("FAIL: could not put the terminal mirror setting back");
await b.close();
if (!mirrored || !tooled || !untouched || !known) {
  console.log("FAIL");
  process.exit(1);
}
console.log("terminal mirror ok");
