# Configuration

Every key the plugin reads, with its default. All keys are optional; a fresh install with none of them works against a logged-in `claude` on `PATH`. Keys go as `config:` on the bundle row in the profile's `cordis.patch.yml` and take effect when dsh next loads the plugin, which a dsh restart does; dsh's Plugins page has no form for them. The switches under Settings → Oh My Claude and in the panel's Tune tab are separate: they apply at once and are kept on the box. Back to the [README](../README.md).

## Keys

| Key | Default | Meaning |
|---|---|---|
| `command` | `claude` | Claude Code binary: a name on PATH or an absolute path. |
| `spawn` | unset | How the process starts. Unset, or `keeper`, the Settings switch "Keep Claude running across dsh restarts" decides: on is `keeper`, off is `dsh`. `node` or `dsh` here wins and locks the switch. `keeper`: under a small keeper process outside dsh's process tree (its own systemd user scope when `systemd-run` exists, else a detached process), so a dsh restart leaves Claude running and the new dsh reattaches; see [Restarts](how-it-works.md#restarts). `node`: directly, as dsh's child. `dsh`: through dsh's subprocess seam (`ctx.subprocess`), which ends Claude and everything it started when dsh shuts down. The seam drops `DSH_*` names and credential-shaped ones (KEY/TOKEN/SECRET/PASSWORD) from the environment; the plugin passes the credential-shaped ones back, and the installer folders on `PATH`, so Claude sees what it sees in the other modes. With a remote provider mounted on that seam, a remote workspace runs Claude Code on that machine and those values go with it. The switch covers SSH boxes and remote workspaces too: on, the far `claude` is held on the box; off, it runs on the ssh connection and ends with it. |
| `sshHost` | `` | Drive this instance's Claude Code on a remote host over SSH (`[user@]host`, or a `Host` alias from `~/.ssh/config`). This box's harness runs `claude` there, nothing else runs on the far side, and the stream flows through the ssh pipe. Uses the remote's own `~/.claude` login, so the status, diagnostics, Settings and Tune panels report and edit that box. With the Settings switch "Keep Claude running across dsh restarts" on (the default), the far `claude` is held in a session of its own on the box, so a dsh restart reattaches. Off, it ends with the ssh connection. The dsh MCP bridge is skipped for a turn that runs on a box, since its URL is this box's port. Key-based auth only (`BatchMode`); a missing key fails fast rather than prompting. See [A box over SSH](remote.md#a-box-over-ssh). |
| `permissionMode` | `dsh` | Claude Code permission mode for the tools it runs itself. `dsh` follows the session's access-mode switch in the dsh UI: Read Only → `plan`, Workspace Write → `acceptEdits`, Full access → `bypassPermissions`. Any of the CLI's six (`plan`, `manual`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`) pins it for every session; the shield by the composer still narrows a session below that ceiling. |
| `hiddenModels` | `[]` | Model ids to leave out of the model picker, for example `claude-opus-5`. An entry matches the exact id, or the id plus a date stamp, and never a longer version, so `claude-opus-5` leaves `claude-opus-5-5` listed. Default is never hidden. A session already on a hidden model keeps running on it. Opened while idle, it moves to the newest listed model of the same family when there is one (hiding `claude-opus-5` moves it to `claude-opus-5-5`); with none listed, its picker reads "Select model" until you pick another. `~/.claude/settings.json` is untouched, unlike `availableModels`, which the terminal CLI honours too. The Settings card's Models block does the same with a switch per model and per box, stored in the hints store; a model this key names shows there as locked. |
| `customModels` | `[]` | Extra rows for the model picker, for a model that neither Anthropic's Models API nor Claude Code's own lineup lists. The usual case is a local router, such as [CC Switch](https://github.com/farion1231/cc-switch), that sends one model name to another provider's model. Settings → Oh My Claude → Models in the picker has an Add a model form that does the same without a restart, one list per box, and those rows can be removed there; rows from this key cannot. Each entry has `model`, the id passed to `claude --model` exactly as written. It may also have `label`, the name the picker shows, `contextWindow` in tokens (which dsh's context ring shows and Claude Code is started with, so it compacts at the model's real size), and `efforts`, any of `low`, `medium`, `high`, `xhigh` and `max`. Left out, they are the id, 200,000 and no effort picker, unless the id is a model the catalog already knows, which keeps its own name, window and levels. Example: `customModels: [{ model: deepseek-flash, label: DeepSeek Flash, contextWindow: 128000 }]`. Rows from either place sit beside the ones `modelPicker.options` in `settings.json` adds, and an `availableModels` list there filters them too. The plugin routes nothing itself: where a request goes is decided by Claude Code's own settings, such as `ANTHROPIC_BASE_URL`, and by the router behind it. The picker does follow that decision: while the box's Claude Code talks to Anthropic, a row for a model Anthropic does not list is left out, since a turn on it would fail, and it comes back when a router is switched on. A row that names a Claude model stays either way. [How the list follows a router](how-it-works.md#models). |
| `allowedTools` | `[]` | Extra `--allowedTools` entries. |
| `disallowedTools` | `[]` | `--disallowedTools` entries. |
| `addDirs` | `[]` | Extra `--add-dir` directories. |
| `pluginDirs` | `[]` | Local plugin directories (or `.zip` files) loaded for this session only, as repeatable `--plugin-dir`. Session-scoped, so they write no settings and do not show in the roster; a CLI without the flag leaves them off, and a path the CLI's policy refuses surfaces its own refusal. |
| `pluginUrls` | `[]` | Plugin `.zip` URLs fetched for this session only, as repeatable `--plugin-url`. Same session scope as `pluginDirs`. |
| `maxTurns` | unset | `--max-turns` cap per request. |
| `maxBudgetUsd` | unset | `--max-budget-usd` cap per request. |
| `titleModel` | `haiku` | Model used for dsh's session-title requests. |
| `toolActivity` | `true` | Show Claude Code tool calls and results. |
| `toolsInline` | unset | `true` renders tool activity as inline text, `false` as dsh's own `tool/call` rows. Unset: rows once the startup probe finds the running dsh loads them back, inline until then. The Settings switch "Native tool rows" overrides this once set. Rows are only written where they load back: a format-0 session log (dsh before 0.1.5), or a dsh whose loader takes a `tool/call` no assistant message advertised, which the plugin probes at startup (dsh 0.1.5-rc.1 does; its format migration did not). |
| `hookRows` | `true` | Show Claude Code hook starts and results as reasoning lines (adds `--include-hook-events`). |
| `resume` | `true` | Keep one Claude Code session per dsh session. |
| `idleTimeoutMs` | `1800000` | Kill the child when no stream event arrives for this long; surfaces as `IDLE_TIMEOUT`. A tool call in flight gets twice as long, and nothing is killed while an approval, a question or a plan review waits for your answer. |
| `toolTextLimit` | `600` | Characters of a tool result kept in its session row. |
| `debug` | `false` | Log the spawn arguments (prompt redacted) and cwd per call. |
| `approvals` | `true` | Relay Claude Code permission prompts and AskUserQuestion to dsh dialogs. |
| `processIdleMs` | `1800000` | Kill a session's idle Claude process after this long with no turn and no output from Claude. The reaper checks every 30 seconds and spares a process running a background task. A keeper with no dsh attached and no output ends its Claude after the same time, but never under five minutes. |
| `maxProcesses` | `4` | Cap on live Claude processes; the longest idle is evicted first. |
| `fastMode` | `false` | Launch every Claude process with fast mode on (`--settings '{"fastMode":true}'`, Opus only, higher cost). The bridged `/fast` then toggles it for that session; in headless mode the toggle only works when the session started this way. |
| `commandBridge` | `true` | Register Claude Code's slash commands (skills, custom commands, from the CLI's init frame) as dsh `/commands` that hand the line to Claude. dsh's own command of the same name wins. |
| `redactSecrets` | `true` | Mask values of env vars named `*KEY`, `*TOKEN`, `*SECRET`, `*PASSWORD` or `*CREDENTIAL` (8+ chars) in Claude's tool results as `[redacted:NAME]` before dsh sees them. |
| `persistTodos` | `true` | Re-append the last todo list at each turn start so dsh's panel keeps it. |
| `refusalAsFailure` | `false` | End a turn whose reply Claude refused, or that a safety classifier stopped with no fallback model, as a failure with code `REFUSAL` (message `Claude declined to answer (<category>): <the CLI's sentence>`) instead of a normal stop. A fallback plugin such as dsh-fallback-models can then continue the turn on another model. The turn ends that way when the CLI sends its `model_refusal_no_fallback` frame or a result that stopped with `refusal`; a subagent's refusal inside Claude Code is left to the subagent. The refused attempt draws nothing and reports no usage, because a fallback plugin retries only an attempt that produced no output; text Claude streamed before it refused has already gone out, and that attempt is not retried. The session's Claude transcript is then moved aside (renamed with a `.refused-<time>` suffix, never deleted), so the refused reply does not steer later turns: the next turn on Claude starts a new Claude session from dsh's own log, where the refused reply is kept as a failed attempt. A refusal Claude Code answered by switching models itself (`model_refusal_fallback`) is not a failure. |
| `continueAfterLimit` | `true` | When a usage limit ends a turn, wait for the reset and continue the task on its own, as the CLI does. |
| `cliCompaction` | `true` | Answer dsh's compaction of a Claude session with Claude Code's own `/compact` and hand dsh its summary, so both sides compact once, at dsh's threshold. Mid-turn the compaction waits until the session is idle; a subagent or team member compacts at its next turn's start. A session moving to another provider keeps dsh's one-shot summarizer. See [Compaction](how-it-works.md#compaction). |
| `configDir` | `` | Claude Code config dir for this plugin instance (exported as `CLAUDE_CONFIG_DIR` to every spawned CLI process); empty = the env var or `~/.claude`. Moves transcripts, `settings.json` and `.credentials.json` together, groundwork for multi-account mounts. |
| `ownTranscripts` | `false` | Keep this instance's transcripts in the plugin's own state dir instead of `~/.claude/projects/`. The CLI runs against a mirror config dir whose login, settings, commands and skills are symlinks back to the real `~/.claude`, so only `projects/` diverges; the archive reads both, so a session started from a terminal is still listed. |
| `providerId` | `claude-code` | Provider id in the model picker. The default is `claude-code`; anything starting with `claude-code-` (e.g. `claude-code-work`) mounts a second independent instance with its own login, state and process registry. |
| `providerName` | `` | Display name in the model picker. Empty = "Oh My Claude" for the default id, else "Oh My Claude (\<suffix\>)" where suffix is the part after `claude-code-`. |
| `dshTools` | `true` | Serve dsh tools (subagents, jobs, goals, skills, web search) to Claude Code over MCP. |

## Effort and denied tools

No effort is advertised as default, so Claude Code's own default applies unless you pick one in dsh. Claude Code's own subagents stream back as `↳ subagent` reasoning blocks. Tool calls the CLI denies because it cannot prompt are counted and reported in one line at the end of the turn; under `auto`, the calls its classifier blocks get their own line with the reasons it gave (`Exfil Scouting`, `Code from External`).

## dsh-side settings

Optional, in `~/.dsh/settings.yaml`:

```yaml
agent-default-model:            # make Claude Code the default for new sessions
  provider: claude-code
  model: claude-fable-5-1       # any model id the picker lists
subagent-model-selection:       # let dsh subagents run on Claude Code too
  enabled: true
  allowedModels:
    - provider: claude-code
      model: claude-haiku-5-5   # any model id the picker lists
```

Mounting the plugin more than once, for a second account or an SSH box, is a `cordis.patch.yml` edit; see [Remote boxes and accounts](remote.md).
