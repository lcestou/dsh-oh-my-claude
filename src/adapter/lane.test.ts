// An edit moves a pending message between dsh's queue and its steer list when the edit changes
// what the message is: a queued command row rewritten into plain text steers (with busy-Enter on
// steer), and a steer rewritten into a Claude command or skill line goes to the queue.
import { strict as assert } from "node:assert";

import type { Message } from "@deepseek-ai/dsh-llm";

import type { PluginContext } from "../dsh.js";
import { tempDir } from "../test-tmp.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";
import { busyEnterOf, CommandRows, commandNameOf, leavesQueue, lineReceipt } from "./lane.js";
import type { LooseMessage } from "./prompt.js";

/** A person's pending message with one text block. */
// SAFETY: test fixture, the fields the code under test reads
const row = (id: string, text: string, kind = "user") =>
  ({
    id,
    role: "user",
    source: { kind },
    content: [{ type: "text", text }],
  }) as LooseMessage;

// A command line is a slash and a name, leading space ignored, as dsh's composer reads a draft.
assert.equal(commandNameOf("/unslop tidy this"), "unslop");
assert.equal(commandNameOf("  /ship"), "ship");
assert.equal(commandNameOf("/plugin:skill a b"), "plugin:skill");
assert.equal(commandNameOf("please /unslop this"), undefined);
assert.equal(commandNameOf("/"), undefined);
assert.equal(commandNameOf("/ tmp is full"), undefined);
assert.equal(commandNameOf(""), undefined);

// Only a row the bridge queued, typed by a person, whose words stopped being a command, leaves.
{
  const rows = new CommandRows();
  rows.add("a");
  rows.add(undefined);
  assert.equal(leavesQueue(row("a", "do this instead of /unslop"), rows), true);
  assert.equal(leavesQueue(row("a", "/unslop other arguments"), rows), false, "still a command");
  assert.equal(leavesQueue(row("a", "   "), rows), false, "blank text never moves");
  assert.equal(leavesQueue(row("b", "plain"), rows), false, "not a row the bridge queued");
  assert.equal(leavesQueue(row("a", "plain", "plugin"), rows), false, "not typed by a person");
  rows.delete("a");
  assert.equal(leavesQueue(row("a", "plain"), rows), false, "forgotten once moved");
  // The cap pushes out the oldest; a row added again counts as newest.
  for (let i = 0; i < 200; i++) rows.add(`n${i}`);
  rows.add("n0");
  rows.add("last");
  assert.equal(rows.has("n0"), true);
  assert.equal(rows.has("n1"), false);
  assert.equal(rows.has("last"), true);
}

// The preference is read off whichever described form carries it; anything else is dsh's default.
{
  /** A settings service that describes these forms. */
  const reads = (forms: Array<{ ns?: string; value?: object }>) => ({
    describe: () => forms,
  });
  assert.equal(
    busyEnterOf(reads([{ ns: "x", value: {} }, { value: { busyEnter: "steer" } }])),
    "steer",
  );
  assert.equal(busyEnterOf(reads([{ value: { busyEnter: "queue" } }])), "queue");
  assert.equal(busyEnterOf(reads([{ value: { busyEnter: 7 } }])), "queue");
  assert.equal(busyEnterOf(reads([])), "queue");
  assert.equal(busyEnterOf({}), "queue", "a service with no describe");
  assert.equal(busyEnterOf(undefined), "queue", "no settings service");
}

/** What a fake agent recorded: ids taken out of the inbox, and messages steered and queued. */
interface Moves {
  removed: string[];
  steered: string[];
  queued: string[];
}

/** An adapter over a fake dsh: one agent holding `pending` in its queue, the busy-Enter preference
 *  as given, and the `session/event` handler the adapter registered. */
function setup(pending: LooseMessage[], busyEnter: string | undefined, status = "running") {
  const moves: Moves = { removed: [], steered: [], queued: [] };
  const handlers: Record<string, (session: unknown, event: unknown) => void> = {};
  const agent = {
    status,
    inbox: {
      nextStep: [],
      nextTurn: pending,
      remove(id: string) {
        moves.removed.push(id);
        return true;
      },
    },
    steer(m: Message) {
      moves.steered.push(String(m.id));
    },
    followup(m: Message) {
      moves.queued.push(String(m.id));
    },
  };
  // SAFETY: partial fake; the code under test reads the event hook, the agent and the settings form
  const ctx = {
    on(name: string, fn: (session: unknown, event: unknown) => void) {
      handlers[name] = fn;
    },
    agents: { get: () => agent },
    get: (name: string) =>
      name === "settings" && busyEnter !== undefined
        ? { describe: () => [{ ns: "ui-conversation", value: { busyEnter } }] }
        : undefined,
  } as unknown as PluginContext;
  const adapter = new ClaudeCodeAdapter(ctx, Config({}));
  adapter.stateDir = tempDir("omc-lane-");
  /** dsh's splice event for an edit of `m` in the queue, then one turn of the microtask queue. */
  const edited = async (m: LooseMessage) => {
    handlers["session/event"]?.(
      { id: "s1" },
      {
        type: "agent/inbox/spliced",
        data: { target: "next-turn", inserted: [m], removedCount: 1 },
      },
    );
    await Promise.resolve();
  };
  return { adapter, moves, edited };
}

// Queue to steer: a command row edited into plain text is taken out and steered, once.
{
  const plain = row("q1", "skip that, just check the changelog");
  const { adapter, moves, edited } = setup([plain], "steer");
  adapter.commandRows.add("q1");
  await edited(plain);
  assert.deepEqual(moves.removed, ["q1"]);
  assert.deepEqual(moves.steered, ["q1"]);
  await edited(plain);
  assert.deepEqual(moves.steered, ["q1"], "a second edit of a row already moved does nothing");
}

// It stays in the queue when plain Enter queues, when the preference cannot be read, when the edit
// left it a command, when the bridge never queued it, and when no turn is running.
{
  const plain = row("q1", "plain words");
  for (const pref of ["queue", undefined]) {
    const { adapter, moves, edited } = setup([plain], pref);
    adapter.commandRows.add("q1");
    await edited(plain);
    assert.deepEqual(moves, { removed: [], steered: [], queued: [] }, `preference ${pref}`);
  }
  {
    const still = row("q1", "/unslop the other file");
    const { adapter, moves, edited } = setup([still], "steer");
    adapter.commandRows.add("q1");
    await edited(still);
    assert.deepEqual(moves.steered, [], "arguments changed, still a command");
    assert.equal(adapter.commandRows.has("q1"), true, "and still remembered for a later edit");
  }
  {
    const { moves, edited } = setup([plain], "steer");
    await edited(plain);
    assert.deepEqual(moves.steered, [], "a row the user queued as plain text is theirs to steer");
  }
  {
    const { adapter, moves, edited } = setup([plain], "steer", "idle");
    adapter.commandRows.add("q1");
    await edited(plain);
    assert.deepEqual(moves.steered, [], "no running turn to steer into");
  }
  {
    // Gone from the queue by the time the move runs (the turn ended and took it).
    const { adapter, moves, edited } = setup([], "steer");
    adapter.commandRows.add("q1");
    await edited(plain);
    assert.deepEqual(moves, { removed: [], steered: [], queued: [] });
  }
}

/** Put one typed steer on hold, as the steer card's Edit does, and save it with new words. */
async function saveHeld(text: string, bridged: string[]) {
  const { adapter, moves } = setup([], "steer");
  for (const name of bridged) adapter.bridged.set(name, () => {});
  // SAFETY: the held message as dsh's inbox handed it over
  const held = row("m1", "also look at the tests") as unknown as Message;
  const timer = setTimeout(() => {}, 60_000);
  adapter.heldSteers.set("s1", new Map([["m1", { messages: [held], text: "x", timer }]]));
  const reply = await adapter.releaseHold("s1", "m1", { text });
  clearTimeout(timer);
  return { adapter, moves, reply };
}

// Steer to queue: saved as a Claude command or skill line, the steer waits for the turn to end,
// and is remembered as a command row, so editing it back into plain text steers it again.
{
  const { adapter, moves, reply } = await saveHeld("/unslop the readme", ["unslop"]);
  assert.deepEqual(reply, { ok: true });
  assert.deepEqual(moves.queued, ["m1"]);
  assert.deepEqual(moves.steered, []);
  assert.equal(adapter.commandRows.has("m1"), true);
}
// Anything else is still a steer: plain words, a name Claude Code does not have, and the plugin's
// own commands, which dsh runs and Claude Code would not.
for (const text of ["look at the readme too", "/nosuch thing", "/btw what is this"]) {
  const { moves } = await saveHeld(text, ["unslop", "btw"]);
  assert.deepEqual(moves.steered, ["m1"], text);
  assert.deepEqual(moves.queued, [], text);
}

// The receipt says queued while a turn runs, since the line has only been queued, and keeps the
// idle wording otherwise.
assert.equal(
  lineReceipt("/unslop x", "running", "sent"),
  "/unslop x is queued for Claude Code and goes when this turn ends",
);
assert.equal(lineReceipt("/unslop x", "idle", "sent"), "sent");
assert.equal(lineReceipt("/unslop x", undefined, "sent"), "sent");

console.log("lane ok");
