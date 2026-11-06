// How a session's Claude Code is started: the plugin config's `spawn` key, else the Settings
// switch "Keep Claude running across dsh restarts" (hint `keeperOff`). prepare() reads it once per
// turn and the answer joins the process spec, so a flip reaches each session on its next turn.
import type { ClaudeProcessSpec } from "../process.js";
import { specKey } from "./turn.js";

/** The three ways the plugin starts Claude Code: under a keeper outside dsh's process tree, as a
 *  plain node child of dsh, or through dsh's subprocess seam. */
export type SpawnSetting = "keeper" | "node" | "dsh";

/** What the Settings switch reads besides its hint: a `spawn: node` or `spawn: dsh` set in the
 *  plugin config, which wins over the switch (`keeper` there is the old default and locks
 *  nothing), and whether this platform can run a keeper at all. */
export interface SpawnModeInfo {
  configured: "node" | "dsh" | null;
  keeper: boolean;
}

/** The hint behind the Settings switch. Absent means on, so a box that never touched the switch
 *  keeps the keeper it ran before the switch existed. */
export const KEEPER_OFF = "keeperOff";

/** The least time a keeper waits, with no dsh attached and no output, before it ends Claude. A
 *  `processIdleMs` lowered toward its 10 s floor would otherwise end an idle keeper during an
 *  ordinary restart: the owner's box was detached 4 to 5 s between dispose and the new adoption. */
export const ORPHAN_FLOOR_MS = 5 * 60_000;

/** The `spawn` key as the switch reads it: `node` and `dsh` win, while `keeper` (the default the
 *  README once told people to paste) and unset both leave the switch in charge. */
export function configuredSpawn(configured: SpawnSetting | undefined): "node" | "dsh" | null {
  return configured === "node" || configured === "dsh" ? configured : null;
}

/**
 * The mode a new Claude process starts in. `spawn: node` or `spawn: dsh` in the plugin config wins;
 * otherwise the switch decides, on for a keeper and off for dsh's subprocess seam (the spawner uses
 * a node child when no seam is mounted). Windows has no unix socket or systemd-run, so on becomes a
 * node child there. Wrong for someone who wrote `spawn: keeper` to pin the keeper against the
 * switch: the switch still turns it off, since that line is indistinguishable from the pasted
 * default.
 */
export function spawnModeFor(
  configured: SpawnSetting | undefined,
  keeperOff: boolean,
  platform: NodeJS.Platform,
): SpawnSetting {
  const wanted = configuredSpawn(configured) ?? (keeperOff ? "dsh" : "keeper");
  return wanted === "keeper" && platform === "win32" ? "node" : wanted;
}

/**
 * True when a live process's spec key differs from the next turn's only in spawn mode (the switch
 * flipped since it started). Such a process is kept for a turn that drains output it already holds
 * (#241 review: a respawn there killed an adopted keeper mid-reply and lost what it wrote while dsh
 * was away); the session's next turn after that replaces it. `procKey` is `specKey` of the
 * process's spec, `procChild` that spec's `child`.
 */
export function flipOnly(
  procKey: string | undefined,
  procChild: "node" | "dsh" | undefined,
  next: ClaudeProcessSpec,
): boolean {
  return procKey !== specKey(next) && procKey === specKey({ ...next, child: procChild });
}

/** The tag this dsh writes on the keepers and holds it starts: its dsh profile directory, such as
 *  `~/.dsh/profiles/web`. Undefined when dsh provides no profile context or an empty dir. */
export function keeperOwner(profile: { readonly dir: string } | undefined): string | undefined {
  return profile?.dir || undefined;
}

/**
 * Whether this dsh may adopt a keeper or hold tagged `theirs`. Two dsh on one box share the state
 * dir (DSH Web and DSH Desktop, #241), and without the tag the one that started later took every
 * keeper the other was attached to. Untagged on either side matches, so a keeper an older plugin
 * started is adopted as before. Wrong when one of the two runs without a profile context, or both
 * run the same profile directory: they adopt each other's keepers, as every dsh did before the tag.
 */
export function ownsKeeper(ours: string | undefined, theirs: string | undefined): boolean {
  return ours === undefined || theirs === undefined || ours === theirs;
}
