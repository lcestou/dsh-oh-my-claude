# dsh-llm-claude

Claude Code CLI as an LLM provider for [dsh](https://github.com/deepseek-ai/dsh). Every request drives `claude -p` with stream-json in and out, so it uses whatever login, hooks, CLAUDE.md files, MCP servers and rate limits Claude Code already has. No API key needed. The plugin speaks the CLI's own protocol (the one the Agent SDK wraps) directly, so it has no runtime dependencies.

## Install

Needs the Claude Code CLI on `PATH` and already logged in (`claude --version` works, `claude` opens without asking you to sign in). Nothing else: no API key, no Node build step.

```sh
dsh plugin --profile web add github:lcestou/dsh-llm-claude
systemctl --user restart dsh-web.service   # or restart `dsh web` however you run it
```

The package declares a dsh bundle, so `dsh plugin add` registers it in the profile by itself. After the restart, "Claude Code" appears in the model picker with the models your login can use. Pick one and chat.

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

Plugin settings live under Settings → Claude Code, or as `config:` on the bundle row if you override it in the profile's `cordis.patch.yml`.

### Developing

Install from a checkout instead: `dsh plugin --profile web add link:/path/to/dsh-llm-claude-code`. The source is strict TypeScript under `src/`; dsh loads the compiled output in `lib/`, so run `bun run build` after every edit and restart (the patch layer hot-reloads, plugin code does not). `lib/server` comes from `tsc`, `lib/client.js` from `bun build` of `src/client/index.tsx`; both are committed, so a plain install has them. `bun run check` runs lint (oxlint with the anti-slop rules in `tools/oxlint`), format check, typecheck, tests and the build.

## Configuration

All keys are optional.

| Key | Default | Meaning |
|---|---|---|
| `command` | `claude` | Claude Code binary: a name on PATH or an absolute path. |
| `spawn` | `node` | How the process starts. `node`: directly, with dsh's environment. `dsh`: through dsh's subprocess seam (`ctx.subprocess`). With a remote provider such as [a remote subprocess provider](https://example.com/remote-provider) mounted, a remote workspace then runs Claude Code on that machine; the seam scrubs credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD), so log in on the machine that runs it. |
| `permissionMode` | `dsh` | Claude Code permission mode for the tools it runs itself. `dsh` follows the session's access-mode switch in the dsh UI: read-only → `plan`, workspace-write → `acceptEdits`, danger-full-access → `bypassPermissions`. Any explicit value pins it. |
| `allowedTools` | `[]` | Extra `--allowedTools` entries. |
| `disallowedTools` | `[]` | `--disallowedTools` entries. |
| `addDirs` | `[]` | Extra `--add-dir` directories. |
| `maxTurns` | unset | `--max-turns` cap per request. |
| `maxBudgetUsd` | unset | `--max-budget-usd` cap per request. |
| `titleModel` | `haiku` | Model used for dsh's session-title requests. |
| `toolActivity` | `true` | Show Claude Code tool calls and results as reasoning blocks. |
| `resume` | `true` | Keep one Claude Code session per dsh session. |
| `idleTimeoutMs` | `1800000` | Kill the child when no stream event arrives for this long; surfaces as `IDLE_TIMEOUT`. |
| `toolTextLimit` | `600` | Characters of tool arguments and results shown in activity blocks. |
| `debug` | `false` | Log the spawn arguments (prompt redacted) and cwd per call. |
| `approvals` | `true` | Relay Claude Code permission prompts and AskUserQuestion to dsh dialogs. |
| `processIdleMs` | `1800000` | Kill a session's idle Claude process after this long without a turn. |
| `maxProcesses` | `4` | Cap on live Claude processes; the longest idle is evicted first. |
| `dshTools` | `true` | Serve dsh tools (subagents, jobs, goals, skills, web search) to Claude Code over MCP. |

Effort: none is advertised as default, so Claude Code's own default applies unless you pick one in dsh. Claude Code's own subagents stream back as `↳ subagent` reasoning blocks. Tool calls the CLI denies because it cannot prompt are counted and reported in one line at the end of the turn.

## How it works

**Models.** The picker is filled from the Anthropic Models API, using `ANTHROPIC_API_KEY` if set, otherwise the access token Claude Code stores in `~/.claude/.credentials.json`. Cached ten minutes; the hardcoded list in `src/adapter.ts` is the fallback. Context window and effort levels come from the same response, and picking an effort in dsh maps to `--effort`.

**Sessions.** Each dsh session gets a deterministic Claude Code session id. The first request starts it with `--session-id`; later requests find the transcript under `~/.claude/projects/<cwd>/` and pass `--resume`, sending only the new turn. Reopening an old dsh session resumes the same Claude Code session, with all its tool history. Forked sessions start fresh from the full dsh transcript. The child runs in the dsh session's working directory, so Claude Code sees the right CLAUDE.md and project files.

**Process.** One `claude` process stays alive per dsh session (`processIdleMs`, default 30 min; `maxProcesses`, default 4, evicts the longest idle). Turns after the first start in about a second because hooks, CLAUDE.md and MCP servers are already loaded. A change of model, effort, working directory or permission mode replaces the process; the Claude session is resumed, so nothing is lost.

**Approvals and questions.** With `approvals: true` (default) the child runs with `--permission-prompt-tool stdio`. When Claude Code would ask permission, dsh's own approval dialog appears; Approve runs the tool, Deny tells Claude the user refused. Claude's `AskUserQuestion` becomes a dsh question form and the answer goes back to Claude. Under Full Access nothing asks. Each ask also shows as a `⚑ approval: Tool …` or `❓ question …` row.

**Restarts.** A dsh restart kills every Claude Code child. Sessions that had a turn running are written to `~/.local/state/dsh-llm-claude/busy.json` as the turn starts and removed as it ends; about ten seconds after dsh comes back, each one still listed gets a plugin notice as a real prompt ("dsh restarted while this turn was in progress…"), the Claude session resumes with `--resume`, and the work continues without anyone typing. Sessions that were idle are left alone. Hot reloads keep their processes and are not restarts.

**Streaming.** Text and thinking arrive as live deltas. Claude Code's tool calls show as reasoning blocks prefixed `▶ ToolName` with the arguments, and their results as `◀ result`. dsh never runs those tools; Claude Code does, under the configured permission mode.

**Images.** Image attachments in the user turn are read from dsh's attachment store and sent inline as base64.

**Session browser.** Settings → Claude Code opens with a runtime line (which `claude`, which account, which box) and one list of every Claude Code transcript in reach: all workspaces of this box (`~/.claude/projects/*`) plus each reachable saved box, fetched box-side over the same login the probe uses. Chips filter by box (an unreachable box shows as offline and stays disabled), selects filter by workspace and origin; rows are grouped by box, newest first, each tagged `dsh`, `archived` or `terminal` with its workspace. On this box, Open opens the dsh session, Restore unarchives it first, and a terminal transcript is imported: converted to dsh events (prompts, replies, thinking, tool calls and results) so the history renders, with the dsh session taking the Claude session id as its own id, so the next prompt resumes that very Claude session with its full context. The transcript is only read; Claude Code keeps appending to the same file, so the session can be continued from either side. Claude's own subagent sidechains and an unanswered trailing prompt are left out of the copy. A row from another box says "Open on <box>" and sends the browser there with `#claude-session=<id>&cwd=<path>`; that box's panel picks the link up once dsh is ready and opens the session the same way. Below the list, Boxes and settings.json are collapsed cards with a one-line summary each. The browser half is `src/client/index.tsx`, built into `lib/client.js` by `bun run build`.

**settings.json editor.** The same Settings → Claude Code panel shows Claude Code's own `settings.json` (`$CLAUDE_CONFIG_DIR` or `~/.claude`): a summary line (model, hooks, permissions, env, plugins) and the file itself, read-only until Edit is pressed; then a plain editor with live JSON validation, Cancel and Save (Ctrl/Cmd+S), so browsing the panel can never change the file by accident. Save keeps the previous copy as `settings.json.bak` and writes through a temp file, so a crash mid-write never leaves a half file. Only a JSON object is accepted. Hooks and permissions edited here apply to every Claude Code process, in dsh or in a terminal; dsh's own hooks live elsewhere and are untouched. Routes: `GET`/`PUT /dsh-llm-claude/settings`, behind dsh's login like the rest.

**dsh tools over MCP.** Every dsh tool the session's agent can see, except the shell and file ones Claude Code has natively, is served to the Claude process as an MCP server named `dsh` (`--mcp-config`, Streamable HTTP on the dsh web port, path `/dsh-llm-claude/mcp/<session id>`, guarded by a key generated per dsh process). Claude Code sees them as `mcp__dsh__*`: `subagent_local`, `researcher_local`, `list_agents`, `send_message`, jobs, goals, skills, web search. A subagent started this way is a real child of the dsh session: it runs on whatever route the preset pins (someone-llm here), shows in the session header's subagent dropdown, and its completion notice reaches the next Claude turn as context. Calls to those tools are relayed, not executed in the bridge: the adapter ends the current step with a real dsh `tool-call`, dsh runs the tool in its own loop (so a subagent shows the native card, the header count, and its completion notice like any dsh-native session), and Claude's MCP request is answered with dsh's result when dsh sends it back. If no live turn can take a call (idle process, a relay already pending) the bridge executes it directly as before. Steers are forwarded to Claude's stdin the moment dsh receives them, so the CLI injects them at its own next tool call instead of waiting for the turn to end; the same message is skipped when dsh later delivers it at a boundary (matched by the prompt's rpcId). When no tool call follows, the CLI answers the steer as a turn of its own, and the dsh turn that re-delivers the steer shows that answer. Parallel dsh calls in one Claude step are gathered into one dsh step so dsh runs them in parallel. Stop in dsh sends the CLI an interrupt and keeps the process for the next turn instead of killing it. Forking a Claude session in dsh copies the parent's Claude transcript under the new id, cut at the forked turn, so the fork keeps Claude's context. One tool is the bridge's own, not dsh's: `open_session` starts a new top-level dsh session in the caller's workspace (optional `provider`, `model`, `agentPreset`, `workspaceId`), sends it a first prompt, and returns the session id. It shows in the sidebar as its own row and nothing comes back to the caller. While the bridge is on, the appended system prompt also tells Claude to route every subagent through `mcp__dsh__*` and never through its own `Agent` tool, whose children dsh cannot see; it points at `mcp__dsh__list_subagent_models` for the allowed routes rather than naming any. Switch off with `dshTools: false`. Source `src/mcp.ts`.

**Auxiliary calls.** dsh's session-title and compaction requests run as one turn with no tools and no session of their own, from a scratch directory so they never show up in a workspace's session list.

**Errors.** Abort from the UI kills the child. Non-zero exits surface with the last stderr; a real rate limit surfaces as `RATE_LIMIT` with the provider's reset time as retry-after.

**Surviving Claude Code updates.** Claude Code updates itself. On first use per process the adapter reads `claude --help` and `--version`; any flag the installed CLI does not list is left out (`--effort`, `--append-system-prompt`, `--include-partial-messages`, `--max-budget-usd`, session flags). Without `--input-format` the prompt goes positionally and images are skipped. Whole-message fallback covers a CLI that stops sending partial events. Started session ids are kept in `~/.local/state/dsh-llm-claude/sessions.json`; a `--resume` the CLI rejects is retried once as a fresh run. Model ids and effort levels come from the Models API, so new models need no code change. The version in use is logged at first request.

## Where things live

The plugin runs Claude Code as a child process of dsh, so everything is on the machine that runs `dsh web`:

- **Binary**: `claude` from that process's `PATH`. No path setting; put it on the PATH of the user running dsh.
- **Config dir**: `$CLAUDE_CONFIG_DIR` if set for the dsh process, otherwise `~/.claude` of that user. Transcripts (`projects/`), `settings.json` and the login token all live there, the same place a terminal `claude` on that machine uses.
- **Login**: done once, in a terminal on that machine, with `claude auth login`. The panel's first line shows which binary, which config dir, which host and which account dsh sees; if it says not logged in, that is the fix.

Same box, several clients (laptop, phone, another PC on the LAN): run `dsh web` where Claude Code is logged in and open that URL from anywhere.

**Several boxes.** The plugin does not ssh itself: a wrapper named `claude` that did would run the model elsewhere while the panel still read local transcripts and settings. Instead, install dsh and this plugin on each machine that has Claude Code, and list the others under Settings → Claude Code → Boxes (name, URL, optional dsh token). Each row is probed from this dsh: host, `claude` version, who is logged in, plugin version (a mismatch is flagged). Open jumps the browser to that box; sessions and logins stay where they are. The token is that box's dsh launch token, needed only when this browser has never logged into it; a proxy that injects the token (the NPM setup in the docs) needs none. Saved in `~/.local/state/dsh-llm-claude/boxes.json`, routes `GET`/`PUT /dsh-llm-claude/boxes` and `GET /dsh-llm-claude/boxes/status`, behind dsh's login. Same shape as another tool's environments, minus the tunnel service.

**Remote through dsh's own seam.** dsh separates *what runs a process* from *who asks*: `ctx.subprocess` is a seam, and community providers such as `a remote subprocess provider` mount a remote one. With `spawn: dsh` this plugin starts `claude` through that seam instead of node's `spawn`, so a workspace that a remote subprocess provider routes to another machine runs Claude Code there, with that machine's login and transcripts, and no ssh code in this plugin. Caveats: the seam's environment is dsh's scrubbed one (credentials come from the remote login); the MCP bridge URL points at this dsh's port, which a remote process cannot reach unless forwarded, so `dshTools` is best off for such workspaces; the session browser and settings editor stay local. The seam contract is covered by `src/adapter.test.ts`; a live remote run needs a remote subprocess provider mounted.

## Not covered

- dsh's shell and file tools are not proxied; Claude Code uses its own, under its own permission mode.
- Claude Code sessions are not deleted when dsh sessions are.

## Check

```sh
bun run check
```

Lint, format check, typecheck, the offline self-checks (`src/adapter.test.ts`, `src/transcript.test.ts`, `src/mcp.test.ts`) and the build. Covers config defaults, model resolution, session id derivation, turn selection, argument building, stream-json translation, the catalog fallback, and the transcript conversion (turn folding, tool result pairing, listing filters).
