TASK H: a per-row menu in the archive list (Download .jsonl, Export as Markdown, Copy resume command) and the same two actions for the open session in the Diagnostics tab.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "4. Export a session as Markdown, and the resume command". Routes that exist: `GET /dsh-oh-my-claude/transcript?id&cwd&provider` (raw .jsonl) and `GET /dsh-oh-my-claude/transcript.md?id&cwd&provider` (Markdown, task D).

SCOPE: src/client/index.tsx, src/client/panel.tsx, src/client/shared.ts, src/sessions.ts (one field added to one route's reply).

Part 1, src/client/shared.ts. Add two exported helpers near `shortPath`:

```ts
/** `cd '<cwd>' && claude --resume <id>`, prefixed with `ssh <host> ` for a session on an ssh box. */
export const resumeCommand = (id: string, cwd: string | undefined, host?: string): string
/** Save a fetched file through a temporary anchor; the object URL is revoked after 30 s. */
export async function saveBlob(url: string, filename: string): Promise<void>
```

`resumeCommand`: quote the cwd with single quotes, escaping an embedded `'` as `'\''`; without a cwd it is just `claude --resume <id>`; with a host it is `ssh <host> "<the cd && claude part>"` with inner double quotes escaped. `saveBlob` is the anchor-click sequence from the `download` function in index.tsx (around line 779), lifted so both surfaces share it; it throws `new Error(\`${filename}: ${reply.status}\`)` when the fetch is not ok.

Part 2, src/client/index.tsx, `function Sessions` (around line 600).
- Refactor `download` to call `saveBlob` per row and keep its behaviour.
- Add a row menu: after the Open button (grep `dsh-oh-my-claude-session-${r.s.id}-button`, around line 1045), for rows where `isLocal || isSsh`, render the `Menu` primitive from `@deepseek-ai/dsh-client-ui-primitives` the way src/client/picker.tsx does (grep `<Menu` there, around line 251: `open`, `onClose`, `items`, `onSelect`, `side="top"`, `portal`, `anchor`). The anchor is `<button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuFor === key} data-omc-row-menu="" style={{ ...btn, padding: "0 8px" }}>⋯</button>` (use the three-dot glyph `⋯`, U+22EF). One `menuFor` state (the row key that is open, or ""). Items:
  - `{ id: "jsonl", label: "Download .jsonl" }` → `saveBlob(\`${ROUTE}/transcript?${q}\`, \`${base}.jsonl\`)`
  - `{ id: "md", label: "Export as Markdown" }` → `saveBlob(\`${ROUTE}/transcript.md?${q}\`, \`${base}.md\`)`
  - `{ id: "resume", label: "Copy resume command" }` → `navigator.clipboard.writeText(resumeCommand(r.s.id, r.s.cwd, isSsh ? r.g.host : undefined))` then `setMoving("Copied")` and clear it after 1600 ms.
  `q` is the same `URLSearchParams` the download builds (id, cwd, provider); `base` is `${r.s.title ? slugFile(r.s.title) : "claude"}-${r.s.id.slice(0, 8)}` (same as today's filename). Errors go to `setError`.

Part 3, src/sessions.ts. The `/diagnostics` route (grep `ROUTE_PREFIX}/diagnostics` around line 1925) gains an optional `session` query param. When given, add to the reply `session: { claudeId, cwd }` where `cwd` is the resolved `cwd` in that block and `claudeId` is `(await startedIds()).has(sid) || existsSync-free check is not needed: use the same decision the transcript opener uses: if a transcript file named `${sid}.jsonl` exists under any `transcriptDirs(cwd)` directory the id is `sid`, otherwise `claudeIdOf(sid)`` (`startedIds`, `claudeIdOf`, `transcriptDirs` and `readAt` all exist in this function; look at how `/transcript` around line 1507 checks the candidate paths and copy that loop to test existence).

Part 4, src/client/panel.tsx, `function DiagnosticsBody`. Extend the `DiagnosticsReply` interface with `session?: { claudeId: string; cwd: string }` and add `&session=${encodeURIComponent(sessionId)}` to the diagnostics fetch. At the top of the Runtime block (before the `Runtime` heading span) render, when `data.session` is present:

```tsx
          <span style={{ ...meta, padding: "2px 4px", display: "block" }}>Session</span>
          <div style={{ padding: "4px 10px", fontSize: 12, lineHeight: "1.5", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.mono }} title={data.session.claudeId}>{data.session.claudeId.slice(0, 8)}</span>
            <span style={{ fontFamily: T.mono, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }} title={data.session.cwd}>{shortPath(data.session.cwd)}</span>
            <span style={{ flex: 1 }} />
            <button type="button" style={btn} data-omc-export-md="" onClick=...>Export as Markdown</button>
            <button type="button" style={btn} data-omc-copy-resume="" onClick=...>{copied ? "Copied" : "Copy resume command"}</button>
          </div>
```

Export fetches `${ROUTE}/transcript.md?id=<claudeId>&cwd=<cwd>` plus `&provider=` when `doctorProvider` is set, through `saveBlob` with filename `claude-<first 8 of claudeId>.md`; copy uses `resumeCommand(claudeId, cwd, host)` where `host` is the ssh host when the provider is an ssh box: take it from `claudeProviderOf` only if a helper already maps a provider to its host in shared.ts (grep `sshHost` / `hostOf` there); otherwise pass `undefined` and note it in the report. Errors show in a `<span style={errText}>` under the row.

Gate: `bun run validate`, last line `✔ all green`. You cannot run the browser check from your sandbox; say so and the launching session runs it.
