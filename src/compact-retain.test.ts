// The newest rows kept verbatim through Claude Code's `/compact`: the budget, the cut, and the
// boundary row that tells `--resume` to keep them.
import assert from "node:assert/strict";
import {
  compactInstructions,
  DEFAULT_RETAIN_RATIO,
  estimateTokens,
  retainBudget,
  retentionSpan,
  summaryInstructions,
  widenPreserved,
} from "./compact-retain.js";

// retainBudget: dsh's own resolution, of the whole window.
const opus = { provider: "claude-code", model: "claude-opus-5" };
assert.equal(DEFAULT_RETAIN_RATIO, 0.16);
assert.equal(retainBudget(undefined, opus, 1_000_000), 160_000, "dsh's default 16%");
assert.equal(retainBudget({ retainRatio: 0.1 }, opus, 200_000), 20_000);
assert.equal(retainBudget({ retainTokens: 5000 }, opus, undefined), 5000, "tokens need no window");
assert.equal(retainBudget({ retainRatio: 0.1 }, opus, undefined), 0, "a ratio of no window");
assert.equal(retainBudget({}, undefined, 0), 0);
const policies = {
  retainTokens: 9000,
  modelPolicies: [
    { provider: "claude-code", model: "claude-opus-5", retainRatio: 0.05 },
    { provider: "claude-code", model: "claude-sonnet-5", retainTokens: 1234 },
  ],
};
assert.equal(
  retainBudget(policies, opus, 1_000_000),
  50_000,
  "a model's ratio beats global tokens",
);
assert.equal(retainBudget(policies, { ...opus, model: "claude-sonnet-5" }, 1_000_000), 1234);
assert.equal(retainBudget(policies, { ...opus, model: "claude-haiku-4-5" }, 200_000), 9000);
assert.equal(retainBudget({ retainTokens: 0 }, opus, 1_000_000), 0, "zero switches it off");

// estimateTokens: CJK costs about a token a character, ASCII about a quarter.
assert.equal(estimateTokens("abcdefgh"), 2);
assert.equal(estimateTokens("你好世界"), 4);
assert.equal(estimateTokens(""), 0);
assert.ok(retentionSpan(160_000) > 160_000 * 4, "reads well past the tail's text");
assert.ok(retentionSpan(10_000_000) <= 6 * 1024 * 1024, "within one SSH read");

/** A transcript written the way Claude Code writes one: a parent chain of rows. */
function transcript() {
  const rows: Array<Record<string, unknown>> = [];
  let parent: string | null = null;
  const add = (row: Record<string, unknown>) => {
    const uuid = `r${rows.length + 1}`;
    rows.push({ parentUuid: parent, isSidechain: false, cwd: "/w", sessionId: "c1", ...row, uuid });
    parent = uuid;
    return uuid;
  };
  const words = (label: string) => `${label} ${"lorem ipsum dolor ".repeat(20)}`;
  return {
    rows,
    leaf: () => parent,
    prompt: (label: string) =>
      add({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: words(label) }] },
      }),
    reply: (id: string, blocks: object[]) =>
      blocks.map((b) =>
        add({ type: "assistant", message: { id, role: "assistant", content: [b] } }),
      ),
    text: (label: string) => ({ type: "text", text: words(label) }),
    call: (id: string) => ({ type: "tool_use", id, name: "Bash", input: { command: "ls" } }),
    result: (id: string) =>
      add({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: id, content: "out" }],
        },
      }),
    attach: () => add({ type: "attachment", attachment: { type: "date", text: "today" } }),
    progress: () => add({ type: "progress", data: { tick: 1 } }),
    noise: () => rows.push({ type: "last-prompt", lastPrompt: "x" }),
    compact: (kept: string[], anchor: string) => {
      const boundary = add({
        type: "system",
        subtype: "compact_boundary",
        logicalParentUuid: parent,
        compactMetadata: {
          trigger: "manual",
          preTokens: 1000,
          preservedSegment: { headUuid: kept[0], anchorUuid: anchor, tailUuid: kept.at(-1) },
          preservedMessages: { anchorUuid: anchor, uuids: kept, allUuids: kept },
        },
        level: "info",
      });
      rows.at(-1)!.parentUuid = null;
      parent = boundary;
      rows.push({
        parentUuid: boundary,
        uuid: anchor,
        type: "user",
        isCompactSummary: true,
        message: { role: "user", content: "the summary" },
      });
      parent = anchor;
      return boundary;
    },
    jsonl: () => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
  };
}

const t = transcript();
t.prompt("p1");
t.reply("m1", [t.text("a1")]);
const p2 = t.prompt("p2");
const [m2a, m2b] = t.reply("m2", [t.text("a2"), t.call("t1")]);
const r1 = t.result("t1");
const [m3] = t.reply("m3", [t.call("t2")]);
const r2 = t.result("t2");
const [m4] = t.reply("m4", [t.text("a4")]);
const p3 = t.prompt("p3");
const at3 = t.attach();
const pr = t.progress();
t.noise();
const [m5] = t.reply("m5", [t.text("a5")]);
const before = t.jsonl();
t.compact([m5!], "sum1");
t.noise();
const after = t.jsonl();

// Everything since the first exchange fits: kept from the second prompt on, progress left out,
// the attachment kept, the CLI's own row still last.
{
  const edit = widenPreserved(after, 1_000_000);
  assert.equal(edit.kind, "edit");
  if (edit.kind !== "edit") throw new Error("unreachable");
  const row = JSON.parse(edit.line);
  const kept: string[] = row.compactMetadata.preservedMessages.uuids;
  assert.equal(kept[0], p2, "the first exchange stays for the summary");
  assert.ok(kept.includes(at3!) && !kept.includes(pr!), "attachments kept, progress left out");
  assert.equal(kept.at(-1), m5);
  assert.equal(row.compactMetadata.preservedMessages.anchorUuid, "sum1");
  assert.deepEqual(row.compactMetadata.preservedMessages.allUuids, kept);
  assert.deepEqual(row.compactMetadata.preservedSegment, {
    headUuid: p2,
    anchorUuid: "sum1",
    tailUuid: m5,
  });
  assert.equal(row.compactMetadata.trigger, "manual", "the CLI's other metadata stays");
  assert.equal(row.level, "info", "fields this module does not read stay");
  assert.equal(row.parentUuid, null);
  const original = after.slice(edit.start, edit.end);
  assert.equal(JSON.parse(original).subtype, "compact_boundary", "the range is the boundary line");
  assert.equal(edit.kept, kept.length);
}

// Every budget cuts where the API takes it: at a prompt or an assistant message's first row with
// every tool call answered, never at a tool result, a message's second row or an attachment. A
// bigger budget never keeps less.
{
  const allowed = new Set([p2, m2a, m3, m4, p3, m5]);
  const refused = new Set([m2b, r1, r2, at3]);
  const full = widenPreserved(after, 1_000_000);
  assert.equal(full.kind, "edit");
  let last = Infinity;
  for (let budget = 0; budget <= (full.kind === "edit" ? full.tokens : 0) + 10; budget += 5) {
    const edit = widenPreserved(after, budget);
    if (edit.kind === "skip") continue;
    const first: string = JSON.parse(edit.line).compactMetadata.preservedMessages.uuids[0];
    assert.ok(allowed.has(first) && !refused.has(first), `budget ${budget} cut at ${first}`);
    assert.ok(edit.tokens <= budget, "the kept rows fit the budget");
    assert.ok(edit.kept >= (last === Infinity ? 0 : last), "more budget keeps no less");
    last = edit.kept;
  }
}

// Too small for anything past the CLI's own last round: left as the CLI wrote it.
assert.deepEqual(widenPreserved(after, 10), { kind: "skip", why: "Claude Code keeps as much" });
assert.equal(widenPreserved(after, 0).kind, "skip");
assert.deepEqual(widenPreserved(before, 1_000_000), {
  kind: "skip",
  why: "no compaction in the transcript's tail",
});

// The CLI kept a row this does not reach: a shape it does not know, left alone.
{
  const odd = transcript();
  odd.prompt("p1");
  odd.reply("m1", [odd.text("a1")]);
  odd.prompt("p2");
  odd.reply("m2", [odd.text("a2")]);
  odd.compact(["elsewhere"], "sum1");
  assert.deepEqual(widenPreserved(odd.jsonl(), 1_000_000), {
    kind: "skip",
    why: "Claude Code kept rows outside the newest stretch",
  });
}

// No summary row to anchor to.
{
  const bare = transcript();
  bare.prompt("p1");
  bare.reply("m1", [bare.text("a1")]);
  bare.rows.push({
    type: "system",
    subtype: "compact_boundary",
    uuid: "b",
    parentUuid: null,
    logicalParentUuid: bare.leaf(),
    compactMetadata: { trigger: "auto", preTokens: 5 },
  });
  assert.equal(widenPreserved(bare.jsonl(), 1_000_000).kind, "skip");
}

// A second compaction keeps nothing from before the first one's summary.
{
  const twice = transcript();
  twice.prompt("p1");
  twice.reply("m1", [twice.text("a1")]);
  const [k1] = twice.reply("m1b", [twice.text("a1b")]);
  twice.compact([k1!], "sum1");
  const q1 = twice.prompt("q1");
  twice.reply("n1", [twice.text("b1")]);
  const q2 = twice.prompt("q2");
  const [n2] = twice.reply("n2", [twice.text("b2")]);
  twice.compact([n2!], "sum2");
  const edit = widenPreserved(twice.jsonl(), 1_000_000);
  assert.equal(edit.kind, "edit");
  const kept: string[] =
    edit.kind === "edit" ? JSON.parse(edit.line).compactMetadata.preservedMessages.uuids : [];
  assert.equal(kept[0], q2, "q1 is the first exchange after the summary, left for the new one");
  assert.ok(!kept.includes(q1) && !kept.includes("sum1"));
}

// A cut read off a tail that starts mid-row: the broken first line is skipped.
{
  const cut = after.slice(after.indexOf(p2) - 40);
  const edit = widenPreserved(cut, 1_000_000);
  assert.equal(edit.kind, "edit");
  assert.equal(
    cut.slice(edit.kind === "edit" ? edit.start : 0).startsWith('{"parentUuid":null'),
    true,
  );
}

// Instructions name the first kept message, read before the compaction.
{
  const text = compactInstructions(before, 1_000_000) ?? "";
  assert.match(text, /from the user message that begins "p2 lorem ipsum/);
  assert.match(text, /Summarize only what comes before it/);
  assert.equal(compactInstructions(before, 0), undefined);
  assert.equal(compactInstructions(before, 10), undefined, "nothing fits: no instructions");
  assert.match(
    compactInstructions(before, 400) ?? "",
    /from (the user message that begins "p3|your reply that begins "a[45]|your Bash call) /,
    "a cut inside a turn is named by its own row",
  );
}

console.log("compact-retain ok");

// Every summary opens with the people, their language and their newest words, with or without a tail.
{
  const bare = summaryInstructions(undefined);
  assert.match(bare, /^Open the summary with a short section on the people/);
  assert.match(bare, /their newest message quoted word for word/);
  assert.match(bare, /Write the rest of the summary in the language of the newest of those messages/);
  const both = summaryInstructions(compactInstructions(before, 1_000_000));
  assert.ok(both.startsWith(bare) && /Summarize only what comes before it/.test(both));
}
