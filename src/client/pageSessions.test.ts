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

// An SSH box is just another group keyed `ssh:<host>`, so the box filter selects it like any other.
{
  const nova: GroupInfo = {
    key: "ssh:nova",
    name: "Nova",
    ok: true,
    sshBox: true,
    sessions: [sess("r", 9)],
  };
  const { list } = pageSessions([many, nova], {
    box: "ssh:nova",
    cwd: "all",
    origin: "all",
    shown: {},
  });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.s.id, "r");
  assert.equal(list[0]?.g.sshBox, true);
}

// A typed query narrows by title, id or path, every word in any order, case-insensitively.
{
  const g = group("local", [
    sess("aa11", 3, { title: "Fix the cost pill", cwd: "/p/app" }),
    sess("bb22", 2, { title: "Tooltip on the button", cwd: "/p/app" }),
    sess("cc33", 1, { cwd: "/srv/site", dsh: { archived: true } }),
  ]);
  const ids = (q: string, origin = "all") =>
    pageSessions([g], { box: "all", cwd: "all", origin, query: q, shown: {} }).list.map(
      (r) => r.s.id,
    );
  assert.deepEqual(ids("PILL cost"), ["aa11"], "words in any order, case folded");
  assert.deepEqual(ids("bb2"), ["bb22"], "an id fragment");
  assert.deepEqual(ids("srv"), ["cc33"], "a path fragment");
  assert.deepEqual(ids("site", "archived"), ["cc33"], "stacks with the origin filter");
  assert.deepEqual(ids("  "), ["aa11", "bb22", "cc33"], "blank keeps every row");
  assert.deepEqual(ids("nothing-here"), []);
}

// `deepIds` is the id filter a deep transcript search sets; the typed query filter does not.
{
  // No `deepIds` at all: the filter is absent, so the answer is exactly what it was before.
  {
    const g = group("local", [
      sess("aa11", 3, { title: "Fix the cost pill", cwd: "/p/app" }),
      sess("bb22", 2, { title: "Tooltip on the button", cwd: "/p/app" }),
    ]);
    const { list } = pageSessions([g], { box: "all", cwd: "all", origin: "all", shown: {} });
    assert.deepEqual(
      list.map((r) => r.s.id),
      ["aa11", "bb22"],
      "an absent deepIds keeps every row",
    );
  }

  // A single id in `deepIds` survives alone, even though every other row would pass the rest.
  {
    const g = group("local", [
      sess("aa11", 3, { title: "Fix the cost pill", cwd: "/p/app" }),
      sess("bb22", 2, { title: "Tooltip on the button", cwd: "/p/app" }),
      sess("cc33", 1, { title: "Third row", cwd: "/p/app" }),
    ]);
    const { list } = pageSessions([g], {
      box: "all",
      cwd: "all",
      origin: "all",
      shown: {},
      deepIds: new Set(["aa11"]),
    });
    assert.deepEqual(
      list.map((r) => r.s.id),
      ["aa11"],
      "only the deep id, the rest dropped even though they pass every other filter",
    );
  }

  // An empty set returns nothing, not everything: the mistake an undefined-versus-empty mix-up makes.
  {
    const g = group("local", [
      sess("aa11", 3, { title: "Fix the cost pill", cwd: "/p/app" }),
      sess("bb22", 2, { cwd: "/p/app" }),
    ]);
    const { list } = pageSessions([g], {
      box: "all",
      cwd: "all",
      origin: "all",
      shown: {},
      deepIds: new Set<string>(),
    });
    assert.equal(list.length, 0, "an empty set matches no row, not every row");
  }

  // Both filters apply together, neither wins over the other. A deep id that also matches the query
  // survives; a deep id whose title misses the query is dropped by the query; a row that matches the
  // query but is not a deep id is dropped by the set. Only aa11 passes both.
  {
    const g = group("local", [
      sess("aa11", 3, { title: "Fix the cost pill", cwd: "/p/app" }),
      sess("bb22", 2, { title: "Tooltip on the pill", cwd: "/p/app" }),
      sess("cc33", 1, { title: "Third row", cwd: "/p/app" }),
    ]);
    const { list } = pageSessions([g], {
      box: "all",
      cwd: "all",
      origin: "all",
      query: "pill",
      shown: {},
      deepIds: new Set(["aa11", "cc33"]),
    });
    assert.deepEqual(
      list.map((r) => r.s.id),
      ["aa11", "cc33"],
      "a deep search replaces the title filter: cc33 has no `pill` in its title and still shows",
    );
  }
}

console.log("pageSessions: ok");
