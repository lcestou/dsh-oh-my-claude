// Offline self-check: bun src/stars.test.ts. Fake fetch, no network.
import assert from "node:assert/strict";
import { forgetStars, stargazerCount, stars, REPO_URL, STAR_REPO } from "./stars.js";

// The count off the repo JSON: a real count is returned, zero is a real count, and anything else
// is treated as no count.
assert.equal(stargazerCount('{"stargazers_count":3}'), 3);
assert.equal(
  stargazerCount('{"stargazers_count":0}'),
  0,
  "zero is a real answer, not a missing one",
);
assert.equal(stargazerCount('{"stargazers_count":-1}'), undefined, "a negative is missing");
assert.equal(stargazerCount('{"stargazers_count":1.5}'), undefined, "a fraction is missing");
assert.equal(stargazerCount('{"message":"Not Found"}'), undefined, "an error document is missing");
assert.equal(stargazerCount("not json"), undefined, "non-JSON is missing");

// A successful read is cached for a day; a second ask, even with a fetch that throws, is served
// from memory and never calls the fetch again.
{
  forgetStars();
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    // SAFETY: the reader only calls `ok` and `text()`; a whole Response is more than the check needs
    return { ok: true, text: async () => '{"stargazers_count":7}' } as Response;
  }) as typeof fetch;
  const boom = (async () => {
    throw new Error("ENOTFOUND");
  }) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await stars(fetchFn, t0), 7);
  assert.equal(await stars(boom, t0 + 1000), 7, "served from memory, the throw never runs");
  assert.equal(calls, 1, "the second ask never called the fetch");
}

// The r.ok guard: a rate-limiter error body is not parsed, so 99 is not believed.
{
  forgetStars();
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: false, text: async () => '{"stargazers_count":99}' } as Response;
  }) as typeof fetch;
  assert.equal(await stars(fetchFn, 1_000_000), undefined, "a non-ok response is a miss");
  assert.equal(calls, 1);
}

// A fetch that throws (offline) is swallowed, not rejected.
{
  forgetStars();
  const boom = (async () => {
    throw new Error("ENOTFOUND");
  }) as typeof fetch;
  assert.equal(await stars(boom, 1_000_000), undefined);
}

// A miss is retried after an hour, not on every open: an hour and a second later reads again.
{
  forgetStars();
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: false, text: async () => '{"message":"Not Found"}' } as Response;
  }) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await stars(fetchFn, t0), undefined);
  assert.equal(calls, 1);
  assert.equal(await stars(fetchFn, t0 + 60 * 60_000 + 1000), undefined);
  assert.equal(calls, 2, "a miss is retried after an hour");
}

// A repo with no stars yet is a real answer, and it must be cached as one. Reading the count for
// truthiness instead of presence would file zero as a failed read and ask GitHub again every hour.
{
  forgetStars();
  let calls = 0;
  const fetchFn = (async () => {
    calls++;
    return { ok: true, text: async () => '{"stargazers_count":0}' } as Response;
  }) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await stars(fetchFn, t0), 0);
  assert.equal(await stars(fetchFn, t0 + 2 * 60 * 60_000), 0, "still cached two hours later");
  assert.equal(calls, 1, "zero was cached as a hit, not retried as a miss");
}

// REPO_URL is the link the Settings line points at, and it names the same repo the count is read
// from; they are exported together so the two cannot drift apart.
assert.ok(REPO_URL.endsWith(STAR_REPO), "the link and the read name one repo");

console.log("ok stars");
