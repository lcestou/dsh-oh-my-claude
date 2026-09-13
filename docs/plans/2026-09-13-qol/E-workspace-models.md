TASK E: remember the last Claude model used per workspace, on the server.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "3. Model remembered per workspace".

SCOPE: src/state.ts, src/state.test.ts, src/sessions.ts (two routes), src/adapter.ts (one write at turn start).

Part 1, src/state.ts. Copy the starters pattern (`loadStarters` / `saveStarter`, around lines 578 to 620, including the `startersChain` serialisation) into:

```ts
export const WORKSPACE_MODELS_FILE = (d: string) => join(d, "workspace-models.json");

export interface WorkspaceModel {
  model: string;
  at: number;
}

/** `{ [cwd]: { model, at } }`; a row whose model is not a non-empty string is skipped. */
export async function loadWorkspaceModels(dir: string): Promise<Map<string, WorkspaceModel>>;

/** Save the model for one cwd, or forget it when `model` is undefined or blank. */
export function saveWorkspaceModel(dir: string, cwd: string, model: string | undefined, at = Date.now()): Promise<void>;
```

Serialise writes through a chain like `startersChain` (name it `workspaceModelsChain`). `at` that is not a finite number reads as 0.

Part 2, src/state.test.ts. Add a block after the starters block (around line 222): empty dir loads an empty map; save `/w/a` as `claude-opus-5` at 10, `/w/b` as `haiku`, reload, assert both rows (`{ model: "claude-opus-5", at: 10 }`); save `/w/b` as `undefined`, reload, only `/w/a` remains; save `/w/a` as `""` clears it too.

Part 3, src/sessions.ts. Next to the `/starter` routes (grep `ROUTE_PREFIX}/starter` around line 2032) add:
- `GET ${ROUTE_PREFIX}/workspace-model?cwd=` : `cwd` required (400 `{ error: "cwd param required" }` when missing); answers `json(res, 200, (await loadWorkspaceModels(STATE_DIR)).get(cwd) ?? {})`.
- `POST ${ROUTE_PREFIX}/workspace-model` with body `{ cwd: string, model: string | null }`: `cwd` required; `null` or blank forgets; answers `json(res, 200, { ok: true })`.
Import `loadWorkspaceModels, saveWorkspaceModel` from `./state.js` and `STATE_DIR` if not already imported (grep the existing import from `./state.js`).

Part 4, src/adapter.ts. At `const prep = await this.prepare(options, { forceFresh });` (around line 3440), directly after the following `if (prep.input === null) return ...;` line, add:

```ts
    // The model this workspace last ran, so a new session there opens on it (client applies it).
    // Keyed by the dsh session's own cwd, the path the client asks with; a temporary session is
    // a side call and does not count.
    if (prep.spec.model && !prep.spec.temporary) {
      const wsCwd = this.ctx?.sessions?.get?.(asSessionId(options.sessionId))?.header?.cwd ?? prep.cwd;
      void saveWorkspaceModel(STATE_DIR, wsCwd, prep.spec.model).catch(() => {});
    }
```

`asSessionId`, `STATE_DIR` and `this.ctx?.sessions?.get?.` are already used in adapter.ts (grep `header?.cwd` around line 2115 for the exact expression). Import `saveWorkspaceModel` from `./state.js` (extend the existing import). If `prep.spec` has no `temporary` field, read it from the `spec` type near `oneShot` (around line 4983 shows `temporary: false`) and report what you found.

Gate: `bun run validate`, last line `✔ all green`. Also `bun src/state.test.ts`; paste its last line.
