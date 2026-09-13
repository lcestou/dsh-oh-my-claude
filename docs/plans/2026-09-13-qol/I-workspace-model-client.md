TASK I: apply the remembered workspace model on a blank Claude session, plus its off switch.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "3. Model remembered per workspace". Routes that exist (task E): `GET /dsh-oh-my-claude/workspace-model?cwd=<path>` answers `{ model, at }` or `{}`. The hints store holds the switch under `workspaceModelOff` (`true` = off).

SCOPE: src/client/index.tsx only.

Part 1, the renderless applier. Add near `StarterCard` (grep `function StarterCard`):

```tsx
/**
 * On a blank session whose provider is already Claude, select the model this workspace last ran.
 * Provider is never changed: the memory is which Claude model, not whether Claude. Once per
 * session id per tab, and never once the session has a message.
 */
function WorkspaceModelMemory({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx })
```

Effect on `[sessionId]`:
- `const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId]; if (!entry || entry.blank === false || !entry.cwd) return;`
- `const provider = claudeProviderOf(ctx, sessionId); if (!provider) return;`
- a module-level `const appliedModel = new Set<string>()`; return if it has `sessionId`, else add it.
- fetch `${ROUTE}/hints`; if `h.workspaceModelOff === true` return.
- fetch `${ROUTE}/workspace-model?cwd=${encodeURIComponent(entry.cwd)}` and `readJson<{ model?: string }>`; if no `model`, return.
- `const dir = ctx.modelDirectories.directoryFor(sessionId); const current = dir.store.getSnapshot().current;` if `current?.model === model` return; if `dir.select` exists, `await dir.select({ provider, model })`.
- Wrap the whole body in try/catch that swallows: a session dsh has not bound yet throws from `directoryFor` (see the comment in `claudeProviderOf` in src/client/shared.ts), and that is not an error here.
- Use a `live` flag so an unmounted component does not select.
Return `null`.

Mount it in the `conversation.input.dock` slot injection (grep `id: "claude-tool-icons"`), as another `ctx.slots.register({ name: "conversation.input.dock", id: "claude-workspace-model", order: 47 }, (props) => props.sessionId ? <WorkspaceModelMemory sessionId={props.sessionId} ctx={ctx} /> : null)`. Keep the `ctx.slots.inject(slot, () => { ctx.slots.register(...); return null; })` wrapper exactly as it is; the bundle fails to load without it.

Part 2, the switch. Add `function WorkspaceModelSwitch()` after `UpdateNoticeSwitch` (around line 4916), same layout, `data-omc-workspace-model-switch=""` on the root, `useHintFlag("workspaceModelOff")`, label "Remember model per workspace", description "A new Claude session in a workspace opens on the model it last ran there. The provider never changes; only which Claude model.", switch `on={!off}`. Mount it in `Section` after `<UpdateNoticeSwitch />` (or after the spend field if task G already placed one there).

Gate: `bun run validate`, last line `✔ all green`. You cannot run the browser check from your sandbox; say so and the launching session runs it.
