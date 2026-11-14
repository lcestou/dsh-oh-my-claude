// Engine mode per agent preset: only a session under a preset ticked in Settings gets the engine
// config, every option applies until skipped, and every other session keeps the plugin's own
// config object, untouched.
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginContext } from "../dsh.js";
import { STATE_DIR } from "../state.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { ENGINE_OPTIONS, engineOverlay, enginePresets, engineSkipKey } from "./engine-mode.js";
import { engineDigest } from "./isolate.js";

const base = new Config({});
const on = { "enginePreset:engine": true } as const;

// Off for the session's preset, no preset, or none ticked: the very same object comes back.
assert.equal(engineOverlay(base, {}, "engine"), base);
assert.equal(engineOverlay(base, on, "standard"), base, "another preset keeps the config");
assert.equal(engineOverlay(base, on, null), base, "no preset recorded");
assert.equal(engineOverlay(base, on, undefined), base);

// On: the whole bundle, and the defaults of every other key untouched.
const engine = engineOverlay(base, on, "engine");
assert.notEqual(engine, base);
assert.deepEqual(
  {
    systemPrompt: engine.systemPrompt,
    builtinTools: engine.builtinTools,
    toolLoading: engine.toolLoading,
    followToolSet: engine.followToolSet,
    verbatimPrompts: engine.verbatimPrompts,
    isolate: engine.isolate,
    thinkingDisplay: engine.thinkingDisplay,
  },
  {
    systemPrompt: "dsh",
    builtinTools: ["ToolSearch"],
    toolLoading: "dsh",
    followToolSet: true,
    verbatimPrompts: true,
    isolate: true,
    thinkingDisplay: "summarized",
  },
);
assert.equal(engine.command, base.command, "keys engine mode does not own stay as configured");
assert.equal(base.isolate, false, "the plugin's own config is not edited");
assert.notEqual(engineDigest(engine), undefined, "so the process spec keys a new process");

// A skipped option keeps the config's own value.
const noIsolate = engineOverlay(base, { ...on, "engineSkip:engine:isolate": true }, "engine");
assert.equal(noIsolate.isolate, false);
assert.equal(noIsolate.systemPrompt, "dsh");
const allSkipped = Object.fromEntries(
  ENGINE_OPTIONS.map((o) => [engineSkipKey(o, "engine"), true]),
);
assert.deepEqual(
  engineOverlay(base, { ...on, ...allSkipped }, "engine").builtinTools,
  base.builtinTools,
);

// Each ticked mode has its own set: one mode's skip never reaches another.
{
  const hints = {
    "enginePreset:engine": true,
    "enginePreset:assistant": true,
    [engineSkipKey("isolate", "assistant")]: true,
    [engineSkipKey("thinkingDisplay", "engine")]: true,
  };
  const engineMode = engineOverlay(base, hints, "engine");
  assert.equal(engineMode.isolate, true, "engine keeps isolate");
  assert.equal(engineMode.thinkingDisplay, base.thinkingDisplay, "engine's own skip applies");
  const assistant = engineOverlay(base, hints, "assistant");
  assert.equal(assistant.isolate, false, "assistant's own skip applies");
  assert.equal(assistant.thinkingDisplay, "summarized", "engine's skip does not reach it");
  assert.equal(engineSkipKey("isolate", "assistant"), "engineSkip:assistant:isolate");
}

assert.deepEqual(enginePresets({ "enginePreset:a": true, "enginePreset:b": true, other: true }), [
  "a",
  "b",
]);

// Through the adapter: the session's preset comes from dsh's preset service and the ticks from the
// hints store; a session in another mode keeps the plugin's own config, and the bridge's per-session
// reads (`configFor`) follow what the last turn worked out.
{
  await writeFile(join(STATE_DIR, "hints.json"), JSON.stringify({ "enginePreset:engine": true }));
  const presets: Record<string, string> = { s1: "engine", s2: "standard" };
  // SAFETY: partial fake; sessionConfigOf reads sessions.get and the preset service only
  const ctx = {
    on() {},
    sessions: { get: (id: string) => ({ id }) },
    get: (name: string) =>
      name === "agentPresets"
        ? { presetForSession: (s: { id: string }) => presets[s.id] ?? null }
        : undefined,
  } as unknown as PluginContext;
  const a = new ClaudeCodeAdapter(ctx, Config({}));
  const s1 = await a.sessionConfigOf("s1");
  assert.equal(s1.isolate, true, "the engine preset's session runs in engine mode");
  assert.deepEqual(a.configFor("s1").builtinTools, ["ToolSearch"]);
  const s2 = await a.sessionConfigOf("s2");
  assert.equal(s2, a.config, "a session in another mode keeps the plugin's own config");
  assert.equal(a.configFor("s2"), a.config);
  assert.equal(a.configFor("never-seen"), a.config, "before a first turn: the plugin's own");
  // Unticked again: the next turn drops the session back to the plugin's config.
  await writeFile(join(STATE_DIR, "hints.json"), "{}");
  assert.equal(await a.sessionConfigOf("s1"), a.config);
  assert.equal(a.configFor("s1"), a.config);
  // A dsh with no preset service is engine mode off.
  // SAFETY: partial fake, as above
  const bare = new ClaudeCodeAdapter(
    { on() {}, sessions: { get: () => ({}) }, get: () => undefined } as unknown as PluginContext,
    Config({}),
  );
  await writeFile(join(STATE_DIR, "hints.json"), JSON.stringify({ "enginePreset:engine": true }));
  assert.equal(await bare.sessionConfigOf("s1"), bare.config);
}

// The environment follows the process, not the plugin's config: isolate's env goes only to a
// process whose spec says isolate, so a normal session started beside an engine one gets none.
{
  // SAFETY: partial fake; localEnvOverride reads the config only
  const a = new ClaudeCodeAdapter({ on() {} } as unknown as PluginContext, Config({}));
  assert.equal(a.localEnvOverride(false, undefined, false, true)?.MCP_TOOL_TIMEOUT, "2000000000");
  assert.equal(a.localEnvOverride(false, undefined, false, false)?.MCP_TOOL_TIMEOUT, undefined);
  assert.equal(a.localEnvOverride(false)?.MCP_TOOL_TIMEOUT, undefined, "default: the config's off");
}

console.log("engine-mode: ok");
