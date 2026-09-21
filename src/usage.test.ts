import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageCredits } from "./usage.js";
import {
  extraUsageOn,
  parseBreakdownCache,
  parseUsageBreakdown,
  readUsage,
  stillLimitedUntil,
  usageCredits,
  usageWindows,
} from "./usage.js";

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

// /usage breakdown: parse the CLI's own text (2.1.x) into windows and driver groups.
{
  const text = [
    "You are currently using your subscription to power your Claude Code usage",
    "",
    "Current session: 6% used · resets Sep 19, 3am (America/New_York)",
    "Current week (all models): 53% used · resets Sep 22, 1pm (America/New_York)",
    "Current week (Fable): 84% used · resets Sep 22, 1pm (America/New_York)",
    "",
    "What's contributing to your limits usage?",
    "Approximate, based on local sessions on this machine — does not include other devices or claude.ai. Behaviors are independent characteristics, not a breakdown.",
    "",
    "Last 24h · 1195 requests · 29 sessions",
    "  91% of your usage was at >150k context",
    "  60% of your usage came from sessions active for 8+ hours",
    "  Top skills: /local-subagent 10%, /unslop 3%, /design-pass 1%",
    "  Top MCP servers: plugin:context-mode:context-mode 16%, dsh 13%",
    "",
    "Last 7d · 9432 requests · 154 sessions",
    "  77% of your usage was at >150k context",
    "  54% of your usage came from sessions active for 8+ hours",
    "  Top skills: /local-subagent 10%, /unslop 3%, /impeccable 2%, /codebase-design 2%, /divi5-skill 1%",
    "  Top MCP servers: dsh 11%, plugin:context-mode:context-mode 11%",
  ].join("\n");
  const wins = parseUsageBreakdown(text);
  assert.equal(wins.length, 2, "two windows parsed");
  const [day, week] = wins;
  if (!day || !week) throw new Error("expected two windows");
  assert.equal(week.label, "Last 7d", "second window label");
  assert.equal(week.requests, 9432, "7d requests");
  assert.equal(week.sessions, 154, "7d sessions");
  assert.deepEqual(
    week.groups.map((g) => g.label),
    ["Skills", "MCP servers"],
    "7d group labels, Title-cased",
  );
  const [skills, mcp] = week.groups;
  if (!skills || !mcp) throw new Error("expected two groups");
  assert.deepEqual(
    skills.drivers,
    [
      { name: "/local-subagent", pct: 10 },
      { name: "/unslop", pct: 3 },
      { name: "/impeccable", pct: 2 },
      { name: "/codebase-design", pct: 2 },
      { name: "/divi5-skill", pct: 1 },
    ],
    "7d skills drivers",
  );
  assert.deepEqual(
    mcp.drivers,
    [
      { name: "dsh", pct: 11 },
      { name: "plugin:context-mode:context-mode", pct: 11 },
    ],
    "7d MCP-server drivers",
  );
  // A behaviour line ("91% of your usage was at >150k context") makes no group.
  assert.equal(day.label, "Last 24h", "first window label");
  assert.equal(day.groups.length, 2, "24h has only the two Top groups, not the behaviour lines");
  assert.deepEqual(
    day.behaviours,
    [
      "91% of your usage was at >150k context",
      "60% of your usage came from sessions active for 8+ hours",
    ],
    "both behaviour sentences are kept verbatim, beside the groups rather than among them",
  );
  // Unrecognised text yields no windows, which the caller degrades to an empty section.
  assert.deepEqual(parseUsageBreakdown("nothing here"), [], "unknown text yields no windows");
}
assert.deepEqual(
  parseUsageBreakdown("Last 7d · 12 requests · 3 sessions\n"),
  [],
  "a window with no Top rows is dropped, not shown empty",
);
console.log("usage-breakdown ok");

// The breakdown cache on disk is read by shape, not trusted by a version number. It has already
// crashed the panel once: a file written before the parser learned to keep the behaviour sentences
// was read by code that expected them. Each case below is a file the reader must refuse rather
// than serve, and refusing means the next open reads fresh.
{
  const reply = (windows: unknown[]) => ({ ok: true, fetchedAt: 1, windows });
  const window = {
    label: "Last 7d",
    requests: 10,
    sessions: 2,
    behaviours: ["78% of your usage was at >150k context"],
    groups: [{ label: "MCP servers", drivers: [{ name: "dsh", pct: 12 }] }],
  };
  const good = JSON.stringify({ entries: { box: { at: 1, reply: reply([window]) } } });
  const windowsOf = (file: string) => {
    const r = parseBreakdownCache(file)?.box?.reply;
    return r?.ok === true ? r.windows : undefined;
  };
  assert.equal(windowsOf(good)?.length, 1, "a well-formed file is read");

  // The file that crashed the panel: written before the behaviour field existed. It is read, and
  // the missing list comes back empty rather than absent, which is what makes it safe: the crash
  // was a `.map` on a list that was not there, and an empty list renders nothing.
  const { behaviours: _dropped, ...older } = window;
  const olderFile = JSON.stringify({ entries: { box: { at: 1, reply: reply([older]) } } });
  assert.deepEqual(
    windowsOf(olderFile)?.[0]?.behaviours,
    [],
    "an old file's missing list reads as empty, so nothing downstream can call .map on undefined",
  );
  assert.equal(parseBreakdownCache('{"entries": {"box": '), undefined, "a torn write is refused");
  // The validator would pass this entry as `{ at: 1, reply: {} }`; the reader must not serve it.
  assert.deepEqual(
    parseBreakdownCache(JSON.stringify({ entries: { box: { at: 1 } } })),
    {},
    "an entry with no reply is dropped rather than served as one",
  );
  assert.equal(parseBreakdownCache("not json"), undefined, "a file that is not JSON is refused");
  // A reply present but not ok must never be seeded as a real one. Measured: the validator rejects
  // `ok: false` outright, and it does not fill a missing `ok` in as true, so the hand check drops
  // that one. Either way nothing reaches the fold that is not a successful read.
  const withReply = (r: unknown) => JSON.stringify({ entries: { box: { at: 1, reply: r } } });
  assert.equal(
    parseBreakdownCache(withReply({ ok: false, error: "spawn failed" })),
    undefined,
    "a failed reply on disk is refused",
  );
  assert.deepEqual(
    parseBreakdownCache(withReply({ fetchedAt: 1, windows: [window] })),
    {},
    "a reply with no ok flag is dropped, not promoted to a success",
  );
}
console.log("breakdown-cache ok");
