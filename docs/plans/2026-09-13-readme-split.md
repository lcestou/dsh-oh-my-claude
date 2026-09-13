# README split: a short front page and a docs folder behind it

Date: 2026-09-13. Status: plan, not yet applied. No PR until the owner has read the result.

## The problem in numbers

`README.md` is 350 lines and 82 KB. Measured per section:

| Section | Bytes | Share |
|---|---|---|
| Hero and intro | 1.8 K | 2% |
| Tour | 3.6 K | 4% |
| Install (with upgrade notes and Developing) | 7.9 K | 10% |
| Configuration (32-row table) | 6.5 K | 8% |
| How it works (45 bold paragraphs) | 48.5 K | 59% |
| Where things live (accounts, boxes, SSH) | 10.6 K | 13% |
| Check, Not covered, Roadmap, Bugs, License | 5.1 K | 6% |

Sixty percent of the page is one section of forty-five paragraphs, several of them over 2 KB with no line break. A reader who liked the Tour hits that wall at the first scroll past Install and leaves. The prose itself is good and accurate, and it is the only written spec of the plugin, so it must survive. It just cannot live on the front page.

What works today and stays as it is: the centered hero with the spark and badges, the one-line pitch, the intro paragraph, and the Tour's nine shots with their captions.

## What the best front pages do

Read against fzf, ripgrep, Starship, Bun, uv, Zed and oh-my-zsh:

- Above the fold: name, one sentence, one picture, the install command. Nothing else.
- Features as a scannable list of one-liners, each linking deeper. Never a paragraph per feature.
- The config reference lives on its own page. The README shows three keys and a link.
- Internals get their own page and a one-line invitation. People who want them find them; everyone else never sees them.
- Contributor material (lint rules, test scripts, release steps) sits in `CONTRIBUTING.md` or `docs/`, not between Install and Configuration.
- One code block per idea. Nothing folds more than two concerns into a sentence.

The README ends up a brochure with a table of contents into the manual. That is what this plan builds.

## Where the docs live, and what stays private

Today `.gitignore` hides all of `docs/*` except `docs/media/` and `docs/plans/`. The hidden files are the owner's notes: `queue.md`, `launch-checklist.md`, `publishing.md`, `reddit-launch.md`, `status-line.md`, `sync-mirror-plan.md`, `claude-spinner.md`, `landscape.md`, and the `research/` and `design/` folders. Adding public pages to the same folder means one more un-ignore line per page and a folder that reads differently on the owner's box than on GitHub.

Decision: move the private notes to a top-level `notes/` folder, ignore that folder, and track all of `docs/`.

```
notes/                      ignored; owner working notes, nothing a reader needs
  queue.md
  launch-checklist.md
  publishing.md
  reddit-launch.md
  status-line.md
  sync-mirror-plan.md
  claude-spinner.md
  landscape.md
  research/
  design/
docs/                       tracked; everything a reader may need
  media/                    tour shots, unchanged
  plans/                    worker briefs and this plan, unchanged
  configuration.md          the full key table
  how-it-works.md           sessions, process, approvals, restarts, streaming, errors, updates
  panel.md                  the spark button and every tab, one heading per tab
  remote.md                 several accounts, several boxes, SSH boxes, the dsh seam
  developing.md             install from a checkout, lint contract, validate, Playwright, live CLI check, session repair
```

`.gitignore` loses three lines (`docs/*`, `!docs/media/`, `!docs/plans/`) and gains one (`notes/`). The two repo references to `docs/queue.md` (`CLAUDE.md` line 3 and 16, `.fallowrc.json` line 44) change to `notes/queue.md`. One skill on the owner's box, `local-subagent`, also names `docs/queue.md`; that is outside the repo and is reported, not edited. The files are untracked today, so the move is a plain `mv` with no history to lose.

This flips `docs/` from private by default to public by default. A note dropped there by old habit would ship on the next `git add`. Two guards replace the old one: `tools/check-links.ts` fails on any tracked `docs/*.md` that no README or docs page links to (an orphan page is most likely a stray note), and the `.gitignore` comment above `notes/` says where notes go now.

`docs/plans/` was tracked on purpose before this plan and stays so; the briefs are the record of how a batch was built, and this plan ships with them. The owner has already made that call; this plan does not reopen it.

Why not the other way, a private `docs/plans` and a public `docs/`? Because the tracked-plans convention is older than this plan. Renaming it to hide notes would cost more than a new folder.

## Where every current paragraph goes

The old "How it works" and "Where things live" carry 49 bold lead-ins. Each one has a destination here, so nothing is invented mid-move and nothing is dropped.

| Page | Takes these lead-ins, in this order |
|---|---|
| `how-it-works.md` | Where things live (binary, config dir, login), Models, Sessions, One session two places, Temporary sessions, Process, Idle watchdog, Approvals and questions, Permission mode per session, Secrets, Restarts, Streaming, Turn status, Compaction, Task progress, Todo panel, Images and files, dsh tools over MCP, Command bridge, Auxiliary calls, Content search, Errors, Surviving Claude Code updates, Plugin updates (the pill paragraph from Install), Failed to load history (the dsh 0.1.5 repair note from Install) |
| `panel.md` | One control beside the composer, Restore from a blank session, Memory, Instructions, Rewind, Changes, MCP, Asides, Diagnostics, Tasks, Tune, Prompt starter, Session notices, Turn accounting (the cost pill), Plan usage, Session browser, settings.json editor |
| `remote.md` | Several accounts, Several boxes, Remote through dsh's own seam, A box over SSH |
| `configuration.md` | The key table, Effort and the denied-tools paragraph under it |
| `developing.md` | Developing, Check, Tour capture note, session log repair (pointer) |

The two bridges (dsh tools over MCP, command bridge) were first placed in `developing.md` for their wire-level prose; the second review moved them to `how-it-works.md`, since the reader who clicks a front-page bullet about subagents or slash commands is a user, not a contributor. The 0.1.5 repair note goes to `how-it-works.md` too: the person who sees *Failed to load history* is an upgrader, and the heading carries the error text so a search lands on it. That section says up front that the repair script needs a checkout, since `tools/` is not in the npm package.

## The new README, section by section

Target: under 150 lines and under 15 KB, with the hero and Tour untouched. Every section below names what it keeps, what it drops, and where the dropped text goes.

### Hero and intro

Keep byte for byte. The one fix: the sub-line about AI contributions says "start with the Developing section below", and Developing will no longer be below. It points at `CONTRIBUTING.md`, which points at `docs/developing.md`.

### Tour

Keep all nine shots and the caption rhythm. Tighten the long captions: the spend-guard caption and the four-features paragraph after the cost row are the two that run past three lines. The four-features paragraph becomes four one-line bullets (Report a problem, archive row menu, model per workspace, status on 5xx), each linking to its docs heading.

The "Captured by `tools/playwright/tour.ts`" aside shrinks to a five-word closing line under the last shot. It says the pictures are made by a script, which is worth a line, and the how goes to `developing.md`.

### Install

Keep the requirement line, the three commands, and the optional `settings.yaml` block. Add the one failure state a first run hits: a picker entry reading `(not logged in)` means `claude auth login` in a terminal on the box that runs dsh, or Log in from Settings. That line lives in "Where things live" today, two screens down.

The long paragraph about the update pill shrinks to two sentences: the plugin tells you when a newer version is on npm, and a click copies the update command. The rest of that paragraph goes to `how-it-works.md` under "Updates".

The "Upgrading dsh to 0.1.5 or later" subsection moves whole to `how-it-works.md` under a heading that carries the error text. Install first carried a one-line pointer quoting that text; the second review cut it, since a first run has no old sessions, and the Plugin updates link in Install reaches the section that sits right above it.

The "Developing" subsection moves whole to `developing.md`. Install keeps one line pointing there.

### What you get (new)

Replaces "How it works" on the front page. One bullet per feature, one line each, in the order a new user meets them, each ending in a link to its docs heading. The list to ship, fourteen lines:

1. Pick any Claude model your login can use, in dsh's own picker.
2. Every dsh session resumes its Claude Code session, tool history included.
3. dsh's access shield sets Claude's six permission modes per session.
4. Claude's permission prompts and questions become dsh dialogs.
5. One spark button opens Memory, Rewind, Changes, MCP and six more tabs.
6. Cost and cached tokens in dsh's footer, with a spend line that turns the pill orange.
7. Plan usage (5-hour, weekly) in dsh's context ring.
8. Restore or import any past Claude transcript, from dsh or a terminal.
9. Claude's slash commands and skills show up as dsh commands.
10. Claude gets dsh's subagents, jobs, goals and web search over MCP.
11. Restart dsh without killing a running Claude turn.
12. Edit CLAUDE.md, settings.json and MCP servers from the panel.
13. Run Claude on another box over SSH, or mount several accounts.
14. Report a problem with a redacted box report, copied or filed as an issue.

Secret redaction and surviving Claude Code updates are defaults nobody toggles; they stay in `how-it-works.md` and off the list.

### Configuration

Three keys people change first (`permissionMode`, `spawn`, `sshHost`) in a short YAML example with one comment each, then "Every key, with defaults, is in docs/configuration.md." The 32-row table moves whole to that page. The Effort and denied-tools paragraph under the table moves to `how-it-works.md`.

### Remote boxes and accounts

Three sentences: several accounts by mounting the plugin twice, several boxes through Settings, a box over SSH with `sshHost`. Link to `remote.md`. The four long paragraphs and two YAML blocks of "Where things live" move there. The "Binary, Config dir, Login" bullets at the head of that section open `how-it-works.md` as "Where things live".

### Not covered, Bugs and feedback, License

Keep. Each is already short. The trademark paragraph under License stays on the front page; it is the one legal line in the repo and a subpage is the wrong place for it.

### Check and Roadmap

Check moves whole to `developing.md`. Roadmap is a one-line section that says the roadmap is not in the repo; it goes, since it says nothing a reader can act on. Bugs and feedback already names the issue tracker.

## Moving the text: rules

The "How it works" prose moves with its meaning intact. It is the spec, and a rewrite of 48 KB of verified detail is how errors get in. What changes on the way over:

- Each bold lead-in paragraph becomes a `##` or `###` heading so links and the GitHub outline work.
- Sentences past forty words are split at their commas into two. Nothing is cut.
- Route names, file names and source pointers stay; they are what a developer comes to these pages for.
- Bold-label-colon lists become prose or a heading.
- Each page opens with a two-line summary of what is on it and a link back to the README.

Every page goes through the `unslop` skill before it is saved. No em dashes anywhere (the current README already has none; keep it so). Sentence case headings. Straight quotes. No bold on proper nouns.

## Links

`docs/` is not in the npm package (`package.json` `files` lists `src`, `lib`, `README.md` and `cordis.patch.yml`), so a relative link on the front page only works where npm's rewriter happens to resolve it against the `repository` field. The images already avoid that with absolute `raw.githubusercontent.com` URLs. The front page does the same for docs: every link is `https://github.com/lcestou/dsh-oh-my-claude/blob/main/docs/<page>.md#<heading>`. Links between docs pages are relative, since those pages are only ever read on GitHub or in a checkout.

Fragments follow GitHub's slug rule: lowercase, spaces to hyphens, punctuation dropped, a numeric suffix for a repeated heading. The link checker builds slugs by that rule rather than by loose matching, so a fragment that would 404 fails the check. What the checker cannot see is npm's own rendering; the absolute URLs are what make that a non-issue.

Old anchors into `README.md` (`README.md#how-it-works` and the like) will stop resolving. Nothing in the repo links to them; the owner's notes are grepped for them before the move.

A trade the front page makes on purpose: Ctrl+F for a config key on the README no longer hits. The key table is one click away and GitHub's search covers it.

## Ten ideas for the page, and which ones this pass takes

1. **Brochure plus manual.** Front page sells and points, docs explain. Taken; it is the whole plan.
2. **A feature list instead of feature essays.** One line per feature with a link. Taken, as "What you get".
3. **Config reference off the front page.** Three keys and a link. Taken.
4. **Fold, don't delete.** GitHub renders `<details>`; the optional `settings.yaml` block and the upgrade repair note could fold. Not taken: folded text does not render on npm, and the two blocks are short enough to stand open.
5. **A "Why this and not the API" box.** Two sentences near the top on what the CLI login buys (hooks, CLAUDE.md, MCP servers, subscription billing). Not taken. The intro paragraph already says it in one sentence; a box under it would say it twice.
6. **Requirements as a checklist.** `claude --version` works, dsh 0.1.5 or newer, nothing else. Taken; it is three lines.
7. **Badges that say something.** The six badges are fine. A license badge could join them. Not taken; License has its own section and the row is already long on a phone.
8. **Screenshots with less weight.** Swap stills for GIFs, or cut the count. Not taken. Nothing in the nine shots is stale (no shot shows Settings, the one thing that changed), and the Tour is the part the owner likes. The images are hotlinked from GitHub, so none of them is in the npm package; the only cost of a GIF is page load, about a megabyte against 30 to 180 KB for a still, and the page already carries one. One optional follow-up: a short clip of Restore or the prompt starter, if a later pass wants motion beyond `panel-tabs.gif`.
9. **A table of contents.** GitHub generates one from headings in the file menu, so a hand-written one is a second copy to maintain. Not taken.
10. **Contributor text under CONTRIBUTING.md.** GitHub links that file from the issue and PR composers, and `docs/developing.md` it never surfaces. Taken: a `CONTRIBUTING.md` of a few lines points at `docs/developing.md`, and the hero's AI-contributions sub-line points at `CONTRIBUTING.md`.

## Per-section ideas that did not make the cut

- Tour: a two-column grid via an HTML table for the three panel shots. Rejected; GitHub caps the table at the column width and the panel text becomes unreadable below 480 px.
- Install: a "one-liner" that chains the add and the restart. Rejected; the restart command differs per box and the current two-command form says that.
- What you get: group the bullets under three sub-headings (Work, See, Control). Rejected for this pass; fifteen flat bullets scan fine and headings add six lines.
- Configuration: keep the five most-used rows of the table on the front page. Rejected; a partial table invites "where is key X" issues. Three keys in YAML with a link is clearer.

## Media

No new shots and no regenerated shots in this pass. `screenshots.json` and the raw GitHub URLs stay as they are. If a later pass records new material, shoot a throwaway session: the panel floats over the chat, and whatever is behind it lands in the frame.

## Checks before the owner reads it

- `bun run validate` passes (the README is not in the gate, but `.fallowrc.json` changes and the gate reads it).
- Every link in `README.md` and `docs/*.md` that points into this repo, absolute or relative, resolves to a file and, where it carries a fragment, to a heading in that file by GitHub's slug rule. Every tracked `docs/*.md` is linked from somewhere. `tools/check-links.ts` does both; it is TypeScript like the rest of `tools/` and runs with `bun`.
- `git status` shows no change for the moved notes (they were untracked) and `notes/` as ignored.
- `grep -c '—' README.md docs/*.md` prints zero for each file.
- Word count: `wc -c README.md` under 15000.

## Review rounds

1. This plan, grilled by a haiku subagent and an opus subagent in parallel, each asked for what breaks, what is missing, and what a first-time reader would still trip on. Done 2026-09-13; what they changed: the page map above (both flagged unassigned lead-ins), the not-logged-in line in Install, the repair note moving to `how-it-works.md` under its error text, absolute links on the front page, idea 5 dropped, idea 10 taken, the orphan-page check, and the media cost reasoning.
2. The finished README and docs, grilled by a fresh opus subagent reading only the rendered files, as a stranger who has dsh installed and has never seen the plugin. Done 2026-09-13; what it changed: the two bridges moved from `developing.md` to `how-it-works.md` (a user clicks those links, not a contributor), the dsh 0.1.5 repair line left Install (a first run has no old sessions; the Plugin updates link still reaches it), the cost caveat reworded so it does not read as "the number is fake", the keeper restart moved up to third in the list, Report a problem and Remember model per workspace promoted to their own headings, the login paragraph split, and the dsh floor stated as `0.1.5-rc.1` to match `peerDependencies`. Not taken: dropping the TypeScript and Bun badges (the owner likes the hero as it is) and cutting "first-class" from the pitch.
3. A final polish pass by hand after round two, then the owner reads it. No PR until then.

## Out of scope

- A docs site or a GitHub Pages build. Five Markdown pages are enough for a plugin this size.
- Rewriting the moved prose for style beyond sentence splits and headings.
- New screenshots or clips.
- The `local-subagent` skill's path to `docs/queue.md`, which lives outside the repo.
