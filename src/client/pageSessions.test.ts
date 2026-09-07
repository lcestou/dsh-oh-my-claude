import { strict as assert } from "node:assert";
import { type GroupInfo, pageSessions, type SessionData } from "./index.js";

const sess = (id: string, modifiedAt: number, over: Partial<SessionData> = {}): SessionData => ({
  id,
  modifiedAt,
  turns: 1,
  bytes: 0,
  ...over,
});

const group = (key: string, sessions: SessionData[]): GroupInfo => ({
  key,
  name: key,
  ok: true,
  sessions,
});

// 25 sessions in one box, modifiedAt ascending by index.
const many = group(
  "local",
  Array.from({ length: 25 }, (_, i) => sess(`s${i}`, i)),
);

// "all" merges every box under one key, newest first: default cap 10, 15 hidden, matched 25.
{
  const { list, hidden, matched } = pageSessions([many], {
    box: "all",
    cwd: "all",
    origin: "all",
    shown: {},
  });
  assert.equal(list.length, 10);
  assert.equal(list[0]?.s.id, "s24", "newest first");
  assert.equal(list[9]?.s.id, "s15");
  assert.equal(hidden.all, 15);
  assert.equal(matched.all, 25);
}

// One "Load more" press → cap 20, hidden 5.
{
  const { list, hidden } = pageSessions([many], {
    box: "all",
    cwd: "all",
    origin: "all",
    shown: { all: 20 },
  });
  assert.equal(list.length, 20);
  assert.equal(hidden.all, 5);
}

// Cap past total → no hidden key.
{
  const { list, hidden } = pageSessions([many], {
    box: "all",
    cwd: "all",
    origin: "all",
    shown: { all: 100 },
  });
  assert.equal(list.length, 25);
  assert.equal(hidden.all, undefined);
}

// "all" is one timeline across boxes, not per-box sections: rows interleave by modifiedAt.
{
  const a = group("local", [sess("a", 3)]);
  const b = group("box2", [sess("hi", 5), sess("lo", 1)]);
  const { list, matched } = pageSessions([a, b], {
    box: "all",
    cwd: "all",
    origin: "all",
    shown: {},
  });
  assert.deepEqual(
    list.map((r) => r.s.id),
    ["hi", "a", "lo"],
    "merged newest-first across boxes",
  );
  assert.equal(matched.all, 3);
}

// box filter drops other boxes entirely.
{
  const other = group("box2", [sess("x", 5)]);
  const { list } = pageSessions([many, other], {
    box: "box2",
    cwd: "all",
    origin: "all",
    shown: {},
  });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.s.id, "x");
}

// cwd + origin filters narrow matched/hidden before capping.
{
  const g = group("local", [
    sess("a", 3, { cwd: "/p/app" }),
    sess("b", 2, { cwd: "/p/other" }),
    sess("c", 1, { cwd: "/p/app", dsh: { archived: true } }),
  ]);
  const byCwd = pageSessions([g], { box: "all", cwd: "/p/app", origin: "all", shown: {} });
  assert.equal(byCwd.matched.all, 2);
  assert.deepEqual(
    byCwd.list.map((r) => r.s.id),
    ["a", "c"],
  );
  const byOrigin = pageSessions([g], { box: "all", cwd: "all", origin: "archived", shown: {} });
  assert.deepEqual(
    byOrigin.list.map((r) => r.s.id),
    ["c"],
  );
}

console.log("pageSessions: ok");
