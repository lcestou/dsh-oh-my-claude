/**
 * Keeper: owns one Claude Code process outside dsh's process tree so a dsh restart never touches
 * it. dsh attaches over a unix socket, sends stdin lines, receives stdout lines; while nobody is
 * attached the keeper buffers Claude's output (bounded) and replays it on the next attach. Started
 * as `node keeper.js <dir>` where `<dir>/spec.json` holds { command, args, cwd, env, sessionId }.
 * Runs under its own systemd user scope when the adapter can arrange it, so a service restart's
 * cgroup kill does not reach it. Line protocol, JSON per line:
 *   client → keeper: { t: "hello" } | { t: "in", line } | { t: "kill" }
 *   keeper → client: { t: "out", line } | { t: "err", line } | { t: "exit", code, signal } | { t: "hello", pid, claudePid, buffered }
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BUFFER_LINES = 20_000; // ~ a long tool-heavy turn; older lines drop with a notice line

interface KeeperSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  sessionId: string;
}

function main(dir: string) {
  // SAFETY: spec.json is written by this plugin's spawnKeeper from a typed object moments earlier
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")) as KeeperSpec;
  const sockPath = join(dir, "keeper.sock");
  const infoPath = join(dir, "keeper.json");
  mkdirSync(dir, { recursive: true });
  if (existsSync(sockPath)) unlinkSync(sockPath);
  process.on("SIGHUP", () => {}); // the launching terminal or service may hang up; we stay
  process.on("SIGTERM", () => {}); // only an explicit kill message ends Claude

  const logPath = join(dir, "keeper.log");
  const log = (line: string) => {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
    } catch {}
  };

  let endedBy: "client" | "child" | "keeper-crash" | null = null;
  let exit: { code: number | null; signal: string | null } | undefined;

  // A keeper that dies takes Claude with it: the next boot cannot reattach to a child whose
  // pipes belonged to a dead keeper, so it kills the orphan and the session loses its process
  // (2026-09-06 23:43: `read ECONNRESET` from the socket dsh dropped mid-restart, exit 70,
  // healthy Claude killed as an orphan). So: log, and stay up as long as the child is up.
  process.on("uncaughtException", (e) => {
    log(`uncaughtException: ${e?.stack ?? e}`);
    if (exit) {
      endedBy = "keeper-crash";
      try {
        writeInfo();
      } catch {
        // the log line above is the record; never let the crash handler itself throw
      }
      process.exit(70);
    }
  });
  process.on("unhandledRejection", (r) => {
    log(`unhandledRejection: ${r instanceof Error ? r.stack : String(r)}`);
  });

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdout.on("error", (e) => log(`stdout error: ${e.message}`));
  child.stderr.on("error", (e) => log(`stderr error: ${e.message}`));
  let client: Socket | undefined;
  const buffer: string[] = [];
  let dropped = 0;

  const send = (msg: object) => {
    const line = `${JSON.stringify(msg)}\n`;
    if (client && !client.destroyed) {
      client.write(line);
      return;
    }
    if (buffer.length >= BUFFER_LINES) {
      buffer.shift();
      dropped++;
    }
    buffer.push(line);
  };
  const writeInfo = () =>
    writeFileSync(
      infoPath,
      JSON.stringify({
        pid: process.pid,
        claudePid: child.pid,
        sessionId: spec.sessionId,
        startedAt: Date.now(),
        exit: exit ?? null,
        // Why Claude ended, for the boot that finds this keeper dead: "client" means a kill
        // message from dsh, "child" means Claude exited on its own.
        endedBy,
      }),
    );
  log(`start pid=${process.pid} claudePid=${child.pid}`);
  writeInfo();

  createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) =>
    send({ t: "out", line }),
  );
  createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", (line) =>
    send({ t: "err", line }),
  );
  child.on("exit", (code, signal) => {
    exit = { code, signal };
    endedBy ??= "child";
    log(`childExit code=${code} signal=${signal}`);
    writeInfo();
    send({ t: "exit", code, signal });
    // Give an attached client time to read the exit, then leave.
    setTimeout(() => process.exit(0), 3000).unref();
  });

  const server = createServer((sock) => {
    // One client at a time: a new dsh replaces the old (which is gone anyway after a restart).
    if (client && !client.destroyed) client.destroy();
    client = sock;
    sock.on("error", () => {});
    log(`attach buffered=${buffer.length} dropped=${dropped}`);
    sock.on("close", () => {
      if (client === sock) {
        client = undefined;
        log(`detach buffered=${buffer.length} dropped=${dropped}`);
      }
    });
    createInterface({ input: sock, crlfDelay: Infinity }).on("line", (raw) => {
      let msg: { t?: string; line?: string };
      try {
        // SAFETY: the only client is this plugin's attachKeeper; fields are checked before use
        msg = JSON.parse(raw) as { t?: string; line?: string };
      } catch {
        return;
      }
      if (msg.t === "hello") {
        sock.write(
          `${JSON.stringify({ t: "hello", pid: process.pid, claudePid: child.pid, buffered: buffer.length, dropped })}\n`,
        );
        if (dropped > 0)
          sock.write(
            `${JSON.stringify({ t: "err", line: `keeper: ${dropped} output lines dropped while detached` })}\n`,
          );
        for (const l of buffer) sock.write(l);
        buffer.length = 0;
        dropped = 0;
        if (exit) sock.write(`${JSON.stringify({ t: "exit", ...exit })}\n`);
      } else if (msg.t === "in" && typeof msg.line === "string") {
        if (!exit) child.stdin.write(msg.line);
      } else if (msg.t === "kill") {
        log(`kill`);
        if (!exit) {
          endedBy = "client";
          child.kill("SIGTERM");
        }
      }
    });
  });
  server.on("error", (e) => log(`server error: ${e.message}`));
  server.listen(sockPath);
  process.on("exit", (code) => {
    log(`exit code=${code} claudeExit=${JSON.stringify(exit ?? null)} endedBy=${endedBy}`);
    try {
      unlinkSync(sockPath);
    } catch {}
  });
}

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: keeper.js <dir>\n");
  process.exit(2);
}
main(dir);
