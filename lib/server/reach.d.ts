/**
 * Reach: why an SSH box did not answer, told apart so the Boxes row can name the fix, and the
 * Tailscale peers this box can see, so a box on a tailnet is a click rather than a hostname typed.
 *
 * Every stage below is a different repair for the user: a name that does not resolve is a tunnel
 * or DNS problem, a route that fails is the box or its network being down, a refused key is the
 * ssh setup, and a box that answers but has no `claude` needs an install. Before this, all four
 * read as one ssh error string in the row.
 */
import type { SshBox } from "./sessions.js";
export type ReachStage = "dns" | "route" | "hostkey" | "auth" | "shell" | "no-cli" | "ok";
export interface Reach {
    stage: ReachStage;
    /** What to do about it, in the user's terms; empty when `ok`. */
    hint: string;
    /** The line ssh or the shell said, for the row's title. */
    detail: string;
}
/**
 * Sort one ssh attempt's outcome. The strings are OpenSSH's; the order matters where two could
 * both match (a host key failure also says "Permission denied" further down in some versions).
 */
export declare function classifyReach(exitCode: number | null, stderr: string, stdout: string): Reach;
/**
 * One shell script over ssh: the cli's path on stdout when all is well, nothing when it is not
 * there. `; true` keeps a missing cli at exit 0, so a non-zero exit means the login shell itself
 * failed, which is a different repair.
 */
export declare const reachScript: (command: string) => string;
/** A Tailscale peer as the Boxes tab offers it: name for the row, host for ssh, and whether it is up. */
export interface TailscalePeer {
    name: string;
    host: string;
    os: string;
    online: boolean;
    /** The peer advertises Tailscale SSH host keys: `ssh` works with no key of ours on it. */
    tailscaleSsh: boolean;
}
/**
 * Peers from `tailscale status --json`. The host is the MagicDNS name without its trailing dot
 * when the tailnet has one (it is what `ssh` resolves through the tailscale resolver), else the
 * first Tailscale IP. This box's own entry is not a peer. Anything malformed reads as no peers.
 */
export declare function tailscalePeers(text: string): TailscalePeer[];
/** A peer that is already a saved box, by host, so the picker can say so instead of adding twice. */
export declare const peerSaved: (peer: TailscalePeer, boxes: SshBox[]) => boolean;
