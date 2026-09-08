/**
 * Hold: a Claude Code process on an SSH box that outlives the ssh that started it, so a dsh restart
 * here leaves the far Claude running and the new dsh reattaches, the way the local keeper does.
 *
 * Nothing runs on the far side but the CLI (the owner's ruling for SSH boxes). The CLI is started
 * under `setsid` with a FIFO as stdin, opened read-write so it never sees EOF between our
 * connections, and a file as stdout. Attaching is one ssh that pumps its stdin into the FIFO and
 * tails the file from the byte offset this box last read; output written while nobody was attached
 * sits in the file, which is the keeper's buffer without the keeper. Liveness is the pid; the exit
 * code lands in a file when the CLI ends, and the tail ends with it (`--pid`).
 *
 * The handle here is what `ClaudeProcess` talks to. A dropped ssh (network, suspend) is not an
 * exit: the handle reattaches from the offset and the process code never learns. Only the exit
 * line, or a far dir that is gone, ends it.
 *
 * Layout under the far `$HOME/.local/state/dsh-oh-my-claude/hold/<name>/`: `in` (FIFO), `out.log`,
 * `err.log`, `pid` (the session leader; its pgid, for the kill), `exit` (the CLI's exit code).
 */
import { createHash } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import {
  CHILD_ENV,
  nodeSpawner,
  shq,
  sshArgs,
  type ClaudeProcessSpec,
  type SubprocessHandle,
} from "./process.js";

/** Under the far `$HOME`; unquoted in the scripts so the far shell expands it. */
export const HOLD_ROOT = '"$HOME"/.local/state/dsh-oh-my-claude/hold';
/** First line of an attach: everything before it is a login shell's banner, not the CLI. */
export const READY = "OMC-HOLD-READY";
/** Last line of an attach that saw the CLI end; the rest of the line is its exit code. */
export const EXIT = "OMC-HOLD-EXIT ";
/** A line of the CLI's stderr, replayed after the exit so the failure row has something to say. */
export const ERR = "OMC-HOLD-ERR ";
/** The attach script's exit status when the far dir is not there (a `rm` on the box, or never made). */
export const GONE = 44;

/** What this box remembers about a hold, enough to reattach after a restart. */
export interface HoldRecord {
  sessionId: string;
  host: string;
  /** The far dir's basename under HOLD_ROOT. */
  name: string;
  command: string;
  args: string[];
  /** The far cwd the CLI was started in. */
  cwd: string;
  procSpec: ClaudeProcessSpec;
  /** Bytes of `out.log` this box has read: the next attach tails from here. */
  offset: number;
  startedAt: number;
}

/** One far dir per spawn, never reused: a respawn must not tail the log of the CLI it replaced. */
export function holdName(providerId: string, sessionId: string, stamp = Date.now()): string {
  const h = createHash("sha256").update(`${providerId}:${sessionId}`).digest("hex").slice(0, 16);
  return `${h}-${stamp.toString(36)}`;
}

const dirOf = (name: string) => `${HOLD_ROOT}/${shq(name)}`;

/**
 * Start the CLI on the box and answer its pid. `setsid` puts it in a session of its own, so the
 * ssh's hangup never reaches it; backgrounded from a non-interactive shell it is not a group leader,
 * so `setsid` execs rather than forks and `$!` is the leader itself. The inner `sh` holds the FIFO
 * open read-write for the CLI and records the exit code after it.
 */
export function holdStartScript(
  name: string,
  cwd: string,
  command: string,
  args: string[],
  token?: string,
): string {
  const envPairs = Object.entries(CHILD_ENV);
  if (token) envPairs.push(["CLAUDE_CODE_OAUTH_TOKEN", token]);
  const env = envPairs.map(([key, val]) => `${key}=${shq(val)}`).join(" ");
  const cli = [command, ...args].map(shq).join(" ");
  // The inner script is single-quoted for the far shell, so it takes the dir as its `$0`.
  const inner = `exec 0<>"$0"/in; env ${env} ${cli}; echo $? >"$0"/exit`;
  return (
    `d=${dirOf(name)}; mkdir -p "$d" && mkfifo "$d"/in || exit 70; ` +
    `cd ${shq(cwd)} 2>/dev/null || cd "$HOME"; ` +
    `setsid sh -c ${shq(inner)} "$d" 1>>"$d"/out.log 2>>"$d"/err.log & ` +
    `echo $! >"$d"/pid; printf '${READY} %s\\n' "$!"`
  );
}

/**
 * Attach: stdin into the FIFO, the log out from `offset`. `tail --pid` ends when the leader does,
 * after one last read, so the final `result` frame is never left in the file. The `cat` is killed
 * after, since a FIFO with no reader would hold it on open forever. The exit line carries the code
 * the inner `sh` wrote, or 255 when the leader died without writing one (a `kill -9`).
 */
export function holdAttachScript(name: string, offset: number): string {
  return (
    `d=${dirOf(name)}; [ -f "$d"/pid ] || exit ${GONE}; p=$(cat "$d"/pid); ` +
    // A background job in a non-interactive shell reads /dev/null unless its stdin is redirected
    // explicitly (POSIX 2.9.3.1), so the ssh's stdin is duplicated to fd 3 and handed to the cat.
    `printf '${READY}\\n'; exec 3<&0; cat <&3 >"$d"/in & c=$!; ` +
    // An exit file means the CLI is over whatever the pid says: a box that ran long enough could
    // have handed that number to a stranger, and `--pid` would follow it instead of ending.
    `if [ -f "$d"/exit ]; then tail -c +${offset + 1} "$d"/out.log; ` +
    `else tail -c +${offset + 1} -f --pid="$p" "$d"/out.log; fi; kill "$c" 2>/dev/null; ` +
    `tail -n 20 "$d"/err.log 2>/dev/null | sed 's/^/${ERR}/'; ` +
    `printf '${EXIT}%s\\n' "$(cat "$d"/exit 2>/dev/null || echo 255)"`
  );
}

/** Exit status 0 when the leader is still there. */
export const holdAliveScript = (name: string): string =>
  `d=${dirOf(name)}; [ -f "$d"/pid ] && kill -0 "$(cat "$d"/pid)" 2>/dev/null`;

/** SIGTERM the whole session (the pgid is the leader's pid), SIGKILL what is left five seconds on. */
export const holdKillScript = (name: string): string =>
  `d=${dirOf(name)}; p=$(cat "$d"/pid 2>/dev/null) || exit 0; ` +
  `kill -TERM -- -"$p" 2>/dev/null; sleep 5; kill -KILL -- -"$p" 2>/dev/null; true`;

/** Remove the far dir: only after the exit line, so the log of a live CLI is never taken away. */
export const holdCleanScript = (name: string): string => `rm -rf ${dirOf(name)}`;

/** One line of an attach, sorted: the banner before READY, the CLI's output, stderr, the exit. */
export type HoldLine =
  | { kind: "ready" }
  | { kind: "out"; line: string }
  | { kind: "err"; line: string }
  | { kind: "exit"; code: number };

export function parseHoldLine(line: string, ready: boolean): HoldLine | undefined {
  if (!ready) return line === READY ? { kind: "ready" } : undefined;
  if (line.startsWith(EXIT)) {
    const code = Number.parseInt(line.slice(EXIT.length), 10);
    return { kind: "exit", code: Number.isNaN(code) ? 255 : code };
  }
  if (line.startsWith(ERR)) return { kind: "err", line: line.slice(ERR.length) };
  return { kind: "out", line };
}

/** How long to wait before reattaching after the ssh dropped without an exit line, by try. */
export const reattachDelay = (attempt: number): number => Math.min(2000 * 2 ** attempt, 15_000);

/** Runs one script on the box; the default is this plugin's `ssh`. A seam for the test. */
export type RunOnBox = (script: string) => SubprocessHandle;

export const sshRunner =
  (host: string): RunOnBox =>
  (script) =>
    nodeSpawner("ssh", sshArgs(host, script), ".");

/**
 * The handle `ClaudeProcess` talks to. Attaches now, reattaches from the current offset whenever
 * the ssh ends without an exit line, and reports the CLI's exit only from that line or from a far
 * dir that is gone. `onOffset` is called as the offset moves, so a restart resumes from the last
 * line this box read rather than replaying the whole log.
 */
export function holdHandle(
  run: RunOnBox,
  name: string,
  offset: number,
  onOffset: (offset: number) => void,
  onExit?: () => void,
): SubprocessHandle {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const pending: string[] = [];
  let current: SubprocessHandle | undefined;
  let ready = false;
  let ended = false;
  let killed = false;
  let attempt = 0;
  let resolveDone: ((v: { exitCode: number | null; signal: string | null }) => void) | undefined;
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((r) => {
    resolveDone = r;
  });
  const settle = (code: number | null, signal: string | null) => {
    if (ended) return;
    ended = true;
    stdout.end();
    stderr.end();
    onExit?.();
    resolveDone?.({ exitCode: code, signal });
  };
  const attach = () => {
    if (ended) return;
    ready = false;
    const ssh = run(holdAttachScript(name, offset));
    current = ssh;
    ssh.stdin.on("error", () => {});
    ssh.stderr.on("data", () => {}); // ssh's own noise (a host key note, "Connection closed")
    // Split on newlines by hand rather than readline: a dropped ssh can end mid-line, and readline
    // would hand that fragment over as a line, which would be counted as one the file does not
    // hold and shown as an event the CLI never wrote. A fragment stays here, uncounted; the next
    // attach re-reads it whole from the last full line's offset.
    let rest = "";
    ssh.stdout.on("data", (chunk: Buffer | string) => {
      rest += String(chunk);
      let nl = rest.indexOf("\n");
      while (nl !== -1) {
        const raw = rest.slice(0, nl);
        rest = rest.slice(nl + 1);
        onLine(raw);
        nl = rest.indexOf("\n");
      }
    });
    const onLine = (raw: string) => {
      if (ended) return; // the streams are closed; a late line has nowhere to go
      const parsed = parseHoldLine(raw, ready);
      if (parsed === undefined) return;
      if (parsed.kind === "ready") {
        ready = true;
        attempt = 0;
        // Written while no attach was ready: a far dir that turned out gone would have lost them,
        // so they wait for the FIFO to be there.
        for (const line of pending) ssh.stdin.write(line);
        pending.length = 0;
        return;
      }
      if (parsed.kind === "out") {
        // The file holds each line plus its newline; count what the file holds, not what the
        // terminal showed, so the next attach starts on a line boundary.
        offset += Buffer.byteLength(raw, "utf8") + 1;
        onOffset(offset);
        stdout.write(`${raw}\n`);
        return;
      }
      if (parsed.kind === "err") {
        stderr.write(`${parsed.line}\n`);
        return;
      }
      settle(parsed.code, null);
    };
    void ssh.done.then((outcome) => {
      if (ended || current !== ssh) return;
      current = undefined;
      if (outcome.exitCode === GONE) {
        stderr.write("hold: the far session directory is gone\n");
        settle(-1, "hold-gone");
        return;
      }
      // No exit line: the ssh went, not the CLI. Come back from where we were.
      const delay = reattachDelay(attempt++);
      setTimeout(attach, delay).unref();
    });
  };
  const stdin = new Writable({
    write(chunk, _enc, cb) {
      const text = String(chunk);
      if (current && ready) current.stdin.write(text);
      else pending.push(text);
      cb();
    },
  });
  attach();
  return {
    stdin,
    stdout,
    stderr,
    done,
    terminate: () => {
      if (killed || ended) return;
      killed = true;
      // A separate ssh: the attached one is busy tailing, and the exit line arrives through it.
      const k = run(holdKillScript(name));
      k.stdin.end();
      k.stdout.on("data", () => {});
      k.stderr.on("data", () => {});
    },
  };
}

/** A holds.json value with every field a reattach needs, or nothing. */
export function asHoldRecord(raw: unknown): HoldRecord | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  // SAFETY: a non-null object from this plugin's own file; each field is checked before use
  const r = raw as Record<string, unknown>;
  if (
    typeof r.sessionId !== "string" ||
    typeof r.host !== "string" ||
    typeof r.name !== "string" ||
    typeof r.command !== "string" ||
    !Array.isArray(r.args) ||
    typeof r.cwd !== "string" ||
    typeof r.procSpec !== "object" ||
    r.procSpec === null ||
    typeof r.offset !== "number" ||
    typeof r.startedAt !== "number"
  )
    return undefined;
  return {
    sessionId: r.sessionId,
    host: r.host,
    name: r.name,
    command: r.command,
    args: r.args.filter((a): a is string => typeof a === "string"),
    cwd: r.cwd,
    // SAFETY: written by holdOn from a ClaudeProcessSpec; a stale shape only mis-keys a respawn
    procSpec: r.procSpec as ClaudeProcessSpec,
    offset: r.offset,
    startedAt: r.startedAt,
  };
}
