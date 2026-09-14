# Changelog

Notable changes to Oh My Claude. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Only 1.0.0 reached npm. Everything below it was released from the repository while the plugin was still private, and the sections are reconstructed from the commits.

## [Unreleased]

Staged as 1.1.0 in `package.json`.

### Added

- Bug report command, a spend guard, model remembered per workspace, Markdown export of a transcript, and a status line when a box answers 5xx.
- Claude look: a switch that turns the orange off, per group, and an accent colour of your choosing.
- Five more panel actions, including a return recap and Ask about the diff.
- A dsh context card in Settings, off by default. A fresh box sends your prompt and the CLAUDE.md files Claude Code loads on its own, and nothing else. Turn the switch on to send dsh's workspace instructions and skill catalog, and the card shows what each block cost on the last turn.

### Changed

- The README is a front page now. The manual moved to `docs/`.
- Archive filters run edge to edge with the rows they filter.
- Claude Code compacts its own context, so the plugin stops reporting a context window to dsh's compactor. dsh no longer compacts on top of it.
- The compaction line says what the context came down to and how long it took, where the CLI reports them.

### Fixed

- The keeper test left a keeper and its child alive on every run. They accumulated.

## [1.0.0] - 2026-09-11

First npm release, as `dsh-oh-my-claude`.

### Added

- npm badge in the README header, storefront screenshots, and a notice when a newer plugin is on npm.

### Changed

- Login reads as the CLI's own, the model picker only offers what the box can run, and Settings takes dsh's shape.
- The turn status bracket uses dsh's clock face and an ellipsis instead of overflow.

### Fixed

- Panel login stores the token when `setup-token` finishes without printing a code.

## [0.26.0] - 2026-09-11

### Added

- Terminal mirror, off by default and experimental: turns taken in a terminal that picked the session up with `claude /resume` land in the dsh session as they happen.
- The running turn's figures in the status row, with the CLI's colour ramps, its stall tint, an eased count, and thought-for and effort.
- Ultrathink painted in the CLI's rainbow, in the composer and in the bracket. Ultracode gets purple.
- A queued message is coloured while it waits.
- Attached images are described to Claude by path.
- Auto mode now reports what its classifier blocked, separately from approval denials.

### Fixed

- Reading a transcript skips system-sourced user rows.
- Every language dsh highlights gets a fence, and plugin MCP servers are named after themselves.

## [0.25.0] - 2026-09-10

The public-launch pass, most of it about matching dsh's own surfaces.

### Added

- The Add workspace dialog uses a port of dsh's directory browser.
- Search in the session browser and the Restore tab.
- Log this box in from the panel, the same way an SSH box logs in, without opening a browser tab.
- The MIT licence, and a Playwright check for the MCP connector presets.
- Bridged commands take attachments and hand Claude a path to each file.

### Changed

- The cost pill gets dsh's hover, click and tap behaviour, leads with Claude's spark, and stops rewriting itself every frame.
- The composer button draws as dsh's own disc on hover and opens the panel over the composer, like the slash menu.
- Inline tool headers use dsh's dot and summary colour. The Changes tab colours its line counts.
- Configured MCP servers show their scope, and skills are listed.

### Fixed

- The tab strip holds still when a tab goes bold.
- A model with no alias keeps its plain id in the picker.
- A blank session leads to Restore, and the starter stays on one row.

## [0.24.2] - 2026-09-09

### Fixed

- The repaired session log writes its header as its own zstd frame.

## [0.24.1] - 2026-09-09

### Fixed

- Session logs stay loadable under dsh 0.1.5's versioned format.

## [0.24.0] - 2026-09-05

The largest release. Five days, 182 commits.

### Added

- One Oh My Claude control with a tabbed panel, replacing five composer buttons. Tabs: Permissions, Tune, Diagnostics, Tasks, MCP, memory, plugins, CLAUDE.md.
- Cost in dsh's footer stats row, with cached tokens and a per-session total that survives a restart.
- An access shield that looks like dsh's, listing Claude's own modes and setting dsh's preset underneath.
- Waiting out a usage limit and continuing the task, using the CLI's own limit text and reset clock.
- Remote workspaces over SSH, an archive that reaches them, and a far-side hold so an SSH session survives a dsh restart. Tailscale and WireGuard as box kinds.
- Claude Code tools rendered inline and in order, with dsh's icons, click-to-expand folding, and a cap on verbose bodies.
- `/btw`, a side question answered off-transcript in a card docked to the composer.
- Export and import of Claude transcripts from the archive.
- Claude's own spark in place of the ✻ stand-in, and Claude's orange on links, checkboxes and workflow-run members in a Claude session.
- Bridged Claude commands under their own names, surviving a dsh restart.
- The model catalog cached to disk, so a fetch outage still lists real models.

### Changed

- `Translator` split into `translator.ts`; the composer panel into `panel.tsx` and `shared.ts`.
- The client's DOM watchers scan once per frame instead of once per added node.
- The owner's working notes left the repository, and local and third-party references were scrubbed from the published files.

### Fixed

- A respawn into a session's keeper directory reaches the new keeper, not the dying one.
- Four translator faults: orphan results, a swallowed limit notice, MultiEdit, unbounded headers.
- Five faults in a resumed transcript.
- Three ways a session could hang with no deadline.
- Every state file lands through a rename.
- The login is masked on every surface that names it.

## [0.23.0] - 2026-09-05

### Added

- An MCP servers popover with status and a reconnect, which also reconnects after a keeper reattach.
- The model picker leads with the CLI's own `list_models` catalog.
- MCP elicitation answered through dsh's question UI.

## [0.22.0] - 2026-09-05

### Added

- Keeper mode: Claude outlives a dsh restart.
- The command bridge, putting Claude's slash commands in dsh as `/claude-<name>`.
- Native tool rows for Claude Code tool calls, and Claude-style turn status.
- A memory panel for Claude's auto-memory files, and rewind with file checkpointing on for every child.
- Model switching in place with `set_model` instead of a respawn.
- A Changes popover showing the CLI's working-tree diff, and a context breakdown in the context-meter popover.
- Per-turn accounting chip, multi-account mounts, background commands as dsh jobs, an idle watchdog with an Extend control, and a plan review panel with secret redaction.

### Changed

- The plugin is called Oh My Claude.

## [0.21.0] - 2026-09-05

### Added

- Claude Code's TodoWrite mirrored into dsh's todo panel.

## [0.20.0] - 2026-09-05

### Added

- Compaction is announced the moment it starts, in the reasoning lane.
- The cross-box session list pages, 10 per box, with Load more and Load all.

## [0.19.0] - 2026-09-05

### Added

- A usage line in the ring's hover tooltip, reading every limit kind, naming the login and box it belongs to.

### Fixed

- The login email is masked on screen, and the usage endpoint backs off after a 429.

## [0.18.0] - 2026-09-05

### Added

- Claude plan usage inside the context-meter popover.

## [0.17.0] - 2026-09-05

### Changed

- The plugin is strict TypeScript.

## [0.16.0] - 2026-09-04

### Added

- One session list across boxes, filtered by box, workspace and origin.

## [0.15.0] - 2026-09-04

### Added

- Sessions a dsh restart interrupted get a nudge, so they finish on their own.

## [0.14.0] - 2026-09-04

### Added

- Claude Code starts through dsh's subprocess seam on request. The panel names the binary and says when it is logged out.

## [0.13.0] - 2026-09-04

### Added

- Boxes: a saved list of other dsh servers to hop between.

## [0.12.0] - 2026-09-04

### Added

- The panel shows which `claude`, which account and which machine it talks to.

## [0.11.0] - 2026-09-04

### Added

- A `settings.json` editor in the Claude Code panel, behind an Edit button.

## [0.10.0] - 2026-09-04

### Added

- dsh-started Claude sessions appear in the session browser, and archived ones can be restored.

## [0.9.0] - 2026-09-03

### Added

- Interrupt, parallel relays, forks, steer replies and hot reload.
- Claude Code compaction shows in the session.

### Fixed

- The dsh session wakes when Claude replies on its own, and still wakes after dsh unloads an idle agent.
- A rate-limit warning is no longer treated as a rate limit.
- CLAUDE.md that Claude Code loads itself is no longer forwarded on top.
- A plugin hot reload no longer takes dsh down.

## [0.8.0] - 2026-09-03

### Added

- dsh tool calls made by Claude Code relay into dsh's own loop.

## [0.7.0] - 2026-09-03

### Added

- `open_session` opens a top-level dsh session from Claude Code.

## [0.6.0] - 2026-09-03

### Added

- dsh's tools are served to Claude Code over MCP.

## [0.5.0] - 2026-09-03

### Added

- Claude Code terminal sessions open from Settings.

## [0.4.0] - 2026-09-03

### Added

- A persistent Claude process, with approvals and questions relayed to dsh.

## [0.3.0] - 2026-09-03

First working version: the Claude Code CLI driven as a dsh provider over stream-json.
