// A Claude config dir the plugin owns, so the transcripts of dsh-started sessions do not pile up
// under `~/.claude/projects/`.
//
// The CLI has one lever on where it writes: `CLAUDE_CONFIG_DIR`. That directory carries the login,
// the settings, the commands and the skills as well as the transcripts, so pointing it straight at
// the plugin's state dir would log the box out and empty the command menu. The mirror is the way
// around it: every entry of the real `~/.claude` is a symlink back to the real one, and only
// `projects/` is a directory of its own. The CLI reads and writes the same login and settings it
// always did, and the conversations land here.
//
// A symlink that has become a real file is the one thing that can fork: the CLI replaced the file
// rather than writing through the link (a temp file plus a rename does exactly that). The next
// build copies such a file back over the real one, keeping a `.bak`, and restores the link, so
// the real `~/.claude` stays the box's single source of truth for the login and the settings.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";

/** What a mirror entry needs to be checked. Absence is the list not holding the name at all. */
export interface MirrorEntry {
  name: string;
  /** Present, but a real file or directory rather than the symlink this module wrote. */
  forked?: boolean;
}

/** The entry the CLI must never see through a link, because it is the point of the whole mirror. */
const OWNED = "projects";

/** What a build has to do: link these names, and copy these back home before relinking them. */
export interface MirrorWork {
  link: string[];
  repair: string[];
}

/**
 * What has to happen for the mirror to hold: which names to link, and which forked back into a real
 * file and have to be copied home first. Split out from the filesystem so it can be asserted.
 */
export function mirrorPlan(real: string[], mirror: MirrorEntry[]): MirrorWork {
  const state = new Map(mirror.map((e) => [e.name, e]));
  const link: string[] = [];
  const repair: string[] = [];
  for (const name of real) {
    if (name === OWNED) continue;
    const at = state.get(name);
    if (at === undefined) link.push(name);
    else if (at.forked === true) repair.push(name);
  }
  return { link, repair };
}

/** How the mirror dir looks right now, in the shape `mirrorPlan` reads. */
const mirrorState = (dir: string): MirrorEntry[] =>
  readdirSync(dir).map((name) => {
    const stat = lstatSync(join(dir, name));
    return { name, forked: !stat.isSymbolicLink() };
  });

/**
 * Build or repair the mirror and answer its path. Synchronous on purpose: it runs once at boot and
 * before the first spawn, and a half-built config dir handed to the CLI is worse than a blocked
 * millisecond.
 */
export function buildMirror(
  realHome: string,
  mirror: string,
  log: (level: string, msg: string) => void,
): string {
  mkdirSync(join(mirror, OWNED), { recursive: true });
  if (!existsSync(realHome)) return mirror;
  const { link, repair } = mirrorPlan(readdirSync(realHome), mirrorState(mirror));
  for (const name of repair) {
    // The CLI replaced the link with a file of its own, so that file, not the real one, holds
    // what it last wrote. Put it back where the rest of the box reads it, then relink.
    const from = join(mirror, name);
    const to = join(realHome, name);
    try {
      if (lstatSync(from).isDirectory()) {
        log("warn", `claude home mirror: ${name} is a real directory; leaving it alone`);
        continue;
      }
      copyFileSync(to, `${to}.bak`);
      renameSync(from, to);
      symlinkSync(to, from);
      log("info", `claude home mirror: ${name} had forked; copied back over ${to} (.bak kept)`);
    } catch (e) {
      log("warn", `claude home mirror: could not repair ${name}: ${String(e)}`);
    }
  }
  for (const name of link) {
    try {
      symlinkSync(join(realHome, name), join(mirror, name));
    } catch {
      // A racing build (two instances, same dir) already made it; anything else surfaces on use.
    }
  }
  // A link whose target the user deleted points nowhere and the CLI would fail on it.
  for (const entry of mirrorState(mirror))
    if (entry.forked !== true && !existsSync(join(mirror, entry.name)))
      rmSync(join(mirror, entry.name), { force: true });
  return mirror;
}
