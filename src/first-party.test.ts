import { strict as assert } from "node:assert";
import {
  ProbeBody,
  firstPartyMode,
  probeFirstParty,
  readsAsAnthropic,
  wantsFirstParty,
} from "./first-party.js";

// The 401 a proxy that forwards hands back, recorded from headroom and from api.anthropic.com on
// 2026-09-17: the same body, down to the request id's shape.
const ANTHROPIC_401 = {
  type: "error",
  error: { type: "authentication_error", message: "x-api-key header is required" },
  request_id: "req_011Cf9Dpm9wp2wExYevgyKEs",
};

assert.equal(readsAsAnthropic(ProbeBody(ANTHROPIC_401), ""), true);
// The header alone answers it, which is what a proxy that rewrites the body still passes through.
assert.equal(readsAsAnthropic(ProbeBody({}), "req_011Cf9DpmX2NdPab62fkHhee"), true);
// The error shape with no id anywhere is the weakest yes, and still a yes.
assert.equal(
  readsAsAnthropic(ProbeBody({ type: "error", error: { type: "invalid_request_error" } }), ""),
  true,
);
// A gateway in front of another provider: neither the id nor the shape.
assert.equal(readsAsAnthropic(ProbeBody({ message: "Missing Authentication Token" }), ""), false);
assert.equal(readsAsAnthropic(ProbeBody({}), "8f3c-not-anthropic"), false);
assert.equal(readsAsAnthropic(ProbeBody({}), ""), false);

// The probe reads a real response object and asks the endpoint once.
{
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    return {
      json: async () => ANTHROPIC_401,
      headers: { get: () => null },
    };
  }) as unknown as typeof fetch;
  assert.equal(await probeFirstParty("http://127.0.0.1:8787", fake), true);
  // One request, and the path is appended without doubling the separator.
  assert.deepEqual(calls, ["http://127.0.0.1:8787/v1/messages"]);
  assert.deepEqual(
    (await probeFirstParty("http://127.0.0.1:8787/", fake), calls.at(-1)),
    "http://127.0.0.1:8787/v1/messages",
  );
}

// A refused connection is "not asked", not "not Anthropic".
{
  const fake = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  assert.equal(await probeFirstParty("http://127.0.0.1:9", fake), undefined);
}

// Absent keys are the default; each flag names its own answer.
assert.equal(firstPartyMode({}), "auto");
assert.equal(firstPartyMode({ proxyFirstParty: true }), "on");
assert.equal(firstPartyMode({ proxyFirstPartyOff: true }), "off");

// A choice outranks the endpoint, in both directions: detection never flips a chosen switch back.
assert.equal(wantsFirstParty({ proxyFirstPartyOff: true }, true), false);
assert.equal(wantsFirstParty({ proxyFirstParty: true }, false), true);
assert.equal(wantsFirstParty({ proxyFirstParty: true }, undefined), true);
// Auto follows the probe, and an unanswered probe leaves the flag off.
assert.equal(wantsFirstParty({}, true), true);
assert.equal(wantsFirstParty({}, false), false);
assert.equal(wantsFirstParty({}, undefined), false);

console.log("first-party.test: ok");
