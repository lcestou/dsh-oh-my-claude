import { strict as assert } from "node:assert";
import {
  PROBE_TTL_MS,
  ProbeBody,
  firstPartyKnown,
  firstPartyMode,
  firstPartyOf,
  forgetFirstParty,
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

// What CC Switch 4.0.29's local router answers the same probe (HTTP 400, recorded 2026-11-10 with
// routing on): its own refusal of the empty body, with no top-level `type` and no request id.
// The model list treats a box behind it as routed on the strength of this reading; if a release
// of the router starts answering in Anthropic's shape, this is where it shows.
const CC_SWITCH_400 = {
  error: {
    type: "invalid_request_error",
    message: "messages must be a non-empty list: send at least one message",
  },
};
assert.equal(readsAsAnthropic(ProbeBody(CC_SWITCH_400), ""), false);

// The kept answers, per URL. A probe that counts its calls and answers what it is told to.
{
  forgetFirstParty();
  const url = "http://127.0.0.1:15721";
  let calls = 0;
  let answer: boolean | undefined = false;
  const probe = async () => {
    calls++;
    return answer;
  };
  // Real time: the store stamps an answer with the clock, and `now` is only what it is read at.
  const t0 = Date.now();
  // A turn waits for the first answer, then reads the kept one for a while.
  assert.equal(await firstPartyOf(url, probe, t0), false);
  assert.equal(await firstPartyOf(url, probe, t0 + 1000), false);
  assert.equal(calls, 1, "one request per URL while the answer is fresh");
  // Another URL is its own question.
  answer = true;
  assert.equal(await firstPartyOf("http://127.0.0.1:8787", probe, t0), true);
  assert.equal(calls, 2);
  // Past the TTL the old answer is returned at once and the endpoint is asked behind the caller.
  const late = t0 + 2 * PROBE_TTL_MS;
  assert.equal(await firstPartyOf(url, probe, late), false, "stale answer, no wait");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 3);

  // A listing never waits. Nothing kept: undefined now, and `changed` once the answer lands.
  forgetFirstParty();
  calls = 0;
  answer = false;
  let changed = 0;
  assert.equal(
    firstPartyKnown(url, () => changed++, probe, t0),
    undefined,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changed, 1, "the first answer is a change from not knowing");
  assert.equal(
    firstPartyKnown(url, () => changed++, probe, t0 + 1),
    false,
  );
  assert.equal(calls, 1, "a fresh answer asks nothing");
  // Asked again when old; the same answer back is not a change, so the listing is not redone.
  assert.equal(
    firstPartyKnown(url, () => changed++, probe, late),
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 2);
  assert.equal(changed, 1);
  // The endpoint stops answering: the kept answer is dropped and the listing is told.
  answer = undefined;
  assert.equal(
    firstPartyKnown(url, () => changed++, probe, t0 + 4 * PROBE_TTL_MS),
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changed, 2);
  assert.equal(
    firstPartyKnown(url, () => changed++, probe, Date.now()),
    undefined,
    "an endpoint that went quiet is no longer known",
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(changed, 2, "still unanswered is not a change");
  forgetFirstParty();
}

console.log("first-party.test: ok");
