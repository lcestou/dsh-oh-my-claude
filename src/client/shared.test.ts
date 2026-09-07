// Offline self-check for the login mask: every surface that names the account runs through it.
import assert from "node:assert/strict";
import { maskEmail } from "./shared.js";

assert.equal(maskEmail("me@example.com"), "m*****@gmail.com");
// Never fewer than three stars, so a short local part does not leak its length.
assert.equal(maskEmail("ab@x.io"), "a***@x.io");
// Not an address: the placeholders these callers pass through are left alone.
assert.equal(maskEmail("logged in"), "logged in");
assert.equal(maskEmail("@host"), "@host");
assert.equal(maskEmail(""), "");

console.log("✓ All login mask checks pass");
