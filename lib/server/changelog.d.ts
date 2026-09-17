/** One `## [...]` section of the file. */
export interface ChangelogRelease {
    /** `1.1.2`, or `Unreleased`. */
    version: string;
    /** `2026-09-15`; null for Unreleased. */
    date: string | null;
    /** The paragraph between the heading and the first `###`, when the release has one. */
    intro: string | null;
    sections: {
        kind: string;
        items: string[];
    }[];
}
/** Releases with something to say, newest first as the file lists them. A `## [Unreleased]` with
 *  no items and no paragraph, which is what cutting a release leaves at the top, is dropped. */
export declare function parseChangelog(text: string): ChangelogRelease[];
