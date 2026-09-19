# How it works

The engine under the plugin: which process runs, how a session is kept, what happens on a restart, and how the stream reaches dsh. The panel and its tabs are on [their own page](panel.md); remote boxes and second accounts on [Remote boxes and accounts](remote.md). Back to the [README](../README.md).

## Where things live

The plugin runs Claude Code as a child process of dsh, so everything is on the machine that runs `dsh web`:

- Binary: `claude` from that process's `PATH`. No path setting; put it on the PATH of the user running dsh.
- Config dir: the plugin's `configDir` if set, else `$CLAUDE_CONFIG_DIR` if set for the dsh process, otherwise `~/.claude` of that user. Transcripts (`projects/`), `settings.json` and the login token all live there, the same place a terminal `claude` on that machine uses.
- Login: done once, in a terminal on that machine, with `claude auth login`, or from the Log in button described next.

The panel's first line shows which binary, which config dir, which host and which account dsh sees; if it says not logged in, that is the fix. The model picker says so too: a mount whose claude has no login is listed as `<name> (not logged in)`, from one `claude auth status` at mount and from every probe the panel runs after that. The models stay listed, so a session already on that box can still show the error a turn produces.

### Log in and Log out

Every row in Settings → Oh My Claude → Boxes offers the same Log in and Log out: this box, an ssh box whichever way it is reached (ssh, Tailscale, WireGuard), and a linked dsh box, whose own copy of this plugin runs them on its box.

Log in runs `claude auth login` under a local PTY (`script`, or `ssh -tt` for a box), the CLI's own login, so the terminal on that box and every Claude the plugin starts there share it. On a box with a browser the CLI opens the sign-in tab itself and the approval reaches it over loopback, no code; when the sign-in page shows a code instead, paste it in the row. Once the process exits the plugin asks that box's `claude auth status` whether the login took, the row flips, and a session whose turn had failed for want of a login shows a Log in card above its composer with the same flow.

Log out runs `claude auth logout` on that box and kills its running Claude processes, so nothing keeps answering on a login that is gone; each session resumes from its transcript on its next message. A token from the earlier `setup-token` flow, still under `ssh-tokens/`, keeps being injected as `CLAUDE_CODE_OAUTH_TOKEN` and its pill says "panel token" until Log out forgets it.

A second instance keeps its own login. With no `claude` on PATH the row says so instead; the plugin does not install it.

## Models

The picker is filled from the Anthropic Models API, using `ANTHROPIC_API_KEY` if set, otherwise the access token Claude Code stores in `~/.claude/.credentials.json`. Cached ten minutes; the hardcoded list in `src/adapter.ts` is the fallback. Context window and effort levels come from the same response, and picking an effort in dsh maps to `--effort`.

`settings.json` then gets the same say the terminal gives it, read fresh on each listing: `modelPicker.options` adds its rows (dropping the built-in lineup when `replaceBuiltInOptions` is set) and `availableModels` allows only the families, versions or ids it names, with the Default row surviving either way. Only the listing is filtered: a session already on a model the allowlist excludes keeps resolving it, as the terminal does. The same file's `maxEffortLevel`, and a per-model `modelSettings.<id>.maxEffortLevel` that overrides it, cap the effort levels a model offers, so the picker no longer shows a level the CLI would clamp; the value is read from that one file, not merged across settings scopes the way the CLI does.

The API dates some ids (`claude-haiku-4-5-20251001`) and leaves others alone, while the fallback list and the CLI's picker use the undated form. Since dsh keys a model by its id, an API id whose undated form is one the fallback list names is advertised undated. Otherwise every switch between the API and the fallback retired the model you had enabled and offered an unselected copy of it. An id the fallback list does not name keeps whatever the API called it. The CLI's own picker is held to the same rule: its rows lead the lineup under the CLI's labels, windows and effort levels, but a row landing on a model the catalog already knows takes that model's id rather than the alias, so a model is spelled the same before and after the CLI answers `list_models`. Only `default` and the `[1m]` variants keep an alias, having no stable id to take.

## Sessions

Each dsh session gets a deterministic Claude Code session id. The first request starts it with `--session-id`; later requests find the transcript under `~/.claude/projects/<cwd>/` and pass `--resume`, sending only the new turn. Reopening an old dsh session resumes the same Claude Code session, with all its tool history. Forked sessions start fresh from the full dsh transcript. The child runs in the dsh session's working directory, so Claude Code sees the right CLAUDE.md and project files.

A terminal `claude` opened in that same directory lists them under `/resume` like its own. That takes one thing from the plugin: every child runs with `CLAUDE_CODE_ENTRYPOINT=dsh-oh-my-claude`, because a print-mode CLI otherwise records `entrypoint: sdk-cli` and the picker hides every sdk-cli, sdk-ts and sdk-py session (Claude Code 2.1.268). Sessions recorded before this setting stay hidden in the picker; `claude --resume <session id>` still opens them, the id being the transcript's file name under `~/.claude/projects/<cwd>/`. Enter the directory by its real path, since a symlinked path maps to a different transcript folder.

## One session, two places

A dsh session and a terminal `claude /resume` share one transcript file. Carrying a session between the two needs nothing switched on: Claude Code writes that file itself, so a terminal `/resume` opens with dsh's turns in it, and a session that has only ever run in a terminal is seeded into dsh from the same transcript.

What is optional is the live copy in one direction: terminal exchanges appearing in an already-open dsh tab as they land. That is the Terminal mirror, marked experimental in the settings panel and off by default, because it holds a dsh turn open while it fills and a prompt typed meanwhile can queue behind it. Turning it off does not affect moving a session between dsh and a terminal.

With it on, the plugin watches the transcript of every session dsh has loaded (inotify on this box, a `stat` over the shared ssh connection every 30 seconds for a session that runs on an SSH box). The terminal's rows carry `entrypoint: cli`, the plugin's own carry `dsh-oh-my-claude`, so when a terminal exchange lands and the file settles the plugin opens a turn of its own in the dsh session: the prompt as a user message, the reply as the assistant's, tool calls drawn inline the way a live turn draws them. Nothing goes to Claude for it, since the transcript already holds both sides, and the live Claude process is marked stale so the next real message resumes from the transcript with the terminal turns in context. One exchange per turn, in order; an exchange that lands during a dsh turn follows it; an archived session is left alone until it is opened again. Where each watch stands is kept in `watch.json` under the state directory, so a restart carries on where it left off, and `resume.log` records each `watch` and `mirror`. What that gives, side by side:

| Start here | Continue there | What happens |
| --- | --- | --- |
| dsh | terminal `claude /resume`, same directory | The picker lists the session; it opens with the whole history. |
| terminal | dsh, the session open in a tab | Each exchange shows in the tab within seconds; the next dsh message knows it. |
| terminal | dsh, the session not open | Shows the moment the session is opened; nothing opens by itself. |
| terminal only | dsh, never spoken there | The panel's session list offers the transcript; opening it seeds a dsh session that keeps the same Claude id. |
| dsh | terminal, while both are open | The terminal never re-reads the file: it sees dsh's turns only on its next `/resume`. |

The last row is the one limit of the design, and it comes from Claude Code, which follows the chain the transcript's last row belongs to when it resumes: a terminal that keeps typing after a dsh turn forks the file, and the next dsh turn takes that fork as the truth. One side live at a time is the rule.

## Temporary sessions

Type `/temporary` in a session to toggle it: from the next turn its Claude process runs with `--no-session-persistence`, so nothing lands under `projects/` for it, and the session is never resumed on the Claude side; a dsh restart continues it from dsh's own log instead. Type `/temporary` again to switch back. The mark lives in memory (it survives a plugin reload, not a dsh restart).

## Process

One `claude` process stays alive per dsh session (`processIdleMs`, default 30 min; `maxProcesses`, default 4, evicts the longest idle). Turns after the first start in about a second because hooks, CLAUDE.md and MCP servers are already loaded. A change of model, effort, working directory or permission mode replaces the process; the Claude session is resumed, so nothing is lost.

### Idle watchdog

`idleTimeoutMs` stops a process that produces nothing for that long, but not silently: half a timeout before the stop (60 s when the timeout is two minutes or more) a reasoning row announces the countdown, and the session header shows `stopping in Ns` with an Extend button that pushes the deadline out by a full timeout. A tool call in flight pauses the watchdog. `GET /dsh-oh-my-claude/idle?session=` and `POST /idle/extend` are the routes behind the chip.

## Approvals and questions

With `approvals: true` (default) the child runs with `--permission-prompt-tool stdio`. When Claude Code would ask permission, dsh's own approval dialog appears; Approve runs the tool, Deny tells Claude the user refused. Claude's `AskUserQuestion` becomes a dsh question form and the answer goes back to Claude.

Under Full Access nothing asks, except plan review: when Claude leaves plan mode (`ExitPlanMode` arrives as a permission request carrying the plan), dsh's own Plan review panel shows it with Approve and Keep planning; approval lets the tool run, anything else goes back to Claude as "the user chose to keep planning" with the typed feedback. Each ask also shows as a `⚑ approval: Tool …` or `❓ question …` row.

## Permission mode per session

dsh's access shield by the composer is the control, in a Claude session with Claude's rows: Plan (read-only), Ask and Accept edits (workspace write), Auto, Don't ask and Bypass (full access). A pick first switches dsh's preset through its own `/permission` command when the mode needs another one, then stores the Claude override per session under the instance state dir (`permission-modes.json`), used for `--permission-mode` at the next spawn or resume and pushed to a live process with the CLI's `set_permission_mode` control request. The override can only be as loose as dsh's preset maps to (`plan`, `acceptEdits`, `bypassPermissions`); the server refuses a looser one. dsh's trigger and menu are kept and relabelled, so other providers see dsh's shield unchanged. Routes: `GET`/`PUT /dsh-oh-my-claude/permission-mode`.

## Secrets

Values of environment variables whose name looks like a secret are masked in Claude's tool results before they reach the session log (`redactSecrets`), since the CLI inherits dsh's environment and a `cat .env` would otherwise persist verbatim. Only the values this process can see are known; secrets read from files are not.

## Restarts

With `spawn: keeper` (default) a dsh restart does not touch Claude: each `claude` process is owned by a keeper (`lib/server/keeper.js`, one per session under `~/.local/state/dsh-oh-my-claude/keepers/<id>/`, launched in its own systemd user scope so the service's cgroup kill misses it). The keeper owns Claude's pipes, buffers its output while no dsh is attached (bounded, oldest lines dropped with a notice), and dsh talks to it over a unix socket. On boot the plugin reattaches to every keeper whose Claude is still alive, and if output was waiting it opens a turn that shows it, with a "reattached" notice as the next prompt. The MCP bridge key lives in `mcp.key` in the state dir so a surviving Claude still reaches the new dsh's tools; Claude's MCP client may still need to reconnect once after the restart. Kill semantics are unchanged: Stop, eviction and the idle timers end the keeper's Claude.

With `spawn: node` or `dsh`, a dsh restart kills every Claude Code child. Sessions that had a turn running are written to `~/.local/state/dsh-oh-my-claude/busy.json` as the turn starts and removed as it ends. About ten seconds after dsh comes back, each one still listed gets a plugin notice as a real prompt ("dsh restarted while this turn was in progress…"), the Claude session resumes with `--resume`, and the work continues without anyone typing. Sessions that were idle are left alone. Hot reloads keep their processes and are not restarts.

Two guards keep this path from doing harm: a boot within a minute of the previous one is treated as a crash loop and nudges nothing (the busy list is left for a later healthy boot), and a session whose durable inbox already holds an unconsumed restart notice is not nudged again. The trace of every boot is `resume.log` next to `busy.json`. The nudge starts one turn; for work that should keep going across restarts with nobody at the keyboard, put it under a dsh goal (`/goal` or `create_goal`): dsh's goal round driver starts the next round whenever the agent is idle with an armed goal, and since dsh disarms goals on session resume, the restart notice tells the model to rearm it with `update_goal` (action `resume`).

## Streaming

Text and thinking arrive as live deltas. Claude Code's own tool calls render inline in the stream by default. With Tune's Tool activity switch on Native rows (only where the running dsh loads them, see [Tune](panel.md#tune)) the adapter appends `tool/call` and `tool/result` session events inside the open step, the same shape dsh's loop writes for its own tools, so `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebFetch` and `WebSearch` each get dsh's presenter for that tool, `MultiEdit` shares Edit's, and every other Claude tool keeps its own name on the generic row. Bash shows its description; an edit shows the +/- badge from `meta.diffs`. Inline headers take dsh's own row typography too: the tool name, a 2 px dot and the summary in the tertiary colour, split out of the translator's `name · summary` line by the same client pass that lifts the glyph. dsh never runs those tools; Claude Code does, under the configured permission mode. Fable-class models return thinking blocks with an empty body, so no reasoning text appears for them; local and Sonnet-class models stream theirs.

## Turn status

While a turn runs on a session this plugin drives, the status row under the last message takes Claude Code's look instead of dsh's blue `Deep diving...`: a spinner glyph played through Claude's own frames, a verb picked per turn from the CLI's list (`settings.json` `spinnerVerbs` is honoured, `append` or `replace`), Claude orange, the elapsed clock kept. After the verb sits a bracket the way the CLI's own line writes it: the clock, the turn's running token count (summed across every message of the turn plus the estimate for a thinking block in progress, eased toward its target the way the CLI eases its own), and `thinking` while a thinking block is open. The word climbs the CLI's ladder (`still thinking` at 10s, `thinking more` at 20s, `thinking some more` at 30s, `almost done thinking` at 45s), names the effort when dsh asked for one, and gives way to `thought for Ns` for two seconds once the block closes. While dsh runs one of its own tools for Claude (a subagent, a background job, `job_output`) the step is closed and nothing streams, so the bracket names the wait instead: `running job_output for 151s`, the shape of the CLI's own `running tool for Ns`, with the clock and the count kept beside it.

Colours follow the CLI's spinner: a thinking burst past ten seconds warms the glyph, verb and word toward the theme's warning shade over the next ten, a response that goes quiet for ten seconds tints them toward the CLI's stall red, and the shimmer sweeps only while neither is up. The figures come from the plugin's `live-turn` route, polled once a second while the row is up and not at all in a hidden tab; everything else is read from the CLI bundle and recorded in the owner's notes. The row has no slot, so the client restyles it through a DOM watcher (`watchTurnStatus`), only when the session's provider is `claude-code`.

The word `ultrathink`, typed in the composer, waiting in the queue or sent in a message, takes the CLI's rainbow (one colour per letter, red through violet, wrapping), with the CLI's shimmer sweeping over it in the composer; `ultracode` takes the CLI's purple in the composer only, under the CLI's own matcher (a quoted or slash-command occurrence is left plain). Both go through the CSS Highlight API, so neither the composer nor the chat sees a DOM change. The same Claude orange tints the running dot beside each session in the sidebar under Workspaces, but only for Claude sessions: a second watcher (`watchSessionSpinners`) colours the matrix dot for sessions whose provider is `claude-code`, matched by their title in the row, and leaves any other provider's dot dsh's default. A session that changes to another provider mid-flight loses the tint.

All of this colour is the Claude look switch in Settings: off, or off per group, and the status row, links, send button, panel and rainbow fall back to dsh's own; the accent picker there recolours the lot. [The panel](panel.md#claude-look) has the switch.

## Compaction

The CLI announces compaction with a `compacting` frame, goes silent while it summarises, then emits the boundary; both ends show in the reasoning lane, and a failed compaction is reported. The `compacting` frame repeats every 30 seconds until the boundary arrives, so the announcement is written once and the repeats only keep the status row's clock moving. A 141-second compaction was measured on 2026-09-14.

dsh's own automatic compaction never runs on this plugin's routes, and there is no setting to turn it on, because compacting on top of a harness that already compacts wastes a summary and stalls the turn. Two things made it worth switching off rather than tuning. Claude Code compacts its own context and this plugin relays that, so the work is already being done. And dsh's pressure reading does not describe this route: dsh measures its own session surface, which keeps growing, while `resume` sends the CLI only the tail after the last assistant message, so dsh reached its threshold 22 times in two sessions that had declared a 1,000,000-token window. Each of those spent about 100 seconds writing a summary the prompt builder then sliced off.

The switch is capacity, reported to one caller and not the other. dsh asks an adapter for a model's context window through two methods: `prepareCall`, whose answer feeds the context ring and the readouts this plugin injects into it, and `resolveModel`, whose answer is what `compaction-basic` multiplies by its threshold ratio before every step. This plugin answers the first and stays quiet on the second, so the ring works and the threshold can never be computed. Compaction's own pre-step handler catches that, warns once and continues the turn. The scope is per route, not per profile: a provider that is not this plugin keeps dsh's compaction, and a Claude Code route loses it wherever it runs. That includes compaction mounted by an agent preset in its own realm, because every realm shares one `llm` service and asks it about the same route.

What stays: `/compact` on demand, which is a different code path and never reads capacity, and dsh's context ring. What goes with automatic compaction: automatic overflow recovery, which is free here because this plugin never reports a context overflow, and `dsh-session-reference`'s capacity-scaled budget, which falls back to its 65,536-byte default on these routes; setting `maxReferenceBytes` on that plugin gets any budget you want back, since it is checked before capacity is.

After a dsh upgrade, one thing is worth re-checking: this depends on `compaction-basic` still reading capacity through `llm.resolveModelInfo()`. If a future version reads it from the prepared call instead, automatic compaction comes back on these routes with no warning, and the fix belongs here rather than in a profile.

## Task progress

The CLI's subagent runner emits `task_started` when a task begins, `task_progress` frames as the task runs (carrying `last_tool_name`, `usage` token counts, `summary`), and `task_notification` when the task finishes or fails. The plugin keeps one reasoning block open per running task so dsh renders each as a single collapsible row with the start line, progress updates as they arrive (tool name and token counts), and the final status. Identical progress frames append nothing so a chatty task does not fill its row with repeats. A task without a `task_id` renders as a single closed line. `background_tasks_changed` is silent (it is list churn). Source: `src/translator.ts` and tested in `src/adapter.test.ts`.

## Todo panel

dsh clears its todo projection at every turn start; the adapter re-appends the last `todo/write` inside the open turn (`persistTodos`), so the panel keeps the list across messages and restarts.

## Images and files

Image attachments in the user turn are read from dsh's attachment store and sent inline as base64, and a copy is kept under `~/.local/state/dsh-oh-my-claude/attachments/<hash>.<ext>` with the extension its media type calls for, since dsh's own stored object is named by hash with none and Claude Code's Read decides image-or-text by the name. A note after the prompt names that path, the display name and the size, so Claude can Read the image again, edit a copy, or hand the path to a subagent instead of only seeing the pixels. A file attachment needs nothing from the plugin: dsh-llm replaces every file block with a line naming the file and the read-only path it is stored under before any provider sees the turn, and Claude reads that path with its own Read tool.

## dsh tools over MCP

Every dsh tool the session's agent can see, except the shell and file ones Claude Code has natively, is served to the Claude process as an MCP server named `dsh` (`--mcp-config`, Streamable HTTP on the dsh web port, path `/dsh-oh-my-claude/mcp/<session id>`, guarded by a key generated per dsh process). Claude Code sees them as `mcp__dsh__*`: `subagent_local`, `researcher_local`, `list_agents`, `send_message`, jobs, goals, skills, web search, and `bash` (for long-running commands that you would run with `run_in_background`: dsh registers the job, shows its card and panel entry, and delivers the finish notice next turn; short foreground commands stay on native `Bash`). A subagent started this way is a real child of the dsh session: it runs on whatever route the preset pins, shows in the session header's subagent dropdown, and its completion notice reaches the next Claude turn as context.

Calls to those tools are relayed, not executed in the bridge: the adapter ends the current step with a real dsh `tool-call`, dsh runs the tool in its own loop (so a subagent shows the native card, the header count, and its completion notice like any dsh-native session), and Claude's MCP request is answered with dsh's result when dsh sends it back. If no live turn can take a call (idle process, a relay already pending) the bridge executes it directly as before. Everything dsh splices into a running step is forwarded to Claude's stdin the moment it arrives, whoever sent it (a steer you typed, a child's `send_message`, a subagent's settlement notice, a job's finish line), so the CLI injects it at its own next tool call instead of waiting for the turn to end; the same message is skipped when dsh later delivers it at a boundary (a typed steer by its prompt's rpcId, a dsh message by its id). A forwarded message also asks the step to end at the CLI's next tool result so dsh can draw it; that request is dropped at every step dsh opens, since dsh draws everything pending before it opens one, and a request left standing would end a step dsh has nothing to follow with. A steer that carries a file or an image is the exception: nothing goes over stdin for it, and it waits for the CLI's next tool result, where dsh delivers it whole with the file's `[File …]` handle. When no tool call follows, the CLI answers the steer as a turn of its own, and the dsh turn that re-delivers the steer shows that answer. Parallel dsh calls in one Claude step are gathered into one dsh step so dsh runs them in parallel. Stop in dsh sends the CLI an interrupt and keeps the process for the next turn instead of killing it. A message sent while that turn ran, and already forwarded to the CLI, is not lost: the CLI runs it as a turn of its own after the interrupt, and its reply shows the way a background reply does. An error there is dropped the way a background error is. Forking a Claude session in dsh copies the parent's Claude transcript under the new id, cut at the forked turn, so the fork keeps Claude's context.

One tool is the bridge's own, not dsh's: `open_session` starts a new top-level dsh session in the caller's workspace (optional `provider`, `model`, `agentPreset`, `workspaceId`), sends it a first prompt, and returns the session id. It shows in the sidebar as its own row and nothing comes back to the caller. While the bridge is on, the appended system prompt also tells Claude to route every subagent through `mcp__dsh__*` and never through its own `Agent` tool, whose children dsh cannot see; it points at `mcp__dsh__list_subagent_models` for the allowed routes rather than naming any. Switch off with `dshTools: false`. Source `src/mcp.ts`.

## Command bridge

The CLI's init frame lists its slash commands (skills, custom commands, built-ins such as `/compact`). Each name dsh's command grammar accepts is registered as a dsh `/claude-<name>` on first sight (default instance only), so the composer's slash menu offers `/claude-verify`, `/claude-context` and the rest under a description naming the Claude command. The prefix is deliberate: dsh's command menu refuses a host command whose name matches a client-side contribution, and Claude's catalog is long. Running one hands `/name <arguments>` to Claude as the next prompt, where the CLI expands it exactly as the terminal would; the transcript shows `/name <arguments>` as the bubble you sent, and the composer shows `/name sent to Claude Code`.

Each bridged command declares `input.attachments`, so a file or image in the composer goes with it (dsh refuses attachments to a command that does not declare them, with `/name does not accept attachments`), and they reach Claude the way a typed turn's do. A bridged line with attachments is logged as a user turn rather than the collapsed notice row, so the bubble shows the file or image chip a typed prompt would. Renaming through the bridge sets dsh's title as well: `/claude-rename <title>` renames the dsh session first and sends the line only if that worked, so the two names cannot end up disagreeing, and dsh's title is pinned afterwards so automatic title generation stops replacing it. Switch off with `commandBridge: false`.

## Auxiliary calls

dsh's session-title and compaction requests run as one turn with no tools and no session of their own, from a scratch directory so they never show up in a workspace's session list.

## Content search

dsh's sidebar search can search message content through its own FTS5 backend (`dsh-session-query-sqlite`), which dsh ships switched off (`openAt: never`). Turning it on is a dsh deployment setting in the profile's `cordis.patch.yml`, not something this plugin does or needs.

## Errors

Abort from the UI kills the child. Non-zero exits surface with the last stderr. A real usage limit surfaces as `RATE_LIMIT` with the provider's reset time as retry-after; the CLI answers a rejected request with its own synthetic message ("You've reached your Fable limit. Switch to another model, or manage usage credits at …") and that text is relayed whole, whatever the cause it names. The failure row adds only what the event's own fields say: which window (`rateLimitType`), when it reopens, printed as the CLI's [error reference](https://code.claude.com/docs/en/errors#youve-hit-your-session-limit) does (`1pm` later today, `Tue 1pm` inside the week, `Sep 8, 1pm` beyond it) in the browser's zone, and "· continuing automatically when it resets" when the wait is on.

While the CLI retries a 429 or 5xx by itself, each attempt is one reasoning line with the wait, the reset clock (in the browser's zone dsh stamps on each prompt, else the box's) and the attempt count, so the turn never looks busy for nothing. A retry line for a 5xx also names the incident Anthropic's status page reports, if any.

With `continueAfterLimit` on, the plugin arms a timer for the reset (kept in `limit-waits.json`, so a restart re-arms it) and then drops a continue notice through the same path a restart uses; any prompt sent before then cancels the wait. Before the notice goes out the plugin checks that the session still runs on this provider (a reroute to another model drops it) and asks the usage endpoint whether a window is still at its cap (then the wait is re-armed for that reset). A rejected request that paid extra usage covers is not a limit at all, the turn goes on as in the CLI; extra usage turned on during a wait needs no detection, since any prompt cancels the wait and Claude's next limit event says whether credits cover the overflow.

## Surviving Claude Code updates

The Claude Code terminal UI updates itself; a headless `claude -p`, which is what this plugin runs, never does (measured on 2.1.273, 2026-09-16: the updater is a component of the terminal UI). So the plugin stands in for it. A minute after boot and every 30 minutes, the CLI's own cadence, this dsh reads the release pointer the CLI reads (`downloads.claude.ai/claude-code-releases/<channel>`, unless `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES` is set, which the CLI honours too) and asks `claude --version` on this box and on every saved ssh box. When a session's box is behind, a card above the composer names the box and both versions with an Update button, which runs `claude update` there from dsh, an Always update link that also flips the box's Update on its own switch, and a dismiss that holds until the next release. The new version is a link to that release's entry on code.claude.com's changelog. Folding the card to its header is kept on the box for that release too, so it stays folded across sessions and tabs until a newer release opens it again. The same button sits on each Boxes row in Settings, beside Log out. Every run is recorded under the plugin's state directory (`claude-updates.json`) and shown under Tune as History. A run the CLI declines (a package-manager install, a `minimumVersion` cap, a slower channel) is recorded with the CLI's own words and not offered again for that release. A running session finishes on the version it started with; the next spawn picks up the new one, and the plugin forgets that box's flag probe so the next spawn reads the new binary. The Claude Code updates switch in Settings turns the whole thing off. On first use per process the adapter reads `claude --help` and `--version`; any flag the installed CLI does not list is left out (`--effort`, `--append-system-prompt`, `--include-partial-messages`, `--max-budget-usd`, session flags). Without `--input-format` the prompt goes positionally and images are skipped. Whole-message fallback covers a CLI that stops sending partial events. Started session ids are kept in `~/.local/state/dsh-oh-my-claude/sessions.json`; a `--resume` the CLI rejects is retried once as a fresh run. Model ids and effort levels come from the Models API, so new models need no code change. The version in use is logged at first request.

## Plugin updates

`dsh plugin --profile web update dsh-oh-my-claude` and a restart of `dsh web` bring in a new version. Neither npm nor dsh announces one, so the plugin does: an orange pill with the new version number appears beside the Oh My Claude heading in Settings, and on the panel's Runtime line, once a newer release is on npm (one registry read a day, from the dsh server); a click puts that update command on the clipboard. The Update notice switch at the top of that settings section turns the read off; the pill then only names the running version. The pill also reads the new release's dsh floor off its package.json on the registry and stays quiet when this box's dsh does not reach it: a plugin that needs a newer dsh than the box has would replace a working one with a broken one. A dsh upgrade, as opposed to a plugin one, can call for one repair, described next.

## Failed to load history after a dsh upgrade

dsh 0.1.5 gave the session log a versioned format with a strict migration. Logs written with `toolsInline: false` before 2026-09-08 hold raw `tool/call` rows the migration refuses, and dsh then shows *Failed to load history … does not match one advertised tool call* for that session. Repair them once, with dsh-web stopped, from a checkout of this repository (`tools/` is not part of the npm package):

```sh
bun tools/dsh-session-repair.ts --check --all   # lists what needs repair, changes nothing
bun tools/dsh-session-repair.ts --apply --all   # drops the offending rows, keeps a .bak next to each log
```

The tool proves every repaired log through dsh's own migration chain before writing it. Conversation text is untouched; only the tool cards of those old turns are gone from history.
