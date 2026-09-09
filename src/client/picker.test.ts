// Offline checks for the Add workspace dialog's breadcrumb trail: bun src/client/picker.test.ts.
// No DOM, no network — the trail is built from the path so a level that came over ssh reads the
// same as a local one.
import assert from "node:assert/strict";
import { baseName, crumbsOf } from "./picker.js";

// Under the box's home: the first crumb is Home, and every crumb after it is a jump target.
{
  assert.deepEqual(crumbsOf("/home/me/Projects/app", "/home/me", "Home"), [
    { label: "Home", path: "/home/me" },
    { label: "Projects", path: "/home/me/Projects" },
    { label: "app", path: "/home/me/Projects/app" },
  ]);
  assert.deepEqual(crumbsOf("/home/me", "/home/me", "Home"), [{ label: "Home", path: "/home/me" }]);
  // The box's home is its own account's, which on a box is rarely this PC's path.
  assert.deepEqual(crumbsOf("/srv/app", "/root", "Home"), [
    { label: "/", path: "/" },
    { label: "srv", path: "/srv" },
    { label: "app", path: "/srv/app" },
  ]);
  // A home the listing could not name leaves the trail rooted at the filesystem root.
  assert.deepEqual(crumbsOf("/", "", "Home"), [{ label: "/", path: "/" }]);
  // A path that only starts with the same letters is not under the home.
  assert.equal(crumbsOf("/home/melanie/p", "/home/me", "Home")[0]?.label, "/");
}

// A remote workspace is named after the directory it pins.
{
  assert.equal(baseName("/srv/app"), "app");
  assert.equal(baseName("/"), "", "the root has no name to take");
}

console.log("picker ok");
