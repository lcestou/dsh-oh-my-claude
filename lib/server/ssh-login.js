// Relay a fresh Claude login for an SSH box to the panel. `claude auth login` on a headless box waits
// on a browser loopback callback that never arrives, so it can't be driven over ssh. `claude
// setup-token` is the headless path: it prints an OAuth URL, reads the pasted code from a real PTY,
// and mints a long-lived CLAUDE_CODE_OAUTH_TOKEN (valid ~1 year). We run it under `ssh -tt` (forces
// the remote PTY setup-token needs) with a wide `stty` so the printed token isn't wrapped, hand the
// URL to the browser, submit the pasted code with a carriage return (the Ink prompt submits on CR,
// not newline), and capture the token. The token is stored per-box in the plugin's own state and
// injected into the remote env at spawn — a fresh per-box login, never a copy of this box's creds.
// The host always comes from the saved ssh-box list, never a request body, so this cannot ssh to an
// arbitrary target.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sshArgs } from "./process.js";
const logins = new Map();
/** How long a started login may sit unfinished before its process is killed. */
const LOGIN_TTL_MS = 10 * 60_000;
const URL_RE = /https:\/\/claude\.com\/[^\s'"]+/;
// A minted token is ~100 chars, so the length floor is what tells a whole token from the first few
// bytes of one: stdout arrives in chunks, and a prefix like `sk-ant-oat01-P` matches an open-ended
// pattern just as happily as the real thing. A partial that reaches the box is a year-long 401.
const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{40,}/;
/** The same shape, whole-string, for a token read back off disk. */
const TOKEN_ONLY_RE = /^sk-ant-oat01-[A-Za-z0-9_-]{40,}$/;
/** A path segment safe from a host string: lowercase alnum, other runs to one dash, bounded. */
const slug = (s) => s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "x";
/** The host string that means the box this plugin runs on; its token sits beside the ssh ones. */
export const THIS_BOX = "";
/**
 * Per-box token file: `<stateDir>/ssh-tokens/<slug(host)>`, private. This box's own login is
 * `.this-box`, a name a slug can never produce, so no saved ssh box can collide with it.
 */
export function sshTokenPath(stateDir, host) {
    return join(stateDir, "ssh-tokens", host === THIS_BOX ? ".this-box" : slug(host));
}
/** The stored login token for a host, or undefined if the box was never logged in from the panel. */
export function readSshToken(stateDir, host) {
    try {
        const t = readFileSync(sshTokenPath(stateDir, host), "utf8").trim();
        // Anything that is not a whole token reads as no login. Every caller routes through here — the
        // spawn env, the hold script and the panel's login badge — so a truncated file left by an older
        // build stops being injected and stops being reported as logged in, in one place.
        return TOKEN_ONLY_RE.test(t) ? t : undefined;
    }
    catch {
        return undefined;
    }
}
export function writeSshToken(stateDir, host, token) {
    mkdirSync(join(stateDir, "ssh-tokens"), { recursive: true, mode: 0o700 });
    writeFileSync(sshTokenPath(stateDir, host), `${token}\n`, { mode: 0o600 });
}
export function deleteSshToken(stateDir, host) {
    try {
        rmSync(sshTokenPath(stateDir, host));
    }
    catch { }
}
/** The last non-empty line, for a terse error without dumping the whole PTY buffer (which carries the
 * OAuth state and the minted token, neither of which we log). The token is masked rather than
 * trusted to be elsewhere in the buffer: `setup-token` can print it and then fail to exit, and that
 * line is exactly what the timeout branch reports — a live year-long token, sent to the browser as
 * an error string and into whatever logged the reply. */
function lastLine(s) {
    const lines = s
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean);
    return (lines[lines.length - 1] ?? "").replace(TOKEN_RE, "sk-ant-oat01-***");
}
export function setupTokenInvocation(host, command = "claude", platform = process.platform) {
    // Wide `stty` so the ~100-char token prints on one line.
    const line = `stty cols 400 rows 60 2>/dev/null; ${command} setup-token`;
    if (host !== THIS_BOX)
        return { command: "ssh", args: ["-tt", ...sshArgs(host, line)] };
    // The CLI opens the sign-in URL itself through the desktop's opener, which on this box means a
    // browser tab nobody asked for: the panel shows the link. Its opener honours BROWSER, and
    // xdg-open with no display errors out and opens nothing, so the local run gets neither.
    const quiet = `BROWSER=true DISPLAY= WAYLAND_DISPLAY= ${line}`;
    return platform === "darwin"
        ? { command: "script", args: ["-q", "/dev/null", "sh", "-c", quiet] }
        : { command: "script", args: ["-qfc", quiet, "/dev/null"] };
}
/**
 * Start `claude setup-token` on `host` (THIS_BOX for the local one) under a kept-alive PTY and
 * resolve with the OAuth URL it prints. The process is held in `logins` keyed by host until the
 * code is submitted or it times out. A prior unfinished login for the same host is killed first.
 */
export function startSshLogin(host, spawnFn = spawn, timeoutMs = 15000, command = "claude", ttlMs = LOGIN_TTL_MS) {
    const prev = logins.get(host);
    if (prev && !prev.done)
        prev.child.kill();
    const inv = setupTokenInvocation(host, command);
    const child = spawnFn(inv.command, inv.args, {
        stdio: ["pipe", "pipe", "pipe"],
    });
    const proc = { child, out: "", done: false, startedAt: Date.now() };
    logins.set(host, proc);
    // A login nobody finishes would otherwise hold its PTY and `setup-token` for the life of the
    // server (found 2026-09-13: a check that hit the start route left one running for good).
    const ttl = setTimeout(() => {
        if (!proc.done)
            proc.child.kill();
    }, ttlMs);
    ttl.unref?.();
    const onData = (chunk) => {
        proc.out += chunk.toString();
        if (!proc.url) {
            const match = proc.out.match(URL_RE);
            if (match)
                proc.url = match[0];
        }
        // Bound the buffer: keep the tail, which holds the token line and the last status line.
        if (proc.out.length > 40000)
            proc.out = proc.out.slice(-16000);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    // `close`, not `exit`: exit fires when the process ends, while stdout may still have buffered
    // chunks to deliver. Marking the login finished there let the token poll match a half-arrived
    // token and store it as a success.
    child.on("close", () => {
        proc.done = true;
    });
    child.on("error", (err) => {
        proc.done = true;
        proc.out += `\n${String(err)}`;
    });
    return new Promise((resolve) => {
        const tick = setInterval(() => {
            if (proc.url) {
                clearInterval(tick);
                resolve({ url: proc.url });
            }
            else if (proc.done || Date.now() - proc.startedAt > timeoutMs) {
                clearInterval(tick);
                resolve({ error: lastLine(proc.out) || "login did not start" });
            }
        }, 250);
    });
}
function loginOutcome(proc) {
    if (!proc.done)
        return undefined;
    const token = proc.out.match(TOKEN_RE)?.[0];
    return token
        ? { done: true, token }
        : { done: false, error: lastLine(proc.out) || "login failed" };
}
/**
 * Whether the held login has finished by itself. `claude setup-token` on a box that already has a
 * login mints the token without a browser and without a code (CLI 2.1.26x, prompt reads "Paste code
 * here if prompted"), so the panel cannot wait on a paste that never comes: it asks this every few
 * seconds after showing the link and stores the token when it lands.
 */
export function pollSshLogin(host) {
    const proc = logins.get(host);
    if (!proc)
        return { pending: false, done: false, error: "no login in progress; start again" };
    const out = loginOutcome(proc);
    return out ? { pending: false, ...out } : { pending: true };
}
/**
 * Write the pasted code to the held setup-token process, submit it with a carriage return, and wait
 * for the process to finish and print the token. Resolves with the minted token on success; the caller
 * stores it. A login that exits without a token reads honestly as an error rather than claiming
 * success. A login that already finished on its own answers with its token: the code was never
 * needed, and "no login in progress" after a successful mint sent the owner back to start.
 */
export function submitSshLoginCode(host, code, timeoutMs = 30000) {
    const proc = logins.get(host);
    if (!proc)
        return Promise.resolve({ done: false, error: "no login in progress; start again" });
    const early = loginOutcome(proc);
    if (early)
        return Promise.resolve(early);
    // A newline in the code would submit early / inject a second line.
    if (/[\r\n]/.test(code) || code.length > 512)
        return Promise.resolve({ done: false, error: "invalid code" });
    // Type the code, then submit with CR — the Ink prompt ignores a bare newline.
    proc.child.stdin?.write(code.trim());
    setTimeout(() => proc.child.stdin?.write("\r"), 500);
    const submittedAt = Date.now();
    return new Promise((resolve) => {
        const tick = setInterval(() => {
            const out = loginOutcome(proc);
            if (out) {
                clearInterval(tick);
                resolve(out);
            }
            else if (Date.now() - submittedAt > timeoutMs) {
                clearInterval(tick);
                proc.child.kill();
                resolve({ done: false, error: lastLine(proc.out) || "login did not finish" });
            }
        }, 250);
    });
}
//# sourceMappingURL=ssh-login.js.map