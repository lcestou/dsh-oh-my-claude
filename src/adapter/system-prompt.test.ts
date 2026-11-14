// `systemPrompt: dsh`: dsh's own system prompt replaces Claude Code's, the tool guidance follows
// it, the CLI's prompt snapshot is off so a changed prompt reaches a resumed session, and dsh's
// mid-session developer text rides in the turn. The default mode is unchanged.
import { strict as assert } from "node:assert";
import { buildArgs } from "./cli.js";
import { Config } from "./config.js";
import { buildPrompt, dshSystemPrompt, selectTurns, type LooseMessage } from "./prompt.js";

/** The value after `flag`, or undefined when the flag is absent. */
const valueOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const text = (t: string) => [{ type: "text" as const, text: t }];
const history: LooseMessage[] = [
  { role: "system", content: text("You are Sakina."), source: { kind: "system-prompt" } },
  { role: "user", content: text("hi"), source: { kind: "user" } },
  { role: "assistant", content: text("hello"), source: { kind: "model", provider: "claude-code" } },
  { role: "developer", content: text("Tools changed."), source: { kind: "tool-update" } },
  { role: "user", content: text("again"), source: { kind: "user" } },
];

assert.equal(dshSystemPrompt(history), "You are Sakina.");
assert.equal(dshSystemPrompt(history, "One-shot."), "One-shot.\n\nYou are Sakina.");
// dsh empties the later system messages when a session moves to a route that is not in-history;
// the prompt in force is the last one with text, not the blank after it.
assert.equal(
  dshSystemPrompt([
    { role: "system", content: "HEAD PROMPT v2" },
    { role: "user", content: "hi" },
    { role: "system", content: "" },
    { role: "user", content: "again" },
  ] as LooseMessage[]),
  "HEAD PROMPT v2",
);
assert.equal(dshSystemPrompt([{ role: "user", content: text("x") }]), undefined);
assert.equal(
  dshSystemPrompt([
    ...history,
    { role: "system", content: text("New prompt, part one.") },
    { role: "system", content: text("Part two.") },
    { role: "user", content: text("later") },
  ]),
  "New prompt, part one.\n\nPart two.",
  "the latest run of system messages is the prompt in force",
);

// The default mode leaves developer messages out; the dsh mode sends their text as system lines.
const resumed = selectTurns(history, true, "claude-code");
assert.deepEqual(
  resumed.map((m) => m.role),
  ["user"],
);
const dshTurns = selectTurns(history, true, "claude-code", true);
assert.deepEqual(
  dshTurns.map((m) => m.role),
  ["developer", "user"],
);
assert.equal(buildPrompt(dshTurns), "[system]\nTools changed.\n\n[user]\nagain");

const tools = [{ name: "subagent", description: "", parameters: { type: "object" } }];
const plain = buildArgs({
  model: "m",
  system: "sys",
  config: new Config({}),
  mcp: { url: "http://x", tools },
});
assert.equal(valueOf(plain, "--system-prompt"), undefined, "default: Claude Code's own prompt");
assert.ok(valueOf(plain, "--append-system-prompt")?.startsWith("sys\n\ndsh tools are available"));
assert.ok(!plain.includes("--system-prompt-snapshot"));

const replaced = buildArgs({
  model: "m",
  config: new Config({ systemPrompt: "dsh" }),
  dshSystem: "You are Sakina.",
  mcp: { url: "http://x", tools },
});
assert.ok(valueOf(replaced, "--system-prompt")?.startsWith("You are Sakina.\n\ndsh tools are"));
assert.equal(valueOf(replaced, "--system-prompt-snapshot"), "off");
assert.equal(valueOf(replaced, "--append-system-prompt"), undefined, "nothing appended twice");

// A CLI without the flag keeps the old path rather than dying on an unknown option.
const old = buildArgs({
  model: "m",
  system: "sys",
  config: new Config({ systemPrompt: "dsh" }),
  dshSystem: "You are Sakina.",
  flags: new Set(["--append-system-prompt"]),
});
assert.equal(valueOf(old, "--system-prompt"), undefined);
assert.equal(valueOf(old, "--append-system-prompt"), "sys");

console.log("system-prompt: ok");
