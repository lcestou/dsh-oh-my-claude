import { spawn } from "node:child_process";
type SpawnFn = typeof spawn;
/** Per-box token file: `<stateDir>/ssh-tokens/<slug(host)>`, private. */
export declare function sshTokenPath(stateDir: string, host: string): string;
/** The stored login token for a host, or undefined if the box was never logged in from the panel. */
export declare function readSshToken(stateDir: string, host: string): string | undefined;
export declare function writeSshToken(stateDir: string, host: string, token: string): void;
export declare function deleteSshToken(stateDir: string, host: string): void;
/**
 * Start `claude setup-token` on `host` under a kept-alive PTY and resolve with the OAuth URL it prints.
 * The process is held in `logins` keyed by host until the code is submitted or it times out. A prior
 * unfinished login for the same host is killed first.
 */
export declare function startSshLogin(host: string, spawnFn?: SpawnFn, timeoutMs?: number): Promise<{
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
