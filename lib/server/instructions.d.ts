import { type FsBox } from "./remote-fs.js";
/** Where a file sits in the hierarchy, named as the CLI names its own layers. */
export type InstructionKind = "Managed" | "User" | "Project" | "Local";
/** One loaded file. `importedBy` is set when a `@` line in another file pulled it in. */
export interface InstructionFile {
    path: string;
    kind: InstructionKind;
    size: number;
    mtime: number;
    importedBy?: string;
}
/**
 * The `@` lines the CLI reads as imports. Its own regex, with its own acceptance rules: the `@`
 * has to open the line or follow whitespace (so `you@example.com` is an address, not an import),
 * a `#` ends the path, `\ ` is an escaped space, and the path is a relative, home or absolute one.
 *
 * The CLI walks a markdown token tree and skips code and codespan tokens. Rather than pull a
 * markdown parser in for it, fenced blocks and inline spans are cut out of the text first, which
 * agrees with the CLI on everything but a fence opened and never closed.
 */
export declare function importsIn(text: string): string[];
/**
 * Every file the walk below asks for by name, in walk order. Only the fixed ones: a rules file is
 * named by a directory listing that has not happened yet, and an `@` import by a file that has not
 * been read yet, so both are found on the way through.
 */
export declare const instructionCandidates: (cwd: string, claudeHome: string) => string[];
/**
 * Whether a listed file may be written back. The list doubles as the write allowlist, and a `@`
 * line puts any absolute path a repo names on it — a cloned `CLAUDE.md` holding `@~/.ssh/authorized_keys`
 * would otherwise offer that file as an editable row. The CLI loads instructions as markdown, so a
 * path that is not a `.md` file is never one this panel should be rewriting.
 */
export declare const isWritableInstructions: (path: string) => boolean;
/**
 * Every CLAUDE.md the CLI would load for this directory, in load order: the managed files, the
 * user's, then each ancestor of the workspace from the root down, ending at the workspace itself.
 * A file pulled in by `@` follows the file that imported it and keeps its scope. Files that are
 * not there are skipped, and each path appears once however many times it is reached.
 */
export declare function listInstructions(cwd: string, claudeHome: string, box?: FsBox): Promise<InstructionFile[]>;
