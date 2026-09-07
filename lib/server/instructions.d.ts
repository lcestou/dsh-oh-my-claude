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
 * Every CLAUDE.md the CLI would load for this directory, in load order: the managed files, the
 * user's, then each ancestor of the workspace from the root down, ending at the workspace itself.
 * A file pulled in by `@` follows the file that imported it and keeps its scope. Files that are
 * not there are skipped, and each path appears once however many times it is reached.
 */
export declare function listInstructions(cwd: string, claudeHome: string): Promise<InstructionFile[]>;
