/**
 * File reads and writes for a session's own box.
 *
 * Every file-backed panel route used to read this box's disk whatever box the session ran on, so a
 * session on an SSH mount was shown this PC's settings and wrote its edits here. A box that is this
 * PC still goes straight to `node:fs`; a box with `sshHost` runs one short shell script over the
 * same `ssh` the spawner and the status probe use. Key-based auth only, as everywhere else.
 *
 * The scripts are built by pure functions so they can be asserted without a host
 * (`src/remote-fs.test.ts`). Every path is single-quoted through `shq`, so a space or a quote in a
 * workspace path cannot break out of its argument.
 *
 * ponytail: a write carries its content base64-encoded inside the command line, which a settings or
 * memory file fits in comfortably; swap for a piped stdin the day something megabyte-sized needs it.
 */
import { execFile } from "node:child_process";
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { shq, sshArgs } from "./process.js";

/** The part of a mount this module needs: an empty `sshHost` means this PC. */
export interface FsBox {
  sshHost?: string;
}

/** A file as the panel reads it: its text, and when it last changed. */
export interface FileRead {
  text: string;
  mtimeMs: number;
}

/** Exit code the read script uses for "no such file", to tell an absent file from a dead connection. */
export const ABSENT = 44;

/** The local counterpart of `ABSENT`: the one `node:fs` failure that means the file is not there. */
export const isEnoent = (e: unknown): boolean =>
  typeof e === "object" && e !== null && "code" in e && e.code === "ENOENT";

/**
 * The modification time on its own first line, then the file verbatim. One round trip serves both
 * the editor's conflict check and its text; GNU `stat` and the BSD one disagree on the flag, so try
 * each and fall back to an unknown time rather than failing the read.
 */
export const readScript = (path: string): string =>
  `if [ -e ${shq(path)} ]; then { stat -c %Y -- ${shq(path)} 2>/dev/null || ` +
  `stat -f %m -- ${shq(path)} 2>/dev/null || echo 0; }; cat -- ${shq(path)}; else exit ${ABSENT}; fi`;

/** One name per line, or nothing when the directory is absent — a missing dir lists empty, as locally. */
export const listScript = (dir: string): string =>
  `if [ -d ${shq(dir)} ]; then ls -A -- ${shq(dir)}; fi`;

/**
 * One directory level for the workspace picker: the level it resolved to, then the box's `$HOME`,
 * then one child directory name per line. An empty `dir` means the box's home, which is where the
 * dialog opens; `cd` resolves `.`, `..` and a symlink for us, so the answer is the path the far box
 * would actually run in. An unreadable or absent level exits `ABSENT`, the way a file read does.
 */
export const dirsScript = (dir: string): string =>
  `cd -- ${dir === "" ? '"$HOME"' : shq(dir)} 2>/dev/null || exit ${ABSENT}; pwd; printf '%s\\n' "$HOME"; ` +
  `for f in * .*; do [ "$f" = . ] || [ "$f" = .. ] || { [ -d "$f" ] && printf '%s\\n' "$f"; }; done; exit 0`;

/** Make one directory, and fail when the name is taken: a picker's New folder, not `mkdir -p`. */
export const makeDirScript = (dir: string): string => `mkdir -- ${shq(dir)}`;

/** One directory level: where it resolved to, the box's home, and its child directory names. */
export interface DirLevel {
  path: string;
  home: string;
  names: string[];
}

/**
 * Split `dirsScript`'s answer: the level, then `$HOME`, then the names. The names are sorted here
 * rather than by the box, whose glob lists the dotted ones after the rest.
 */
export function splitDirs(out: string): DirLevel {
  const [path = "", home = "", ...names] = out.split("\n");
  return { path, home, names: names.filter((n) => n !== "").toSorted() };
}

/** Join a child onto a POSIX level without doubling the root's slash. */
export const childPath = (dir: string, name: string): string =>
  dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;

/**
 * Back the file up the way a local write does, then replace it through a temp file so a dropped
 * connection cannot leave a half-written settings file the CLI would refuse to start on.
 * `base64 -d` is in coreutils and busybox alike. It answers the mtime it left behind, which the
 * editor checks its next write against: reading it back in a second round trip would both cost a
 * connection and report on a file that may have moved on since.
 */
export const writeScript = (path: string, base64: string): string =>
  // `$$` is the remote shell's pid: two writes to one path at once would otherwise share a temp
  // name, and the second `mv` would find the file the first one already moved.
  `mkdir -p ${shq(dirname(path))} && { [ -e ${shq(path)} ] && cp -- ${shq(path)} ${shq(`${path}.bak`)} || true; } && ` +
  `t=${shq(`${path}.tmp`)}.$$ && printf %s ${shq(base64)} | base64 -d > "$t" && mv -- "$t" ${shq(path)} && ` +
  `{ stat -c %Y -- ${shq(path)} 2>/dev/null || stat -f %m -- ${shq(path)} 2>/dev/null || echo 0; }`;

/** Delete, and stay silent about a file that was already gone. */
export const removeScript = (path: string): string => `rm -f -- ${shq(path)}`;

/** The file's size in bytes, GNU or BSD stat; a missing file exits with the absent code. */
export const sizeScript = (path: string): string =>
  `if [ -e ${shq(path)} ]; then stat -c %s -- ${shq(path)} 2>/dev/null || ` +
  `stat -f %z -- ${shq(path)}; else exit ${ABSENT}; fi`;

/** The bytes past `offset` (tail counts from 1); nothing when the file is shorter or missing. */
export const tailScript = (path: string, offset: number): string =>
  `tail -c +${Math.max(0, Math.floor(offset)) + 1} -- ${shq(path)} 2>/dev/null || true`;

/** What a remote command returned: `code` is the remote exit status when ssh itself connected. */
interface Ran {
  code: number;
  out: string;
  err: string;
}

/** ssh could not run the script at all (bad key, unknown host, timeout) rather than the file missing. */
const transportError = (host: string, r: Ran): Error =>
  new Error(
    `${host}: ${r.err || (r.code === 0 ? "the script printed no answer" : `ssh exited ${r.code}`)}`,
  );

/**
 * The marker every script prints before its own output.
 *
 * A login shell on the far end runs its rc files before our script, and whatever they print lands
 * on stdout ahead of the answer: an `echo` in someone's `.bashrc` used to be read as the first line
 * of a file read — the mtime — and its banner as the start of `$HOME` or of a file name. The script
 * says where its output begins rather than the reader trusting position, in a control byte no
 * banner emits.
 */
const MARK = "\u0001omc\u0001";

/** The script's own output, or null when the marker never arrived and there is no answer to read. */
export const afterMark = (out: string): string | null => {
  const at = out.indexOf(MARK);
  return at === -1 ? null : out.slice(at + MARK.length);
};

/**
 * Run `script` on `host` and answer what it printed, with the box's own chatter cut away. Rejects
 * when the marker never arrived: the script did not get as far as its first statement, so `out` is
 * the box talking to itself rather than an answer — and reading that as one is how an unreachable
 * box shows up as an empty file that the next save then overwrites.
 */
const ssh = (host: string, script: string, timeout = 15_000): Promise<Ran> =>
  new Promise((resolve, reject) =>
    execFile(
      "ssh",
      sshArgs(host, `printf ${shq(MARK)}; ${script}`),
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (e, out, err) => {
        const said = afterMark(String(out));
        const r: Ran = {
          // SAFETY: execFile's error carries the remote exit status; anything else (spawn failure,
          // timeout) has no code and reads as 255, the status ssh itself uses for a failed connection.
          code: e === null ? 0 : ((e as { code?: number }).code ?? 255),
          out: said ?? String(out),
          err: String(err).trim().slice(0, 300),
        };
        if (said === null) reject(transportError(host, r));
        else resolve(r);
      },
    ),
  );

/** Split the read script's answer: the first line is the mtime in seconds, the rest is the file. */
export function splitRead(out: string): FileRead {
  const cut = out.indexOf("\n");
  const head = cut === -1 ? out : out.slice(0, cut);
  const seconds = Number(head.trim());
  return {
    text: cut === -1 ? "" : out.slice(cut + 1),
    mtimeMs: Number.isFinite(seconds) ? seconds * 1000 : 0,
  };
}

/** The file with its mtime, or null when it does not exist. Throws when the box cannot be reached. */
export async function readAt(box: FsBox, path: string): Promise<FileRead | null> {
  if (!box.sshHost) {
    const read = await Promise.all([readFile(path, "utf8"), stat(path)]).catch((e: unknown) => {
      // Only an absent file reads as null. A permission error or a broken mount is a fault worth
      // surfacing, and answering null for it would show an unreadable file as one that is not there.
      if (!isEnoent(e)) throw e;
      return null;
    });
    return read === null ? null : { text: read[0], mtimeMs: read[1].mtimeMs };
  }
  const r = await ssh(box.sshHost, readScript(path));
  if (r.code === ABSENT) return null;
  if (r.code !== 0) throw transportError(box.sshHost, r);
  return splitRead(r.out);
}

/** The file's size, or null when it does not exist. Throws when the box cannot be reached. */
export async function sizeAt(box: FsBox, path: string): Promise<number | null> {
  if (!box.sshHost) {
    try {
      return (await stat(path)).size;
    } catch (e) {
      if (!isEnoent(e)) throw e;
      return null;
    }
  }
  const r = await ssh(box.sshHost, sizeScript(path));
  if (r.code === ABSENT) return null;
  if (r.code !== 0) throw transportError(box.sshHost, r);
  const n = Number(r.out.trim());
  return Number.isFinite(n) ? n : null;
}

/** The bytes a file gained past `offset`, or "" when it has not grown or is not there. Locally one
 *  positioned read; on a box one `tail`, over the shared connection. A file shorter than the offset
 *  was replaced under us and reads as nothing new. */
export async function readFromAt(box: FsBox, path: string, offset: number): Promise<string> {
  if (!box.sshHost) {
    let fh;
    try {
      fh = await open(path, "r");
    } catch (e) {
      if (!isEnoent(e)) throw e;
      return "";
    }
    try {
      const { size } = await fh.stat();
      if (size <= offset) return "";
      const buf = Buffer.alloc(size - offset);
      // `bytesRead`, not `buf.length`: a file truncated between the stat and the read returns fewer
      // bytes, and decoding the untouched zero tail would append junk that fails to parse as a row.
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      return buf.toString("utf8", 0, bytesRead);
    } finally {
      await fh.close();
    }
  }
  const r = await ssh(box.sshHost, tailScript(path, offset), 60_000);
  if (r.code !== 0) throw transportError(box.sshHost, r);
  return r.out;
}

/** The file's text, or null when it does not exist. */
export async function readTextAt(box: FsBox, path: string): Promise<string | null> {
  return (await readAt(box, path))?.text ?? null;
}

/** The names in a directory; an absent directory lists empty, the way a local read does. */
export async function listNamesAt(box: FsBox, dir: string): Promise<string[]> {
  if (!box.sshHost) return await readdir(dir).catch(() => []);
  const r = await ssh(box.sshHost, listScript(dir));
  if (r.code !== 0) throw transportError(box.sshHost, r);
  return r.out.split("\n").filter((n) => n !== "");
}

/**
 * One directory level on the box, or null when the level is gone or unreadable. The picker opens on
 * the box's home, so an empty `dir` asks for that rather than this PC's.
 */
export async function listDirsAt(box: FsBox, dir: string): Promise<DirLevel | null> {
  if (!box.sshHost) {
    const home = homedir();
    const at = dir === "" ? home : dir;
    const kids = await readdir(at, { withFileTypes: true }).catch(() => null);
    if (kids === null) return null;
    return {
      path: at,
      home,
      names: kids
        .filter((k) => k.isDirectory())
        .map((k) => k.name)
        .toSorted(),
    };
  }
  const r = await ssh(box.sshHost, dirsScript(dir));
  if (r.code === ABSENT) return null;
  if (r.code !== 0) throw transportError(box.sshHost, r);
  return splitDirs(r.out);
}

/** Create one directory on the box. A name already in use is a fault the picker shows. */
export async function makeDirAt(box: FsBox, dir: string): Promise<void> {
  if (!box.sshHost) {
    await mkdir(dir);
    return;
  }
  const r = await ssh(box.sshHost, makeDirScript(dir));
  if (r.code !== 0) throw transportError(box.sshHost, r);
}

/**
 * Write the file, creating its parent and keeping a `.bak` of what was there. Answers the mtime the
 * file ended up with, which is what the editor checks its next write against.
 */
export async function writeAt(box: FsBox, path: string, text: string): Promise<number> {
  const body = text.endsWith("\n") ? text : `${text}\n`;
  if (!box.sshHost) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
    return (await stat(path)).mtimeMs;
  }
  const r = await ssh(box.sshHost, writeScript(path, Buffer.from(body, "utf8").toString("base64")));
  if (r.code !== 0) throw transportError(box.sshHost, r);
  const seconds = Number(r.out.trim());
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

/** Remote home directories, keyed by host: a box's `$HOME` does not change while dsh runs. */
const homes = new Map<string, string>();

/**
 * The box's home directory, which is where its `~/.claude` lives. A mount's `configDir` is resolved
 * against *this* PC's home, so a remote box's user-scope settings path has to be asked for over ssh
 * rather than assumed: the account there is often not the account here.
 */
export async function homeAt(box: FsBox): Promise<string> {
  if (!box.sshHost) return homedir();
  const cached = homes.get(box.sshHost);
  if (cached !== undefined) return cached;
  const r = await ssh(box.sshHost, 'printf %s "$HOME"');
  if (r.code !== 0) throw transportError(box.sshHost, r);
  const home = r.out.trim();
  // An empty `$HOME` would build `/.claude/settings.json` and edit the wrong file, so it is a fault
  // rather than a value to cache: the caller hears about the box instead of writing to the root.
  if (home === "") throw new Error(`${box.sshHost}: no $HOME on the remote account`);
  homes.set(box.sshHost, home);
  return home;
}

/** Delete the file; a file that was already gone is not an error. */
export async function removeAt(box: FsBox, path: string): Promise<void> {
  if (!box.sshHost) {
    await rm(path, { force: true });
    return;
  }
  const r = await ssh(box.sshHost, removeScript(path));
  if (r.code !== 0) throw transportError(box.sshHost, r);
}
