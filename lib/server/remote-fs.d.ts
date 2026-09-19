import { type SubprocessHandle } from "./process.js";
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
export declare const ABSENT = 44;
/** The local counterpart of `ABSENT`: the one `node:fs` failure that means the file is not there. */
export declare const isEnoent: (e: unknown) => boolean;
/**
 * The modification time on its own first line, then the file verbatim. One round trip serves both
 * the editor's conflict check and its text; GNU `stat` and the BSD one disagree on the flag, so try
 * each and fall back to an unknown time rather than failing the read.
 */
export declare const readScript: (path: string) => string;
/** One name per line, or nothing when the directory is absent — a missing dir lists empty, as locally. */
export declare const listScript: (dir: string) => string;
/**
 * One directory level for the workspace picker: the level it resolved to, then the box's `$HOME`,
 * then one child directory name per line. An empty `dir` means the box's home, which is where the
 * dialog opens; `cd` resolves `.`, `..` and a symlink for us, so the answer is the path the far box
 * would actually run in. An unreadable or absent level exits `ABSENT`, the way a file read does.
 */
export declare const dirsScript: (dir: string) => string;
/** Make one directory, and fail when the name is taken: a picker's New folder, not `mkdir -p`. */
export declare const makeDirScript: (dir: string) => string;
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
export declare function splitDirs(out: string): DirLevel;
/** Join a child onto a POSIX level without doubling the root's slash. */
export declare const childPath: (dir: string, name: string) => string;
/**
 * Back the file up the way a local write does, then replace it through a temp file so a dropped
 * connection cannot leave a half-written settings file the CLI would refuse to start on.
 * `base64 -d` is in coreutils and busybox alike. It answers the mtime it left behind, which the
 * editor checks its next write against: reading it back in a second round trip would both cost a
 * connection and report on a file that may have moved on since.
 */
export declare const writeScript: (path: string, base64: string) => string;
/** Delete, and stay silent about a file that was already gone. */
export declare const removeScript: (path: string) => string;
/** The file's size in bytes, GNU or BSD stat; a missing file exits with the absent code. */
export declare const sizeScript: (path: string) => string;
/** The bytes past `offset` (tail counts from 1); nothing when the file is shorter or missing. */
export declare const tailScript: (path: string, offset: number) => string;
/** The script's own output, or null when the marker never arrived and there is no answer to read. */
export declare const afterMark: (out: string) => string | null;
/** Split the read script's answer: the first line is the mtime in seconds, the rest is the file. */
export declare function splitRead(out: string): FileRead;
/** The file with its mtime, or null when it does not exist. Throws when the box cannot be reached. */
export declare function readAt(box: FsBox, path: string): Promise<FileRead | null>;
/** The file's size, or null when it does not exist. Throws when the box cannot be reached. */
export declare function sizeAt(box: FsBox, path: string): Promise<number | null>;
/** The bytes a file gained past `offset`, or "" when it has not grown or is not there. Locally one
 *  positioned read; on a box one `tail`, over the shared connection. A file shorter than the offset
 *  was replaced under us and reads as nothing new. */
export declare function readFromAt(box: FsBox, path: string, offset: number): Promise<string>;
/** The file's text, or null when it does not exist. */
export declare function readTextAt(box: FsBox, path: string): Promise<string | null>;
/** The names in a directory; an absent directory lists empty, the way a local read does. */
export declare function listNamesAt(box: FsBox, dir: string): Promise<string[]>;
/**
 * One directory level on the box, or null when the level is gone or unreadable. The picker opens on
 * the box's home, so an empty `dir` asks for that rather than this PC's.
 */
export declare function listDirsAt(box: FsBox, dir: string): Promise<DirLevel | null>;
/** Create one directory on the box. A name already in use is a fault the picker shows. */
export declare function makeDirAt(box: FsBox, dir: string): Promise<void>;
/**
 * Write the file, creating its parent and keeping a `.bak` of what was there. Answers the mtime the
 * file ended up with, which is what the editor checks its next write against.
 */
export declare function writeAt(box: FsBox, path: string, text: string): Promise<number>;
/**
 * The box's home directory, which is where its `~/.claude` lives. A mount's `configDir` is resolved
 * against *this* PC's home, so a remote box's user-scope settings path has to be asked for over ssh
 * rather than assumed: the account there is often not the account here.
 */
export declare function homeAt(box: FsBox): Promise<string>;
/** Delete the file; a file that was already gone is not an error. */
export declare function removeAt(box: FsBox, path: string): Promise<void>;
/** Delete a directory and everything under it; a directory already gone is not an error. The caller
 *  passes a path it resolved from a trusted listing, never a raw client value, so the `rm -rf` target
 *  is always a skills directory this plugin computed. */
export declare function removeDirAt(box: FsBox, dir: string): Promise<void>;
/**
 * Write stdin to `<attachments>/<name>` on the box and print the absolute path it has there. The
 * bytes go through a temp file that takes the real name only once it holds `bytes` bytes: a read
 * that failed on this side ends the stream early and cleanly, which the far `cat` cannot tell from
 * a whole file, and a short copy under the real name would be kept as "already there" for good. A
 * short temp file is removed and the script fails. A file already there is kept and stdin is
 * drained, so ssh still exits 0.
 *
 * ponytail: a file that is already there is still streamed and thrown away; asking first would
 * cost a second connection per new file, and the caller remembers what it has copied.
 */
export declare const copyScript: (name: string, bytes: number) => string;
/** Runs one script on a box with its stdin open; the default is this plugin's `ssh`. A seam for the test. */
type RunWithStdin = (host: string, script: string) => SubprocessHandle;
/**
 * Stream one local file to the box and answer the absolute path it has there. The bytes ride
 * stdin, not the command line the way `writeAt`'s do, so a 34 MB zip costs one connection and
 * meets no argument-length limit. The answer is read after the marker, as every script's is: a
 * login shell that prints a banner would otherwise end up in front of the path.
 */
export declare function copyToAt(box: FsBox, localPath: string, name: string, timeoutMs?: number, run?: RunWithStdin): Promise<string>;
export {};
