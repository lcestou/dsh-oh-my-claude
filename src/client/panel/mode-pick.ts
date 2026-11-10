// What a Claude mode pick in the Access control does to dsh's shield and the stored override. Pure,
// so the shield and the composer trigger share one rule that is tested without a DOM, in
// mode-pick.test.ts.
import type { PermissionModeState } from "../events.js";

// Claude mode → dsh preset it needs.
export const PRESET_FOR_MODE = {
  plan: "read-only",
  default: "workspace-write",
  acceptEdits: "workspace-write",
  auto: "danger-full-access",
  dontAsk: "danger-full-access",
  bypassPermissions: "danger-full-access",
} satisfies Record<string, string>;

// dsh's presets from strictest to loosest.
const PRESET_RANK = {
  "read-only": 0,
  "workspace-write": 1,
  "danger-full-access": 2,
} as const satisfies Record<string, number>;

/** A preset's place from strictest, or `fallback` for a preset this table does not know. */
const rankOf = (preset: string, fallback: number): number =>
  // SAFETY: the key is checked against the table before it is used as its index
  Object.hasOwn(PRESET_RANK, preset) ? PRESET_RANK[preset as keyof typeof PRESET_RANK] : fallback;

/** The dsh permission preset that matches a Claude mode. Callers pass one of the six mode keys; any
 *  other string gives undefined despite the type. */
export const presetForMode = (m: string): string =>
  // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys; all callers pass a known key.
  PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];

/** Whether picking `mode` should clear the stored override rather than store one: only when the
 *  mode equals what a session with no override runs in on the shield the pick lands on, which is
 *  always the mode's own preset. Under the `dsh` config that is the old rule (Plan on Read Only,
 *  Accept edits on Workspace Write, Bypass on Full access); under a pinned mode only the pin
 *  clears, so any other pick is stored instead of falling back to the pin. */
export const clearsOverride = (mode: string, snap: PermissionModeState): boolean =>
  mode === snap.defaultModes[presetForMode(mode)];

/** Whether a pick of `mode` must leave everything as it is: the mode is already in force and its
 *  preset is looser than the shield. Only a pinned config puts a session there (a pinned Auto on
 *  Workspace Write), and sending the pick on would widen the shield to the mode's preset. Under
 *  `dsh` the mode in force never sits above its shield, so this is always false. An unknown shield
 *  (no access mode yet) returns false and keeps the old path. */
export const keepsShield = (mode: string, snap: PermissionModeState): boolean =>
  mode === snap.mode &&
  snap.accessMode !== null &&
  rankOf(presetForMode(mode), 0) > rankOf(snap.accessMode, 2);
