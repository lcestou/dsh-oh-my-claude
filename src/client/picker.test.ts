// Offline checks for the Add workspace dialog: bun src/client/picker.test.ts.
// No DOM, no network. The ancestry a remote level gets, the name a remote workspace takes, and the
// ported dialog's pure helpers: crumb display, draft reading and the row filter.
import assert from "node:assert/strict";
import { ancestry, baseName } from "./picker.js";
import { displayCrumbs, readDraft, visibleEntries, type Listing } from "./browser.js";

// A remote level's ancestry: root first, named by its own path, then one crumb per segment.
{
  assert.deepEqual(ancestry("/home/me/Projects/app"), [
    { name: "/", path: "/", hidden: false },
    { name: "home", path: "/home", hidden: false },
    { name: "me", path: "/home/me", hidden: false },
    { name: "Projects", path: "/home/me/Projects", hidden: false },
    { name: "app", path: "/home/me/Projects/app", hidden: false },
  ]);
  assert.deepEqual(ancestry("/"), [{ name: "/", path: "/", hidden: false }]);
}

// The dialog collapses the chain to Home inside the home subtree and shows it whole outside.
{
  const under: Listing = {
    path: "/home/me/Projects",
    home: "/home/me",
    crumbs: ancestry("/home/me/Projects"),
    entries: [],
  };
  assert.deepEqual(
    displayCrumbs(under, "Home").map((c) => c.name),
    ["Home", "Projects"],
  );
  const outside: Listing = {
    path: "/srv/app",
    home: "/root",
    crumbs: ancestry("/srv/app"),
    entries: [],
  };
  assert.deepEqual(
    displayCrumbs(outside, "Home").map((c) => c.name),
    ["/", "srv", "app"],
  );
}

// A typed draft: the directory part through its last separator, and the tail only when this
// level is the one that part names.
{
  const level: Listing = {
    path: "/home/me",
    home: "/home/me",
    crumbs: ancestry("/home/me"),
    entries: [],
  };
  assert.deepEqual(readDraft(level, "/home/me/Pro", null), { directory: "/home/me/", tail: "Pro" });
  assert.deepEqual(readDraft(level, "/usr/lo", null), { directory: "/usr/", tail: null });
  assert.deepEqual(readDraft(level, "nope", null), { directory: null, tail: null });
  // The level a draft-following scan just produced answers that directory part too.
  assert.equal(
    readDraft(level, "/home/me/../me/x", { directory: "/home/me/../me/", landed: "/home/me" }).tail,
    "x",
  );
}

// Row filter: hidden rows obey the toggle, a dot prefix reveals them, a prefix nobody matches
// releases the filter, and the selection is never filtered out.
{
  const rows = [
    { name: ".git", path: "/p/.git", hidden: true },
    { name: "app", path: "/p/app", hidden: false },
    { name: "lib", path: "/p/lib", hidden: false },
  ];
  const names = (r: typeof rows) => r.map((e) => e.name);
  assert.deepEqual(names(visibleEntries(rows, null, false, null)), ["app", "lib"]);
  assert.deepEqual(names(visibleEntries(rows, null, true, null)), [".git", "app", "lib"]);
  assert.deepEqual(names(visibleEntries(rows, null, false, "a")), ["app"]);
  assert.deepEqual(names(visibleEntries(rows, null, false, ".g")), [".git"]);
  assert.deepEqual(names(visibleEntries(rows, null, false, "zzz")), ["app", "lib"]);
  assert.deepEqual(names(visibleEntries(rows, "/p/.git", false, "l")), [".git", "lib"]);
}

// A remote workspace is named after the directory it pins.
{
  assert.equal(baseName("/srv/app"), "app");
  assert.equal(baseName("/"), "", "the root has no name to take");
}

console.log("picker ok");
