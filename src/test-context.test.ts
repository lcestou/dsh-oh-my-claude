// Offline self-check of the typed dsh fakes the other suites build on.
import assert from "node:assert/strict";
import { asSessionId } from "./dsh.js";
import { fakeAgent, fakePluginContext, fakeSession, rowsOf } from "./test-context.js";

// A context's root is the fake itself, optional services read as absent, and an unfaked method
// names itself when called.
{
  const ctx = fakePluginContext({ sessions: { list: () => [] } });
  assert.equal(ctx.root, ctx);
  assert.equal(ctx.get("compaction"), undefined);
  assert.deepEqual(ctx.sessions.list(), []);
  assert.throws(() => ctx.sessions.flush(fakeSession()), /not faked: sessions\.flush/);
  assert.equal(ctx.on, undefined, "optional members stay absent");
}

// A getter handed in stays live instead of being read once.
{
  let seq = 1;

  const session = fakeSession({
    header: { cwd: "/w" },
    get seq() {
      return seq;
    },
  });

  seq = 5;

  assert.equal(session.seq, 5);
  assert.equal(session.header.cwd, "/w");
  assert.equal(session.header.version, 0);
}

// An agent keeps the id it was given.
{
  const agent = fakeAgent({ id: asSessionId("a1") });
  assert.equal(agent.id, "a1");
  assert.equal(agent.steer, undefined, "optional members stay absent");
}

// A reply list decodes when every row carries the named fields, and fails the test otherwise.
{
  const rows = rowsOf(
    [
      { name: "a.md", size: 3 },
      { name: "b.md", size: 4, hidden: true },
    ],
    {
      name: "string",
      hidden: "boolean?",
    },
  );

  assert.deepEqual(
    rows.map((r) => [r.name, r.hidden]),
    [
      ["a.md", undefined],
      ["b.md", true],
    ],
  );
  assert.throws(() => rowsOf([{ name: 1 }], { name: "string" }), /to carry/);
  assert.throws(() => rowsOf({ name: "a" }, { name: "string" }), /expected a list/);
}

console.log("test-context: ok");
