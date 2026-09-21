// Dev-only: every link from README.md or docs/*.md into this repository resolves to a file, every
// fragment to a heading by GitHub's slug rule, and every page under docs/ is linked from somewhere
// (an orphan page is most likely a stray note). Exit 1 with one line per failure.
//   bun tools/check-links.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repoBlob = "https://github.com/lcestou/dsh-oh-my-claude/blob/main/";
const pages = [
  "README.md",
  "CONTRIBUTING.md",
  ...readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/${f}`),
];

// GitHub's heading slug: lowercase, drop everything but letters, digits, spaces, hyphens and
// underscores, spaces to hyphens, then -1, -2 for a repeated heading.
/** Turn markdown headings into GitHub-style slugs (lowercase, strip non-alphanumerics except spaces
 *  and hyphens, suffix a count for repeats) so link fragments can be matched.
 */
const slugsOf = (markdown: string): Set<string> => {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = (m[1] ?? "")
      .replace(/`/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
};

/** Extract every link target from markdown, from both `[text](url)` and `href="..."` forms,
 *  flattening to a list.
 */
const linksIn = (markdown: string): string[] => {
  const out: string[] = [];
  for (const m of markdown.matchAll(/\]\(([^)\s]+)\)|href="([^"]+)"/g))
    out.push(m[1] ?? m[2] ?? "");
  return out;
};

const failures: string[] = [];
const linked = new Set<string>();
for (const page of pages) {
  const text = readFileSync(join(root, page), "utf8");
  for (const raw of linksIn(text)) {
    const absolute = raw.startsWith(repoBlob);
    if (!absolute && (/^[a-z]+:/.test(raw) || raw.startsWith("#"))) continue;
    const [path = "", fragment] = (absolute ? raw.slice(repoBlob.length) : raw).split("#");
    const file = absolute ? join(root, path) : resolve(join(root, dirname(page)), path);
    const rel = relative(root, file);
    if (!existsSync(file)) {
      failures.push(`${page}: ${raw} -> no file ${rel}`);
      continue;
    }
    linked.add(rel);
    if (fragment && rel.endsWith(".md") && !slugsOf(readFileSync(file, "utf8")).has(fragment)) {
      failures.push(`${page}: ${raw} -> no heading #${fragment} in ${rel}`);
    }
  }
}
for (const page of pages) {
  if (page !== "README.md" && !linked.has(page)) failures.push(`${page}: linked from nowhere`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`check-links: ${pages.length} pages, no failures`);
