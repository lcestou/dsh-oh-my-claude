# dsh-llm-claude

Claude Code CLI as an LLM provider for [dsh](https://github.com/deepseek-ai/dsh). Every request drives `claude -p` with stream-json in and out, so it uses whatever login, hooks, CLAUDE.md files, MCP servers and rate limits Claude Code already has. No API key needed.

## Install

```sh
cd ~/.dsh/profiles/web
pnpm add file:/path/to/dsh-llm-claude-code
```

Then add the plugin to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: llm-claude
      name: 'dsh-llm-claude'
      config: {}
```

Restart `dsh web` after installing and after every edit to `src/`. The patch layer hot-reloads, plugin code does not. pnpm hardlinks the `file:` dependency per file, so editors that replace files break the link; copy `src/` over `node_modules/dsh-llm-claude/src/` if `cmp` shows a difference.

## Configuration

All keys are optional.

| Key | Default | Meaning |
|---|---|---|
| `permissionMode` | `dsh` | Claude Code permission mode for the tools it runs itself. `dsh` follows the session's access-mode switch in the dsh UI: read-only → `plan`, workspace-write → `acceptEdits`, danger-full-access → `bypassPermissions`. Any explicit value pins it. |
| `allowedTools` | `[]` | Extra `--allowedTools` entries. |
| `disallowedTools` | `[]` | `--disallowedTools` entries. |
| `addDirs` | `[]` | Extra `--add-dir` directories. |
| `maxTurns` | unset | `--max-turns` cap per request. |
| `maxBudgetUsd` | unset | `--max-budget-usd` cap per request. |
| `titleModel` | `haiku` | Model used for dsh's session-title requests. |
| `toolActivity` | `true` | Show Claude Code tool calls and results as reasoning blocks. |
| `resume` | `true` | Keep one Claude Code session per dsh session. |

## How it works

**Models.** The picker is filled from the Anthropic Models API, using `ANTHROPIC_API_KEY` if set, otherwise the access token Claude Code stores in `~/.claude/.credentials.json`. Cached ten minutes; the hardcoded list in `src/adapter.js` is the fallback. Context window and effort levels come from the same response, and picking an effort in dsh maps to `--effort`.

**Sessions.** Each dsh session gets a deterministic Claude Code session id. The first request starts it with `--session-id`; later requests find the transcript under `~/.claude/projects/<cwd>/` and pass `--resume`, sending only the new turn. Reopening an old dsh session resumes the same Claude Code session, with all its tool history. Forked sessions start fresh from the full dsh transcript. The child runs in the dsh session's working directory, so Claude Code sees the right CLAUDE.md and project files.

**Streaming.** Text and thinking arrive as live deltas. Claude Code's tool calls show as reasoning blocks prefixed `▶ ToolName` with the arguments, and their results as `◀ result`. dsh never runs those tools; Claude Code does, under the configured permission mode.

**Images.** Image attachments in the user turn are read from dsh's attachment store and sent inline as base64.

**Auxiliary calls.** dsh's session-title and compaction requests run as one turn with no tools and no session of their own.

**Errors.** Abort from the UI kills the child. Non-zero exits surface with the last stderr; a real rate limit surfaces as `RATE_LIMIT` with the provider's reset time as retry-after.

**Surviving Claude Code updates.** Claude Code updates itself. On first use per process the adapter reads `claude --help` and `--version`; any flag the installed CLI does not list is left out (`--effort`, `--append-system-prompt`, `--include-partial-messages`, `--max-budget-usd`, session flags). Without `--input-format` the prompt goes positionally and images are skipped. Whole-message fallback covers a CLI that stops sending partial events. Started session ids are kept in `~/.local/state/dsh-llm-claude/sessions.json`; a `--resume` the CLI rejects is retried once as a fresh run. Model ids and effort levels come from the Models API, so new models need no code change. The version in use is logged at first request.

## Not covered

- dsh's own tools are invisible to the child. The system prompt still mentions them, so Claude Code may occasionally talk about a tool it cannot call.
- Claude Code permission prompts cannot be relayed to the dsh UI. Under `acceptEdits` anything that would prompt is denied; use `bypassPermissions` or `allowedTools` to widen.
- Claude Code sessions are not deleted when dsh sessions are.

## Check

```sh
bun run check
```

Lint, format check, and the offline self-check in `src/adapter.test.js`. Covers config defaults, model resolution, session id derivation, turn selection, argument building, stream-json translation, and the catalog fallback.
