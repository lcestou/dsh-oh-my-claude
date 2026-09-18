# Changelog

Notable changes to Oh My Claude. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions from 1.0.0 up are on npm. Everything below 1.0.0 was released from the repository while the plugin was still private, and those sections are reconstructed from the commits.

## [Unreleased]

### Fixed

- The first turn after a dsh-web restart no longer fails with `UNSUPPORTED_REASONING_EFFORT`
  when an effort is selected, and the effort menu is back for every model. The model lineup the
  CLI answered was kept on disk under one key and read back under another, so after a restart
  every row seeded with no effort levels until a live process answered again, which the failed
  turn never let happen.
- The context meter's breakdown request no longer prints a red 409 in the browser console on
  every session switch. The route answers 200 with `ok: false` when the session is mid-turn or
  has no live process, which is what the client already read.
- A dsh-web restart no longer logs you out of the desktop. A keeper whose Claude failed to start
  (the binary missing, or its folder gone) recorded no Claude pid, the plugin read that back as
  `-1`, and the next start's cleanup asked whether "pid -1" was alive and then sent it SIGTERM.
  On Linux `-1` means every process you own, so the signal reached your login session's own
  manager, which ended the session (2026-09-17, 20:18). Only a positive pid is treated as a
  process now.
- The Remote workspaces card in Settings shows a workspace the moment it is added from the Add
  workspace dialog. It used to list it only after a page reload.
- Removing an ssh box removes the workspaces pinned to it, from the sidebar and from the card. They
  used to stay in the sidebar with no box behind them. The box's row says how many workspaces go
  with it before you confirm. Their sessions stay, under Ungrouped, and say why they cannot run
  until the same folder is pinned again.
- A remote workspace deleted from the sidebar's own menu no longer comes back in the Settings card.
  dsh deletes it in its own list and never told the plugin, which kept its record; the plugin now
  checks its records against dsh's list and drops the ones dsh no longer has.
- A file or image attached in a session that runs on an ssh box can be read there. Claude used to be
  handed a path on this PC. The attachment is now copied to the box over ssh first, into
  `~/.local/state/dsh-oh-my-claude/attachments/`, and Claude gets that path.

- A session left idle long enough for dsh to unload it is woken again when Claude finishes a
  background task on its own. dsh 0.1.6 answers a cold resume with `{ agent }` where 0.1.5 answered
  the agent, the plugin read the wrapper as the agent, and every such wake failed; the reply sat
  unseen until the next typed message. Both shapes are read now.

- A child's report and a subagent's finish notice now reach Claude when they land mid-turn. A
  message dsh spliced into a running step a few seconds after a typed steer was forwarded only if a
  person typed it; a child's `send_message`, a settlement notice or a job's finish line in the same
  step was claimed by dsh and never written to the CLI, and the session went quiet while Claude
  polled a log for a report that had already arrived (three times on 2026-09-16). Every text
  message dsh delivers mid-step now goes over stdin the way a typed steer does, marked by its id so
  it is read once; one carrying a file or image waits for the next tool result, as a typed one does.

- A message sent seconds before Claude called a dsh tool no longer strands the turn. The message
  set a flag that parks the step at the next tool result so dsh can draw it; when that next tool
  was a dsh tool, dsh had already drawn the message, the park landed on an empty inbox, and dsh
  closed the turn while Claude kept working. From then on its subagents and jobs ran with no card
  and no text, the header still counting them, until the next message resumed the turn and the
  missing work appeared all at once beneath it (twice on 2026-09-16). The flag is now cleared at
  every step dsh opens.

- Settings written at the same moment no longer drop one another. The hints store is
  read-modify-write, and two requests that overlapped both read the file before either wrote it, so
  the second put back a map from before the first and every key it had added was gone — a store of
  eight switches came back holding one. Requests are applied in turn now, and the file is replaced
  atomically, so a crash mid-write cannot truncate it either. Two browsers on the same box, which
  is what box-wide settings invite, was all it took.

### Changed

- The icon tile on dsh's changed-files card takes the accent colour in a Claude session, with the
  links and rules group; it stayed dsh's blue beside an orange chat.

- The proxy control takes its width from the word it shows, so Off and On sit narrower than Auto
  instead of every state holding the widest one's box.

### Added

- The status row names the dsh tool a turn is waiting on: `running job_output for 151s`, after the
  clock and the token count. While dsh ran a tool for Claude the bracket used to empty down to the
  clock, and the count restarted from zero when the result came back; both now hold through the
  wait.

- A switch for the footer cost readout, in the plugin's settings, on unless it is turned off. The
  turn records behind it are kept either way, so the figure is whole again the moment the switch
  comes back.

### Changed

- The cost pill reads `$28.84 · $7.78 last`; the cached-token count that used to close it has moved
  into the panel behind it. dsh's own neighbouring pill already reports the session's tokens and
  cache hit rate, and ours was the longest pill in the row.

- The cost panel is capped at 320px rather than 440px, so the API-rate footnote wraps instead of
  setting the panel's width. It stood half again as wide as dsh's stats panel beside it.

### Fixed

- The cost readout sits in dsh's footer row as a pill again on dsh 0.1.6-alpha.2, which stopped
  marking that row. It had fallen back to the older shape and rendered as loose text behind a bar,
  outside the row; as a pill it also takes dsh's own phone behaviour, shortening to the icon alone.

- The Claude usage block and the context breakdown are back in dsh's context-meter panel on dsh
  0.1.6-alpha.2, which moved that panel out of the ring's own corner of the page and into a
  portal on `<body>`. The ring's hover bubble was never affected.

- The Oh My Claude control, the access shield and the Claude look all come back on dsh
  0.1.6-alpha.2. dsh moved two things the plugin reads: the open session left the session list
  snapshot (`current`) for the main view's own retention, and session navigation left the Session
  Controller (`sessions.open`) for `uiWorkspace.openSession`. Both old and new shapes are read, so
  the same build serves dsh 0.1.5 and 0.1.6.

- The context popover and the line under dsh's ring write a million-token window as `1M`; it read
  `1000k`.
- Opus 5 and Opus 4.8 are listed at 1M before a session has answered, as Claude Code 2.1.274's own
  table has them. A session's own answer still outranks the table.

- A new session no longer opens on a model id the picker cannot name. A workspace remembers the
  model it last ran, and Claude Code renames its picker rows between releases (2.1.274 lists Fable
  as `claude-fable-5-1` where 2.1.273 listed `claude-fable-5-1[1m]`), so the remembered id could be
  one no menu has and the composer showed `claude-code/claude-fable-5-1[1m]`. The remembered id is
  now answered as the form the lineup still offers, or not at all, and a session already on a
  renamed id is moved to the living form when it is opened (once its turn, if any, has ended).

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

- Proxy reaches Anthropic, a setting for a box whose `ANTHROPIC_BASE_URL` is a proxy in front of
  api.anthropic.com. Claude Code assumes 200k for its 1M models behind any other host (and stops
  compacting Fable); on such a box, sessions start with the CLI's own flag for a proxy that
  forwards, and the context popover names it when it sees a session in that state. A session
  already running follows on its next message.

  Auto, On or Off, and Auto is the default: it asks the base URL once per dsh run, with no key
  attached, and takes Anthropic's own authentication error and request id as the answer — a proxy
  that forwards passes both through, a gateway routing to another provider does not, and a proxy
  that cannot be reached is left alone rather than assumed. On and Off are answers a person gave,
  so detection never overrides one. Nothing changes without a base URL.
- A Changelog card in Settings → Oh My Claude, above Report a problem and collapsed. It lists what
  the last five versions added, changed and fixed, read from the plugin's own `CHANGELOG.md` when
  the card opens, with the installed version marked. The file now ships in the npm package; an
  install from before this has no copy, and the card says so with a link to the file on GitHub.
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
