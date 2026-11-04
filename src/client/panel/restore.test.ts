// Offline self-check for the panel's opening tab: the blank-session race the owner hit on
// 2026-11-04 (flower clicked before the workspace's transcript list answered) opens on Restore.
import assert from "node:assert/strict";
import { panelOpenTab } from "./restore.js";

// A blank session with something to restore opens on Restore.
assert.equal(
  panelOpenTab({ blank: true, restorable: 2, unknown: false, lastTab: "Memory" }),
  "Restore",
);
// The race: list still unknown, so Restore still wins.
assert.equal(
  panelOpenTab({ blank: true, restorable: 0, unknown: true, lastTab: "Memory" }),
  "Restore",
);
// Known empty list: the last tab, as before.
assert.equal(
  panelOpenTab({ blank: true, restorable: 0, unknown: false, lastTab: "Changes" }),
  "Changes",
);
// A session with content never opens on Restore, even when Restore was the last tab.
assert.equal(
  panelOpenTab({ blank: false, restorable: 3, unknown: true, lastTab: "Restore" }),
  "Memory",
);
assert.equal(
  panelOpenTab({ blank: false, restorable: 0, unknown: false, lastTab: "Tasks" }),
  "Tasks",
);
console.log("panelOpenTab ok");
