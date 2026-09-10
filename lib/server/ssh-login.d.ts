import { spawn } from "node:child_process";
type SpawnFn = typeof spawn;
/** The host string that means the box this plugin runs on; its token sits beside the ssh ones. */
export declare const THIS_BOX = "";
/**
 * Per-box token file: `<stateDir>/ssh-tokens/<slug(host)>`, private. This box's own login is
 * `.this-box`, a name a slug can never produce, so no saved ssh box can collide with it.
 */
export declare function sshTokenPath(stateDir: string, host: string): string;
/** The stored login token for a host, or undefined if the box was never logged in from the panel. */
export declare function readSshToken(stateDir: string, host: string): string | undefined;
export declare function writeSshToken(stateDir: string, host: string, token: string): void;
export declare function deleteSshToken(stateDir: string, host: string): void;
/**
 * The command line that runs `setup-token` under a PTY. On a box it rides `ssh -tt`. On this box
 * there is no ssh to lend a PTY, so `script` (util-linux on Linux, BSD's on macOS) provides one;
 * the invocation differs between the two, which is what the platform switch is for.
 */
/** A process to start: the binary and its argument list. */
export interface Invocation {
    command: string;
    args: string[];
}
export declare function setupTokenInvocation(host: string, command?: string, platform?: NodeJS.Platform): Invocation;
/**
 * Start `claude setup-token` on `host` (THIS_BOX for the local one) under a kept-alive PTY and
 * resolve with the OAuth URL it prints. The process is held in `logins` keyed by host until the
 * code is submitted or it times out. A prior unfinished login for the same host is killed first.
 */
export declare function startSshLogin(host: string, spawnFn?: SpawnFn, timeoutMs?: number, command?: string): Promise<{
    url?: string;
    error?: string;
}>;
/**
 * Write the pasted code to the held setup-token process, submit it with a carriage return, and wait
 * for the process to finish and print the token. Resolves with the minted token on success; the caller
 * stores it. A login that exits without a token reads honestly as an error rather than claiming
 * success.
 */
export declare function submitSshLoginCode(host: string, code: string, timeoutMs?: number): Promise<{
    done: boolean;
    token?: string;
    error?: string;
}>;
export {};
