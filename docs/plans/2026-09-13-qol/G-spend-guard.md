TASK G: the spend guard, client side.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "2. Spend guard". The hints store (task A) accepts numbers: `GET /dsh-oh-my-claude/hints` answers `Record<string, boolean | number>`; `POST` with `{ key: number }` sets, `{ key: null }` clears. Keys: `spendWarnUsd` for the box, and `spendWarnUsd` + the session id with dashes removed for one session. The login method comes from `GET /dsh-oh-my-claude/status` as `authMethod` (`"claude.ai"` is a subscription login).

SCOPE: src/client/index.tsx only.

Part 1, a number hook beside `useHintFlag` (around line 4811). Refactor so both share one loader:

```tsx
function useHintValue(key: string): [boolean | number | undefined, (next: boolean | number | null) => void]
```

reads `h[key]` and posts `{ [key]: next }` then dispatches `HINTS_EVENT`, exactly as `useHintFlag` does today. `useHintFlag` becomes a two-line wrapper: `const [v, set] = useHintValue(flag); return [v === true, (on) => set(on)];`.

Part 2, the Settings field. Add `function SpendGuardField()` after `UpdateNoticeSwitch` (around line 4916) and mount it in `Section` directly after `<UpdateNoticeSwitch />` (around line 5535). Same outer layout as `UpdateNoticeSwitch` (flex row, label column left, control right, `data-omc-spend-field=""` on the root):
- label: "Spend warning"; description: "Turns the cost pill orange once a session passes this API-rate figure. Empty is off. A session can set its own line in the cost dialog."
- control: `<label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>$<input type="number" min={0} step={1} inputMode="decimal" aria-label="Warn per session at dollars" style={{ ...inputStyle, width: 72 }} .../></label>`. Local draft state seeded from `useHintValue("spendWarnUsd")` (a number renders as its string, anything else as ""). Save on blur and on Enter: parse with `Number`; a finite value `>= 0` posts the number, an empty string posts `null`, anything else restores the draft from the store.

Part 3, `function CostLine` (around line 4285).
- Read the two keys once: `const [boxLine] = useHintValue("spendWarnUsd"); const [sessionLine, setSessionLine] = useHintValue(\`spendWarnUsd${sessionId.replace(/-/g, "")}\`);` and `const line = typeof sessionLine === "number" ? sessionLine : typeof boxLine === "number" ? boxLine : undefined;` (index.tsx forbids `typeof` checks by lint: write a tiny exported helper `numberOr(v: boolean | number | undefined): number | undefined` in src/client/shared.ts instead, implemented with `typeof` there, and use it here).
- `const over = line !== undefined && total >= line;`
- `title` (the tooltip / aria-label) becomes, when `over`: `over ${fmtCost(line)} this session, API-rate · ${existing title}`; otherwise the existing title with `Claude cost:` replaced by `Claude cost, API-rate:`.
- The pill colour: in `tryHook`, where the trigger and inline are created and where `sync` rewrites text, set or remove the attribute `data-omc-cost-over` on `trigger ?? inline` from a ref `overRef` (same pattern as `titleRef`/`textRef`). Add to the plugin's style block (the long `styleEl.textContent` template around line 3058) the rule `[data-omc-cost-over]{color:${CLAUDE_ORANGE}}` before `${RAINBOW_CSS}`. The fallback (non-pill) span gets `style.color` the same way.
- In the dialog, after the `<dl data-omc-cost-details="">` block add:

```tsx
            <div data-omc-cost-guard="">
              <label>
                Warn at $
                <input type="number" min={0} step={1} inputMode="decimal" aria-label="Warn this session at dollars" value={draft} placeholder={boxPlaceholder} onChange=... onBlur={save} onKeyDown={enter saves} />
              </label>
              {sessionSet && <button type="button" onClick={() => setSessionLine(null)}>Clear</button>}
              {subscription && <p data-omc-cost-note="">Shown at API rates; a subscription login is not billed by it.</p>}
            </div>
```

  where `draft` is local state seeded from the session key, `boxPlaceholder` is the box line as a string or "off", `sessionSet` is `numberOr(sessionLine) !== undefined`, and `subscription` comes from a module-level memoised fetch of `${ROUTE}/status` (`let statusOnce: Promise<{ authMethod?: string | null }> | undefined`) read in an effect: true when `authMethod === "claude.ai"`.
- Add rules to `COST_DIALOG_CSS` (around line 5396) for `[data-omc-cost-guard]` (margin-top 10px, padding-top 8px, border-top `1px solid var(--dsw-alias-border-l1)`, display flex, gap 8px, align-items center, flex-wrap wrap, font-size 12px), its `input` (width 64px, the same look as `inputStyle`: use `font: inherit; background: var(--dsw-alias-bg-module-platform, rgba(128,128,128,.1)); border: 0; border-radius: 6px; padding: 2px 6px; color: inherit`), its `button` (same as dsh's small pill buttons: `font: inherit; font-size: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 2px 8px; background: transparent; color: inherit; cursor: pointer`), and `[data-omc-cost-note]` (`flex-basis: 100%; margin: 4px 0 0; color: var(--dsw-alias-label-tertiary)`).

Do not change how the pill is found or hooked, only what it shows. Keep every existing `data-omc-cost-*` hook.

Gate: `bun run validate`, last line `✔ all green`. You cannot run the browser check from your sandbox; say so and the launching session runs it.
