/** ssh's own last line for the stage, so the classifier is asserted against the real strings. */
const STAGE_HINTS = {
    dns: "The name does not resolve here. On a tailnet or VPN, check the tunnel is up (tailscale status, wg show); otherwise check the spelling or use the IP.",
    route: "No route to the box, or it did not answer in time. Check it is on and reachable (ping it); a WireGuard or Tailscale box needs its tunnel up on both ends.",
    hostkey: "The box's host key changed or is unknown. Run `ssh <host>` once in a terminal to accept it, or fix ~/.ssh/known_hosts.",
    auth: "The box refused the key. Copy one with `ssh-copy-id <host>`, or on a tailnet turn on Tailscale SSH so no key is needed.",
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
//# sourceMappingURL=reach.js.map