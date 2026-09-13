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
export declare function deleteSshToken(stateDir: string, host: string): void;
/** A process to start: the binary and its argument list. */
export interface Invocation {
    command: string;
    args: string[];
}
/**
 * The command line that runs `claude auth login` under a PTY. On a box it rides `ssh -tt`. On this
 * box there is no ssh to lend a PTY, so `script` (util-linux on Linux, BSD's on macOS) provides one;
 * the invocation differs between the two, which is what the platform switch is for.
 */
export declare function loginInvocation(host: string, command?: string, platform?: NodeJS.Platform): Invocation;
/**
 * Start `claude auth login` on `host` (THIS_BOX for the local one) under a kept-alive PTY and
 * resolve with the sign-in URL it prints. The process is held in `logins` keyed by host until it
 * finishes or its time to live passes. A prior unfinished login for the same host is killed first.
 */
export declare function startSshLogin(host: string, spawnFn?: SpawnFn, timeoutMs?: number, command?: string, ttlMs?: number): Promise<{
    url?: string;
    error?: string;
}>;
/** How a login ended: `done` once the box's own `claude auth status` says logged in after the
 *  process exited, or not, with the CLI's last line as the error. */
export interface LoginOutcome {
    done: boolean;
    error?: string;
}
/** A poll's answer: still running, or the outcome. */
export type LoginPoll = {
    pending: true;
} | ({
    pending: false;
} & LoginOutcome);
/** Asks the box whether it is logged in now: the one proof a login took, run after the process
 *  exits. The routes hand in `claude auth status` on that box; tests hand in a stub. */
export type VerifyLogin = () => Promise<boolean>;
/**
 * Whether the held login has finished by itself. On a box with a browser the approval reaches the
 * CLI over loopback and it exits with no code pasted, so the panel cannot wait on a paste that never
 * comes: it asks this every few seconds after showing the link.
 */
export declare function pollSshLogin(host: string, verify: VerifyLogin): Promise<LoginPoll>;
/**
 * Write the pasted code to the held login process, submit it with a carriage return, and wait for
 * the process to finish; then the box says whether the login took. A login that exits without one
 * reads honestly as an error rather than claiming success. A login that already finished on its
 * own answers with its outcome: the code was never needed.
 */
export declare function submitSshLoginCode(host: string, code: string, verify: VerifyLogin, timeoutMs?: number): Promise<LoginOutcome>;
export {};
