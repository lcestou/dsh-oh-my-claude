// A wake for a subagent's session goes through its parent: dsh refuses `resolveAgent` on a child
// ("owned by subagent routing"), so the notice is sent with `subagents.sendMessage` from the live
// parent, which cold-resumes the child. A parent's own restart notice then names the children that
// were continued, so it does not hand them the work again.
import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Agent, PluginContext } from "../dsh.js";
import { markBusy } from "../state.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { childrenContinuedText, RESTART_TEXT, WAKE_TEXT, wakeOnlyTurn } from "./turn.js";

interface Sent {
  sender: string;
  target: string;
  text: string;
}

/** A dsh with one root `p1` and its subagent `c1`, neither loaded; `extra` adds more headers. */
function world(
  options: {
    parentLive?: boolean;
    childEvents?: unknown[];
    subagents?: boolean;
    headers?: Record<string, { parentSession?: string; origin?: string }>;
  } = {},
) {
  const sent: Sent[] = [];
  const followups: Array<{ id: string; content: Array<{ text: string }> }> = [];
  const resolved: string[] = [];
  const headers: Record<string, { parentSession?: string; origin?: string }> = {
    p1: {},
    c1: { parentSession: "p1", origin: "subagent" },
    ...options.headers,
  };
  const agent = (id: string) => ({
    id,
    status: "idle",
    followup(m: { content: Array<{ text: string }> }) {
      followups.push({ id, content: m.content });
    },
  });
  const live = new Map<string, ReturnType<typeof agent>>();
  if (options.parentLive) live.set("p1", agent("p1"));
  const services: Record<string, unknown> = {
    sessionQuery: {
      observeSession: async (id: string) => {
        const header = headers[id];
        if (!header) throw new Error(`session "${id}" not found`);
        return {
          header,
          events: id === "c1" ? (options.childEvents ?? []) : [],
          [Symbol.dispose]() {},
        };
      },
    },
  };
  if (options.subagents !== false)
    services.subagents = {
      sendMessage: async (
        sender: Agent,
        target: string,
        content: Array<{ text: string }>,
        opts: { signal: AbortSignal },
      ) => {
        assert.ok(opts.signal instanceof AbortSignal, "a signal bounds the send");
        sent.push({ sender: String(sender.id), target, text: content.map((b) => b.text).join("") });
        return "m1";
      },
    };
  // SAFETY: partial fake; wake reads sessions, agents and get(sessionQuery | subagents)
  const ctx = {
    on() {},
    get: (name: string) => services[name],
    sessions: { get: () => undefined },
    agents: { get: (id: string) => live.get(id) },
  } as unknown as PluginContext;
  // The double-wake guard and the continued-children map are process-wide; each block starts clean.
  ClaudeCodeAdapter.wokeThroughParent.clear();
  ClaudeCodeAdapter.continuedChildren.clear();
  const adapter = new ClaudeCodeAdapter(ctx, Config({}));
  adapter.sessionController = {
    resolveAgent: async (id: string) => {
      resolved.push(id);
      const header = headers[id];
      if (header?.origin === "subagent")
        return { error: new Error(`session "${id}" is owned by subagent routing`) };
      const a = agent(id);
      live.set(id, a);
      // SAFETY: partial Agent; wake reads id, status and followup
      return { agent: a as unknown as Agent };
    },
    // SAFETY: the rest of the controller is not reached by a wake
  } as unknown as ClaudeCodeAdapter["sessionController"];
  return { adapter, sent, followups, resolved };
}

{
  const w = world();
  assert.equal(await w.adapter.wake("c1", undefined, RESTART_TEXT), true, "the child is woken");
  assert.deepEqual(w.sent, [{ sender: "p1", target: "c1", text: RESTART_TEXT }]);
  assert.deepEqual(w.resolved, ["p1"], "the parent is resumed; the child is never asked for");
  assert.equal(w.followups.length, 0, "no followup straight into the child");
  assert.deepEqual([...(ClaudeCodeAdapter.continuedChildren.get("p1") ?? [])], ["c1"]);

  // The parent's own restart notice names the child once, in a block of its own.
  assert.equal(await w.adapter.wake("p1", undefined, RESTART_TEXT), true);
  assert.deepEqual(
    w.followups.map((f) => f.content.map((b) => b.text)),
    [[RESTART_TEXT, childrenContinuedText(["c1"])]],
  );
  assert.equal(ClaudeCodeAdapter.continuedChildren.has("p1"), false, "named once, then forgotten");
}

{
  const w = world({ parentLive: true });
  assert.equal(await w.adapter.wake("c1", undefined, WAKE_TEXT), true);
  assert.deepEqual(w.resolved, [], "a live parent is used as it is");
  assert.equal(w.sent[0]?.text, WAKE_TEXT);
  assert.equal(
    ClaudeCodeAdapter.continuedChildren.size,
    0,
    "a background-task wake is no continuation",
  );
}

{
  // Two wakes in the same moment (an adopted keeper's drain and its idle result) send once, also
  // while the parent is still being loaded.
  const w = world();
  const both = await Promise.all([
    w.adapter.wake("c1", undefined, WAKE_TEXT),
    w.adapter.wake("c1", undefined, WAKE_TEXT),
  ]);
  assert.deepEqual(both, [true, true]);
  assert.equal(w.sent.length, 1, "one message through the parent");
}

{
  // A restart notice already waits in the child's inbox (an earlier boot sent it): not stacked.
  const pending = {
    type: "agent/inbox/spliced",
    data: {
      target: "next-turn",
      inserted: [
        {
          source: { kind: "agent-message", form: "relay", senderSessionId: "p1" },
          content: [
            { type: "text", text: "Agent p1 sent a message: " },
            { type: "text", text: RESTART_TEXT },
          ],
        },
      ],
    },
  };
  const w = world({ childEvents: [pending] });
  assert.equal(await w.adapter.wake("c1", undefined, RESTART_TEXT), true);
  assert.equal(w.sent.length, 0, "nothing sent on top of the pending notice");
}

{
  // The parent is a subagent too: out of reach for this wake.
  const w = world({ headers: { p1: { parentSession: "root", origin: "subagent" } } });
  assert.equal(await w.adapter.wake("c1", undefined, RESTART_TEXT), false);
  assert.equal(w.sent.length, 0);
}

{
  // A dsh without the subagent service cannot reach a child at all.
  const w = world({ subagents: false });
  assert.equal(await w.adapter.wake("c1", undefined, RESTART_TEXT), false);
}

{
  // A fork carries a parent but is no subagent: woken like any root.
  const w = world({ headers: { f1: { parentSession: "p1" } } });
  assert.equal(await w.adapter.wake("f1", undefined, RESTART_TEXT), true);
  assert.equal(w.sent.length, 0);
  assert.deepEqual(w.resolved, ["f1"]);
  assert.equal(w.followups[0]?.id, "f1");
}

{
  // At boot, children are nudged before their parents, so the parent's notice can name them.
  const w = world();
  const busyPath = join(w.adapter.stateDir, "busy.json");
  rmSync(join(w.adapter.stateDir, "boot.json"), { force: true });
  await markBusy("p1", true, busyPath);
  await markBusy("c1", true, busyPath);
  await w.adapter.resumeInterrupted(busyPath);
  assert.deepEqual(
    w.sent.map((s) => s.target),
    ["c1"],
  );
  assert.deepEqual(
    w.followups.map((f) => [f.id, f.content.length]),
    [["p1", 2]],
    "the parent's notice carries the continued-children line",
  );
}

{
  // A background-task wake relayed into a subagent's session is still a wake-only turn.
  const relayed = {
    role: "user",
    source: { kind: "agent-message" },
    content: [
      { type: "text" as const, text: "Agent p1 sent a message: " },
      { type: "text" as const, text: WAKE_TEXT },
    ],
  };
  assert.equal(wakeOnlyTurn([relayed]), true);
  const prompt = { ...relayed, content: [{ type: "text" as const, text: "do more" }] };
  assert.equal(wakeOnlyTurn([prompt]), false, "a real message from the parent is a prompt");
}

console.log("wake-subagent ok");
process.exit(0);
