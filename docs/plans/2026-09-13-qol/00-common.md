You are a worker on one bounded chunk of a TypeScript plugin. Follow this brief exactly.

Repo: /home/lutechi/Projects/oh-my-claude (bun, strict TypeScript, no build step needed for tests).
Branch: feat/2026-09-13-qol. Run `git branch --show-current` first; it must print exactly that. If it does not, stop and report.

Rules:
- Do not start subagents (no `subagent`, `subagent_local`, `researcher_local`, `subagent_fork`); work alone, sequentially.
- Never call `ask_user_question`; decide and continue. Every file this brief names already exists unless the brief says "new file".
- No git that writes: no add, commit, switch, checkout, stash, reset, clean, branch, restore. Read-only git (status, diff, log, show) is fine.
- Touch only the files listed under SCOPE. Do not edit anything else. Do not reformat lines you did not change.
- Before code, read README.md lines 100 to 113 (the lint contract) and quote one sentence from it in your report. Key rules: every `as` assertion needs a `// SAFETY: <why>` comment on the line above; no `as X as Y`; no conditional empty-object spread; no `_prefixed` names; no shadowed names; no unused variables; do not widen a literal; `src/adapter.ts` and `src/client/index.tsx` forbid `typeof x === "string"` style checks (use `isJsonObject`, typed fields, or a guard function in another module).
- Lines are capped at 100 characters. Comments explain why, not what.
- Gate after each edit: `bun run validate`. It formats in place, then lints, tests, builds and typechecks. The last line on success is `✔ all green`. Paste the last six lines of the final run in your report. If a gate cannot run, say which command failed and quote the exact error; never guess the cause.
- New tests use `node:assert/strict` blocks like the existing `src/*.test.ts` files; a test must import the product code it checks and assert literal expected values.

Report shape, nothing else:
1. `git diff --stat`
2. Last six lines of `bun run validate`
3. Files changed, one line each: what changed
4. What you left alone and why
5. The quoted README sentence
