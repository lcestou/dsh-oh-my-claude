// Relay a Claude Code login for a box to the panel. `claude auth login` under a PTY prints the
// sign-in URL and reads a pasted code when the sign-in page cannot reach it (CLI 2.1.26x: "Paste code
// here if prompted"); on a box with a browser it opens the tab itself and the approval reaches it
// over loopback, no code. Either way it writes the CLI's own credentials file on that box, so the
// terminal there and every Claude the plugin starts share one login. This box runs it under `script`
// (no ssh to lend a PTY); a box rides `ssh -tt`. The panel hands the URL to the browser, submits a
// pasted code with a carriage return (the Ink prompt submits on CR, not newline), and once the
// process exits asks the box's own `claude auth status` whether the login took. The host always
// comes from the saved ssh-box list, never a request body, so this cannot ssh to an arbitrary
// target. Tokens from the earlier `setup-token` flow still live under `ssh-tokens/` on boxes that
// logged in that way; they are read and injected until Log out forgets them, never minted again.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
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
/** Remove the host's stored SSH token. A token already gone is not an error. */
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
/**
 * The command line that runs `claude auth login` under a PTY. On a box it rides `ssh -tt`. On this
 * box there is no ssh to lend a PTY, so `script` (util-linux on Linux, BSD's on macOS) provides one;
 * the invocation differs between the two, which is what the platform switch is for.
 */
export function loginInvocation(host, command = "claude", platform = process.platform) {
    // Wide `stty` so the sign-in URL prints on one line.
    const line = `stty cols 400 rows 60 2>/dev/null; ${command} auth login`;
    if (host !== THIS_BOX)
        return { command: "ssh", args: ["-tt", ...sshArgs(host, line)] };
    // The CLI opens the sign-in URL itself through the desktop's opener. The panel shows the link
    // too; these keep a headless box from erroring on an opener with no display.
    const quiet = `BROWSER=true DISPLAY= WAYLAND_DISPLAY= ${line}`;
    return platform === "darwin"
        ? { command: "script", args: ["-q", "/dev/null", "sh", "-c", quiet] }
        : { command: "script", args: ["-qfc", quiet, "/dev/null"] };
}
/**
 * Start `claude auth login` on `host` (THIS_BOX for the local one) under a kept-alive PTY and
 * resolve with the sign-in URL it prints. The process is held in `logins` keyed by host until it
 * finishes or its time to live passes. A prior unfinished login for the same host is killed first.
 */
export function startSshLogin(host, spawnFn = spawn, timeoutMs = 15000, command = "claude", ttlMs = LOGIN_TTL_MS) {
    const prev = logins.get(host);
    if (prev && !prev.done)
        prev.child.kill();
    const inv = loginInvocation(host, command);
    const child = spawnFn(inv.command, inv.args, {
        stdio: ["pipe", "pipe", "pipe"],
    });
    const proc = { child, out: "", done: false, startedAt: Date.now() };
    logins.set(host, proc);
    // A login nobody finishes would otherwise hold its PTY and the CLI for the life of the server
    // (found 2026-09-13: a check that hit the start route left one running for good).
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
        // Bound the buffer: keep the tail, which holds the last status line.
        if (proc.out.length > 40000)
            proc.out = proc.out.slice(-16000);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    // `close`, not `exit`: exit fires when the process ends, while stdout may still have buffered
    // chunks to deliver; the last line the error reports should be the last one printed.
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
/** What a held login has come to: undefined while it runs; the verified outcome once it has exited.
 *  Verified once and kept, so a poll and a submit that both see the finished login get the same
 *  answer without asking the box twice. */
async function loginOutcome(proc, verify) {
    if (!proc.done)
        return undefined;
    if (!proc.outcome) {
        const ok = await verify().catch(() => false);
        proc.outcome = ok
            ? { done: true }
            : { done: false, error: lastLine(proc.out) || "login did not complete" };
    }
    return proc.outcome;
}
/**
 * Whether the held login has finished by itself. On a box with a browser the approval reaches the
 * CLI over loopback and it exits with no code pasted, so the panel cannot wait on a paste that never
 * comes: it asks this every few seconds after showing the link.
 */
export async function pollSshLogin(host, verify) {
    const proc = logins.get(host);
    if (!proc)
        return { pending: false, done: false, error: "no login in progress; start again" };
    const out = await loginOutcome(proc, verify);
    return out ? { pending: false, ...out } : { pending: true };
}
/**
 * Write the pasted code to the held login process, submit it with a carriage return, and wait for
 * the process to finish; then the box says whether the login took. A login that exits without one
 * reads honestly as an error rather than claiming success. A login that already finished on its
 * own answers with its outcome: the code was never needed.
 */
export function submitSshLoginCode(host, code, verify, timeoutMs = 30000) {
    const proc = logins.get(host);
    if (!proc)
        return Promise.resolve({ done: false, error: "no login in progress; start again" });
    // A newline in the code would submit early / inject a second line.
    if (/[\r\n]/.test(code) || code.length > 512)
        return Promise.resolve({ done: false, error: "invalid code" });
    return (async () => {
        const early = await loginOutcome(proc, verify);
        if (early)
            return early;
        // Type the code, then submit with CR — the Ink prompt ignores a bare newline.
        proc.child.stdin?.write(code.trim());
        setTimeout(() => proc.child.stdin?.write("\r"), 500);
        const submittedAt = Date.now();
        for (;;) {
            await new Promise((r) => setTimeout(r, 250));
            const out = await loginOutcome(proc, verify);
            if (out)
                return out;
            if (Date.now() - submittedAt > timeoutMs) {
                proc.child.kill();
                return { done: false, error: lastLine(proc.out) || "login did not finish" };
            }
        }
    })();
}
//# sourceMappingURL=ssh-login.js.map