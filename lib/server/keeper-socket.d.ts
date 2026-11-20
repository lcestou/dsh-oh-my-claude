/** The longest socket path that binds: `sun_path` is 108 bytes on Linux and 104 on macOS and the
 *  BSDs, with the terminator inside it either way. */
export declare const SOCKET_PATH_MAX: number;
/**
 * A short directory only this user can enter, for sockets whose natural home is too deep: the
 * login's runtime dir when there is one (Linux), else the temp dir, which on macOS is already a
 * per-user folder. Undefined when it cannot be made, or when someone else made it first (a shared
 * `/tmp`): a socket there would take stdin lines from whoever owns the folder.
 */
export declare function privateSocketDir(runtime?: string | undefined, tmp?: string): string | undefined;
/**
 * The socket a keeper in `dir` listens on: `<dir>/keeper.sock` when that fits, as every keeper
 * before #328 did, else a name hashed from `dir` in `privateSocketDir`. When neither fits, the
 * too-long path comes back and the keeper refuses it with the reason in its `keeper.log`.
 * spawnKeeper records the answer in spec.json, so a later attach never recomputes it.
 */
export declare function keeperSocketPath(dir: string, shortDir?: () => string | undefined, max?: number): string;
