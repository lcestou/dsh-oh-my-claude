/** The box's VAPID identity. `publicKey` is the 65-byte uncompressed P-256 point, base64url, the
 *  form `pushManager.subscribe` takes as `applicationServerKey`; `privateJwk` never leaves the box. */
export interface VapidKeys {
    publicKey: string;
    privateJwk: JsonWebKey;
}
/** Who to contact about this sender, as the push services ask for. Apple's service refuses a token
 *  whose `sub` is neither `mailto:` nor `https:`, so this is the plugin's own page: it names no one
 *  on the box and is the same on every install. */
export declare const VAPID_SUBJECT = "https://github.com/lcestou/dsh-oh-my-claude";
/** A fresh P-256 pair for one box. Called once, the first time a device subscribes; changing the
 *  pair later orphans every subscription made with the old public key. */
export declare function newVapidKeys(): VapidKeys;
/**
 * The `Authorization` header for one push to `endpoint`: a JWT for the endpoint's origin, valid
 * twelve hours (the services cap it at 24), signed ES256 with the signature in the raw r||s form JWT
 * wants rather than node's default DER. Throws when `endpoint` is not a URL.
 */
export declare function vapidAuthorization(endpoint: string, keys: VapidKeys, now?: number): string;
/**
 * Encrypt `plain` for one subscription as a single aes128gcm record (RFC 8291 section 3.4).
 * `p256dh` and `auth` are the subscription's keys as the browser hands them over (base64url).
 * `sender` and `salt` exist for the RFC test vector; every real send leaves both out so each
 * message gets a fresh key and salt. A body over 4096 bytes is refused by the push service, not
 * here: the caller keeps its payload small.
 */
export declare function encryptPayload(plain: Buffer, p256dh: string, auth: string, sender?: Buffer, salt?: Buffer): Buffer;
