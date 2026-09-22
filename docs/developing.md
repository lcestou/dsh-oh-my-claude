# Developing

Working on the plugin: install from a checkout, the lint contract, the gate and the browser checks. Back to the [README](../README.md).

## From a checkout

Install from a checkout instead of npm: `dsh plugin --profile web add link:/path/to/oh-my-claude`. The source is strict TypeScript under `src/`; dsh loads the compiled output in `lib/`, so run `bun run build` after every edit. `lib/client.js` hot-reloads into every open tab the moment it is written; a change under `lib/server` needs a restart of `dsh web`. `lib/server` comes from `tsc`, `lib/client.js` from `bun build` of `src/client/index.tsx`; both are committed, so a plain install has them. `bun run validate` runs the whole gate: format, lint (oxlint with the anti-slop rules in `tools/oxlint`), tests, dead code, build, typecheck and a conflict-marker scan.

## What this plugin may lean on in dsh

Two kinds of coupling, and only one of them is safe.

**Named slots fail loudly.** dsh exposes 83 of them and this plugin mounts into seven. If dsh
renames one, the plugin does not load and says which service it waited for: ugly, immediate, and
nothing is half-broken. Prefer a slot wherever one exists. dsh publishes no slot reference, so the
list is derived from the installed bundles; the command to regenerate it, the audit of what has no
slot, and the version it was taken against are in `notes/reference/dsh-slots.md`.

A name that looks like a slot is not one until something calls `slots.register` or `slots.inject`
with it. `status.running` and its siblings read like slots and are status labels.

**Selectors over dsh's own markup fail silently, and always have.** Every dsh upgrade that has
broken this plugin broke it the same way: the thing kept its name and changed its shape.
`resolveAgent` went from answering an `Agent` to answering `{ agent } | { error }`. The
access-shield menu moved to a portal on `document.body`. A chat anchor key gained a leading kind,
so `*=":input-message"` matched nothing. Nothing threw, nothing logged, and one was found days
later by grepping a log for a line that had stopped appearing.

Two rules follow. Accept both shapes when you learn of one, which is what those fixes did. And add
a probe to `src/client/contract.ts` for any selector a feature depends on, so Diagnostics reports
it missing the first time the panel opens after an upgrade. A probe must be structural: one that
depends on what someone typed cries wolf, which is why the skill-chip hook is not in that list.

## Lint contract

Read before writing code. The anti-slop rules in `.oxlintrc.json` fail the build and cost a worker 25 check runs on 2026-09-05.

- Every `as` assertion needs a `// SAFETY: <the invariant that makes it true>` comment on the line directly above it. Prefer a type guard or a narrower type so no assertion is needed. No `as X as Y` chains, no `as unknown as`.
- No `typeof x === "string"` style runtime checks in `src/adapter.ts` and `src/client/index.tsx` (test files and the listed server modules are exempt). Use the existing narrowing helpers (`isJsonObject`, `textOf`, schema parsing) or a typed field.
- No conditional empty-object spread (`...(cond ? { a } : {})`). Assign the property in a separate statement when present.
- No `unknown` parameters, returns or type aliases in `src/adapter.ts`; name the shape.
- Do not widen a known literal (`const x: string = "bash"`); let inference keep the literal.
- No `_prefixed` identifiers (`no-underscore-dangle`), no shadowed names (`no-shadow`), no unused variables.
- Exemptions in `.oxlintrc.json` are per rule, not per file. The I/O modules (`process.ts`, `sessions.ts`, `state.ts` and the rest) parse payloads this plugin does not own, so four of the anti-slop rules are turned off for them, but each rule names only the files that actually need it, not one blanket list. Turning all four off everywhere hid 19 file-and-rule pairs that pass without help. Before adding a file to one of those lists, check it fails without it.
- TypeScript, always. Every new script, tool and helper is `.ts`, `tools/` included. No `.js`, no `.mjs`, and no JSDoc types standing in for real ones: JSDoc is checked by nothing here and drifts silently, and one stray `.mjs` leaves the next reader working out which rules apply to which file. If something genuinely has to be served raw as JavaScript, say why at the top of it.
- Semantic ids and roles in markup. Client code gives what it emits a stable, meaningful `id` or `data-*` hook (`data-omc-turn-status`, not a generated class) and the right ARIA role, and selects on those. dsh's own DOM is not ours to depend on: a hashed class name changes on any dsh upgrade, and a check that selects one then fails for a reason unrelated to this plugin.
- Every function, method, class and React component has a `/** … */` comment directly above it that says what its name does not: the case it gets wrong, what it assumes, what it returns or throws on failure, or why it exists. A comment that restates the name is noise and does not count. `anti-slop/require-doc-comment` fails the build on a named function, class, class method or top-level function const with no `/** */` above it. It can only check that a comment exists; whether it says anything is still the reviewer's call. It covers `src/` and `tools/`. Callbacks and functions nested inside another function are left to their enclosing function's comment, and test files are exempt.
- Every form field has an accessible name. `anti-slop/require-field-label` fails the build on an `input`, `select` or `textarea` with no `aria-label`, no `aria-labelledby`, no `id` for a `<label>` to point at, and no wrapping `<label>`. A `placeholder` is not a name: it disappears as someone types and screen readers do not announce it. The upstream `jsx-a11y/control-has-associated-label` skips `<input>` on purpose, which is why this rule exists.
- The `jsx-a11y` rules run in the gate: a button with no name, an image with no `alt`, an invalid link, an unknown ARIA attribute and the rest fail the build. A few sites switch one rule off on the next line, and each says why in the directive itself. A `role="status"` notice stays a `div`, because `<output>` is for form results. A popover keeps `role="dialog"`, because a `<dialog>` is hidden unless opened and brings its own position and box. An editor the person just opened takes focus with `autoFocus`. Add a new one only with a reason of that kind, not to quiet the rule.
- Every string a person reads ships in English and Chinese. The plugin follows dsh's language setting (Settings → General → Language). On-screen text goes through `t("<area>.<name>")` from `src/client/i18n.ts`, with the English and the Chinese added to that area's file under `src/client/i18n/`; a component that renders `t()` text calls `useLocale()` first so a language switch re-renders it. Server text that reaches the screen goes through `serverText()` in `src/locale.ts`. What Claude or the CLI reads (prompts, messages the plugin sends, command bodies), code tokens, file names and product names stay English. Use dsh's own Chinese terms for shared concepts (会话, 工作区, 设置, 子智能体, 技能) and "你" rather than "您". `src/client/i18n.test.ts` fails the gate on a key missing either language or with different `{placeholders}` in the two, and `src/client/i18n-coverage.test.ts` fails it on on-screen text that skips `t()` (JSX text, a literal `aria-label`, `title`, `placeholder`, `alt` or `label`, a literal among children, or a label written into the DOM by hand); a string that really must stay as written goes in its `ALLOWED` list with the reason. Code that finds one of dsh's own controls by its text matches both languages. A change to the README goes into `README.zh.md` too.
- Run `bun run validate` after each edit, not once at the end: the first run tells you which rule you are fighting, and it formats in place before it checks anything.
- The suite runs under a fresh `DSH_OMC_STATE_DIR` (the `test` script sets it), and `STATE_DIR` follows it, so a test never rewrites the running plugin's files under `~/.local/state/dsh-oh-my-claude`. Any new store must build its path from `STATE_DIR`, never from `homedir()` on its own.

## Client bundle safety

dsh hot-reloads `lib/client.js` the moment `bun run build` writes it, into every open tab. A wrong service name in `export const inject` leaves the plugin `pending (waiting for service: …)` and every panel it owns disappears (2026-09-05: `models` instead of `modelDirectories`). After any client build, run the headless check and read its first line:

```sh
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' ~/.local/state/dsh/web.log | tail -1 | cut -d= -f2)
PLAYWRIGHT_ROOT=/path/to/a/project/with/playwright bun tools/playwright/peek.ts "$TOKEN"
```

It prints the sidebar text; a `Failed to load plugins` line means roll back with `git show main:lib/client.js > lib/client.js` and rebuild.

## Browser checks

The scripts under `tools/playwright/` are development checks only; nothing in the plugin needs Playwright, which is why it is not a dependency. `tools/playwright/pw.ts` resolves the borrowed install at run time and declares the slice of its API these scripts use.

- `tour.ts <token>` takes the README's screenshots and the clip behind `panel-tabs.gif`, into `docs/media/`. Shoot a throwaway session: the panel floats over the chat, and the text behind it lands in the shot. The ffmpeg crop for the gif is in the file's header.
- `turn-status.ts <token> <out.png>` and `restore-button.ts <token> <out.png>` screenshot the two DOM features.
- `starter-row.ts <token>` types into a blank session and fails if the starter dock changes height when the Save draft chip appears.
- `keyword-paint.ts <token>` types `ultracode` and `ultrathink` into the composer and reads the highlight registry back.
- `update-pill.ts <token> <dir>` rewrites the box's own status reply so npm appears to hold a newer plugin, then clicks the pill and reads the clipboard at a desktop and a phone width.
- `context-rows.ts <token> <session pattern> <workspace>` opens a session and reads the computed display of every chat row, so it can tell a folded row from one that was never logged.
- `context-assumed.ts <token>` stubs the `/context` reply with and without `assumedBehind`, opens the ring popover each time, and fails unless the proxy note appears in the first and not in the second.
- `add-workspace.ts <token>` clicks dsh's sidebar "+" and fails if dsh's own directory dialog answers instead of ours, which is how the takeover reads when it stops engaging. `DSH_ORIGIN` runs it through a reverse proxy instead of loopback, and `DSH_HMR=1` adds a second click after a client rebuild, so a tab left open across a plugin build is covered too.
- `remote-ws-sync.ts <token>` pins a throwaway workspace on the first saved ssh box and checks three things: the open Settings card lists it with no reload, a delete from dsh's sidebar menu leaves no row behind in the card, and a removal through the route leaves the open card. It needs one saved ssh box and removes what it made, also after a run that died half way.
- `cost-pill.ts`, `usage-popover.ts`, `shield-rows.ts`, `mcp-preset.ts`, `login-card.ts`, `starter-switch.ts`, `composer-shots.ts`, `terminal-mirror.ts` and `qol.ts` each drive one feature the same way; the header comment of each says what it asserts.

Everything under `tools/` is TypeScript (the scripts run with `bun`, the oxlint plugin is loaded by oxlint), and `tools/**/*.ts` is in the `tsconfig.json` include, so `bun run typecheck` covers all of it. That is what keeps a rename in `src/` from leaving `live-cli-check.ts` probing the wrong thing, and a null `boundingBox()` from reaching a screenshot crop.

## The gate

```sh
bun run validate
```

One command for the whole gate, in phases, because the steps are not interchangeable. Formatting runs first and it writes: formatting is a fix, not a finding, and failing a run on it before anything else has run wastes the pass. Lint, the tests and `fallow`'s dead-code pass then run together: they share no state and never write, so serialising them only costs wall-clock. The build comes next, and typecheck last, after it, since `tsc` reads the `.d.ts` files the build emits, so the order is a real dependency rather than a preference. A conflict-marker scan closes it out: `git grep` over tracked files only, so ignored directories drop out for free and a stray blob in someone's local cache cannot fail the gate. `lib/` is excluded because it is generated from `src/`, where a real marker would already have been caught. Each step is quiet when it passes and prints its output only when it fails; the run ends with a per-step table.

Lint, format and typecheck all cover `src/` and `tools/`: the dev scripts are held to the same compiler and the same rules as the plugin, so a check script cannot rot into a different dialect from the code it checks. `tools/` has three exemptions of its own, on the same per-rule terms as `src/`. Two are for the oxlint plugin, which walks oxlint's AST generically and is therefore the parse boundary the anti-slop rules keep asking it to move the work to; the third is `dsh-session-repair.ts`, whose row types carry an index signature because it rewrites dsh's session logs and has to pass through every field it does not read.

Dead code is `fallow`, configured in `.fallowrc.json`, and it is report-only, never `fallow fix`. Run it alone with `bun run deadcode`. Every suppression in that file names the blind spot it covers, and the two biggest are structural rather than sloppy: nothing in the repo imports `tools/` (they are optional dev checks, so each one is declared an entry point), and the tool-facing half of the API is reached through `lib/`, which is ignored because it is build output. `src/adapter.ts` is declared an entry point for the same reason one step up: dsh imports `name`, `inject` and `apply` from it by name through the Cordis protocol, so nothing in this repo references them. An auto-fix reading either as dead would delete the `tools/` scripts wholesale. Two findings are left standing on purpose, each with its reason beside it in the config: `SubprocessHandle` is defined twice because `dsh.ts` mirrors dsh's own type verbatim while `process.ts` declares the narrower seam the node spawner can also answer, and the six import cycles through `adapter.ts` are demoted to a warning as known debt: a gate that is permanently red is a gate everyone learns to ignore.

The tests are every `*.test.ts` under `src/` and `src/client/`. The suite is a glob rather than a list, so a new test file runs from the moment it is written. Covers config defaults, model resolution, session id derivation, config-dir resolution, turn selection, argument building, stream-json translation including native tool rows, the catalog fallback, the box settings proxy, the remote-fs scripts and their local branch, the transcript conversion (turn folding, tool result pairing, listing filters), session-list paging, the restore filter and the spinner verb helpers. UI checks that need a browser are the Playwright scripts above.

The suite fakes the CLI, so it cannot see a box whose `claude` is older than this one. `tools/live-cli-check.ts` closes that gap against the real binaries:

```sh
bun tools/live-cli-check.ts          # every flag the plugin would send is a flag that binary has
bun tools/live-cli-check.ts --live   # also runs one real turn per target, which spends tokens
```

It checks the local `claude` plus every box a remote workspace names, using the same argument builder, the same SSH invocation and the same stored box login the plugin spawns with. An unreachable host is skipped; a flag the target does not have is a failure. Development check only, like Playwright.

Links in the README and under `docs/` are checked by `bun tools/check-links.ts`: every link into this repo resolves to a file, every fragment to a heading by GitHub's slug rule, and every page under `docs/` is linked from somewhere.

## Repairing session logs

`tools/dsh-session-repair.ts` mends a session log that dsh 0.1.5's format migration refuses; the user-facing note is [Failed to load history after a dsh upgrade](how-it-works.md#failed-to-load-history-after-a-dsh-upgrade). It proves every repaired log through dsh's own migration chain before writing it and keeps a `.bak` beside each.
