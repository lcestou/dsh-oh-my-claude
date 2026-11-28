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

/** PRESET_RANK by name, for a lookup with whatever preset dsh reports. */
const RANK_BY_PRESET = new Map<string, number>(Object.entries(PRESET_RANK));

/** A preset's place from strictest, or `fallback` for a preset this table does not know. */
const rankOf = (preset: string, fallback: number): number => RANK_BY_PRESET.get(preset) ?? fallback;

/** The dsh permission preset that matches one of the six Claude modes. */
export const presetForMode = (m: keyof typeof PRESET_FOR_MODE): string => PRESET_FOR_MODE[m];

/** PRESET_FOR_MODE by mode, for a mode named by a string from elsewhere; an unknown one has none. */
const PRESET_BY_MODE = new Map<string, string>(Object.entries(PRESET_FOR_MODE));

/** What each shield gives a session with no override when `permissionMode` is `dsh`. */
const DSH_DEFAULTS = {
  "read-only": "plan",
  "workspace-write": "acceptEdits",
  "danger-full-access": "bypassPermissions",
} satisfies Record<string, string>;

/** The snapshot's per-shield defaults, or the `dsh` mapping when the server sent none. */
const defaultsOf = (snap: PermissionModeState): Record<string, string> =>
  snap.defaultModes ?? DSH_DEFAULTS;

/** Whether picking `mode` should clear the stored override rather than store one: only when the
 *  mode equals what a session with no override runs in on the shield the pick lands on, which is
 *  always the mode's own preset. Under the `dsh` config that is the old rule (Plan on Read Only,
 *  Accept edits on Workspace Write, Bypass on Full access); under a pinned mode only the pin
 *  clears, so any other pick is stored instead of falling back to the pin. */
export const clearsOverride = (mode: string, snap: PermissionModeState): boolean =>
  // A snapshot from a server older than this client has no map (the client hot-reloads, the
  // server waits for a restart): the `dsh` mapping is what that server uses, so it stands in.
  mode === defaultsOf(snap)[PRESET_BY_MODE.get(mode) ?? ""];

/** Whether a pick of `mode` must leave everything as it is: the mode is already in force and its
 *  preset is looser than the shield. Only a pinned config puts a session there (a pinned Auto on
 *  Workspace Write), and sending the pick on would widen the shield to the mode's preset. Under
 *  `dsh` the mode in force never sits above its shield, so this is always false. An unknown shield
 *  (no access mode yet) returns false and keeps the old path. */
export const keepsShield = (mode: string, snap: PermissionModeState): boolean =>
  mode === snap.mode &&
  snap.accessMode !== null &&
  rankOf(PRESET_BY_MODE.get(mode) ?? "", 0) > rankOf(snap.accessMode, 2);
