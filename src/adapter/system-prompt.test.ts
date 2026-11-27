// `systemPrompt: dsh`: dsh's own system prompt replaces Claude Code's, the tool guidance follows
// it, the CLI's prompt snapshot is off so a changed prompt reaches a resumed session, and dsh's
// mid-session developer text rides in the turn. The default mode is unchanged.
import { strict as assert } from "node:assert";
import { buildArgs } from "./cli.js";
import { Config } from "./config.js";
import { buildPrompt, dshSystemPrompt, selectTurns } from "./prompt.js";
import type { LooseMessage } from "./prompt.js";

/** The value after `flag`, or undefined when the flag is absent. */
const valueOf = (args: Array<string>, flag: string) => {
  const i = args.indexOf(flag);

  return i === -1 ? undefined : args[i + 1];
};

const text = (t: string) => [{ type: "text" as const, text: t }];

const history: Array<LooseMessage> = [
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
  ] as Array<LooseMessage>),
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

// dsh 0.2.3 names each source in a system message, and a later message holds only what changed.
// This is the shape a scratch 0.2.3-alpha.2 wrote on a model switch: a notice block, then the new
// text of the one source that moved. Read as a whole prompt it was all Claude got.
const sectioned: Array<LooseMessage> = [
  {
    role: "system",
    content: [
      ...text("You are an agent."),
      ...text("Model: default."),
      ...text("Use bash with care."),
    ],
    source: {
      kind: "system-prompt",
      sections: [
        { name: "harness:identity", state: "active", order: 0, contentIndex: 0 },
        { name: "deployment:persona-prefix", state: "active", order: 10, contentIndex: 1 },
        { name: "tool:bash", state: "active", order: 20, contentIndex: 2 },
      ],
    },
  },
  { role: "user", content: text("hi"), source: { kind: "user" } },
  { role: "assistant", content: text("hello"), source: { kind: "model", provider: "claude-code" } },
  {
    role: "system",
    content: [
      ...text("The following replaces the earlier instructions from deployment:persona-prefix."),
      ...text("Model: opus."),
    ],
    source: {
      kind: "system-prompt",
      sections: [
        { name: "deployment:persona-prefix", state: "active", order: 10, contentIndex: 1 },
      ],
    },
  },
  { role: "user", content: text("again"), source: { kind: "user" } },
];

assert.equal(
  dshSystemPrompt(sectioned),
  "You are an agent.\n\nModel: opus.\n\nUse bash with care.",
  "a later message that names its sources changes those sources and keeps the rest",
);

assert.equal(
  dshSystemPrompt(sectioned, "One-shot."),
  "One-shot.\n\nYou are an agent.\n\nModel: opus.\n\nUse bash with care.",
);

/** `sectioned` with one more system message on the end, built from its blocks and sections. */
const sectionedThen = (
  blocks: Array<string>,
  source: NonNullable<LooseMessage["source"]>,
): Array<LooseMessage> => [
  ...sectioned,
  { role: "system", content: blocks.flatMap(text), source: { kind: "system-prompt", ...source } },
];

assert.equal(
  dshSystemPrompt(
    sectionedThen(["The earlier instructions from tool:bash no longer apply."], {
      sections: [{ name: "tool:bash", state: "retired" }],
    }),
  ),
  "You are an agent.\n\nModel: opus.",
  "a retired source leaves the prompt, and its notice is not instructions",
);

assert.equal(
  dshSystemPrompt(
    sectionedThen(["Everything before this is superseded.", "You are Sakina."], {
      reset: true,
      sections: [
        { name: "deployment:persona-prefix", state: "active", order: 10, contentIndex: 1 },
      ],
    }),
  ),
  "You are Sakina.",
  "a reset message starts over from its own sources",
);

assert.equal(
  dshSystemPrompt(
    sectionedThen(["Read files first.", "Ask before deleting.", ""], {
      sections: [
        { name: "tool:read", state: "active", order: 20, contentIndex: 0 },
        { name: "context:b", state: "active", order: 5, contentIndex: 1 },
        { name: "context:empty", state: "active", order: 1, contentIndex: 2 },
      ],
    }),
  ),
  "You are an agent.\n\nAsk before deleting.\n\nModel: opus.\n\nUse bash with care.\n\nRead files first.",
  "sources read in order, a tie by name, and one with no text adds nothing",
);

// A session begun before the upgrade: its whole prompt stands until 0.2.3 writes the reset that
// rebuilds it from sources.
const upgraded: Array<LooseMessage> = [
  { role: "system", content: text("Whole prompt from 0.2.2."), source: { kind: "system-prompt" } },
  { role: "user", content: text("hi"), source: { kind: "user" } },
  {
    role: "system",
    content: text("Rebuilt identity."),
    source: {
      kind: "system-prompt",
      reset: true,
      sections: [{ name: "harness:identity", state: "active", order: 0, contentIndex: 0 }],
    },
  },
];

assert.equal(dshSystemPrompt(upgraded), "Rebuilt identity.");

assert.equal(
  dshSystemPrompt([
    ...upgraded.slice(0, 2),
    {
      role: "system",
      content: text("Use bash with care."),
      source: {
        kind: "system-prompt",
        sections: [{ name: "tool:bash", state: "active", order: 20, contentIndex: 0 }],
      },
    },
  ]),
  "Whole prompt from 0.2.2.\n\nUse bash with care.",
  "with no reset yet, the older whole prompt is kept under the sources added since",
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
