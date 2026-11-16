// A turn with no Claude transcript to resume gets dsh's log written as one, as turns, instead of the
// whole history flattened into a single prompt. Checked here: the rows the seed holds, where the
// history ends and the new turn begins, and the adapter writing the file (moving an old one aside).
import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import { loadStarted } from "../state.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { buildPrompt, type LooseMessage, selectTurns } from "./prompt.js";
import { bridgedName, historyEnd, NO_RESULT, seedTranscriptText } from "./seed.js";
import { projectDirName } from "./transcript-watch.js";

const text = (t: string) => [{ type: "text" as const, text: t }];
const person = (t: string): LooseMessage => ({
  role: "user",
  content: text(t),
  source: { kind: "user" },
});
const reply = (t: string, provider = "claude-code"): LooseMessage => ({
  role: "assistant",
  content: text(t),
  source: { kind: "model", provider, model: "m" },
});
// SAFETY: hand-written dsh messages in the shapes dsh 0.1.7+ logs
const call = (id: string, name: string, args: string, say = ""): LooseMessage =>
  ({
    role: "assistant",
    content: [...(say ? text(say) : []), { type: "tool-call", id, name, arguments: args }],
    source: { kind: "model", provider: "claude-code", model: "m" },
  }) as unknown as LooseMessage;
const result = (id: string, t: string, isError = false): LooseMessage => ({
  role: "tool",
  toolCallId: id,
  content: text(t),
  isError,
});

const history: LooseMessage[] = [
  { role: "system", content: text("You are Sakina."), source: { kind: "system-prompt" } },
  {
    role: "user",
    content: text("[Telegram message from Lia]"),
    source: { kind: "telegram-sender" },
  },
  person("帮我查一下包裹"),
  // A relayed dsh call: the plugin mints its id.
  call("6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f", "bash", '{"command":"amazon-ca order 1"}', "我看看"),
  result("6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f", "Delivery attempted today at 6:14 a.m."),
  reply("包裹今天早上 6:14 来过一次，没送成。"),
  person("白天送呗你帮我改"),
  call("c2", "subagent", '{"prompt":"Move the redelivery to daytime."}'),
  result("c2", "started subagent 086518b8"),
  call("c3", "edit", "{not json"),
  // c3 never got a result: the turn was cut off.
  reply("派了一只小猫猫去改。", "other-route"),
  person("怎么样了"),
];

const rows = (t: string) =>
  t
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

// The history ends after the last reply; the person's newest message is the new turn.
assert.equal(historyEnd(history), history.length - 1);
assert.equal(historyEnd([person("hi")]), 0, "no reply yet: nothing to seed");
assert.equal(
  seedTranscriptText([person("hi")], { sessionId: "s", cwd: "/w", version: "1.0.0" }),
  "",
);
// A reply whose calls are answered after it: the answers belong to the history.
assert.equal(historyEnd([person("go"), call("x", "bash", "{}"), result("x", "ok")]), 3);

const seed = rows(
  seedTranscriptText(history, { sessionId: "s", cwd: "/w", version: "2.1.325", developer: true }),
);
// Turns, not one block: who said what stays with its role.
assert.deepEqual(
  seed.map((r) => `${r.type}:${r.message.content.map((b: { type: string }) => b.type).join("+")}`),
  [
    "user:text",
    "user:text",
    "assistant:text+tool_use",
    "user:tool_result",
    "assistant:text",
    "user:text",
    "assistant:tool_use",
    "user:tool_result",
    "assistant:tool_use",
    "user:tool_result",
    "assistant:text",
  ],
);
assert.equal(
  seed[1].message.content[0].text,
  "帮我查一下包裹",
  "the person's own words, unlabelled",
);
assert.ok(!JSON.stringify(seed).includes("You are Sakina."), "the system prompt rides on its flag");
assert.ok(!JSON.stringify(seed).includes("[assistant]"), "no role labels inside a message");
assert.equal(seed[2].message.content[1].name, "mcp__dsh__bash", "named as Claude saw it");
assert.deepEqual(seed[2].message.content[1].input, { command: "amazon-ca order 1" });
assert.deepEqual(
  seed[8].message.content[0].input,
  { input: "{not json" },
  "unparsable kept as text",
);
assert.equal(seed[9].message.content[0].tool_use_id, "c3");
assert.equal(seed[9].message.content[0].content[0].text, NO_RESULT, "an unanswered call is closed");
assert.equal(seed[9].message.content[0].is_error, true);
assert.equal(
  seed[10].message.content[0].text,
  "派了一只小猫猫去改。",
  "another route's reply counts",
);
// A chain the CLI walks back from the last row, with the fields its loader reads.
for (const [i, r] of seed.entries()) {
  assert.equal(r.parentUuid, i === 0 ? null : seed[i - 1].uuid);
  assert.equal(r.sessionId, "s");
  assert.equal(r.cwd, "/w");
  assert.equal(r.version, "2.1.325");
  if (i > 0) assert.ok(r.timestamp > seed[i - 1].timestamp, "time order is write order");
}

// After a seed, the prompt is only what came after the last reply, whichever route wrote it.
const tail = selectTurns(history, true, undefined, true);
assert.equal(buildPrompt(tail), "怎么样了");
// The old path, for comparison: everything since Claude's own last reply, flattened with labels.
assert.match(buildPrompt(selectTurns(history, false)), /^\[user\]\n/);

// Tool text: whole by default, cut at the replay limit when one is set.
{
  const long = "x".repeat(50);
  const capped = rows(
    seedTranscriptText([person("go"), call("k", "bash", "{}"), result("k", long), reply("done")], {
      sessionId: "s",
      cwd: "/w",
      version: "1",
      cap: 10,
    }),
  );
  assert.equal(
    capped[2].message.content[0].content[0].text,
    `${"x".repeat(10)}… (40 more characters)`,
  );
}
// An error result stays an error; a developer message is conversation only in the dsh mode.
{
  const dev: LooseMessage = {
    role: "developer",
    content: text("Tools changed."),
    source: { kind: "tool-update" },
  };
  const msgs = [person("go"), call("e", "bash", "{}"), result("e", "boom", true), dev, reply("ok")];
  const plain = rows(seedTranscriptText(msgs, { sessionId: "s", cwd: "/w", version: "1" }));
  assert.equal(plain[2].message.content[0].is_error, true);
  assert.ok(!JSON.stringify(plain).includes("Tools changed."));
  const dsh = rows(
    seedTranscriptText(msgs, { sessionId: "s", cwd: "/w", version: "1", developer: true }),
  );
  assert.ok(JSON.stringify(dsh).includes("Tools changed."));
}
// A history that opens with a reply still opens with the user, as the API requires.
{
  const opened = rows(
    seedTranscriptText([reply("hello"), person("hi"), reply("hey")], {
      sessionId: "s",
      cwd: "/w",
      version: "1",
    }),
  );
  assert.equal(opened[0].type, "user");
  assert.equal(opened[0].parentUuid, null);
  assert.equal(opened[1].parentUuid, opened[0].uuid);
  assert.ok(opened[0].timestamp < opened[1].timestamp, "the opening row sorts first");
}
assert.equal(bridgedName("bash"), "mcp__dsh__bash");
// One of Claude's own tool calls, logged by the plugin as `<callId>:call` under dsh's name, goes
// back under the name Claude called it by; a relayed dsh call keeps its bridge name.
{
  const native = (id: string, name: string, args = "{}"): LooseMessage => ({
    ...call(id, name, args),
    id: `${id}:call`,
  });
  const named = rows(
    seedTranscriptText(
      [
        person("go"),
        native("n1", "bash"),
        result("n1", "ok"),
        native("n2", "edit"),
        result("n2", "ok"),
        native("n3", "edit", '{"file_path":"f","edits":[]}'),
        result("n3", "ok"),
        call("9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a", "bash", "{}"),
        result("9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a", "ok"),
        reply("done"),
      ],
      { sessionId: "s", cwd: "/w", version: "2.1.325" },
    ),
  )
    .flatMap((r) => r.message.content)
    .filter((b: { type: string }) => b.type === "tool_use")
    .map((b: { name: string }) => b.name);
  assert.deepEqual(named, ["Bash", "Edit", "MultiEdit", "mcp__dsh__bash"]);
  // The Import seed writes Claude's calls inside its reply, under dsh's name and Claude's
  // tool_use id; a relayed call in a live reply has the id the plugin minted for it.
  const imported = rows(
    seedTranscriptText(
      [
        person("go"),
        call("toolu_01Abc", "bash", "{}"),
        result("toolu_01Abc", "ok"),
        call("0b6a5c1e-3f2d-4c8e-9a7b-1d2e3f4a5b6c", "bash", "{}"),
        result("0b6a5c1e-3f2d-4c8e-9a7b-1d2e3f4a5b6c", "ok"),
        call("toolu_02Def", "mcp__dsh__subagent", "{}"),
        result("toolu_02Def", "ok"),
        reply("done"),
      ],
      { sessionId: "s", cwd: "/w", version: "2.1.325" },
    ),
  )
    .flatMap((r) => r.message.content)
    .filter((b: { type: string }) => b.type === "tool_use")
    .map((b: { name: string }) => b.name);
  assert.deepEqual(imported, ["Bash", "mcp__dsh__bash", "mcp__dsh__subagent"]);
}
assert.equal(bridgedName("ToolSearch"), "ToolSearch");
assert.equal(bridgedName("mcp__other__x"), "mcp__other__x");

// The adapter writes the seed where `--resume` looks, marks it started, and moves an old
// transcript aside rather than deleting it.
{
  const home = mkdtempSync(join(tmpdir(), "omc-seed-"));
  // SAFETY: partial fake; the constructor reads nothing past `on`
  const adapter = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, Config({}));
  adapter.claudeHome = home;
  const dir = join(home, "projects", projectDirName("/w"));
  assert.equal(await adapter.seedTranscript([person("hi")], "/w", "fresh", "2.1.325", {}), false);
  assert.equal(existsSync(join(dir, "fresh.jsonl")), false, "nothing to seed, nothing written");
  assert.equal(
    await adapter.seedTranscript(history, "/w", "s1", "2.1.325 (Claude Code)", {}),
    true,
  );
  const written = rows(readFileSync(join(dir, "s1.jsonl"), "utf8"));
  assert.equal(written.length, 11);
  assert.equal(written[0].version, "2.1.325", "the number alone, as the CLI stamps it");
  assert.ok((await loadStarted()).has("s1"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "s2.jsonl"), "{}\n");
  assert.equal(await adapter.seedTranscript(history, "/w", "s2", "2.1.325", {}), true);
  assert.ok(
    readdirSync(dir).some((f) => /^s2\.jsonl\.replaced-\d+$/.test(f)),
    "the old one kept",
  );
  // A transcript that cannot be moved aside is never written over: the seed gives up instead.
  // Root ignores a read-only directory, so the check only holds for an ordinary user.
  if (process.getuid?.() !== 0) {
    writeFileSync(join(dir, "s3.jsonl"), "{}\n");
    chmodSync(dir, 0o555);
    try {
      assert.equal(await adapter.seedTranscript(history, "/w", "s3", "2.1.325", {}), false);
    } finally {
      chmodSync(dir, 0o755);
    }
    assert.equal(readFileSync(join(dir, "s3.jsonl"), "utf8"), "{}\n", "the old one untouched");
  }
  rmSync(home, { recursive: true, force: true });
}

console.log("seed: ok");
