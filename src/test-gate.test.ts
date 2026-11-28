// The test gate's rules: when a run blocks a stop, how the count restarts, what Claude reads, how
// the chat line finds its tag, what Settings suggests, and the hook block the spawn passes.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  decide,
  gateNoteOf,
  gateReason,
  runCapSec,
  stopHookSettings,
  suggestCommand,
  testEnv,
} from "./test-gate.js";
import { gateEntryOf, testScriptIn } from "./test-gate-files.js";
import { buildArgs } from "./adapter/cli.js";
import { Config } from "./adapter/config.js";
import type { ClaudeEvent } from "./process.js";
import { Translator } from "./translator.js";
import { specKey } from "./adapter/turn.js";
import { objectOf, parseJson } from "./test-context.js";

const fail = { code: 1, timedOut: false, stopped: false };
const pass = { code: 0, timedOut: false, stopped: false };

// A first failure in a turn blocks as attempt 1, whatever an earlier turn left behind.
assert.deepEqual(decide(3, false, fail, 3), { state: "fixing", attempt: 1, block: true });

// Inside the same turn the count carries on, and blocks until it passes `tries`.
assert.deepEqual(decide(2, true, fail, 3), { state: "fixing", attempt: 3, block: true });

assert.deepEqual(decide(3, true, fail, 3), { state: "gave-up", attempt: 3, block: false });

// A pass, a timeout, a cancel and a missing command never block.
assert.equal(decide(1, true, pass, 3).state, "passed");

assert.equal(decide(0, false, { code: null, timedOut: true, stopped: false }, 3).block, false);

assert.equal(decide(0, false, { code: null, timedOut: false, stopped: true }, 3).state, "stopped");

assert.equal(decide(0, false, { code: 127, timedOut: false, stopped: false }, 3).state, "broken");

// The reason opens with the tag the translator reads back, as the CLI prefixes it.
const reason = gateReason(2, 3, "bun run test", "x".repeat(5000) + "END");

assert.ok(reason.startsWith("[test gate 2/3] "));

assert.ok(reason.endsWith("END") && reason.length < 4400, "only the tail goes to Claude");

assert.deepEqual(gateNoteOf(`Stop hook feedback:\n${reason}`), { attempt: 2, tries: 3 });

assert.equal(gateNoteOf("Stop hook feedback:\nsomething else"), undefined);

// Suggestions follow the lockfile; npm init's placeholder script is not a test command.
assert.equal(
  suggestCommand({
    testScript: testScriptIn('{"scripts":{"test":"vitest"}}'),
    lockfiles: ["bun.lock"],
  }),
  "bun run test",
);

assert.equal(
  suggestCommand({
    testScript: 'echo "Error: no test specified" && exit 1',
    lockfiles: [],
  }),
  undefined,
);

assert.equal(
  suggestCommand({ lockfiles: ["uv.lock"], pyproject: "[tool.pytest.ini_options]" }),
  "uv run pytest -q",
);

assert.equal(suggestCommand({ lockfiles: [], cargoToml: true }), "cargo test");

assert.equal(testScriptIn("not json"), undefined);

// Hand edits are clamped, and an empty command reads as off.
assert.deepEqual(gateEntryOf({ enabled: true, command: " make test ", tries: 99, timeoutSec: 1 }), {
  enabled: true,
  command: "make test",
  tries: 5,
  timeoutSec: 10,
});

assert.equal(gateEntryOf({ enabled: true, command: "  " })?.enabled, false);

// The hook line quotes every path, a space and a quote included.
const block = stopHookSettings(
  "/usr/bin/node",
  "/a b/hook.js",
  "/s/g.json",
  "/s/r.json",
  "/w/it's",
  600,
);

assert.equal(
  block.Stop[0]?.hooks[0]?.command,
  `'/usr/bin/node' '/a b/hook.js' '/s/g.json' '/s/r.json' '/w/it'\\''s' '600'`,
);

assert.equal(block.Stop[0]?.hooks[0]?.timeout, 630, "the CLI waits 30 s past the script's own cap");

// The run cap stays a minute under the idle watchdog, and never past 20 min.
assert.equal(runCapSec(1_800_000), 1200);

assert.equal(runCapSec(600_000), 540);

assert.equal(runCapSec(5000), 10);

// The test run keeps PATH and drops anything credential-shaped and dsh's own names.
assert.deepEqual(
  testEnv({
    PATH: "/bin",
    GH_TOKEN: "x",
    AWS_SECRET_ACCESS_KEY: "x",
    DSH_OMC_MCP_KEY: "x",
    DSH_HOME: "x",
    ANTHROPIC_CUSTOM_HEADERS: "x",
    HOME: "/h",
  }),
  { PATH: "/bin", HOME: "/h" },
);

// The spawn merges the block into --settings beside isolate's own, and a side call never gets it.
const settingsOf = (args: Array<string>) => {
  const i = args.indexOf("--settings");

  return i === -1 ? undefined : objectOf(parseJson(args[i + 1] ?? "{}"));
};

const gated = buildArgs({ model: "m", config: new Config({ isolate: true }), testGate: block });

assert.deepEqual(settingsOf(gated)?.hooks, block);

assert.equal(settingsOf(gated)?.autoMemoryEnabled, false, "isolate's settings stay");

const side = buildArgs({
  model: "m",
  config: new Config({}),
  testGate: block,
  purpose: "session-title",
});

assert.equal(settingsOf(side), undefined, "a title call runs no gate");

// The CLI's synthetic feedback frame draws one line for this gate's reason, none for another hook's.
{
  const t = new Translator({});

  /** The CLI's synthetic user frame carrying hook feedback `text`. */
  const frame = (text: string): ClaudeEvent => ({
    type: "user",
    isSynthetic: true,
    message: { content: [{ type: "text", text }] },
  });

  const ours = JSON.stringify(t.translate(frame(`Stop hook feedback:\n${reason}`)));
  assert.ok(ours.includes("Tests failed, Claude is fixing them (2/3)"), ours);
  assert.deepEqual(t.translate(frame("Stop hook feedback:\nlint is unhappy")), []);
}

// The hook runs as a bare node process, where dsh's packages do not resolve: it and the two
// modules it loads import only node builtins and each other.
for (const f of ["test-gate-hook.ts", "test-gate-files.ts", "test-gate.ts"]) {
  const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");

  for (const [, spec] of src.matchAll(/^import[^"]*"([^"]+)"/gm)) {
    assert.ok(/^node:|^\.\/test-gate(-files)?\.js$/.test(spec ?? ""), `${f} imports ${spec}`);
  }
}

// The gate joins the process spec, so switching it on or off keys a new process.
{
  const spec = {
    cwd: "/w",
    model: "m",
    effort: null,
    mode: "default",
    sessionId: "s",
    temporary: false,
  };

  assert.notEqual(specKey({ ...spec, testGate: true }), specKey(spec));
}

console.log("test-gate ok");
