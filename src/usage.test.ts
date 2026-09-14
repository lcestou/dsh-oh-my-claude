import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageCredits } from "./usage.js";
import { extraUsageOn, readUsage, stillLimitedUntil, usageCredits, usageWindows } from "./usage.js";

// limits shape: session + weekly + scoped model rows, a repeated kind taking the first only.
// `is_active` is deliberately not a filter: the endpoint sends false for windows that are running,
// so a row carrying it false is read like any other.
const w = usageWindows({
  limits: [
    { kind: "session", percent: 34.4, resets_at: "2026-09-05T12:00:00Z", is_active: false },
    { kind: "weekly_all", percent: 12, resets_at: 1_800_000_000, is_active: false },
    {
      kind: "weekly_scoped",
      percent: 140,
      is_active: true,
      scope: { model: { display_name: "Opus" } },
    },
    { kind: "weekly_scoped", percent: 5, is_active: false, scope: { surface: "code" } },
    { kind: "session", percent: 99 },
    { kind: "opus_daily", percent: 7, resets_at: null },
  ],
});
assert.deepEqual(
  w.map((x) => [x.label, x.usedPercent, x.resetsAt]),
  [
    ["5-hour", 34.4, Date.parse("2026-09-05T12:00:00Z")],
    ["Weekly", 12, 1_800_000_000_000],
    ["Opus weekly", 100, null],
    ["code weekly", 5, null],
    ["Opus daily", 7, null],
  ],
);
// legacy shape
assert.deepEqual(usageWindows({ five_hour: { utilization: 50, resets_at: null }, seven_day: {} }), [
  { label: "5-hour", usedPercent: 50, resetsAt: null },
]);
assert.deepEqual(usageWindows(null), []);
assert.deepEqual(usageWindows({ limits: "nope" }), []);

// A fake login in a scratch home, so these reads never touch this box's own credentials: with the
// box logged out they stopped at "needs a Claude Code login" before the fake fetch was ever called.
const home = mkdtempSync(join(tmpdir(), "omc-usage-"));
writeFileSync(
  join(home, ".credentials.json"),
  JSON.stringify({
    claudeAiOauth: { accessToken: "sk-ant-test", expiresAt: Date.now() + 3_600_000 },
  }),
);

// readUsage never throws
const dead = await readUsage(async () => {
  throw new Error("ECONNREFUSED");
}, home);
assert.equal(dead.ok, false);

// a 429 surfaces retryAfterMs from the header (seconds), so the route can back off
const limited = await readUsage(
  async () => ({
    status: 429,
    headers: { get: (n: string) => (n === "retry-after" ? "120" : null) },
    json: async () => ({}),
  }),
  home,
);
assert.equal(limited.ok, false);
assert.equal(limited.ok === false && limited.retryAfterMs, 120_000);

// a 429 with no header still backs off at the floor (60s), never 0
const noHeader = await readUsage(async () => ({ status: 429, json: async () => ({}) }), home);
assert.equal(noHeader.ok === false && noHeader.retryAfterMs, 60_000);

// still at the cap: the latest reset among full windows; nothing when all have room, expired, or unreadable
{
  const now = 1_000_000;
  const win = (usedPercent: number, resetsAt: number | null) => ({
    label: "w",
    usedPercent,
    resetsAt,
  });
  const ok = (windows: any[]) => ({ ok: true as const, fetchedAt: now, windows });
  assert.equal(
    stillLimitedUntil(ok([win(100, now + 5_000), win(100, now + 9_000)]), now),
    now + 9_000,
  );
  assert.equal(stillLimitedUntil(ok([win(99, now + 5_000)]), now), undefined);
  assert.equal(stillLimitedUntil(ok([win(100, now - 1)]), now), undefined);
  assert.equal(stillLimitedUntil(ok([win(100, null)]), now), undefined);
  assert.equal(stillLimitedUntil({ ok: false, error: "x" }, now), undefined);
  assert.equal(
    stillLimitedUntil({ ...ok([win(100, now + 5_000)]), extraUsage: true }, now),
    undefined,
  );
  assert.equal(
    extraUsageOn({ extra_usage: { is_enabled: true, spend_limit_reached: false } }),
    true,
  );
  assert.equal(
    extraUsageOn({ extra_usage: { is_enabled: true, spend_limit_reached: true } }),
    false,
  );
  assert.equal(extraUsageOn({ extra_usage: { is_enabled: false, user_disabled: true } }), false);
  assert.equal(extraUsageOn({}), false);
  console.log("still-limited ok");
}

// credits, as the ✻ popover row reads them
{
  const disclaimer =
    "Usage credits cover you when you hit your plan limits. [Learn more](https://support.claude.com/articles/12429409)";
  // the live payload with credits off: zero spent, no limit, purchase not offered
  const off: UsageCredits = usageCredits({
    extra_usage: {
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      user_disabled: true,
      spend_limit_reached: false,
      credits_ever_enabled: true,
    },
    spend: {
      used: { amount_minor: 0, currency: "USD", exponent: 2 },
      limit: null,
      percent: 0,
      severity: "normal",
      enabled: false,
      cap: null,
      disclaimer,
      can_purchase_credits: false,
      can_toggle: false,
    },
  });
  assert.deepEqual(off, { enabled: false, capped: false, canPurchase: false, note: disclaimer });

  // on with a cap: both amounts formatted from the payload's own currency and exponent
  const on = usageCredits({
    spend: {
      enabled: true,
      used: { amount_minor: 120, currency: "USD", exponent: 2 },
      limit: { amount_minor: 2500, currency: "USD", exponent: 2 },
      disclaimer,
      can_purchase_credits: true,
    },
  });
  assert.deepEqual(on, {
    enabled: true,
    capped: false,
    used: "$1.20",
    limit: "$25.00",
    canPurchase: true,
    note: disclaimer,
  });

  // `cap` stands in when no `limit` is set, and a currency other than the dollar keeps its symbol
  assert.equal(
    usageCredits({
      spend: {
        enabled: true,
        used: { amount_minor: 5, currency: "EUR", exponent: 2 },
        cap: {
          amount_minor: 1000,
          currency: "EUR",
          exponent: 2,
        },
      },
    }).limit,
    "€10.00",
  );

  // the cap reached, from the legacy flag and from the numbers alone
  assert.equal(usageCredits({ extra_usage: { spend_limit_reached: true } }).capped, true);
  assert.equal(
    usageCredits({
      spend: {
        enabled: true,
        used: { amount_minor: 2500, currency: "USD", exponent: 2 },
        limit: { amount_minor: 2500, currency: "USD", exponent: 2 },
      },
    }).capped,
    true,
  );

  // a payload old enough to carry only `extra_usage`: state without amounts
  assert.deepEqual(
    usageCredits({ extra_usage: { is_enabled: true, spend_limit_reached: false } }),
    {
      enabled: true,
      capped: false,
      canPurchase: false,
    },
  );
  assert.deepEqual(usageCredits(null), { enabled: false, capped: false, canPurchase: false });

  // the consequence: credits covering a full window still stop the limit wait from arming, and a
  // reached cap still arms it, whichever block the payload states them in
  const now = 2_000_000;
  const full = [{ label: "5-hour", usedPercent: 100, resetsAt: now + 7_000 }];
  const reply = (payload: unknown) => ({
    ok: true as const,
    fetchedAt: now,
    windows: full,
    extraUsage: extraUsageOn(payload),
  });
  assert.equal(stillLimitedUntil(reply({ spend: { enabled: true } }), now), undefined);
  assert.equal(stillLimitedUntil(reply({ spend: { enabled: false } }), now), now + 7_000);
  assert.equal(
    stillLimitedUntil(reply({ extra_usage: { is_enabled: true, spend_limit_reached: true } }), now),
    now + 7_000,
  );
  console.log("credits ok");
}
console.log("usage ok");
