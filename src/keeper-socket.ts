/**
 * Where a keeper's unix socket goes. A socket path has to fit in `sun_path`, and the keeper's own
 * directory does not always: an extra mount keeps its state under `<state>/<providerId>/keepers/`,
 * and on macOS that put `claude-code-work`'s socket at 107 bytes, past the 103 the system allows,
 * so every turn on the second account ended as "keeper did not answer" (#328).
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The longest socket path that binds: `sun_path` is 108 bytes on Linux and 104 on macOS and the
 *  BSDs, with the terminator inside it either way. */
export const SOCKET_PATH_MAX = process.platform === "linux" ? 107 : 103;

/**
 * A short directory only this user can enter, for sockets whose natural home is too deep: the
 * login's runtime dir when there is one (Linux), else the temp dir, which on macOS is already a
 * per-user folder. Undefined when it cannot be made, or when someone else made it first (a shared
 * `/tmp`): a socket there would take stdin lines from whoever owns the folder.
 */
export function privateSocketDir(
  runtime: string | undefined = process.env.XDG_RUNTIME_DIR,
  tmp: string = tmpdir(),
): string | undefined {
  const uid = process.getuid?.();
  const dir = join(runtime || tmp, `omc-${uid ?? "user"}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || (uid !== undefined && st.uid !== uid) || (st.mode & 0o077) !== 0)
      return undefined;
    return dir;
  } catch {
    return undefined;
  }
}

/**
 * The socket a keeper in `dir` listens on: `<dir>/keeper.sock` when that fits, as every keeper
 * before #328 did, else a name hashed from `dir` in `privateSocketDir`. When neither fits, the
 * too-long path comes back and the keeper refuses it with the reason in its `keeper.log`.
 * spawnKeeper records the answer in spec.json, so a later attach never recomputes it.
 */
export function keeperSocketPath(
  dir: string,
  shortDir: () => string | undefined = privateSocketDir,
  max: number = SOCKET_PATH_MAX,
): string {
  const inDir = join(dir, "keeper.sock");
  if (Buffer.byteLength(inDir) <= max) return inDir;
  const base = shortDir();
  if (!base) return inDir;
  const name = `k-${createHash("sha256").update(dir).digest("hex").slice(0, 24)}.sock`;
  return join(base, name);
}
