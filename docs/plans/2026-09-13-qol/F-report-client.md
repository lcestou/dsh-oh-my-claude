TASK F: the Report a problem block, in Settings and in the Diagnostics tab.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "1. Diagnostics and a prefilled bug report". The server route from task B exists: `GET /dsh-oh-my-claude/report?session=<id>&provider=<id>&host=1` answers `{ ok: true, text: string, issues: string }` (`issues` is the GitHub new-issue URL).

SCOPE: src/client/report.tsx (new file), src/client/index.tsx (mount one card), src/client/panel.tsx (mount one block).

Part 1, new file src/client/report.tsx. Model it on src/client/update-pill.tsx (a small component module importing from `./shared.js`). Export:

```tsx
export function ReportBlock({ sessionId, provider }: { sessionId?: string; provider?: string })
```

Behaviour:
- State: `text` (string, editable), `issues` (string), `host` (boolean, default false), `error` (string), `copied` (boolean).
- On mount and whenever `host` changes, fetch `${ROUTE}/report?` with `session`, `provider` (when given) and `host=1` (when on); `readJson` the reply; set `text` and `issues`; on failure set `error` to the message.
- Markup, top to bottom, inside `<div data-omc-report="">`:
  - `<p style={{ ...meta, whiteSpace: "normal", margin: "0 0 6px" }}>` with: "What the plugin knows about this box, with your home, user name and email masked. Read it, strike anything you do not want to share, then copy it or open an issue."
  - `<textarea data-omc-report-text aria-label="Bug report" rows={10} spellCheck={false} value={text} onChange=...>` styled `{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: T.mono, fontSize: 11, lineHeight: "1.45", resize: "vertical" }`.
  - a row (`display: flex; gap: 8; align-items: center; flex-wrap: wrap; margin-top: 8`) with:
    - `<label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}><input type="checkbox" data-omc-report-host checked={host} onChange=.../> Include hostname</label>`
    - a spacer `<span style={{ flex: 1 }} />`
    - `<button type="button" data-omc-report-copy style={btnPrimary} onClick=...>` reading `Copied` for 1600 ms after a successful `navigator.clipboard.writeText(text)`, else `Copy report`.
    - `<a data-omc-report-issue target="_blank" rel="noreferrer" style={btn} href={issueHref}>Open GitHub issue</a>` where `issueHref = \`${issues}?body=${encodeURIComponent(text)}\``. When `issueHref.length > 7000` render instead a `<span style={meta}>` reading "Too long for a link: copy the report and paste it into a new issue." plus a plain `<a>` to `issues` labelled "Open issues page".
  - `{error && <p style={errText}>{error}</p>}`
- Nothing in this component reads the email, hostname or paths itself: the server already masked the text.

Part 2, src/client/index.tsx, `function Section` (around line 5509). After the `<Boxes ... />` card add a folded card:

```tsx
        <Card
          id="dsh-oh-my-claude-report-card"
          title="Report a problem"
          summary="A masked report of this box for a GitHub issue: versions, login state, switches, last error."
          open={openReport}
          onToggle={() => setOpenReport((v) => !v)}
        >
          <ReportBlock />
        </Card>
```

with `const [openReport, setOpenReport] = useState(false);` beside the other open flags. Import `ReportBlock` from `./report.js`.

Part 3, src/client/panel.tsx, `function DiagnosticsBody` (around line 1594). After the Doctor button `<div>` (the one that ends the `<>` fragment, grep `Run doctor`), add:

```tsx
          <span style={{ ...meta, padding: "2px 4px", display: "block", marginTop: 8 }}>
            Report a problem
          </span>
          <div style={{ padding: "4px 10px" }}>
            <ReportBlock sessionId={sessionId} provider={doctorProvider} />
          </div>
```

`doctorProvider` already exists in that function. Import `ReportBlock` from `./report.js`.

Gate: `bun run validate`, last line `✔ all green`. The client bundle hot-reloads into open tabs when `lib/client.js` is written; you cannot run the browser check from your sandbox, so say so and the launching session runs it.
