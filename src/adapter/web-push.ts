// Web Push from node:crypto alone: the VAPID key pair, the ES256 token a push service checks, and
// the aes128gcm body a browser decrypts (RFC 8291 over RFC 8188). No npm package: the whole of it
// is one ECDH, three HKDF reads and one AES-GCM call, and `web-push.test.ts` pins it to the RFC's
// own test vector.
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

/** The box's VAPID identity. `publicKey` is the 65-byte uncompressed P-256 point, base64url, the
 *  form `pushManager.subscribe` takes as `applicationServerKey`; `privateJwk` never leaves the box. */
export interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

/** Who to contact about this sender, as the push services ask for. Apple's service refuses a token
 *  whose `sub` is neither `mailto:` nor `https:`, so this is the plugin's own page: it names no one
 *  on the box and is the same on every install. */
export const VAPID_SUBJECT = "https://github.com/lcestou/dsh-oh-my-claude";

/** A fresh P-256 pair for one box. Called once, the first time a device subscribes; changing the
 *  pair later orphans every subscription made with the old public key. */
export function newVapidKeys(): VapidKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pub = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(String(pub.x), "base64url"),
    Buffer.from(String(pub.y), "base64url"),
  ]);
  return {
    publicKey: point.toString("base64url"),
    privateJwk: privateKey.export({ format: "jwk" }),
  };
}

/** The two JSON parts of a VAPID token, before signing. */
type JwtPart = { typ: "JWT"; alg: "ES256" } | { aud: string; exp: number; sub: string };

/** One JWT part as base64url JSON. */
const jwtPart = (v: JwtPart): string => Buffer.from(JSON.stringify(v)).toString("base64url");

/**
 * The `Authorization` header for one push to `endpoint`: a JWT for the endpoint's origin, valid
 * twelve hours (the services cap it at 24), signed ES256 with the signature in the raw r||s form JWT
 * wants rather than node's default DER. Throws when `endpoint` is not a URL.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const head = jwtPart({ typ: "JWT", alg: "ES256" });
  const claims = jwtPart({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  });
  const key = createPrivateKey({ key: keys.privateJwk, format: "jwk" });
  const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${sig.toString("base64url")}, k=${keys.publicKey}`;
}

/**
 * Encrypt `plain` for one subscription as a single aes128gcm record (RFC 8291 section 3.4).
 * `p256dh` and `auth` are the subscription's keys as the browser hands them over (base64url).
 * `sender` and `salt` exist for the RFC test vector; every real send leaves both out so each
 * message gets a fresh key and salt. A body over 4096 bytes is refused by the push service, not
 * here: the caller keeps its payload small.
 */
export function encryptPayload(
  plain: Buffer,
  p256dh: string,
  auth: string,
  sender?: Buffer,
  salt: Buffer = randomBytes(16),
): Buffer {
  const uaPublic = Buffer.from(p256dh, "base64url");
  const ecdh = createECDH("prime256v1");
  if (sender) ecdh.setPrivateKey(sender);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, Buffer.from(auth, "base64url"), keyInfo, 32));
  const derive = (info: string, len: number) =>
    Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from(`Content-Encoding: ${info}\0`), len));
  const cipher = createCipheriv("aes-128-gcm", derive("aes128gcm", 16), derive("nonce", 12));
  // 0x02 marks the last (and only) record; no padding beyond it.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}
