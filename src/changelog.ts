// The Changelog card in Settings: the route reads the plugin's own CHANGELOG.md on each open and
// this module turns it into releases, so the card draws what the file says and nothing is
// hardcoded. Keep a Changelog shape: `## [version] - date` (or `## [Unreleased]`), an optional
// paragraph under the heading, `### Added|Changed|Fixed|Removed`, and `- ` items that wrap with
// two leading spaces.

/** One `## [...]` section of the file. */
export interface ChangelogRelease {
  /** `1.1.2`, or `Unreleased`. */
  version: string;
  /** `2026-09-15`; null for Unreleased. */
  date: string | null;
  /** The paragraph between the heading and the first `###`, when the release has one. */
  intro: string | null;
  sections: { kind: string; items: string[] }[];
}

const HEADING = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/;

/** Releases with something to say, newest first as the file lists them. A `## [Unreleased]` with
 *  no items and no paragraph, which is what cutting a release leaves at the top, is dropped. */
export function parseChangelog(text: string): ChangelogRelease[] {
  const out: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: { kind: string; items: string[] } | null = null;
  for (const line of text.split("\n")) {
    const head = HEADING.exec(line);
    if (head) {
      release = { version: head[1] ?? "", date: head[2] ?? null, intro: null, sections: [] };
      section = null;
      out.push(release);
      continue;
    }
    if (!release) continue;
    if (line.startsWith("### ")) {
      section = { kind: line.slice(4).trim(), items: [] };
      release.sections.push(section);
    } else if (line.startsWith("- ")) {
      if (section) section.items.push(line.slice(2).trim());
    } else if (line.startsWith("  ") && section) {
      // A wrapped item: the file breaks lines at 100 columns and indents the rest by two.
      const prev = section.items.pop();
      if (prev !== undefined) section.items.push(`${prev} ${line.trim()}`);
    } else if (line.trim() && !section) {
      release.intro = release.intro ? `${release.intro} ${line.trim()}` : line.trim();
    }
  }
  return out.filter((r) => r.intro !== null || r.sections.some((s) => s.items.length > 0));
}
