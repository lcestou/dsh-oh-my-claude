TASK D: export a Claude Code transcript as Markdown.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "4. Export a session as Markdown, and the resume command".

SCOPE: src/transcript.ts, src/transcript.test.ts, src/sessions.ts (one new route).

Part 1, src/transcript.ts. Add after `mirrorReplyBlocks` (around line 798):

```ts
/**
 * A transcript as one Markdown document: title, date, then `## You` and `## Claude` per turn,
 * the reply rendered by the same blocks the terminal mirror draws (text, tool calls, results).
 */
export function toMarkdown(folded: FoldedTranscript, limit = 4000): string
```

Output, exactly:
- line 1: `# ${folded.title ?? "Claude Code session"}`
- line 2: blank; line 3: `_${new Date(folded.createdAt).toISOString()}_`
- for each turn: blank line, `## You`, blank line, the user text (`turn.content.map((b) => b.text).join("\n").trim()`, or `(empty)` when blank), blank line, `## Claude`, blank line, `mirrorReplyBlocks(turn, limit).join("\n\n")`.
- end with one trailing newline.

Part 2, src/transcript.test.ts. Near the existing `const folded = foldTranscript(transcript);` (around line 98) add a block: `const md = toMarkdown(folded);` and assert `md.startsWith("# ")`, that it contains `\n## You\n`, `\n## Claude\n`, the first user prompt text of that fixture verbatim, and that the number of `## You` occurrences equals `folded.turns.length`. Assert `toMarkdown({ turns: [], title: undefined, createdAt: 0, agents: new Map() })` equals `"# Claude Code session\n\n_1970-01-01T00:00:00.000Z_\n"`.

Part 3, src/sessions.ts. Add `GET ${ROUTE_PREFIX}/transcript.md` directly after the `/transcript` route (grep `ROUTE_PREFIX}/transcript\`` around line 1507; that block ends with `return json(res, 404, { error: "transcript not found" });`). Same query params (`id`, `cwd`, `provider`) and the same path lookup as the `/transcript` route. For each candidate path call `await readTranscript(box, path)` (imported from `./transcript.js`; check the existing import line and add `readTranscript, toMarkdown` to it). On the first defined result:

```ts
res.writeHead(200, {
  "content-type": "text/markdown; charset=utf-8",
  "content-disposition": `attachment; filename="${id}.md"`,
  "cache-control": "no-store",
});
res.end(toMarkdown(folded));
return;
```

Otherwise `return json(res, 404, { error: "transcript not found" });`. `readTranscript` throws for an unreachable box; wrap the loop body so that error answers `json(res, 502, { error: errorText(e) })` (`errorText` exists in sessions.ts; grep it).

Gate: `bun run validate`, last line `✔ all green`. Also `bun src/transcript.test.ts`; paste its last line.
