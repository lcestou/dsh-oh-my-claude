// Offline self-check: bun src/client/panel/mode-pick.test.ts. The Access pick rule both composers
// share, with no DOM: under the default `dsh` config it must match the rule the panel had before,
// and under a pinned mode a pick must neither fall back to the pin nor widen dsh's shield.
import assert from "node:assert/strict";
import type { PermissionModeState } from "../events.js";
import { clearsOverride, keepsShield } from "./mode-pick.js";

const MODES = ["plan", "default", "acceptEdits", "auto", "dontAsk", "bypassPermissions"];
const SHIELDS = ["read-only", "workspace-write", "danger-full-access"];
const DSH_DEFAULTS = {
  "read-only": "plan",
  "workspace-write": "acceptEdits",
  "danger-full-access": "bypassPermissions",
};
// The modes a `dsh` session may be in on each shield: modesUpTo of the shield's mapping.
const DSH_ALLOWED: Record<string, string[]> = {
  "read-only": ["plan"],
  "workspace-write": ["plan", "default", "acceptEdits"],
  "danger-full-access": MODES,
};

/** A permission-mode reply with the given fields over a `dsh` Workspace Write session. */
const snap = (o: Partial<PermissionModeState>): PermissionModeState => ({
  mode: "acceptEdits",
  override: null,
  modes: DSH_ALLOWED["workspace-write"] ?? [],
  accessMode: "workspace-write",
  ceiling: "acceptEdits",
  defaultModes: DSH_DEFAULTS,
  liveMode: null,
  ...o,
});

/** The clear rule the panel hardcoded before `defaultModes`, keyed on the pick alone. */
const oldClear = (m: string): boolean =>
  m === "plan" || m === "acceptEdits" || m === "bypassPermissions";

// Default `dsh`: every pick on every shield clears exactly as before, and no reachable state ever
// skips the pick, so the shield moves to the pick's preset as it always did.
for (const shield of SHIELDS) {
  for (const inForce of DSH_ALLOWED[shield] ?? []) {
    for (const m of MODES) {
      const s = snap({ accessMode: shield, mode: inForce });
      assert.equal(clearsOverride(m, s), oldClear(m), `dsh ${shield} ${inForce} pick ${m}`);
      assert.equal(keepsShield(m, s), false, `dsh ${shield} ${inForce} pick ${m}`);
    }
  }
}

// Pinned: only the pin clears, on any shield. Accept edits under a pinned Auto, or Plan under a
// pinned Bypass, is stored as an override instead of falling back to the pin.
for (const pin of MODES) {
  const defaultModes = Object.fromEntries(SHIELDS.map((s) => [s, pin]));
  for (const shield of SHIELDS) {
    for (const m of MODES) {
      const s = snap({ accessMode: shield, mode: pin, ceiling: pin, defaultModes });
      assert.equal(clearsOverride(m, s), m === pin, `pin ${pin} ${shield} pick ${m}`);
    }
  }
}

// The checked Auto row under a pinned Auto on Workspace Write: the pick does nothing, rather than
// sending `/permission danger-full-access`. On Full access it widens nothing, so it goes through.
const pinnedAuto = Object.fromEntries(SHIELDS.map((s) => [s, "auto"]));
const autoOn = (accessMode: string): PermissionModeState =>
  snap({ accessMode, mode: "auto", liveMode: "auto", ceiling: "auto", defaultModes: pinnedAuto });
assert.equal(keepsShield("auto", autoOn("workspace-write")), true);
assert.equal(keepsShield("auto", autoOn("read-only")), true);
assert.equal(keepsShield("auto", autoOn("danger-full-access")), false);
// Another row on the same session is a real pick and still goes through.
assert.equal(keepsShield("acceptEdits", autoOn("workspace-write")), false);
assert.equal(keepsShield("dontAsk", autoOn("workspace-write")), false);
// Before the first prompt names a shield nothing is known to widen, so the old path runs.
assert.equal(keepsShield("auto", snap({ accessMode: null, mode: "auto" })), false);
