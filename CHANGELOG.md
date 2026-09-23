# Changelog

Notable changes to Oh My Claude. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions from 1.0.0 up are on npm. Everything below 1.0.0 was released from the repository while the plugin was still private, and those sections are reconstructed from the commits.

## [Unreleased]

### Added

- The steer card (the "Waiting for Claude" card above the composer) appears faster: while a turn is
  running the plugin checks for queued messages every second instead of every three, and drops back
  to three at rest. With more than one message waiting, a Send all now button sends them all at once,
  next to Edit all.
- Claude's working line (spinner, verb, figures) repeats above the composer once the turn's own
  header has scrolled off screen or is not drawn. dsh 0.1.7 keeps that line in the turn header,
  which a long run of tool cards pushes out of view, and on a long turn the header sits above the
  "Load earlier" fold and is not drawn at all. It is on by default; a switch in Settings > Oh My
  Claude turns it off for someone who wants only dsh's header line.

### Changed

- The list rows in the ✻ panel's tabs (transcripts to restore, memory files, instructions, prompts
  to rewind to, changed files) no longer sit in their own hairline box; like dsh's rows they are
  bare at rest and tint under the pointer.
- Less work per frame and per poll. The status line no longer forces a style recalc or walks the
  page eight times a second; the row mask for withheld context re-runs only when rows are added,
  not on every streamed chunk; the cost pill, the send-button tint and the panel's fit-above
  measurement search a small root instead of the whole page; a hidden tab makes no status request
  and paints no spinner. On the server, the hints file is parsed once per change, a box's runtime
  status is remembered for a minute (three processes, or three ssh connections per box, per ask
  before), the three ssh probes of a box run over one connection, and the steer card's poll no
  longer reads the whole session log each second.

### Changed

- The Claude permission control, the Add workspace dialog with its box dropdown, and the orange
  mark on a running Claude session's sidebar row now sit in dsh's own slots
  (`conversation.input.permission`, the two directory-flow holes, and the session row's action
  strip) instead of rewriting dsh's DOM. The permission menu is drawn by the plugin, so it no longer
  depends on dsh's menu markup, and the row mark follows the session id rather than the row title.
  The old DOM paths stay as the fallback on a dsh that refuses the slot.
- The Add workspace dialog with the box dropdown appears only once an SSH box is saved. With none,
  the sidebar "+" and the hero's Add workspace open dsh's own dialog, and saving the first box
  swaps ours in without a reload.
- The inline-or-rows choice for Claude's tool activity moved from the Tune tab to Settings > Oh My
  Claude, as a Native tool rows switch. It configures the bridge, not Claude Code, which is what
  Tune is for.
- Native rows are the default on dsh 0.1.7 and later. There the text streams live between dsh's
  own tool cards and the rows survive a reload, so Claude's tool activity looks like every other
  provider's in dsh. Inline stays the default before 0.1.7, where a step's text lands only when it
  settles. A mode picked in Tune, or a `toolsInline` set in the config, still wins; and a dsh that
  stops loading rows locks the switch and the plugin writes inline on its own.

### Fixed

- The Restore tab reaches every transcript in a workspace. It showed eight and left the rest to
  the search box, with nothing saying more existed; now a Show more line under the eight brings
  twenty at a time and says how many are left. Searching starts the list short again.
- A running DeepSeek or llama session's sidebar glyph stays dsh's blue while a Claude session is
  open. It went orange with the rest, since the rule reached every running glyph on the page; the
  sidebar rows now take the orange only from the mark on a running Claude row, and turn it on and
  off the instant the row's state flips rather than on the next one-second pass.
- The permission capsule shows the mode Claude is running in, not the last pick. Picking Bypass on
  a session whose process started in another mode used to get the CLI's refusal as raw text, and a
  later look showed Bypass while every tool call was still being denied. Bypass is now stored for
  the next turn, which respawns the process in it, and the menu says "Bypass · full access takes
  effect on the next turn" until then. A transcript opened from the terminal keeps the permission
  mode it ran under instead of the workspace default. When dsh's approval prompts are switched
  off, a denied tool call tells Claude that dsh auto-denied it and nobody was asked, instead of
  "the user denied this action".
- A step that hands dsh a tool call no longer ends while one of Claude's own tools is still
  running beside it. Claude firing Bash and a dsh tool in one message left the Bash call without
  a result row in that step, and dsh refused the whole session log on the next load ("step/end
  leaves unresolved tool call"). The step now waits up to ten seconds for those results and
  closes any still running with a placeholder row, so the log always loads.
- Buttons and rows in the ✻ panel and in Settings > Oh My Claude tint their background under the
  pointer, the way dsh's own rows do, instead of turning their border orange. In dark mode the
  faint hairline going orange read as a border appearing on whatever was hovered, on every tab.
  The orange border is now the keyboard focus ring only.
- Claude's working line in the turn header no longer vanishes mid-turn, leaving dsh's "Deep
  diving 12s" for the rest of the run. The plugin read the header's fold state as "the turn ended";
  dsh folds a live group on its own, and the line came down and never came back.
- The permission capsule no longer catches clicks far above and below itself. Its label had a
  line height of 260 px inside a 28 px button, so a click in the composer near it opened the menu.

### Fixed

- Native rows work on dsh 0.1.7 and survive a restart. Rows mode now announces each of Claude's
  tool calls in a small assistant message before its row, which is what 0.1.7's loader requires
  and what 0.1.5's migration asked for; the probe that gates the switch writes the same shape, so
  the switch unlocks on a dsh that loads it. Checked by running a rows turn, restarting dsh and
  reopening the session from disk: it loads, with one card per call.

### Fixed

- Native rows are locked again on dsh 0.1.7, this time for the real reason. That release loads a
  session with a stricter check than it migrates one with, and the check refuses the raw tool rows
  rows mode writes ("has no advertised tool lifecycle"): two rows-mode sessions failed to load
  after a restart on 2026-09-22 while the plugin's probe, asking the looser way, said rows were
  fine. The probe asks the way the installed dsh loads now. `tools/dsh-session-repair.ts` mends
  such v4 logs the way it mended 0.1.5's: the raw tool rows go, the conversation stays.
- A Send now button on each waiting message in the steer card. It does what Claude Code's own
  send-now key (Ctrl+Enter) does: stops what Claude is doing and sends the message as the next
  turn instead of waiting for the current step to end. Needs dsh 0.1.7; on an older dsh the button
  says it cannot and leaves the message waiting.
- The status line under a turn that was stopped or failed no longer keeps going, and no longer
  comes back with a new verb after it is taken down. dsh leaves such a turn's group open, and the
  line was rewired on every frame; a group whose sentence has stopped changing is done and stays
  done.
- Native rows are available again on dsh 0.1.7. The switch was locked by the plugin's own check,
  which fed dsh a tool result in the shape dsh 0.1.6 stored and heard that 0.1.7 refuses it; the
  check and the Import seed now write the shape the installed dsh stores (a tool-role message from
  v4), and rows mode itself already did, through dsh's own message builder. A rows-mode session
  written on 0.1.7 reopens there.
- Remember model per workspace no longer overwrites a provider you pick while a blank session is
  still loading.

### Added

- Chinese. Everything the plugin draws follows dsh's language setting (Settings → General →
  Language), or the browser's language when none is picked, and switches without a reload. The
  plan review dialog, the not logged in tag and the login message follow the stored setting. A
  Chinese README sits beside the English one.
- Claude's tool headers in the chat use the words dsh puts on its own tool cards when the stored
  language is Chinese (读取, 写入, 编辑, 网页搜索, 网页获取, 更新任务清单, with 输出 and 失败 on
  the result rows). Bash, Grep, Glob and MCP tool names stay as dsh shows them, in English. The
  status lines the plugin writes into the chat (compaction, retries, model fallbacks, usage limits,
  denied tool calls, "more lines" on long output) and the `/btw` replies follow it too.
- The usage panel, the context breakdown and the usage report in Settings read in Chinese too,
  including the sentences Claude Code and the usage API send in English. A sentence from a newer
  Claude Code shows as sent until it is added.
- A card above the composer lists the messages you steered in while Claude works, until Claude
  reads them, with Edit, Remove and Edit all (every waiting message as one, as Claude Code's up
  arrow does). Nothing goes out while the editor is open. A message Claude already has is left
  alone and the card says so. Queue mode keeps dsh's own editing.
- A Chinese set of working verbs for the turn status line, in the same cheeky spirit as Claude
  Code's English ones (炼丹中, 憋大招中, 叽里咕噜中). Your own `spinnerVerbs` in Claude Code's
  settings still apply on top of them, or replace them.

- The plugin carries its own mark and its own name into dsh's Plugins page, where dsh 0.1.7 draws a
  card per installed plugin. Before this it took the default artwork every plugin without one gets.

### Changed

- Remember model per workspace remembers the Claude too, not only which Claude model. dsh 0.1.7
  makes each workspace's blank session ahead of time on the deployment default with no selection
  of its own, so a workspace that always ran Claude opened on llama and the memory, which only
  ever changed the model, had nothing to act on. A new session now opens on the box and model the
  workspace last ran Claude on; a blank you have switched by hand is left as you set it. The first
  Claude turn in a workspace after this update records the mount, and it sticks from then on.
- The Claude Code update card is about the Claude Code you picked. It followed the box a session's
  turns run on, which in a remote workspace is that box whichever model is selected, so a session
  deliberately set to this machine's Claude was offered the other one's update. It now reads the
  model picker, switches with it on the next poll, and its Update button acts on the box the card
  names. No extra request and no extra probe: the poll was already running and the server answers
  from the updater its own half-hourly tick keeps fresh.

### Fixed

- Settings > General > Permission is dsh's own again. dsh 0.1.7 draws the same permission control
  there as in the composer, and the access shield adopted it too: its six Claude rows appeared in
  that dropdown and the row kept reading "Full access" whatever was picked. The shield now only
  touches the control inside its own composer.
- An SSH box reports its own Claude Code again. Every box probe was run with this box's resolved
  path to `claude`, which does not exist there, so a box read as "no claude", its version as
  unknown, and the update card offered a release it could not compare against. The box is named the
  binary as configured, the way its turns already were.
- A session in a remote workspace runs again when the plugin's own mount is the local one. The
  turn carried this box's absolute path to `claude` to the far box, where it does not exist, and
  failed with `claude exited 127`. The far box is named the binary as configured and finds its own.
- Picking a permission mode marks the menu at once. The pick used to sit on the old mode for the
  second or so the change takes, which read as a click that had not landed; a change that fails
  now puts the real mode back.
- The result of a tool dsh ran for Claude is read back on dsh 0.1.7, which answers it as a message
  of its own rather than a block inside a user message. Without this the relay saw no result and
  the turn waited on one that had already arrived.
- A transcript brought in through Import is readable on dsh 0.1.7. Its log was stamped version 3
  while 0.1.7 writes and expects version 4, and that dsh refuses a file whose name and header
  disagree. The version is read from dsh itself now.
- The plugin's own text follows the language setting on dsh 0.1.7 again. That release replaced the
  settings read the server used, so every server sentence stayed English whatever the setting said.
- Unarchiving a session on dsh 0.1.7 uses the method that release added for it; the internals the
  older path reached for are private there.
- The cost reads last in dsh's stats row again, in dsh's own pill shape. dsh 0.1.7 draws each stat
  as a plain pill rather than a button inside an anchor, which left the cost wearing an icon's
  style: a bordered box with the mark stacked above the figure. Switching Performance and usage
  between Compact and Detailed rebuilds that row, and the rebuilt stats landed after the cost,
  putting it first; it moves back to the end and re-copies dsh's pill style when that happens.
- A turn that fails stops the status line with it. dsh leaves a failed turn's group open, so the
  line kept its verb and spinner under dsh's own "Failed" as though the work were still running.
- The turn status line is back on dsh 0.1.7. That release moved the visible line into the button
  heading each turn's process group and left the old row for screen readers only, so the verb,
  spinner and figures were still being drawn, into a node one pixel tall that nobody could see.
  The line now goes in the button beside dsh's own sentence, which is hidden while it is up and
  comes back the moment the turn ends. The elapsed time in the bracket is read from the turn itself
  rather than off dsh's clock, which 0.1.7 folded into that same sentence.
- Changes, MCP and Diagnostics no longer ask the CLI for anything in a session nobody has prompted
  yet. There is no Claude running to answer, so the tabs say so straight away instead of firing
  three requests that can only be refused, and the permission readout says it in words rather than
  showing the refusal as an error.
- The cost card and the panel's menus are solid again on dsh 0.1.7, which made its menu fill
  translucent and put the blur behind it. Without that blur the cards read as see-through over the
  chat.
- Runs on dsh 0.1.7-alpha.1, which renamed every sized icon export in its primitives package. On
  0.1.7 the old names arrived as undefined and React threw where they were drawn, so the composer
  cards, the Oh My Claude panel, the directory browser and the add-workspace box list all went
  missing at once. Each icon now resolves to whichever name the installed dsh has, and 0.1.5 and
  0.1.6 keep working.
- The Claude look no longer drops off new sessions until a refresh. One passing error from dsh's
  session list could switch off the plugin's page code for the rest of the tab's life; now only a
  real unload does.
- Tool headers in the chat no longer show up now and then as a plain line with the code block
  open under it until the tab is reloaded. A paragraph dsh reused for a header was never picked up.
- Runs under DSH Desktop. The plugin finds `claude` in the usual install folders when dsh starts
  with a short PATH, as an app opened from the macOS Dock does, and the update pill no longer
  offers a `dsh plugin` command Desktop refuses; Desktop updates plugins from its own page.
- On Windows the plugin starts Claude as a plain child instead of through the keeper, which needs a
  Unix socket and `systemd-run`, so turns no longer fail there.
- Turns no longer fail with "keeper did not answer" on a Linux box where `systemd-run` is installed
  but cannot reach the user session (a container, WSL, some SSH logins). The keeper now starts as a
  detached process there.

## [1.3.1] - 2026-09-21

### Changed

- Every tab of the panel keeps the same inset on all four sides, the one dsh's slash menu uses,
  with the same section labels, 13 px text on a steady line height, and the thin Settings rule
  under open folds.
  The MCP add form and the New skill form take the panel's field look.
- The Skills tab opens with its groups folded, so user, project and plugin skills and Skill costs
  all show at once. A search opens them to show its matches.

### Fixed

- Scrolling to the end of a panel tab no longer scrolls the chat behind the panel.
- Clicking outside the panel to close it no longer sends focus back to the ✻ button, which lit up
  its tooltip. Escape still returns focus there.

## [1.3.0] - 2026-09-21

### Added

- On a box that has never used the plugin, a small bubble above ✻ says what lives behind it. It goes
  for good on the first open or its ×, and a box that already used the plugin never shows it.
- Plan limit warnings. When a limit the session's model counts against is close, the usage ring
  turns amber, and red once it is reached, with a one-line notice above the composer saying which
  limit and when it resets. The grading is Anthropic's own, a per-model limit such as the weekly
  Fable one only counts in a session on that model, and a model or limit added later is covered
  without an update. On by default, with a Customize fold in Settings to keep only the ring or only
  the notice; the notice can be dismissed until the limit resets.
- The Tasks tab shows dsh's own goal next to Claude Code's: the current one with its phase, rounds
  and, when blocked, the reason, and a Past goals fold with every earlier goal the session had and
  how it ended. It is read from dsh's session log, and it shows whether or not Claude is running.
  Claude Code's own goal appears beside it only when the CLI holds one.
- The Diagnostics tab opens with a line reading how many of this plugin's assumptions about dsh's
  own markup still hold. Every dsh upgrade that has broken the plugin broke it silently, by moving
  something a selector pointed at, and the cost was never the fix but the days before anyone
  noticed. A break now shows the first time the panel is opened, and names what stopped working.
- The session browser can search inside transcripts, not only their titles. Type a phrase, press
  Search transcripts, and the list narrows to the sessions that said it, with a snippet under each.
  The scope dropdown covers this workspace or every workspace on the box. It searches your messages
  and Claude's replies; tool output is not searched, and the status line says so.
- A one-line nudge under the Settings heading, with the repo's live star count and a link to it.
  The `×` hides it for good on the box, which also stops the count being read.
- A session that stops to ask you something now raises a notice, the way one that finishes a turn
  already did. A permission dialog or an MCP question keeps the CLI's stream open, so the session
  still reads as running and nothing fired; a prompt on a tab you were not looking at could sit
  unnoticed. The notice says whether Claude wants approval, an answer, or a look at a plan.
- An MCP server that needs signing in can be signed in from the MCP tab. The row carries a Log in
  button that opens the server's sign-in page in a new tab and then watches for the server to come
  back; before this the only way through was `/mcp` in a terminal. The sign-in has to finish in a
  browser on the box Claude Code runs on, which the row now says.
- The Skills tab's Skill costs fold now shows a sortable table instead of Claude Code's raw
  `/skill-doctor` text. Click a column heading to reorder; it opens on the last seven days' tokens,
  largest first. Cells sort by the magnitude they name, so 188.5m ranks above 54.3m. A report whose
  header is not the six known columns still shows as raw text.
- Concise joins the output styles the Tune tab offers. It is one of Claude Code's four built-in
  styles and the only one the row left out; it makes Claude answer tersely and skip the preamble.
- The Plugins roster names a plugin that loaded with a warning, under the block that names one that
  failed. A warning is the CLI's own wording for a plugin it took but had to work around, such as a
  default folder the manifest shadows. The list refreshes when the session next starts, since the
  CLI reports no warning count on a reload.
- The Skills tab can now add, edit and remove skills, not only list them. New skill writes a template `SKILL.md` and opens it for editing; Edit and Remove act on your own and the project's skills, while a plugin's stay read-only. A change reaches the running session at once, so a new skill's slash command works without restarting Claude.
- **What else drives your usage**, a fold in the Skills tab: which skills, subagents, plugins and
  MCP servers drove this machine's sessions over the last 24 hours and 7 days, and Claude Code's
  own sentences about how the work was shaped. It reads Claude Code's `/usage` on the box, so the
  figures match what `claude` reports in a terminal; the answer is kept on disk, so opening it is
  instant, and a Refresh control reads again.
- The Claude Code update card links the version it offers to that release's entry on
  code.claude.com's changelog, in a new tab, so what changed is one click from the offer.
- The Plugins roster names any plugin the Claude Code CLI could not load, with the reason, in a
  red block above the plugin rows. The block clears once a plugin reload reports no errors left;
  until then it shows what the session's last start found.
- A model fallback now surfaces in the session. When Claude's safeguards flag a message and re-run
  it on another model, the transcript shows a line naming the model that answered and the category
  that flagged the request, and a desktop notice says the same when the turn ends in a background
  tab. The model picker moves onto the answering model when the switch sticks for the rest of the
  conversation, matching the app, and stays put when the fallback was a one-off or a subagent's.
- A Skills tab in the panel gathers every skill the CLI can reach, grouped into User, Project and
  Plugin sections, and folds in Claude Code's own `/skill-doctor` report of what each costs in
  context and how often you have used it. The report runs the command as a throwaway one-shot, so no
  message reaches the model and it costs no usage. This replaces the Skill costs card that sat in
  Settings and the skills list that sat under the Instructions tab.

### Changed

- Claude Code update settings moved out of the Tune tab into Settings, under the Claude Code updates
  switch they depend on: the release channel, Update on its own, Check now and the run history.
  They sit behind one Options line that shows the current choices and opens on a click, and show
  at all only while the switch is on. With more than one box, a picker chooses which box they apply
  to. The Tune tab now holds only how Claude answers.
- The panel's tabs work from the keyboard. The strip is one stop in the tab order, the arrow keys,
  Home and End move between tabs, and opening the panel moves focus into it rather than leaving
  Tab to walk the page behind.
- The two dock cards, the Claude Code update card and a side question, have a real fold button in
  their header with Copy and close beside it, where the whole header used to be a clickable div
  holding buttons, which a screen reader cannot use. The side question's chevron now sits before
  Copy. The update card also stops its countdown to closing while it has keyboard focus.
- The Restore, Skills and Session browser searches look like dsh's own: its magnifier inside the
  field, the base layer behind it, 32 px tall. The Restore and Skills ones had been squeezed to
  17 px.
- A session with no title shows as `Untitled · <id>` in Restore and the Session browser, not as a
  bare date, and the Settings card that lists every session is called Session browser, not
  Archived Sessions.
- A new session's MCP tab says Claude starts on your first message, in muted text, instead of a red
  "no live Claude process".
- The chips dsh draws in a sent bubble, a skill it knows such as `/ic-logos` and a file
  mention, take the Claude look's accent under the "Links, rules and quotes" group instead of
  dsh's blue, so a sent skill reads in the same colour as the rest of the Claude chrome.
- A Claude command or skill run from dsh's slash menu (`/claude-<name>`) shows in the transcript
  as the bubble the person sent, `/name arguments`, instead of a collapsed context row. The row
  was easy to miss when reading back where a turn started.
- Each turn read the session's whole event log twice, front to back, to find the open turn and
  step and the last todo list; both reads now start from the tail and stop at the first hit, so a
  long session pays for a few events instead of all of them. The model-selection lookup used on
  a continue-after-limit does the same.

### Fixed

- The restore pulse on ✻ could fire a second time in the same tab, because marking one hint as seen
  dropped the others the tab had already read.
- The dsh hooks line in Diagnostics no longer turns amber on a blank session. It checked for the
  context ring, which dsh only draws once a session has context.
- The ✻ panel no longer runs under dsh's top strip in a short window. On a new session the
  composer sits mid-screen, and the panel sized itself to reach the top of the window, while dsh's
  conversation area starts 40 px lower and clipped its first rows, the Restore search among them.
  It now stops 8 px short of whatever clips it.
- Adding your first ssh box in Settings now switches Add workspace over to the box picker straight
  away. The picker read the box list once when the page loaded, so a box added afterwards did not
  show up until the tab was refreshed. It now rereads the list when Settings saves it, and when the
  tab comes back into view.
- The terminal mirror no longer replays exchanges it already showed after dsh restarts. Two saves
  of where it had read up to could land at once, and the older one could win, so the next start
  read from an earlier point and posted those exchanges into the session again. Saves now run one
  at a time, in the order they were made.
- A skill both dsh and Claude Code know now reaches Claude once instead of twice. dsh stops sending its own copy when the CLI lists that skill's name, because Claude Code injects the body itself. A skill only dsh knows still reaches Claude, since that copy is the only one.
- The effort picker now honours settings.json `maxEffortLevel`, so it lists only the levels the CLI will run. Before this it offered every level a model supports and the CLI quietly clamped a pick above the cap, so the picker showed an effort the turn never used.
- The percentage dsh prints beside the context ring, visible on a phone, said 100% while the
  ring and the usage panel said 58%. dsh draws that text from the same pressure figure that pins
  the ring for a Claude Code session; the plugin already corrected the ring and its label, and now
  corrects the text too.
- Under the default `spawn: keeper`, a Stop or idle timeout sent the CLI a SIGTERM and nothing
  more, so a `claude` wedged inside an uninterruptible tool outlived both; the keeper now follows
  with a SIGKILL after five seconds, as the plain spawner already did.
- The Claude Code update card stays folded once folded. The fold lived in the card's own
  state, so switching sessions remounted it open; it is now kept on the box for that release,
  beside the dismissal, and a fold made in one tab reaches every other tab and session on the
  box within a few seconds. A newer release opens the card again.
- Stop, then send again within a few seconds: the new turn no longer fails with the CLI's
  `[ede_diagnostic] result_type=user` text. When a steer had been forwarded to the CLI before the
  Stop, the plugin still waited to park the step on it, read the CLI's interrupt echo as that
  boundary, and left the interrupted turn's error result for the next prompt to read first. The
  interrupt now clears the park flag; the CLI runs the forwarded steer as a turn of its own, and
  its reply arrives the way a background reply does. An error there is dropped the way a
  background error is.
- A request could make ssh run a command on the machine hosting dsh. Two Tailscale routes passed
  a host from the request straight into `ssh`, and a host of `-oProxyCommand=<command>` is read
  by ssh as an option that runs the command before connecting anywhere. Anyone who could sign in
  to dsh could do it, outside every permission mode Claude has. The host is now always a
  destination, never an option, for every ssh call the plugin makes.
- The saved-boxes file, which holds each remote dsh's sign-in token, was readable by every
  account on the machine. It is now readable by its owner only.
- Memory no longer grows for as long as dsh runs. Several records kept per Claude session were
  never removed, so a box that opens a few hundred sessions a week carried every one until dsh
  restarted. They now go with the session's process.
- Every form field in the panel and in Settings has a name a screen reader announces. Most had
  only a placeholder, which disappears as soon as someone types.

### Removed

- The `/tailscale/peers` route, which nothing called; the add-box form reads `/tailscale/status`,
  whose reply carries the peers.

## [1.2.1] - 2026-09-18

### Added

- The update pill reads the newer release's dsh floor off the registry and stays quiet when this
  box's dsh does not reach it, so an update never replaces a working plugin with one built for a
  newer dsh. The box's own dsh channel brings the newer dsh in its own time. `/status` names the
  box's dsh and this build's floor.

### Fixed

- The dsh context card's block sizes, its CLAUDE.md row and the session notices watcher find the
  open session again on dsh 0.1.6-alpha.2. All three still read the list snapshot's `current`,
  which that dsh removed, so the card showed no sizes and no CLAUDE.md count, the return recap
  never fired, and the title's waiting mark did not clear for the session on screen.
- An attached image over 2000px on a side no longer breaks the turn once a conversation holds
  more than twenty images. The API caps each image at 2000px from the twenty-first on, the CLI
  answered "an image in the conversation could not be processed and was removed", and a wide
  screenshot in a long design session hit it twice in five minutes. Such an image now goes by
  path, and the note under the prompt says to Read it, which scales it; smaller images still
  ride inline as before. Matches the 2000px the CLI applies to everything it ingests itself.
- A keeper whose socket path is over Linux's 108-byte limit now says so in keeper.log and exits
  before spawning Claude, instead of failing to listen with `EADDRINUSE` and leaving dsh to report
  "keeper did not answer". Only a state dir nested very deep reaches it.

## [1.2.0] - 2026-09-18

### Added

- The status row names the dsh tool a turn is waiting on: `running job_output for 151s`, after the
  clock and the token count. While dsh ran a tool for Claude the bracket used to empty down to the
  clock, and the count restarted from zero when the result came back; both now hold through the
  wait.

- A switch for the footer cost readout, in the plugin's settings, on unless it is turned off. The
  turn records behind it are kept either way, so the figure is whole again the moment the switch
  comes back.

- Proxy reaches Anthropic, a setting for a box whose `ANTHROPIC_BASE_URL` is a proxy in front of
  api.anthropic.com. Claude Code assumes 200k for its 1M models behind any other host (and stops
  compacting Fable); on such a box, sessions start with the CLI's own flag for a proxy that
  forwards, and the context popover names it when it sees a session in that state. A session
  already running follows on its next message.

  Auto, On or Off, and Auto is the default: it asks the base URL once per dsh run, with no key
  attached, and takes Anthropic's own authentication error and request id as the answer. A proxy
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

### Changed

- The icon tile on dsh's changed-files card takes the accent colour in a Claude session, with the
  links and rules group; it stayed dsh's blue beside an orange chat.

- The proxy control takes its width from the word it shows, so Off and On sit narrower than Auto
  instead of every state holding the widest one's box.

- The cost pill reads `$28.84 · $7.78 last`; the cached-token count that used to close it has moved
  into the panel behind it. dsh's own neighbouring pill already reports the session's tokens and
  cache hit rate, and ours was the longest pill in the row.

- The cost panel is capped at 320px rather than 440px, so the API-rate footnote wraps instead of
  setting the panel's width. It stood half again as wide as dsh's stats panel beside it.

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
  the second put back a map from before the first and every key it had added was gone. A store of
  eight switches came back holding one. Requests are applied in turn now, and the file is replaced
  atomically, so a crash mid-write cannot truncate it either. Two browsers on the same box, which
  is what box-wide settings invite, was all it took.

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
