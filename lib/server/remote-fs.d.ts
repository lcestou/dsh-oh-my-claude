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
 * Back the file up the way a local write does, then replace it through a temp file so a dropped
 * connection cannot leave a half-written settings file the CLI would refuse to start on.
 * `base64 -d` is in coreutils and busybox alike. It answers the mtime it left behind, which the
 * editor checks its next write against: reading it back in a second round trip would both cost a
 * connection and report on a file that may have moved on since.
 */
export declare const writeScript: (path: string, base64: string) => string;
/** Delete, and stay silent about a file that was already gone. */
export declare const removeScript: (path: string) => string;
/** The script's own output, or null when the marker never arrived and there is no answer to read. */
export declare const afterMark: (out: string) => string | null;
/** Split the read script's answer: the first line is the mtime in seconds, the rest is the file. */
export declare function splitRead(out: string): FileRead;
/** The file with its mtime, or null when it does not exist. Throws when the box cannot be reached. */
export declare function readAt(box: FsBox, path: string): Promise<FileRead | null>;
/** The file's text, or null when it does not exist. */
export declare function readTextAt(box: FsBox, path: string): Promise<string | null>;
/** The names in a directory; an absent directory lists empty, the way a local read does. */
export declare function listNamesAt(box: FsBox, dir: string): Promise<string[]>;
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
