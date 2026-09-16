// Offline checks for the Claude Code updater: the pointer read and its cache, the settings reads, the file, the two predicates, and the class with a fake exec.
import assert from "node:assert/strict";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  latestClaude,
  forgetLatestClaude,
  installedClaude,
  channelFrom,
  offBy,
  lastLine,
  readUpdates,
  writeUpdates,
  newer,
  cardFor,
  ClaudeUpdater,
  type Exec,
  type ClaudeUpdateState,
  type ClaudeUpdateEntry,
} from "./claude-update.js";

const dir = await mkdtemp(join(tmpdir(), "omc-claude-update-"));

// A. latestClaude: cache, TTL, forget, junk answers, channel param.
{
  let calls = 0;
  const fetchFn = (async (url: string) => {
    calls++;
    assert.equal(url, "https://downloads.claude.ai/claude-code-releases/latest");
    // SAFETY: the reader only calls `ok` and `text()`; a whole Response is more than the check needs
    return { ok: true, text: async () => "2.1.274\n" } as Response;
  }) as typeof fetch;
  const t0 = 1_000_000;
  assert.equal(await latestClaude("latest", fetchFn, t0), "2.1.274");
  assert.equal(await latestClaude("latest", fetchFn, t0 + 60_000), "2.1.274");
  assert.equal(calls, 1, "second ask within the 30 min cache is served from memory");
  assert.equal(await latestClaude("latest", fetchFn, t0 + 31 * 60_000), "2.1.274");
  assert.equal(calls, 2, "after 31 minutes it reads again");

  forgetLatestClaude();
  calls = 0;
  const failFetch = (async () => {
    calls++;
    return { ok: false } as Response;
  }) as typeof fetch;
  assert.equal(await latestClaude("latest", failFetch, t0), undefined);
  assert.equal(await latestClaude("latest", failFetch, t0 + 30 * 60_000), undefined);
  assert.equal(calls, 1, "failed read cached for an hour: no new read at 30 min");
  assert.equal(await latestClaude("latest", failFetch, t0 + 61 * 60_000), undefined);
  assert.equal(calls, 2, "after an hour a new read is attempted");

  forgetLatestClaude();
  const junkFetch = (async () => {
    return { ok: true, text: async () => "not a version" } as Response;
  }) as typeof fetch;
  assert.equal(await latestClaude("latest", junkFetch, t0), undefined);

  forgetLatestClaude();
  calls = 0;
  const stableFetch = (async (url: string) => {
    calls++;
    assert.equal(url.split("/").pop(), "stable");
    return { ok: true, text: async () => "2.1.274\n" } as Response;
  }) as typeof fetch;
  assert.equal(await latestClaude("stable", stableFetch, t0), "2.1.274");
}

// B. installedClaude: happy path, not-found binary, arg verification.
{
  const execCalls: { args: string[]; timeoutMs: number }[] = [];
  const exec: Exec = async (args, timeoutMs) => {
    execCalls.push({ args, timeoutMs });
    if (args[0] === "--version") return { out: "2.1.273 (Claude Code)\n" };
    return { out: "" };
  };
  assert.equal(await installedClaude(exec), "2.1.273");
  const notFoundExec: Exec = async () => ({ out: "", error: "not found" });
  assert.equal(await installedClaude(notFoundExec), null);
  assert.deepEqual(execCalls, [{ args: ["--version"], timeoutMs: 8000 }]);
}

// C. channelFrom: defaults and recognised values; junk falls back to latest.
assert.equal(channelFrom(undefined), "latest");
assert.equal(channelFrom("{"), "latest");
assert.equal(channelFrom('{"autoUpdatesChannel":"stable"}'), "stable");
assert.equal(channelFrom('{"autoUpdatesChannel":"rc"}'), "rc");
assert.equal(channelFrom('{"autoUpdatesChannel":"nightly"}'), "latest");
assert.equal(channelFrom("[]"), "latest");

// D. offBy: env wins, then settings nested env; number is not a string; wrong shape is ignored.
assert.equal(offBy({}, undefined), undefined);
assert.equal(offBy({ DISABLE_AUTOUPDATER: "1" }, undefined), "DISABLE_AUTOUPDATER");
assert.equal(
  offBy({ DISABLE_UPDATES: "true", DISABLE_AUTOUPDATER: "1" }, undefined),
  "DISABLE_UPDATES",
);
assert.equal(offBy({ DISABLE_AUTOUPDATER: "0" }, undefined), undefined);
assert.equal(offBy({ DISABLE_AUTOUPDATER: " Yes " }, undefined), "DISABLE_AUTOUPDATER");
assert.equal(offBy({}, '{"env":{"DISABLE_AUTOUPDATER":"on"}}'), "DISABLE_AUTOUPDATER");
assert.equal(offBy({}, '{"env":{"DISABLE_AUTOUPDATER":1}}'), undefined);
assert.equal(offBy({}, '{"env":"x"}'), undefined);

// E. lastLine: last non-empty line of out, then error; capped at 200 chars.
assert.equal(lastLine("a\nb\n\n", undefined), "b");
assert.equal(lastLine("", "err line 1\nerr line 2\n"), "err line 2");
assert.equal(lastLine("", ""), undefined);
assert.equal(lastLine("x".repeat(300), undefined)?.length, 200);

// F. readUpdates / writeUpdates: missing file, round-trip, cross-box isolation, chain serialisation, truncation, malformed JSON, array root.
{
  assert.deepEqual(await readUpdates(dir, "this-box"), { log: [] });

  const e1: ClaudeUpdateEntry = {
    at: 1,
    from: "2.1.273",
    to: "2.1.274",
    by: "button",
    ok: true,
  };
  await writeUpdates(dir, "this-box", { auto: true, skipped: "2.1.274", log: [e1] });
  assert.deepEqual(await readUpdates(dir, "this-box"), {
    auto: true,
    skipped: "2.1.274",
    log: [e1],
  });

  const e2: ClaudeUpdateEntry = { at: 2, from: "2.1.274", to: "2.1.275", by: "auto", ok: true };
  await writeUpdates(dir, "lilly", { log: [e2] });
  assert.deepEqual(await readUpdates(dir, "this-box"), {
    auto: true,
    skipped: "2.1.274",
    log: [e1],
  });

  const wA = writeUpdates(dir, "a", { log: [e1] });
  const wB = writeUpdates(dir, "b", { log: [e2] });
  await Promise.all([wA, wB]);
  assert.deepEqual(await readUpdates(dir, "a"), { log: [e1] });
  assert.deepEqual(await readUpdates(dir, "b"), { log: [e2] });

  const sixty = Array.from({ length: 60 }, (_, i) => ({
    at: i + 1,
    from: null,
    to: null,
    by: "auto" as const,
    ok: true,
  }));
  await writeUpdates(dir, "many", { log: sixty });
  const manyResult = await readUpdates(dir, "many");
  assert.equal(manyResult.log.length, 50);
  assert.equal(manyResult.log[0]!.at, 11);

  const badFile = JSON.stringify({
    "this-box": {
      log: [{ at: 1, from: null, to: "2.1.1", by: "auto", ok: true }, { at: "bad" }],
      auto: "yes",
      skipped: "nope",
    },
  });
  await writeFile(join(dir, "claude-updates.json"), badFile);
  assert.deepEqual(await readUpdates(dir, "this-box"), {
    log: [{ at: 1, from: null, to: "2.1.1", by: "auto", ok: true }],
  });

  await writeFile(join(dir, "claude-updates.json"), "[]");
  assert.deepEqual(await readUpdates(dir, "this-box"), { log: [] });
}

// G. newer / cardFor: baseline, undefined state, off knob, no latest, null installed, same version, skipped, auto.
{
  const base: ClaudeUpdateState = {
    host: "",
    label: "this box",
    installed: "2.1.273",
    latest: "2.1.274",
    channel: "latest",
    busy: false,
    auto: false,
    log: [],
  };
  assert.equal(newer(base), true);
  assert.equal(newer(undefined), false);
  assert.equal(newer({ ...base, off: "DISABLE_UPDATES" }), false);
  assert.equal(newer({ ...base, latest: undefined }), false);
  assert.equal(newer({ ...base, installed: null }), false);
  assert.equal(newer({ ...base, latest: "2.1.273" }), false);

  assert.deepEqual(cardFor(base), {
    host: "",
    label: "this box",
    installed: "2.1.273",
    latest: "2.1.274",
  });
  assert.equal(cardFor(undefined), null);
  assert.equal(cardFor({ ...base, skipped: "2.1.274" }), null);
  assert.notEqual(cardFor({ ...base, skipped: "2.1.270" }), null);
  assert.equal(cardFor({ ...base, auto: true }), null);
}

// H. ClaudeUpdater: check, settings-driven off/channel, setAuto, skip, concurrent runs, declined run, throwing exec.
{
  const dir2 = await mkdtemp(join(tmpdir(), "omc-claude-update-"));
  let version = "2.1.273";
  const execCalls: string[][] = [];
  let fetchCallCount = 0;

  const exec: Exec = async (args, _timeoutMs) => {
    execCalls.push(args);
    if (args[0] === "--version") return { out: `${version} (Claude Code)\n` };
    if (args[0] === "update") {
      version = "2.1.274";
      return { out: "Successfully updated to version 2.1.274\n" };
    }
    return { out: "" };
  };

  const fetchFn = (async (_url: string) => {
    fetchCallCount++;
    return { ok: true, text: async () => "2.1.274\n" } as Response;
  }) as typeof fetch;

  const updated: string[] = [];
  const u = new ClaudeUpdater({
    dir: dir2,
    host: "",
    label: "this box",
    settingsPath: join(dir2, "settings.json"),
    env: {},
    exec,
    fetchFn,
    now: () => 5_000,
    onUpdated: (host) => {
      updated.push(host);
    },
  });

  const state = await u.check();
  assert.equal(state.installed, "2.1.273");
  assert.equal(state.latest, "2.1.274");
  assert.equal(state.channel, "latest");
  assert.equal(state.off, undefined);
  assert.equal(state.checkedAt, 5000);
  assert.equal(state.busy, false);
  assert.equal(state.auto, false);
  assert.ok(
    execCalls.some((a) => a[0] === "--version"),
    "exec called --version",
  );
  assert.ok(!execCalls.some((a) => a[0] === "update"), "check never installs");

  await writeFile(
    join(dir2, "settings.json"),
    '{"autoUpdatesChannel":"stable","env":{"DISABLE_UPDATES":"1"}}',
  );
  forgetLatestClaude();
  fetchCallCount = 0;
  const state2 = await u.check();
  assert.equal(state2.off, "DISABLE_UPDATES");
  assert.equal(state2.channel, "stable");
  assert.equal(state2.latest, undefined);
  assert.equal(fetchCallCount, 0, "fetch not called when off");

  await unlink(join(dir2, "settings.json"));
  forgetLatestClaude();
  const state3 = await u.check();
  assert.equal(state3.latest, "2.1.274", "latest is back after forgetting cache");

  await u.setAuto(true);
  assert.equal(u.state().auto, true);
  const recAfterSetTrue = await readUpdates(dir2, "this-box");
  assert.equal(recAfterSetTrue.auto, true);

  await u.setAuto(false);
  const recAfterSetFalse = await readUpdates(dir2, "this-box");
  assert.equal("auto" in recAfterSetFalse, false);

  await u.skip("nope");
  assert.equal(u.state().skipped, undefined);
  await u.skip("2.1.274");
  assert.equal(u.state().skipped, "2.1.274");
  assert.equal(cardFor(u.state()), null);

  const p1 = u.runUpdate("button");
  const p2 = u.runUpdate("auto");
  assert.equal(p1 === p2, true, "concurrent calls share the same promise");
  await Promise.resolve();
  assert.equal(u.state().busy, true);
  const entry = await p1;
  assert.equal(u.state().busy, false);
  assert.equal(u.state().installed, "2.1.274");
  assert.deepEqual(entry, {
    at: 5000,
    from: "2.1.273",
    to: "2.1.274",
    by: "button",
    ok: true,
    note: "Successfully updated to version 2.1.274",
  });
  assert.equal(execCalls.filter((a) => a[0] === "update").length, 1);
  assert.deepEqual(updated, [""]);
  const logAfterRun = await readUpdates(dir2, "this-box");
  assert.equal(logAfterRun.log.length, 1);
  assert.equal(cardFor(u.state()), null);

  // Declined run: exec says up to date, pointer is newer.
  version = "2.1.273";
  const declinedExec: Exec = async (args, _timeoutMs) => {
    execCalls.push(args);
    if (args[0] === "--version") return { out: `${version} (Claude Code)\n` };
    if (args[0] === "update") {
      return { out: "", error: "Claude is up to date!\n" };
    }
    return { out: "" };
  };
  const declinedFetch = (async () => {
    return { ok: true, text: async () => "2.1.275\n" } as Response;
  }) as typeof fetch;
  const u2 = new ClaudeUpdater({
    dir: dir2,
    host: "",
    label: "this box",
    settingsPath: join(dir2, "settings.json"),
    env: {},
    exec: declinedExec,
    fetchFn: declinedFetch,
    now: () => 5_000,
    onUpdated: (host) => {
      updated.push(host);
    },
  });
  forgetLatestClaude();
  await u2.check();
  assert.equal(u2.state().latest, "2.1.275");
  await u2.skip("2.1.270");
  assert.equal(u2.state().skipped, "2.1.270");
  const e = await u2.runUpdate("auto");
  assert.equal(e.ok, false);
  assert.equal(e.to, "2.1.273");
  assert.equal(e.note, "Claude is up to date!");
  assert.equal(u2.state().skipped, "2.1.275");
  assert.equal(updated.length, 1, "declined run does not call onUpdated");
  assert.equal(cardFor(u2.state()), null);

  // Throwing exec: busy clears, next call is a fresh promise.
  const boomExec: Exec = async (args, _timeoutMs) => {
    execCalls.push(args);
    if (args[0] === "update") throw new Error("boom");
    return { out: `${version} (Claude Code)\n` };
  };
  const u3 = new ClaudeUpdater({
    dir: dir2,
    host: "",
    label: "this box",
    settingsPath: join(dir2, "settings.json"),
    env: {},
    exec: boomExec,
    fetchFn: declinedFetch,
    now: () => 5_000,
  });
  await u3.check();
  const boomPromise = u3.runUpdate("button");
  let boomRejected = false;
  try {
    await boomPromise;
  } catch {
    boomRejected = true;
  }
  assert.equal(boomRejected, true);
  assert.equal(u3.state().busy, false);
  await Promise.resolve();
  const fresh = u3.runUpdate("button");
  assert.notEqual(fresh, boomPromise, "a following call is a new promise");
  // The fresh promise also rejects; handle it to avoid an unhandled rejection.
  await assert.rejects(() => fresh);
}

console.log("ok claude-update");
