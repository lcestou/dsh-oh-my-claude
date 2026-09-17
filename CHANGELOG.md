# Changelog

Notable changes to Oh My Claude. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions from 1.0.0 up are on npm. Everything below 1.0.0 was released from the repository while the plugin was still private, and those sections are reconstructed from the commits.

## [Unreleased]

### Fixed

- The Claude Code update card above the composer folds like a side-question card: a header line
  with the label, a chevron and the close at the far right, and the sentence and buttons under
  it, hidden on a click on the header and back on the next. On a phone the sentence takes its own
  line and the buttons the next; it used to squeeze the text into a column a few words wide beside
  the Update button.
- A file or image attached to a message sent while a turn runs now reaches Claude: the message
  waits for the CLI's next tool result (or the next prompt, when no tool call follows) and arrives
  whole, with the file's `[File …]` handle. It used to arrive as its text alone and was then
  marked as delivered, so the attachment never came.
- The ✻ button comes up the moment a Claude model is picked on a new session, instead of on the
  first keystroke in the composer.
- The model picker names its rows one way: a CLI row that lands on a model the plugin knows takes
  that model's name ("Claude Opus 5 (1M context)" rather than "Opus (1M context)" above a second
  "Claude Opus 5"), and carries the CLI's own blurb under it. The CLI's lineup is kept on disk per
  box, so a fresh dsh-web lists the same rows before any session has run there, rather than a
  lineup without the 1M variants that showed a session's raw model id in the composer seat.

- The Boxes rows in Settings keep their buttons centred on the row and beside the text: a row with
  three buttons (Log out, Update, Remove) wraps its status line at a separator instead of dropping
  the buttons under it, and the status dot stays on the first line.
- Buttons in the Settings section and the ✻ panel take the accent colour on hover and focus, as
  the login card's already did; the buttons carry their border inline, so no hover rule had ever
  reached them.

### Added

- A card above the composer when a newer Claude Code is out for the box a session runs on, with an
  Update button that runs `claude update` there from dsh, an Always update link, and a dismiss that
  holds until the next release. The same button sits on each Boxes row in Settings. Under Tune: a
  Release channel row, an Update on its own switch and the history of runs; in Settings, a switch
  for the whole feature. A headless `claude -p` never updates itself, so until now a box relied on
  the terminal for it.

## [1.1.2] - 2026-09-15

### Fixed

- The six Claude permission rows reach dsh's access-shield menu again on dsh 0.1.6, which renders
  that menu into a portal on `document.body` instead of inline under its trigger. The plugin looked
  in one of those two places, so the upgrade left the shield offering dsh's own three presets and no
  way to pick a Claude mode. It now looks in both, so dsh 0.1.5 keeps working. dsh places a
  portalled menu by its height, measured once when it opens, so the plugin asks for a second
  measurement after the six rows are in and the menu lands where dsh's own menus do.
- A session in a remote workspace no longer opens with Claude asking you to restart a tool server.
  The dsh MCP bridge is served on this box's loopback port, which a `claude` running over SSH cannot
  reach, and the switch that skipped it was per provider while a remote workspace makes a session
  remote under the local provider. A turn that runs on a box now skips the bridge and its
  system-prompt guidance together. `dshTools` stays on for local sessions, and the docs stop
  advising you to turn it off box-wide.
- Installing the plugin no longer prints four unmet peer dependency warnings. dsh supplies its own
  packages to a plugin through a shared fallback directory, so pnpm running in the profile is right
  that they are absent and wrong that it is a problem. The dsh peers are marked optional, which is
  how dsh's larger plugins declare theirs.

## [1.1.1] - 2026-09-14

### Fixed

- The turn usage pill appears on turns that used tools. dsh proves a turn's token total by folding one usage sample per step, and the plugin reported usage once per turn, on the result frame. A single-step turn had its sample and drew the pill. A turn that ran tools left most of its steps without one, and dsh drops a total it cannot prove, so the pill went missing on 13 turns of a 27-turn session. Each step now reports what it spent, summed from the per-message counts Claude Code streams while the turn runs.
- Tokens per second, on the turn and in the session statistics. Both folds count a step's decode time only when that step also carries usage, so a turn's whole output was divided by one step's decode window. The same session reads 57 tok/s where it read 183.
- Reasoning tokens in the usage popover. Claude Code reports them with every message and the plugin dropped them, so that row never appeared.
- The running dots take the accent colour wherever dsh draws them, including the subagent list. They stayed blue outside the turn status row because dsh sets the colour on the element itself, which beats a value inherited from the page.

## [1.1.0] - 2026-09-14

### Added

- Bug report command, a spend guard, model remembered per workspace, Markdown export of a transcript, and a status line when a box answers 5xx.
- Claude look: a switch that turns the orange off, per group, and an accent colour of your choosing.
- Five more panel actions, including a return recap and Ask about the diff.
- A dsh context card in Settings, off by default. A fresh box sends your prompt and the CLAUDE.md files Claude Code loads on its own, and nothing else. Turn the switch on to send dsh's workspace instructions and skill catalog, and the card shows what each block cost on the last turn.

### Changed

- The context breakdown is drawn the way dsh draws its own meter, with a filled bar across the
  window, a colour per category and a legend row each, plus the model the percentage is measured
  against. It replaces dsh's readout in that popover rather than sitting above it, so there is one
  set of numbers instead of two that disagree.
- The README is a front page now. The manual moved to `docs/`.
- Archive filters run edge to edge with the rows they filter.
- Claude Code compacts its own context, so the plugin stops reporting a context window to dsh's compactor. dsh no longer compacts on top of it.
- The compaction line says what the context came down to and how long it took, where the CLI reports them.

### Fixed

- The ring beside the send button filled to 100% during any long turn. dsh fills it from the prompt
  side of the last usage sample, which Claude Code reports with every API call of the turn summed
  into it, so a turn of a hundred calls reads as millions of tokens. The arc and its label now follow
  the CLI's own occupancy, the same figure the popover shows.
- dsh's context ring read a session at a fifth of its real fill. The window reported to dsh was the
  one the model can hold, while Claude Code runs several of them against a smaller one until 1M is
  turned on, so an Opus 5 session 83% of the way to compaction showed as 17%. The window is now taken
  from the session itself, so it is right for a model released after this build and follows a model
  switched mid-session, including a session left on the mount's default model.
- The cost pill billed every turn for the whole session again. Claude Code's `total_cost_usd` and `duration_api_ms` are running totals for the process, not the turn's own figures, and the pill summed them, so a session of 50 turns read as many times its real cost and "last turn" was the running total rather than the last turn. The turn's own share is now taken where the record is written, so the pill, the cost dialog and the `/turns` route all agree with `/cost`. Records written before this fix still hold the old numbers.
- The context breakdown counted the compaction buffer as conversation. Rows are classified on the CLI's own `kind` field, which is what tells free space and the compaction reserve apart from content; the English row names it used to match are explicitly not for this.
- Plan usage dropped every window the endpoint marks `is_active: false`, which is how a live account's own 5-hour and weekly windows arrive. The two survived by falling back to the legacy fields that repeat them; a per-model weekly row, which has no legacy twin, disappeared.
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
