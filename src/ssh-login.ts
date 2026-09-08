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

type SpawnFn = typeof spawn;

interface LoginProc {
  child: ReturnType<SpawnFn>;
  out: string;
  url?: string;
  done: boolean;
  startedAt: number;
}

const logins = new Map<string, LoginProc>();
const URL_RE = /https:\/\/claude\.com\/[^\s'"]+/;
const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]+/;

/** A path segment safe from a host string: lowercase alnum, other runs to one dash, bounded. */
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "x";

/** Per-box token file: `<stateDir>/ssh-tokens/<slug(host)>`, private. */
export function sshTokenPath(stateDir: string, host: string): string {
  return join(stateDir, "ssh-tokens", slug(host));
}

/** The stored login token for a host, or undefined if the box was never logged in from the panel. */
export function readSshToken(stateDir: string, host: string): string | undefined {
  try {
    const t = readFileSync(sshTokenPath(stateDir, host), "utf8").trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

export function writeSshToken(stateDir: string, host: string, token: string): void {
  mkdirSync(join(stateDir, "ssh-tokens"), { recursive: true, mode: 0o700 });
  writeFileSync(sshTokenPath(stateDir, host), `${token}\n`, { mode: 0o600 });
}

export function deleteSshToken(stateDir: string, host: string): void {
  try {
    rmSync(sshTokenPath(stateDir, host));
  } catch {}
}

/** The last non-empty line, for a terse error without dumping the whole PTY buffer (which carries the
 * OAuth state and the minted token, neither of which we log). The token is masked rather than
 * trusted to be elsewhere in the buffer: `setup-token` can print it and then fail to exit, and that
 * line is exactly what the timeout branch reports — a live year-long token, sent to the browser as
 * an error string and into whatever logged the reply. */
function lastLine(s: string): string {
  const lines = s
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? "").replace(TOKEN_RE, "sk-ant-oat01-***");
}

/**
 * Start `claude setup-token` on `host` under a kept-alive PTY and resolve with the OAuth URL it prints.
 * The process is held in `logins` keyed by host until the code is submitted or it times out. A prior
 * unfinished login for the same host is killed first.
 */
export function startSshLogin(
  host: string,
  spawnFn: SpawnFn = spawn,
  timeoutMs = 15000,
): Promise<{ url?: string; error?: string }> {
  const prev = logins.get(host);
  if (prev && !prev.done) prev.child.kill();
  // Wide `stty` so the ~100-char token prints on one line; `-tt` forces the PTY setup-token needs.
  const remote = "stty cols 400 rows 60 2>/dev/null; claude setup-token";
  const child = spawnFn("ssh", ["-tt", ...sshArgs(host, remote)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const proc: LoginProc = { child, out: "", done: false, startedAt: Date.now() };
  logins.set(host, proc);
  const onData = (chunk: Buffer) => {
    proc.out += chunk.toString();
    if (!proc.url) {
      const match = proc.out.match(URL_RE);
      if (match) proc.url = match[0];
    }
    // Bound the buffer: keep the tail, which holds the token line and the last status line.
    if (proc.out.length > 40000) proc.out = proc.out.slice(-16000);
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", () => {
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
      } else if (proc.done || Date.now() - proc.startedAt > timeoutMs) {
        clearInterval(tick);
        resolve({ error: lastLine(proc.out) || "login did not start" });
      }
    }, 250);
  });
}

/**
 * Write the pasted code to the held setup-token process, submit it with a carriage return, and wait
 * for the process to finish and print the token. Resolves with the minted token on success; the caller
 * stores it. A login that exits without a token reads honestly as an error rather than claiming
 * success.
 */
export function submitSshLoginCode(
  host: string,
  code: string,
  timeoutMs = 30000,
): Promise<{ done: boolean; token?: string; error?: string }> {
  const proc = logins.get(host);
  if (!proc || proc.done)
    return Promise.resolve({ done: false, error: "no login in progress; start again" });
  // A newline in the code would submit early / inject a second line.
  if (/[\r\n]/.test(code) || code.length > 512)
    return Promise.resolve({ done: false, error: "invalid code" });
  // Type the code, then submit with CR — the Ink prompt ignores a bare newline.
  proc.child.stdin?.write(code.trim());
  setTimeout(() => proc.child.stdin?.write("\r"), 500);
  const submittedAt = Date.now();
  return new Promise((resolve) => {
    const tick = setInterval(() => {
      const token = proc.out.match(TOKEN_RE)?.[0];
      if (token && proc.done) {
        clearInterval(tick);
        resolve({ done: true, token });
      } else if (proc.done) {
        clearInterval(tick);
        resolve({ done: false, error: lastLine(proc.out) || "login failed" });
      } else if (Date.now() - submittedAt > timeoutMs) {
        clearInterval(tick);
        proc.child.kill();
        resolve({ done: false, error: lastLine(proc.out) || "login did not finish" });
      }
    }, 250);
  });
}
