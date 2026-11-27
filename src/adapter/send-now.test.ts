// Send now on the steer card: the plugin's own send-now (take the steer back from the CLI, cut the
// turn through dsh, put the steer back once dsh is idle). Claude Code 2.1.332 has a native
// `update_queued_message` request with `priority: "now"`, but it answers `unsupported_request`
// unless a server flag is on, and its send-now drains the queue the way an interrupt does, into a
// turn the CLI starts on its own and dsh never opened. These blocks pin the hold path, so a later
// switch has a baseline to match.
import { strict as assert } from "node:assert";
import type { PluginContext } from "../dsh.js";
import type { ClaudeProcess } from "../process.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { registryKey } from "./types.js";

/** A live process mid-turn with steers written to stdin; every control request is answered with
 *  `{ cancelled }` on the next tick, the way the CLI answers `cancel_async_message`. */
function makeProc(
  cancelled: boolean,
  steers: Array<[string, { uuid: string; text: string; at: number }]>,
) {
  const written: Array<{ subtype: string; message_uuid?: string }> = [];

  const proc: Record<string, unknown> = {
    alive: true,
    busy: true,
    relays: new Map(),
    controlListener: undefined,
    steerPending: true,
    forwarded: steers.length,
    sent: new Set(steers.map(([id]) => `k-${id}`)),
    steers: new Map(steers.map(([id, s]) => [id, { ...s, key: `k-${id}` }])),
    /** Records each control request and answers it `{ cancelled }` on the next tick. */
    write(line: string) {
      const req = JSON.parse(line);

      if (req.type !== "control_request") {
        return true;
      }

      written.push(req.request);
      setTimeout(() => {
        // SAFETY: the adapter installs this listener before writing a control request
        (proc.controlListener as (e: object) => void)({
          type: "control_response",
          response: { subtype: "success", request_id: req.request_id, response: { cancelled } },
        });
      }, 0);

      return true;
    },
  };

  // SAFETY: partial fake; the send-now path reads only the fields above
  return { proc: proc as unknown as ClaudeProcess, raw: proc, written };
}

/** A dsh agent whose inbox holds `ids`, recording every call send-now makes on it in order. */
function makeAgent(ids: Array<[string, string]>, withCancel = true) {
  const calls: Array<string> = [];

  const nextStep = ids.map(([id, text]) => ({
    id,
    role: "user",
    source: { kind: "user", rpcId: `r-${id}` },
    content: [{ type: "text", text }],
  }));

  const agent: Record<string, unknown> = {
    inbox: {
      nextStep,
      replace: () => true,
      /** Records the inbox removal. */
      remove(id: string) {
        calls.push(`remove ${id}`);

        return true;
      },
    },
    /** Records the steer and its text. */
    steer(m: { id: string; content: Array<{ text: string }> }) {
      calls.push(`steer ${m.id} ${m.content[0]!.text}`);
    },
    /** Records a follow-up, which send-now must never use. */
    followup(m: { id: string }) {
      calls.push(`followup ${m.id}`);
    },
  };

  if (withCancel) {
    /** Records the turn cut and whether the inbox was kept. */
    agent.cancel = (reason: { kind: string }, opts: { keepInbox?: boolean }) =>
      calls.push(`cancel ${reason.kind} keepInbox=${opts.keepInbox}`);
    /** Records the wait for dsh to go idle. */
    agent.whenIdle = async () => {
      calls.push("idle");
    };
  }

  return { agent, calls };
}

/** An adapter whose context hands out `agent` for every session. */
function adapterWith(agent: object) {
  // SAFETY: partial fake; send-now reads `agents.get` and subscribes with `on`
  const ctx = { on() {}, agents: { get: () => agent } } as unknown as PluginContext;

  return new ClaudeCodeAdapter(ctx, Config({}));
}

// One waiting steer: cancelled in the CLI by its uuid, out of dsh's inbox, the turn cut with the
// inbox kept, and only once dsh is idle steered back as it was. The card is empty afterwards.
{
  const { agent, calls } = makeAgent([["m1", "first"]]);
  const adapter = adapterWith(agent);
  const { proc, raw, written } = makeProc(true, [["m1", { uuid: "u1", text: "first", at: 5 }]]);
  adapter.processes.set(registryKey(adapter.providerId, "s1"), proc);
  assert.deepEqual(await adapter.sendSteerNow("s1", ["m1"]), { ok: true });
  assert.deepEqual(written, [{ subtype: "cancel_async_message", message_uuid: "u1" }]);
  assert.deepEqual(calls, ["remove m1", "cancel user keepInbox=true", "idle", "steer m1 first"]);
  assert.equal(raw.steerPending, false, "nothing forwarded is left, so the park flag drops");
  assert.deepEqual(adapter.steersFor("s1"), { waiting: [], held: [] });
}

// Two waiting steers, asked newest first: both cancelled oldest first, one cut, both steered back
// oldest first, so Claude reads them in the order they were typed.
{
  const { agent, calls } = makeAgent([
    ["m1", "first"],
    ["m2", "second"],
  ]);

  const adapter = adapterWith(agent);

  const { proc, written } = makeProc(true, [
    ["m1", { uuid: "u1", text: "first", at: 5 }],
    ["m2", { uuid: "u2", text: "second", at: 9 }],
  ]);

  adapter.processes.set(registryKey(adapter.providerId, "s1"), proc);
  assert.deepEqual(await adapter.sendSteerNow("s1", ["m2", "m1"]), { ok: true });
  assert.deepEqual(
    written.map((w) => w.message_uuid),
    ["u1", "u2"],
  );
  assert.deepEqual(calls, [
    "remove m1",
    "remove m2",
    "cancel user keepInbox=true",
    "idle",
    "steer m1 first",
    "steer m2 second",
  ]);
}

// The CLI already took it (`cancelled: false`): Claude is reading it, so nothing is cut and
// nothing goes back. The card drops the row.
{
  const { agent, calls } = makeAgent([["m1", "first"]]);
  const adapter = adapterWith(agent);
  const { proc } = makeProc(false, [["m1", { uuid: "u1", text: "first", at: 5 }]]);
  adapter.processes.set(registryKey(adapter.providerId, "s1"), proc);
  assert.deepEqual(await adapter.sendSteerNow("s1", ["m1"]), { ok: false, reason: "sent" });
  assert.deepEqual(calls, []);
  assert.deepEqual(adapter.steersFor("s1").waiting, []);
}

// A dsh agent without `cancel`: the steer goes back untouched and the refusal says why.
{
  const { agent, calls } = makeAgent([["m1", "first"]], false);
  const adapter = adapterWith(agent);
  const { proc } = makeProc(true, [["m1", { uuid: "u1", text: "first", at: 5 }]]);
  adapter.processes.set(registryKey(adapter.providerId, "s1"), proc);
  assert.deepEqual(await adapter.sendSteerNow("s1", ["m1"]), {
    ok: false,
    reason: "error",
    error: "this dsh cannot cut a turn short",
  });
  assert.deepEqual(calls, ["remove m1", "steer m1 first"]);
}

console.log("send-now hold path ok");
