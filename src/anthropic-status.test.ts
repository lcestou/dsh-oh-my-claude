// Offline self-check: bun src/anthropic-status.test.ts. Fake fetch, no network.
import { strict as assert } from "node:assert";
import { anthropicStatus, degradedNote, forgetStatus, peekStatus } from "./anthropic-status.js";

const makeFetch = (doc: unknown, status = 200) => {
  let calls = 0;
  return async (_url: string, _init: { signal: AbortSignal }) => {
    calls += 1;
    return new Response(JSON.stringify(doc), { status });
  };
};

// a `minor` document with description "Degraded performance" gives the right shape and note
{
  forgetStatus();
  const now = Date.now();
  const fetchFn = makeFetch({
    status: { indicator: "minor", description: "Degraded performance" },
  });
  const val = await anthropicStatus(fetchFn, now);
  assert.deepEqual(val, { indicator: "minor", description: "Degraded performance" });
  assert.equal(degradedNote(val!), " · Anthropic reports Degraded performance");
}

// a `none` document gives an empty degradedNote
{
  forgetStatus();
  const now = Date.now();
  const fetchFn = makeFetch({
    status: { indicator: "none", description: "All systems operational" },
  });
  const val = await anthropicStatus(fetchFn, now);
  assert.deepEqual(val, { indicator: "none", description: "All systems operational" });
  assert.equal(degradedNote(val!), "");
}

// cache: second call at now + 30_000 does not fetch again; at now + 61_000 does
{
  forgetStatus();
  const now = Date.now();
  let calls = 0;
  const fetchFn = async (_url: string, _init: { signal: AbortSignal }) => {
    calls += 1;
    return new Response(
      JSON.stringify({ status: { indicator: "minor", description: "Degraded" } }),
      {
        status: 200,
      },
    );
  };
  await anthropicStatus(fetchFn, now);
  assert.equal(calls, 1);
  await anthropicStatus(fetchFn, now + 30_000);
  assert.equal(calls, 1);
  await anthropicStatus(fetchFn, now + 61_000);
  assert.equal(calls, 2);
}

// a 503 response caches undefined: second call at now + 60_000 keeps count; at now + 5*60_000 + 1 fetches again
{
  forgetStatus();
  const now = Date.now();
  let calls = 0;
  const fetchFn = async (_url: string, _init: { signal: AbortSignal }) => {
    calls += 1;
    return new Response(JSON.stringify({}), { status: 503 });
  };
  await anthropicStatus(fetchFn, now);
  assert.equal(calls, 1);
  await anthropicStatus(fetchFn, now + 60_000);
  assert.equal(calls, 1);
  await anthropicStatus(fetchFn, now + 5 * 60_000 + 1);
  assert.equal(calls, 2);
}

// a fetch that rejects answers undefined without throwing
{
  forgetStatus();
  const now = Date.now();
  const fetchFn = async () => {
    throw new Error("nope");
  };
  const val = await anthropicStatus(fetchFn, now);
  assert.equal(val, undefined);
}

// peekStatus answers the cached value while fresh, undefined after TTL, and after forgetStatus
{
  forgetStatus();
  const now = Date.now();
  const fetchFn = makeFetch({ status: { indicator: "major", description: "Partial" } });
  await anthropicStatus(fetchFn, now);
  assert.deepEqual(peekStatus(now), { indicator: "major", description: "Partial" });
  assert.equal(peekStatus(now + 61_000), undefined);
  forgetStatus();
  assert.equal(peekStatus(now), undefined);
}

// two concurrent calls with no cache share one fetch (count 1)
{
  forgetStatus();
  const now = Date.now();
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 50));
    return new Response(
      JSON.stringify({ status: { indicator: "critical", description: "Down" } }),
      {
        status: 200,
      },
    );
  };
  const [a, b] = await Promise.all([anthropicStatus(fetchFn, now), anthropicStatus(fetchFn, now)]);
  assert.deepEqual(a, { indicator: "critical", description: "Down" });
  assert.deepEqual(b, { indicator: "critical", description: "Down" });
  assert.equal(calls, 1);
}

console.log("anthropic status ok");
