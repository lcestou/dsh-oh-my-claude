# Five quality-of-life items, one branch (2026-09-13)

The five items ranked in `docs/queue.md` after PR #6: a prefilled bug report, a spend guard, a model remembered per workspace, Markdown export with a resume command, and Anthropic's status on API errors. Each got five candidate shapes before one was picked. The rule from `2026-09-07-controls.md` still governs placement: a control belongs on the surface that already shows its consequence, and nothing is silently persistent.

Two privacy rules apply to everything below. Nothing the plugin writes to a clipboard or a URL carries an email, a username, a hostname (unless asked for), a token, session text, or a workspace path beyond the plugin's own state directory. And every stored preference names where it lives, so a user can find and clear it.

## 1. Diagnostics and a prefilled bug report

What exists: the session panel's Diagnostics tab (runtime, config files, feature switches, MCP servers, refused calls, `claude doctor`) and the Settings section's This box row (CLI version, login, update pill). Neither can be copied, and both show the raw config path and the masked email.

Options:

1. **A Report a problem card in Settings.** Report text in an editable box, Copy and Open issue buttons, a hostname checkbox. Box-wide facts only.
2. **Buttons in the Diagnostics tab.** Same report, built from what the tab already loaded, so it carries the session's MCP statuses and refused calls. Session-bound: a user who cannot open a session cannot report.
3. **Both surfaces, one component.** The Settings card for a box that will not log in or start; the tab's block for a session that misbehaves, with the session facts added.
4. **A Report button on the This box row.** Closest to the facts it reports, but the row is already the login and logout control and a text box does not fit a row.
5. **A link only.** Open a GitHub issue with the report in the URL, no preview. Fails the queue's own requirement that the text shows before anything leaves the box.

**Chosen: 3.** One `Report` component (`src/client/report.tsx`) fed by one server route, `GET /report`, mounted as a folded card in Settings and as a block under Run doctor in the Diagnostics tab. The route builds the text on the server so redaction happens in one tested function (`src/report.ts`), not in two renderers. The text box is editable: a user strikes a line before copying. Hostname is off by default and a checkbox adds it. The GitHub link is `bugs.url` from `package.json` with the report URL-encoded in the body; a report longer than the URL budget falls back to a Copy-then-paste hint.

What the report carries: plugin version, dsh version, CLI version and binary presence, OS and Node, login state and method (never the email), config dir written as `~/.claude`, whether the state dir is writable, MCP server names and statuses when a session is given, the last error the status probe saw, the plugin's own switches, and the running-process count. The final line of `buildReport` is a redaction pass over the whole text: home to `~`, the username to `<user>`, every email to `<email>`, the hostname to `<host>` unless allowed, and anything shaped like an API key or OAuth token dropped.

## 2. Spend guard

What exists: the cost pill in dsh's stats row (`CostLine`), its dialog, and the CLI's `total_cost_usd` on every result frame. There is no threshold anywhere.

Options:

1. **A box-wide field in Settings, nothing per session.** Simplest, but a long research session and a two-line fix want different lines.
2. **Per-session only, in the cost dialog.** Nothing to set up front; the warning never fires on a session the user forgot to arm.
3. **Box-wide default plus a per-session override in the dialog, with Clear.** The queue's own shape.
4. **A Tune tab row.** Consistent with the row grammar, but the Tune tab changes how a turn is generated and this changes nothing about the turn.
5. **Hard stop at the line.** Refuse the next turn past the threshold. Too much: the figure is API-rate, and a subscription user is not billed by it.

**Chosen: 3.** The box-wide line is a number field under the Settings switches, `Warn per session at $`, empty means off. The per-session override is a row at the foot of the cost dialog with its own field and a Clear that falls back to the box line. Past the line the pill turns Claude orange and its tooltip reads `over $X this session, API-rate`. Every label says API-rate, and the dialog carries one line for a subscription login: shown at API rates, not billed. The plugin has no price table; the figure is the CLI's own.

Storage: the hints store (`hints.json`, `GET`/`POST /hints`) grows from booleans to booleans and finite non-negative numbers. Box line under `spendWarnUsd`; a session override under `spendWarnUsd` followed by the session id without dashes, which fits the store's key rule. `false` or `null` clears either. Ponytail: one key per session that set an override, never swept; a session that sets one is rare and the store is a few hundred bytes.

## 3. Model remembered per workspace

Checked first, as the queue asked: dsh 0.1.5-rc.2 keeps one `agent-default-model` in `settings.yaml` and nothing per workspace. No `dsh-client-ui-*` bundle reads a last, preferred or per-workspace model, and nothing writes one to `localStorage`.

Options:

1. **Client records every picker change and re-applies it on a new session.** Watches `modelDirectories` stores in the tab. Misses picks made in another tab and fights dsh's default on every provider.
2. **Server records at turn start, client applies on a blank session.** The adapter knows the session's cwd and model on every turn, so the record is right by construction. The client reads one route on a blank session and calls `select`.
3. **Write dsh's `agent-default-model`.** Box-wide and not ours to write.
4. **A Tune tab row: Default model for this workspace.** Explicit, but a row that needs a click is not "remembered".
5. **Remember the provider too, so a workspace that used Claude opens on Claude.** Surprising on a box whose default is a local model; a new session would silently switch providers.

**Chosen: 2, scoped to this provider.** The adapter writes `workspace-models.json` (`{ [cwd]: { model, at } }`) at turn start; the provider is the session's own, never stored. On a blank session whose current selection is already a `claude-code*` provider, the client asks `GET /workspace-model?cwd=` once and, when the remembered model differs, calls `directoryFor(id).select`. A session whose provider is not Claude is left alone, so the feature remembers which Claude model, never whether Claude. A Settings switch, `Remember model per workspace`, turns both halves off through the hints store (`workspaceModelOff`).

## 4. Export a session as Markdown, and the resume command

What exists: the archive list downloads the raw `.jsonl` per ticked row, and `foldTranscript` plus `mirrorReplyBlocks` already render each turn as Markdown blocks for the terminal mirror. No Markdown file, no resume command anywhere.

Options:

1. **Two more buttons per row.** Export .md, Copy resume. Doubles the row's controls and does not fit a phone.
2. **A row menu.** One overflow button per row opening dsh's `Menu` primitive with Download .jsonl, Export as Markdown, Copy resume command. The checkbox and batch Download stay for many rows at once.
3. **A format picker on the batch Download.** Choose .jsonl or .md for the ticked rows. Fine for export, no home for the resume command.
4. **Open-session items in the session header.** dsh's header actions slot is where the idle chip lives; a menu there is another surface to learn.
5. **Open-session items in the Oh My Claude control.** The composer control already replaced five buttons; its panel has tabs, not actions.

**Chosen: 2 for rows, and for the open session a Session row at the top of the Diagnostics tab with the same two actions.** The Diagnostics tab is the one place the session's own identity (id, cwd, binary) is already printed, so the resume command and the export sit beside the facts they are made from. One route, `GET /transcript.md?id&cwd&provider`, answers `text/markdown` built by `toMarkdown(folded)` in `src/transcript.ts`: a title, the date, one `## You` and `## Claude` pair per turn, tool calls as fenced blocks with the same formatting the mirror uses. The resume command is `cd '<cwd>' && claude --resume <id>`; on an SSH box it is prefixed with `ssh <host>`. The clipboard write says Copied for a second on the item that was clicked.

## 5. Anthropic status on API errors

What exists: `api_retry` and `api_error` frames become one reasoning line each in `Translator.translate`, and the `result` frame carries `api_error_status`. The translator is synchronous; a status read is not.

Options:

1. **Poll status.anthropic.com on a timer.** Costs a read a minute for a fact needed once a week.
2. **Fetch on the first 5xx or 529, cache for a minute, add the note to every following line.** The first retry line says nothing; retries come every few seconds and the second line carries the note. The final error on the result frame always has it.
3. **Make the translator async and await the read inline.** Touches every call site of `translate` for one line of text.
4. **Have the browser fetch the status.** Blocked by CORS on the status page.
5. **A status route the client polls when the row shows an error.** More surface for the same note.

**Chosen: 2.** `src/anthropic-status.ts`: one read of `https://status.anthropic.com/api/v2/status.json` (Statuspage's summary, `status.indicator` of `none`, `minor`, `major` or `critical`, plus a description), cached sixty seconds on success and five minutes on failure, with the same timeout and memoisation shape as `src/update.ts`. The translator takes a `statusNote` callback; on a status of 500 or above, or 529, it calls it and appends ` · Anthropic reports <description>` when the cache has an answer, and triggers the read when it does not. The `result` frame's error text gets the same suffix. Nothing else in the plugin reads the page.

## Performance notes, applied while building

- Every new route answers from memory or one file read; nothing walks `projects/`.
- The report is built on demand, never on the status poll.
- The spend threshold is read once per `CostLine` mount and on the hints event, not per poll.
- The workspace model is one `GET` per blank session, and none once the session has a message.
- The Markdown route streams the folded transcript once and does not read subagent files it does not need.
- The status read runs at most once a minute box-wide, shared across sessions.
