// Offline self-check: bun src/changelog.test.ts. A fixture in the file's shape, then the real file.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseChangelog } from "./changelog.js";

const FIXTURE = `# Changelog

Notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.2] - 2026-09-15

### Fixed

- The six rows reach dsh's menu again on dsh 0.1.6, which renders
  that menu into a portal on \`document.body\`.
- A second fix.

### Added

- One addition.

## [1.0.0] - 2026-09-11

First npm release, as \`dsh-oh-my-claude\`.

### Added

- npm badge.

## [0.3.0] - 2026-09-03

First working version.
`;

const releases = parseChangelog(FIXTURE);
// A. The empty Unreleased at the top is dropped; the three with content stay, in file order.
assert.equal(releases.length, 3, "three releases with content");
assert.deepEqual(
  releases.map((r) => r.version),
  ["1.1.2", "1.0.0", "0.3.0"],
);
// B. Heading fields.
assert.equal(releases[0]?.date, "2026-09-15");
assert.equal(releases[0]?.intro, null);
// C. Sections in file order, a wrapped item joined with one space, backticks kept for the client.
assert.deepEqual(
  releases[0]?.sections.map((s) => s.kind),
  ["Fixed", "Added"],
);
assert.equal(
  releases[0]?.sections[0]?.items[0],
  "The six rows reach dsh's menu again on dsh 0.1.6, which renders that menu into a portal on `document.body`.",
);
assert.equal(releases[0]?.sections[0]?.items.length, 2);
assert.equal(releases[0]?.sections[1]?.items[0], "One addition.");
// D. A paragraph under the heading is the intro; a release with an intro and no items is kept.
assert.equal(releases[1]?.intro, "First npm release, as `dsh-oh-my-claude`.");
assert.equal(releases[2]?.intro, "First working version.");
assert.equal(releases[2]?.sections.length, 0);
// E. An Unreleased with an item is kept, with no date.
const dev = parseChangelog("## [Unreleased]\n\n### Added\n\n- Something new.\n");
assert.equal(dev[0]?.version, "Unreleased");
assert.equal(dev[0]?.date, null);
assert.equal(dev[0]?.sections[0]?.items[0], "Something new.");
// F. Nothing parses to nothing.
assert.deepEqual(parseChangelog(""), []);

// G. The real file: every dated heading parses, and 1.1.2 reads as it was written.
const real = parseChangelog(await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
assert.ok(real.length >= 30, `real changelog parses to ${real.length} releases`);
for (const r of real)
  if (r.version !== "Unreleased") assert.match(r.date ?? "", /^\d{4}-\d{2}-\d{2}$/, r.version);
const v112 = real.find((r) => r.version === "1.1.2");
assert.equal(v112?.date, "2026-09-15");
assert.equal(v112?.sections[0]?.kind, "Fixed");
assert.equal(v112?.sections[0]?.items.length, 3);

console.log("changelog ok");
