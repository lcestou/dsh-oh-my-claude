// Offline self-check: bun src/update.test.ts. Fake fetch, no network.
import assert from "node:assert/strict";
import { forgetLatest, isNewer, latestVersion, profileFromPath, updateCommand } from "./update.js";

// Version order: numbers first, then a release beats its own prerelease; junk is never newer.
assert.equal(isNewer("1.0.0", "1.0.1"), true);
assert.equal(isNewer("1.0.0", "1.1.0"), true);
assert.equal(isNewer("1.9.9", "2.0.0"), true);
assert.equal(isNewer("1.0.1", "1.0.0"), false);
assert.equal(isNewer("1.0.0", "1.0.0"), false);
assert.equal(isNewer("1.0.0-rc.1", "1.0.0"), true, "release after its prerelease");
assert.equal(isNewer("1.0.0", "1.0.0-rc.2"), false, "a prerelease of the same is not newer");
assert.equal(isNewer("1.0.0", "1.0.1-rc.1"), true, "a prerelease of a later patch is newer");
assert.equal(isNewer("1.0.0", "latest"), false);
assert.equal(isNewer("", "1.0.1"), false);
assert.equal(isNewer("1.0.0", "v1.0.1"), true, "a leading v is tolerated");

// The profile comes off the install path; a linked checkout falls back.
assert.equal(
  profileFromPath("file:///home/u/.dsh/profiles/web/node_modules/dsh-oh-my-claude/lib/server/x.js"),
  "web",
);
assert.equal(
  profileFromPath("file:///home/u/.dsh/profiles/lab-2/node_modules/dsh-oh-my-claude/lib/x.js"),
  "lab-2",
);
assert.equal(profileFromPath("file:///home/u/Projects/oh-my-claude/lib/server/x.js"), "web");
assert.equal(
  updateCommand("dsh-oh-my-claude", "web"),
  "dsh plugin --profile web update dsh-oh-my-claude",
);

// The registry read: one call per day per name, an hour after a failure, never a throw.
{
  forgetLatest();
  let calls = 0;
  let reply: { ok: boolean; body: unknown } = { ok: true, body: { version: "1.0.1" } };
  const fetchFn = (async (url: string) => {
    calls++;
    assert.equal(url, "https://registry.npmjs.org/dsh-oh-my-claude/latest");
    // SAFETY: the reader only calls `ok` and `text()`; a whole Response is more than the check needs
    return { ok: reply.ok, text: async () => JSON.stringify(reply.body) } as Response;
  }) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0), "1.0.1");
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0 + 60_000), "1.0.1");
  assert.equal(calls, 1, "second ask within the day is served from memory");
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0 + 25 * 3_600_000), "1.0.1");
  assert.equal(calls, 2, "a day later it reads again");

  // A failed read is remembered for an hour, not a day.
  forgetLatest();
  calls = 0;
  reply = { ok: false, body: {} };
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0), undefined);
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0 + 30 * 60_000), undefined);
  assert.equal(calls, 1);
  reply = { ok: true, body: { version: "1.0.2" } };
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0 + 61 * 60_000), "1.0.2");
  assert.equal(calls, 2);

  // The real document has more before `version`; the first "version" key is still the top one.
  forgetLatest();
  reply = {
    ok: true,
    body: {
      _id: "dsh-oh-my-claude@1.0.3",
      name: "dsh-oh-my-claude",
      version: "1.0.3",
      dependencies: { x: "^1.0.0" },
    },
  };
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0), "1.0.3");

  // A registry answer that is not a version is treated as no answer.
  forgetLatest();
  reply = { ok: true, body: { version: "next" } };
  assert.equal(await latestVersion("dsh-oh-my-claude", fetchFn, t0), undefined);

  // A fetch that throws (offline) is swallowed.
  forgetLatest();
  const boom = (async () => {
    throw new Error("ENOTFOUND");
  }) as typeof fetch;
  assert.equal(await latestVersion("dsh-oh-my-claude", boom, t0), undefined);
}

console.log("ok update");
