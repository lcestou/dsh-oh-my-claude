/** What a mirror entry needs to be checked. Absence is the list not holding the name at all. */
export interface MirrorEntry {
    name: string;
    /** Present, but a real file or directory rather than the symlink this module wrote. */
    forked?: boolean;
}
/** What a build has to do: link these names, and copy these back home before relinking them. */
export interface MirrorWork {
    link: string[];
    repair: string[];
}
/**
 * What has to happen for the mirror to hold: which names to link, and which forked back into a real
 * file and have to be copied home first. Split out from the filesystem so it can be asserted.
 */
export declare function mirrorPlan(real: string[], mirror: MirrorEntry[]): MirrorWork;
/**
 * Build or repair the mirror and answer its path. Synchronous on purpose: it runs once at boot and
 * before the first spawn, and a half-built config dir handed to the CLI is worse than a blocked
 * millisecond.
 */
export declare function buildMirror(realHome: string, mirror: string, log: (level: string, msg: string) => void): string;
