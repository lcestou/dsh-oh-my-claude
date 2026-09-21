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
export type ReachStage = "dns" | "route" | "hostkey" | "auth" | "policy" | "shell" | "no-cli" | "ok";
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
/** What `tailscale status --json` says about this node: whether it is on a tailnet, and who it is. */
export interface TailscaleState {
    /** `Running`, `NeedsLogin`, `Stopped`, `NoState`, or whatever the daemon says. */
    state: string;
    loggedIn: boolean;
    self?: {
        name: string;
        host: string;
        ip: string;
    };
    peers: TailscalePeer[];
}
/** Parses `tailscale status --json` output, returning undefined on anything it cannot read and
 *  deriving login state from the 'Running' backend state. */
export declare function tailscaleStatus(text: string): TailscaleState | undefined;
/** The approval link `tailscale login` prints, once it does. */
export declare const loginUrlIn: (text: string) => string | undefined;
/** A WireGuard peer as the Boxes tab offers it: the tunnel address is the host. */
export interface WireguardPeer {
    iface: string;
    /** The first allowed address without its mask: what ssh dials. */
    host: string;
    allowedIps: string[];
    endpoint: string;
    /** Seconds since the last handshake, or nothing when there has never been one. */
    handshakeAge: number | null;
}
/**
 * Peers from `wg show all dump`: tab-separated, interface lines with five fields, peer lines with
 * nine (interface, public key, preshared key, endpoint, allowed ips, latest handshake, rx, tx,
 * keepalive). The host is the peer's first single address (/32 or /128); a peer whose allowed
 * ranges hold no single address is skipped, since there is no one host to dial in a range.
 */
export declare function wireguardPeers(dump: string, now?: number): WireguardPeer[];
/** What the card sends to join a tailnet; both fields optional, both checked before a shell. */
export interface TailnetJoin {
    loginServer: string;
    authKey: string;
}
/**
 * The two strings reach `tailscale up` through shq, so this is about shape, not shell safety: a
 * login server is an http(s) URL, and a key is what Tailscale (`tskey-auth-…`) or Headscale (hex,
 * sometimes base64-ish) hands out.
 */
/** A checked join, or the reason it was refused. */
export interface ValidatedTailnetJoin {
    value?: TailnetJoin;
    error?: string;
}
/** Validates a tailnet join, treating an empty or absent field as unset so it passes, and
 *  pattern-checking only the values that are present. */
export declare function validateTailnetJoin(raw: {
    loginServer?: unknown;
    authKey?: unknown;
}): ValidatedTailnetJoin;
