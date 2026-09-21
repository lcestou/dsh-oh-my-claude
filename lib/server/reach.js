/** ssh's own last line for the stage, so the classifier is asserted against the real strings. */
const STAGE_HINTS = {
    dns: "The name does not resolve here. On a tailnet or VPN, check the tunnel is up (tailscale status, wg show); otherwise check the spelling or use the IP.",
    route: "No route to the box, or it did not answer in time. Check it is on and reachable (ping it); a WireGuard or Tailscale box needs its tunnel up on both ends.",
    hostkey: "The box's host key changed or is unknown. Run `ssh <host>` once in a terminal to accept it, or fix ~/.ssh/known_hosts.",
    auth: "The box refused the key. Copy one with `ssh-copy-id <host>`, or on a tailnet turn on Tailscale SSH so no key is needed.",
    policy: "Tailscale SSH is on for this box but the tailnet's policy does not let you in. Allow ssh in the tailnet ACL (Headscale: an `ssh` rule in the policy file; Tailscale: the admin console), or run `tailscale set --ssh=false` on the box to use its plain sshd.",
    shell: "ssh connected but the command failed on the box. Run `ssh <host> true` in a terminal to see what the login shell says.",
    "no-cli": "ssh works but the box has no `claude` on the login PATH. Install Claude Code there, or set the box's `command` to its full path.",
};
/**
 * Sort one ssh attempt's outcome. The strings are OpenSSH's; the order matters where two could
 * both match (a host key failure also says "Permission denied" further down in some versions).
 */
export function classifyReach(exitCode, stderr, stdout) {
    const err = stderr.trim();
    const last = err
        .split(/\r?\n/)
        .filter((l) => l !== "")
        .at(-1) ?? "";
    const stage = (() => {
        if (/could not resolve hostname|name or service not known|nodename nor servname/i.test(err))
            return "dns";
        if (/host key verification failed|remote host identification has changed|no .*host key is known/i.test(err))
            return "hostkey";
        if (/no route to host|connection timed out|network is unreachable|connection refused|operation timed out|connect to host .* port \d+/i.test(err))
            return "route";
        if (/tailnet policy does not permit|tailscale: .*not permit/i.test(err))
            return "policy";
        if (/permission denied|too many authentication failures|authentication failed/i.test(err))
            return "auth";
        if (exitCode === 255)
            return "route"; // ssh's own failure with a line we do not know
        if (exitCode !== 0)
            return "shell";
        return stdout.trim() === "" ? "no-cli" : "ok";
    })();
    return { stage, hint: stage === "ok" ? "" : STAGE_HINTS[stage], detail: last };
}
/**
 * One shell script over ssh: the cli's path on stdout when all is well, nothing when it is not
 * there. `; true` keeps a missing cli at exit 0, so a non-zero exit means the login shell itself
 * failed, which is a different repair.
 */
export const reachScript = (command) => `command -v ${JSON.stringify(command).replace(/"/g, "'")} 2>/dev/null; true`;
/**
 * Peers from `tailscale status --json`. The host is the MagicDNS name without its trailing dot
 * when the tailnet has one (it is what `ssh` resolves through the tailscale resolver), else the
 * first Tailscale IP. This box's own entry is not a peer. Anything malformed reads as no peers.
 */
export function tailscalePeers(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null)
        return [];
    // SAFETY: the shape is tailscale's status document; every field is checked before use
    const doc = parsed;
    if (typeof doc.Peer !== "object" || doc.Peer === null)
        return [];
    const peers = [];
    for (const raw of Object.values(doc.Peer)) {
        if (typeof raw !== "object" || raw === null)
            continue;
        // SAFETY: one peer record; each field is checked for its type before it is read
        const p = raw;
        const name = typeof p.HostName === "string" ? p.HostName : "";
        const dns = typeof p.DNSName === "string" ? p.DNSName.replace(/\.$/, "") : "";
        const ips = Array.isArray(p.TailscaleIPs)
            ? p.TailscaleIPs.filter((ip) => typeof ip === "string")
            : [];
        const host = dns || ips[0] || "";
        if (!name || !host)
            continue;
        const keys = p.SSH_HostKeys;
        peers.push({
            name,
            host,
            os: typeof p.OS === "string" ? p.OS : "",
            online: p.Online === true,
            tailscaleSsh: Array.isArray(keys) && keys.length > 0,
        });
    }
    return peers.toSorted((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
/** A peer that is already a saved box, by host, so the picker can say so instead of adding twice. */
export const peerSaved = (peer, boxes) => boxes.some((b) => b.host === peer.host || b.host.endsWith(`@${peer.host}`));
/** Parses `tailscale status --json` output, returning undefined on anything it cannot read and
 *  deriving login state from the 'Running' backend state. */
export function tailscaleStatus(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    // SAFETY: tailscale's status document; each field is checked before use
    const doc = parsed;
    const state = typeof doc.BackendState === "string" ? doc.BackendState : "NoState";
    const out = { state, loggedIn: state === "Running", peers: tailscalePeers(text) };
    const me = doc.Self;
    if (typeof me === "object" && me !== null) {
        const name = typeof me.HostName === "string" ? me.HostName : "";
        const dns = typeof me.DNSName === "string" ? me.DNSName.replace(/\.$/, "") : "";
        const ips = Array.isArray(me.TailscaleIPs)
            ? me.TailscaleIPs.filter((ip) => typeof ip === "string")
            : [];
        if (name)
            out.self = { name, host: dns || ips[0] || "", ip: ips[0] ?? "" };
    }
    return out;
}
/** The approval link `tailscale login` prints, once it does. */
export const loginUrlIn = (text) => /https:\/\/login\.tailscale\.com\/[A-Za-z0-9/_-]+/.exec(text)?.[0];
/**
 * Peers from `wg show all dump`: tab-separated, interface lines with five fields, peer lines with
 * nine (interface, public key, preshared key, endpoint, allowed ips, latest handshake, rx, tx,
 * keepalive). The host is the peer's first single address (/32 or /128); a peer whose allowed
 * ranges hold no single address is skipped, since there is no one host to dial in a range.
 */
export function wireguardPeers(dump, now = Date.now()) {
    const peers = [];
    for (const line of dump.split(/\r?\n/)) {
        const f = line.split("\t");
        if (f.length < 9)
            continue;
        const iface = f[0] ?? "";
        const allowedIps = (f[4] ?? "")
            .split(",")
            .map((x) => x.trim())
            .filter((x) => x !== "");
        const single = allowedIps.find((ip) => /\/(32|128)$/.test(ip));
        if (!iface || !single)
            continue;
        const handshake = Number(f[5]);
        peers.push({
            iface,
            host: single.replace(/\/(32|128)$/, ""),
            allowedIps,
            endpoint: f[3] === "(none)" ? "" : (f[3] ?? ""),
            handshakeAge: handshake > 0 ? Math.max(0, Math.round(now / 1000 - handshake)) : null,
        });
    }
    return peers;
}
/** Validates a tailnet join, treating an empty or absent field as unset so it passes, and
 *  pattern-checking only the values that are present. */
export function validateTailnetJoin(raw) {
    const loginServer = String(raw.loginServer ?? "").trim();
    const authKey = String(raw.authKey ?? "").trim();
    if (loginServer && !/^https?:\/\/[A-Za-z0-9.:_-]+(\/[A-Za-z0-9._/-]*)?$/.test(loginServer))
        return { error: "login server must be an http(s) URL" };
    if (authKey && !/^[A-Za-z0-9_+/=.-]{8,200}$/.test(authKey))
        return { error: "that does not look like a pre-auth key" };
    return { value: { loginServer, authKey } };
}
//# sourceMappingURL=reach.js.map