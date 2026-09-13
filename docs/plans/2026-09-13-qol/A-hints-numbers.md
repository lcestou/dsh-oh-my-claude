TASK A: the hints store accepts numbers as well as booleans.

Context: `hints.json` under the plugin's state dir is a flat map. Today `readHints` keeps only `true` values and the `POST /hints` route accepts only `true` (set) and `false` (delete). Two upcoming features store a dollar figure there, so the store must also keep finite non-negative numbers. Keys stay the same (`^[a-zA-Z][a-zA-Z0-9]{0,40}$`).

SCOPE: src/sessions.ts, src/sessions.test.ts, src/client/index.tsx, src/client/panel.tsx.

Steps:

1. src/sessions.ts, `async function readHints(hintsPath: string)` (around line 202). Change its return type to `Promise<Record<string, boolean | number>>`. Keep `true`; also keep a value `v` when `typeof v === "number" && Number.isFinite(v) && v >= 0`. Drop everything else. Export the function (`export async function readHints`). Update its doc comment: "booleans and non-negative numbers".

2. src/sessions.ts, the `/hints` route (grep for `ROUTE_PREFIX}/hints` around line 2016). In the POST loop, after the key check:
   - `v === true` sets `next[k] = true` (unchanged)
   - a finite number `>= 0` sets `next[k] = v`
   - `v === false || v === null` deletes the key
   - anything else is ignored
   `next` is typed `Record<string, boolean | number>`. `readBody` returns a JSON object; narrow `v` with `typeof v === "number"` (sessions.ts is exempt from the runtime-typeof rule).

3. src/sessions.ts, `pluginUpdate` (around line 216) reads `(await readHints(hintsPath)).updateCheckOff`. Make it `=== true`.

4. src/client/index.tsx, `function useHintFlag` (around line 4811): the fetch reads `readJson<Record<string, boolean | number>>(r)` and keeps `h[flag] === true`. Do not change its return type.

5. src/client/panel.tsx, the `hintsCache` block (around lines 188 to 205): the cached type becomes `Record<string, boolean | number>`; any `h.restorePulse` style read stays a truthiness check on `=== true`.

6. src/sessions.test.ts: add one block at the end. Write a temp file with `{"a": true, "b": false, "n": 3.5, "neg": -1, "s": "x", "inf": 1e999}` (write `Infinity` by writing the JSON text by hand, since JSON.stringify drops it; the parser turns `1e999` into Infinity) and assert `readHints(path)` deep-equals `{ a: true, n: 3.5 }`. Also assert a missing file reads as `{}`.

Gate: `bun run validate`, last line `✔ all green`. Also run `bun src/sessions.test.ts` alone and paste its last line.
