// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d /tmp/omc-test.XXXXXX) bun src/adapter/web-push.test.ts.
// The encryption is pinned to RFC 8291 Appendix A byte for byte; the token is checked by verifying
// its signature with the public key the browser would hold.
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { encryptPayload, newVapidKeys, vapidAuthorization, VAPID_SUBJECT } from "./web-push.js";

const b64u = (s: string): Buffer => Buffer.from(s, "base64url");

{
  const out = encryptPayload(
    Buffer.from("When I grow up, I want to be a watermelon"),
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    "BTBZMqHH6r4Tts7J_aSIgg",
    b64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    b64u("DGv6ra1nlYgDCS1FRnbzlw"),
  );

  assert.equal(
    out.subarray(0, 86).toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    "the RFC 8291 header: salt, record size 4096, sender key",
  );
  assert.equal(
    out.subarray(86).toString("base64url"),
    "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
    "the RFC 8291 ciphertext",
  );
}

{
  const keys = newVapidKeys();
  assert.equal(b64u(keys.publicKey).length, 65, "an uncompressed P-256 point");
  const header = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH", keys, 1_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, "the vapid t=…, k=… form");
  const [, head, claims, sig, k] = m;
  assert.equal(k, keys.publicKey, "k is the key the browser subscribed with");
  const body = JSON.parse(b64u(claims ?? "").toString());
  assert.deepEqual(
    body,
    { aud: "https://web.push.apple.com", exp: 1000 + 12 * 3600, sub: VAPID_SUBJECT },
    "aud is the endpoint's origin, never its path",
  );

  const pub = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: keys.privateJwk.x, y: keys.privateJwk.y },
    format: "jwk",
  });

  assert.ok(
    verify(
      "sha256",
      Buffer.from(`${head}.${claims}`),
      { key: pub, dsaEncoding: "ieee-p1363" },
      b64u(sig ?? ""),
    ),
    "the ES256 signature verifies in raw r||s form",
  );
}

console.log("web-push ok");
