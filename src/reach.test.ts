// Offline self-check: bun src/reach.test.ts. OpenSSH's own last lines, and a tailscale status document.
import { strict as assert } from "node:assert";
import {
  classifyReach,
  loginUrlIn,
  peerSaved,
  reachScript,
  tailscalePeers,
  tailscaleStatus,
  validateTailnetJoin,
  wireguardPeers,
} from "./reach.js";

// The strings are what OpenSSH 9.x prints; each is a different repair.
const cases: Array<[number, string, string, string]> = [
  [255, "ssh: Could not resolve hostname nosuch.invalid: Name or service not known", "", "dns"],
  [255, "ssh: connect to host 10.255.255.1 port 22: Connection timed out", "", "route"],
  [255, "ssh: connect to host box port 22: No route to host", "", "route"],
  [255, "ssh: connect to host box port 22: Connection refused", "", "route"],
  [255, "nobody@nova: Permission denied (publickey).", "", "auth"],
  [
    255,
    "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nWARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.",
    "",
    "hostkey",
  ],
  [
    255,
    "No ED25519 host key is known for box and you have requested strict checking.\r\nHost key verification failed.",
    "",
    "hostkey",
  ],
  [255, "kex_exchange_identification: read: Connection reset by peer", "", "route"],
  [
    255,
    "tailscale: tailnet policy does not permit you to SSH to this node\r\nConnection closed by 100.64.0.2 port 22",
    "",
    "policy",
  ],
  [1, "sh: 1: something: not found", "", "shell"],
  [0, "", "", "no-cli"],
  [0, "Welcome to the box\n", "/usr/local/bin/claude\n", "ok"],
];
for (const [code, stderr, stdout, stage] of cases) {
  const r = classifyReach(code, stderr, stdout);
  assert.equal(r.stage, stage, `${JSON.stringify(stderr.slice(0, 40))} -> ${stage}`);
  if (stage === "ok") assert.equal(r.hint, "");
  else assert.ok(r.hint.length > 20, `${stage} names a fix`);
}
assert.equal(
  classifyReach(255, "line one\nPermission denied (publickey,password).", "").detail,
  "Permission denied (publickey,password).",
  "the detail is ssh's last line",
);
assert.equal(reachScript("claude"), "command -v 'claude' 2>/dev/null; true");
assert.equal(reachScript("/opt/bin/claude"), "command -v '/opt/bin/claude' 2>/dev/null; true");

// A tailscale status document, trimmed to what the picker reads: this box is not a peer, the
// MagicDNS name loses its trailing dot, a peer with no DNS name falls back to its IP, offline
// peers sort after online ones, and Tailscale SSH shows as the host keys the peer advertises.
const doc = {
  Self: { HostName: "desk", DNSName: "desk.tail1234.ts.net.", TailscaleIPs: ["100.64.0.1"] },
  MagicDNSSuffix: "tail1234.ts.net",
  Peer: {
    k1: {
      HostName: "nova",
      DNSName: "nova.tail1234.ts.net.",
      OS: "linux",
      Online: true,
      TailscaleIPs: ["100.64.0.2", "fd7a::2"],
      SSH_HostKeys: ["ssh-ed25519 AAAA"],
    },
    k2: { HostName: "nas", DNSName: "", OS: "linux", Online: false, TailscaleIPs: ["100.64.0.3"] },
    k3: {
      HostName: "phone",
      DNSName: "phone.tail1234.ts.net.",
      OS: "android",
      Online: true,
      TailscaleIPs: [],
    },
    k4: { HostName: "", DNSName: "", TailscaleIPs: [] },
    k5: "not a peer",
  },
};
const peers = tailscalePeers(JSON.stringify(doc));
assert.deepEqual(
  peers.map((p) => [p.name, p.host, p.os, p.online, p.tailscaleSsh]),
  [
    ["nova", "nova.tail1234.ts.net", "linux", true, true],
    ["phone", "phone.tail1234.ts.net", "android", true, false],
    ["nas", "100.64.0.3", "linux", false, false],
  ],
);
assert.deepEqual(tailscalePeers("not json"), [], "no tailscale, or garbage: no peers");
assert.deepEqual(tailscalePeers('{"Peer":null}'), []);
assert.equal(peerSaved(peers[0]!, [{ name: "L", host: "nova.tail1234.ts.net" }]), true);
assert.equal(peerSaved(peers[0]!, [{ name: "L", host: "me@nova.tail1234.ts.net" }]), true);
assert.equal(peerSaved(peers[0]!, [{ name: "L", host: "nova" }]), false);

// The node's own state: NeedsLogin is not logged in, Running is, and self carries its tailnet name.
const st = tailscaleStatus(JSON.stringify({ ...doc, BackendState: "NeedsLogin" }));
assert.equal(st?.state, "NeedsLogin");
assert.equal(st?.loggedIn, false);
assert.deepEqual(st?.self, { name: "desk", host: "desk.tail1234.ts.net", ip: "100.64.0.1" });
assert.equal(st?.peers.length, 3, "the peers ride along");
assert.equal(tailscaleStatus(JSON.stringify({ ...doc, BackendState: "Running" }))?.loggedIn, true);
assert.equal(tailscaleStatus("nope"), undefined);
assert.equal(
  loginUrlIn("To authenticate, visit:\n\n\thttps://login.tailscale.com/a/abc123DEF\n"),
  "https://login.tailscale.com/a/abc123DEF",
);
assert.equal(loginUrlIn("Access denied: checkprefs access denied"), undefined);

// A `wg show all dump`: the interface line is skipped, a peer's single allowed address is the
// host, the handshake age is seconds from now, and a peer with only a range has no host to dial.
const nowSec = 1_788_918_500;
const dump = [
  "wg0\tPRIV\tPUB\t51820\toff",
  "wg0\tPEER1\t(none)\t192.168.1.79:51820\t10.77.0.2/32\t1788918456\t1234\t5678\t25",
  "wg0\tPEER2\t(none)\t(none)\t10.77.1.0/24\t0\t0\t0\toff",
  "wg1\tPEER3\t(none)\t1.2.3.4:51820\t10.9.0.7/32,10.9.1.0/24\t0\t0\t0\toff",
].join("\n");
assert.deepEqual(wireguardPeers(dump, nowSec * 1000), [
  {
    iface: "wg0",
    host: "10.77.0.2",
    allowedIps: ["10.77.0.2/32"],
    endpoint: "192.168.1.79:51820",
    handshakeAge: 44,
  },
  {
    iface: "wg1",
    host: "10.9.0.7",
    allowedIps: ["10.9.0.7/32", "10.9.1.0/24"],
    endpoint: "1.2.3.4:51820",
    handshakeAge: null,
  },
]);
assert.deepEqual(wireguardPeers(""), []);

// The join fields: shape only (shq handles the shell); Tailscale's and Headscale's key forms both pass.
assert.deepEqual(validateTailnetJoin({}), { value: { loginServer: "", authKey: "" } });
assert.deepEqual(validateTailnetJoin({ loginServer: " http://192.168.1.194:8090 ", authKey: "" }), {
  value: { loginServer: "http://192.168.1.194:8090", authKey: "" },
});
assert.ok(validateTailnetJoin({ loginServer: "https://hs.example.com/" }).value);
assert.ok(validateTailnetJoin({ authKey: "tskey-auth-kAbC123CNTRL-x9y8z7w6v5u4t3s2r1q0" }).value);
assert.ok(
  validateTailnetJoin({
    authKey: "3f2a9c8b7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a",
  }).value,
);
assert.ok(
  validateTailnetJoin({ authKey: "abc+def/ghi=jkl.mno-pqr" }).value,
  "base64-ish keys pass",
);
assert.equal(
  validateTailnetJoin({ loginServer: "hs.example.com" }).error,
  "login server must be an http(s) URL",
);
assert.equal(
  validateTailnetJoin({ loginServer: "http://x; rm -rf /" }).error,
  "login server must be an http(s) URL",
);
assert.equal(
  validateTailnetJoin({ authKey: "short" }).error,
  "that does not look like a pre-auth key",
);
assert.equal(
  validateTailnetJoin({ authKey: "has spaces in it here" }).error,
  "that does not look like a pre-auth key",
);

console.log("reach ok");
