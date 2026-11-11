// What a turn through a router must leave alone: the things that belong to the Claude account or to
// Claude's own models. Each case here was found by going through what the plugin writes or sends
// while a router is on and asking what is still wrong once it is off again (2026-11-11).
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PluginContext } from "../dsh.js";
import { sshTokenPath, THIS_BOX } from "../ssh-login.js";
import { countsForWorkspaceMemory, STATE_DIR } from "../state.js";
import { tempDir } from "../test-tmp.js";
import { resolveModelInfo } from "./catalog.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";

// SAFETY: partial fake; these cases read the event hook and nothing else of the context
const ctx = { on() {} } as unknown as PluginContext;
/** A fresh adapter with its own state dir. */
const adapterHere = () => {
  const a = new ClaudeCodeAdapter(ctx, Config({}));
  a.stateDir = tempDir("omc-routed-");
  return a;
};

// The workspace remembers the model a direct turn ran, never a router's name for something else.
assert.equal(
  countsForWorkspaceMemory({
    model: "sonnet",
    temporary: false,
    origin: undefined,
    via: "127.0.0.1:15721",
  }),
  false,
);
assert.equal(
  countsForWorkspaceMemory({ model: "claude-fable-5-2", temporary: false, origin: undefined }),
  true,
);

// The window a routed session reports is the router's. On a Claude id with no stated size it must
// not be remembered as that Claude model's window.
{
  const window = () => resolveModelInfo("claude-code", "claude-opus-5-5").context?.contextWindow;
  const before = window();
  const a = adapterHere();
  /** A live process that answers `get_context_usage` with a 123,456 window. */
  const procWith = (via: string | undefined) => {
    // SAFETY: partial fake of the process; the read uses these fields and the control listener
    const proc: any = {
      alive: true,
      busy: false,
      spec: { model: "claude-opus-5-5" },
      prep: { via },
      steers: new Map(),
      controlListener: undefined,
      write(line: string) {
        const req = JSON.parse(line);
        setTimeout(() => {
          proc.controlListener({
            type: "control_response",
            request_id: req.request_id,
            response: {
              subtype: "success",
              request_id: req.request_id,
              response: { categories: [], totalTokens: 1, maxTokens: 123_456, percentage: 1 },
            },
          });
        }, 0);
        return true;
      },
    };
    return proc;
  };
  a.processes.set("claude-code:routed", procWith("127.0.0.1:15721"));
  assert.equal((await a.contextUsage("routed")).ok, true);
  assert.equal(window(), before, "a routed read leaves Claude Opus's remembered window alone");
  a.processes.set("claude-code:direct", procWith(undefined));
  assert.equal((await a.contextUsage("direct")).ok, true);
  assert.equal(window(), 123_456, "a direct read is remembered, as before");
}

// A wait for Claude's limit to lift does not wake the session once the box talks to a router.
{
  const a = adapterHere();
  const woken: string[] = [];
  a.sessionProvider = () => undefined;
  a.wake = async (sessionId: string) => {
    woken.push(sessionId);
    return true;
  };
  /** A usage answer with no window at its cap. */
  // SAFETY: the probe's reply shape, as far as `stillLimitedUntil` reads it
  const lifted = (async () => ({ ok: true, fetchedAt: 0, windows: [] })) as any;
  a.route = async () => ({ state: "routed", host: "127.0.0.1:15721" });
  await a.continueAfterLimit("s1", lifted);
  assert.deepEqual(woken, [], "the local model is not told to continue Claude's work");
  a.route = async () => ({ state: "direct" });
  await a.continueAfterLimit("s1", lifted);
  assert.deepEqual(woken, ["s1"], "on a direct box the wake goes out as before");
}

// The panel login is the Claude account's token: it rides in a local Claude's environment, but not
// when the turn was proven to go to a router.
{
  const token = `sk-ant-oat01-${"a".repeat(60)}`;
  const file = sshTokenPath(STATE_DIR, THIS_BOX);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, token);
  const a = adapterHere();
  assert.equal(a.localEnvOverride()?.CLAUDE_CODE_OAUTH_TOKEN, token, "direct: the token rides");
  a.routedNow = true;
  assert.equal(a.localEnvOverride()?.CLAUDE_CODE_OAUTH_TOKEN, undefined, "routed: it stays home");
}

// Hides stored before the key named a box are carried to this box's key at start, once.
{
  const path = join(tempDir("omc-hides-"), "hints.json");
  writeFileSync(path, JSON.stringify({ "hideModel:claude-sonnet-5": true, starterOff: true }));
  const a = adapterHere();
  await a.carryHides(path);
  const moved = { "hideModel:claude-code:claude-sonnet-5": true, starterOff: true };
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), moved);
  await a.carryHides(path);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), moved, "a second start changes nothing");
}

console.log("routed isolation ok");
process.exit(0);
