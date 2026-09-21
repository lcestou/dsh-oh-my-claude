import { type ClaudeProcessSpec, type SubprocessHandle } from "./process.js";
/** First line of an attach: everything before it is a login shell's banner, not the CLI. */
export declare const READY = "OMC-HOLD-READY";
/** Last line of an attach that saw the CLI end; the rest of the line is its exit code. */
export declare const EXIT = "OMC-HOLD-EXIT ";
/** A line of the CLI's stderr, replayed after the exit so the failure row has something to say. */
export declare const ERR = "OMC-HOLD-ERR ";
/** The attach script's exit status when the far dir is not there (a `rm` on the box, or never made). */
export declare const GONE = 44;
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
export declare function holdName(providerId: string, sessionId: string, stamp?: number): string;
/**
 * Start the CLI on the box and answer its pid. `setsid` puts it in a session of its own, so the
 * ssh's hangup never reaches it; backgrounded from a non-interactive shell it is not a group leader,
 * so `setsid` execs rather than forks and `$!` is the leader itself. The inner `sh` holds the FIFO
 * open read-write for the CLI and records the exit code after it.
 */
export declare function holdStartScript(name: string, cwd: string, command: string, args: string[], token?: string): string;
/**
 * Attach: stdin into the FIFO, the log out from `offset`. `tail --pid` ends when the leader does,
 * after one last read, so the final `result` frame is never left in the file. The `cat` is killed
 * after, since a FIFO with no reader would hold it on open forever. The exit line carries the code
 * the inner `sh` wrote, or 255 when the leader died without writing one (a `kill -9`).
 */
export declare function holdAttachScript(name: string, offset: number): string;
/** SIGTERM the whole session (the pgid is the leader's pid), SIGKILL what is left five seconds on. */
export declare const holdKillScript: (name: string) => string;
/** Remove the far dir: only after the exit line, so the log of a live CLI is never taken away. */
export declare const holdCleanScript: (name: string) => string;
/** One line of an attach, sorted: the banner before READY, the CLI's output, stderr, the exit. */
export type HoldLine = {
    kind: "ready";
} | {
    kind: "out";
    line: string;
} | {
    kind: "err";
    line: string;
} | {
    kind: "exit";
    code: number;
};
/** Classifies one line from an attach stream: before the session is ready it recognizes only the
 *  READY banner and drops everything else, and once ready it reads exit, stderr and output lines,
 *  defaulting an unreadable exit code to 255. */
export declare function parseHoldLine(line: string, ready: boolean): HoldLine | undefined;
/** How long to wait before reattaching after the ssh dropped without an exit line, by try. */
export declare const reattachDelay: (attempt: number) => number;
/** Runs one script on the box; the default is this plugin's `ssh`. A seam for the test. */
export type RunOnBox = (script: string) => SubprocessHandle;
export declare const sshRunner: (host: string) => RunOnBox;
/**
 * The handle `ClaudeProcess` talks to. Attaches now, reattaches from the current offset whenever
 * the ssh ends without an exit line, and reports the CLI's exit only from that line or from a far
 * dir that is gone. `onOffset` is called as the offset moves, so a restart resumes from the last
 * line this box read rather than replaying the whole log.
 */
export declare function holdHandle(run: RunOnBox, name: string, offset: number, onOffset: (offset: number) => void, onExit?: () => void): SubprocessHandle;
/** A holds.json value with every field a reattach needs, or nothing. */
export declare function asHoldRecord(raw: unknown): HoldRecord | undefined;
