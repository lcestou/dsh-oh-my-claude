# Configuration

Every key the plugin reads, with its default. All keys are optional; a fresh install with none of them works against a logged-in `claude` on `PATH`. Keys live under Settings → Oh My Claude, or as `config:` on the bundle row if you override it in the profile's `cordis.patch.yml`. Back to the [README](../README.md).

## Keys

| Key | Default | Meaning |
|---|---|---|
| `command` | `claude` | Claude Code binary: a name on PATH or an absolute path. |
| `spawn` | `keeper` | How the process starts. `keeper`: under a small keeper process outside dsh's process tree (its own systemd user scope when `systemd-run` exists, else a detached process), so a dsh restart leaves Claude running and the new dsh reattaches; see [Restarts](how-it-works.md#restarts). `node`: directly, as dsh's child. `dsh`: through dsh's subprocess seam (`ctx.subprocess`). With a remote provider mounted on that seam, a remote workspace then runs Claude Code on that machine; the seam scrubs credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD), so log in on the machine that runs it. |
| `sshHost` | `` | Drive this instance's Claude Code on a remote host over SSH (`[user@]host`, or a `Host` alias from `~/.ssh/config`). This box's harness runs `claude` there, nothing else runs on the far side, and the stream flows through the ssh pipe. Uses the remote's own `~/.claude` login, so the status, diagnostics, Settings and Tune panels report and edit that box; forces node-style spawn (no keeper survival yet). The dsh MCP bridge and the remaining file-reading tabs (Browser, Memory, Rewind) do not reach the remote yet, so keep `dshTools` off. Key-based auth only (`BatchMode`); a missing key fails fast rather than prompting. See [A box over SSH](remote.md#a-box-over-ssh). |
| `permissionMode` | `dsh` | Claude Code permission mode for the tools it runs itself. `dsh` follows the session's access-mode switch in the dsh UI: read-only → `plan`, workspace-write → `acceptEdits`, danger-full-access → `bypassPermissions`. Any of the CLI's six (`plan`, `manual`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`) pins it for every session; the shield by the composer still narrows a session below that ceiling. |
| `allowedTools` | `[]` | Extra `--allowedTools` entries. |
| `disallowedTools` | `[]` | `--disallowedTools` entries. |
| `addDirs` | `[]` | Extra `--add-dir` directories. |
| `pluginDirs` | `[]` | Local plugin directories (or `.zip` files) loaded for this session only, as repeatable `--plugin-dir`. Session-scoped, so they write no settings and do not show in the roster; a CLI without the flag leaves them off, and a path the CLI's policy refuses surfaces its own refusal. |
| `pluginUrls` | `[]` | Plugin `.zip` URLs fetched for this session only, as repeatable `--plugin-url`. Same session scope as `pluginDirs`. |
| `maxTurns` | unset | `--max-turns` cap per request. |
| `maxBudgetUsd` | unset | `--max-budget-usd` cap per request. |
| `titleModel` | `haiku` | Model used for dsh's session-title requests. |
| `toolActivity` | `true` | Show Claude Code tool calls and results. |
| `toolsInline` | `true` | Render tool activity inline in the stream. `false` appends dsh's own `tool/call` rows instead. The Tune tab's Tool activity switch overrides this once set. Rows are only written where they load back: a format-0 session log (dsh before 0.1.5), or a dsh whose loader takes a `tool/call` no assistant message advertised, which the plugin probes at startup (dsh 0.1.5-rc.1 does; its format migration did not). |
| `hookRows` | `true` | Show Claude Code hook starts and results as reasoning lines (adds `--include-hook-events`). |
| `resume` | `true` | Keep one Claude Code session per dsh session. |
| `idleTimeoutMs` | `1800000` | Kill the child when no stream event arrives for this long; surfaces as `IDLE_TIMEOUT`. |
| `toolTextLimit` | `600` | Characters of a tool result kept in its session row. |
| `debug` | `false` | Log the spawn arguments (prompt redacted) and cwd per call. |
| `approvals` | `true` | Relay Claude Code permission prompts and AskUserQuestion to dsh dialogs. |
| `processIdleMs` | `1800000` | Kill a session's idle Claude process after this long without a turn. |
| `maxProcesses` | `4` | Cap on live Claude processes; the longest idle is evicted first. |
| `fastMode` | `false` | Launch every Claude process with fast mode on (`--settings '{"fastMode":true}'`, Opus only, higher cost). The bridged `/fast` then toggles it for that session; in headless mode the toggle only works when the session started this way. |
| `commandBridge` | `true` | Register Claude Code's slash commands (skills, custom commands, from the CLI's init frame) as dsh `/commands` that hand the line to Claude. dsh's own command of the same name wins. |
| `redactSecrets` | `true` | Mask values of env vars named `*KEY`, `*TOKEN`, `*SECRET`, `*PASSWORD` or `*CREDENTIAL` (8+ chars) in Claude's tool results as `[redacted:NAME]` before dsh sees them. |
| `persistTodos` | `true` | Re-append the last todo list at each turn start so dsh's panel keeps it. |
| `continueAfterLimit` | `true` | When a usage limit ends a turn, wait for the reset and continue the task on its own, as the CLI does. |
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
  model: claude-fable-5-1
subagent-model-selection:       # let dsh subagents run on Claude Code too
  enabled: true
  allowedModels:
    - provider: claude-code
      model: claude-haiku-4-5
```

Mounting the plugin more than once, for a second account or an SSH box, is a `cordis.patch.yml` edit; see [Remote boxes and accounts](remote.md).
