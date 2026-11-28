# oxlint rules

Lint comes from three layers, all wired in `oxlint.config.ts` at the repo root.

1. **[`@cloudflare/oxlint-config`](https://github.com/cloudflare/oxlint-config)**, loaded through `extends`. It builds on [`@nkzw/oxlint-config`](https://github.com/nkzw-tech/oxlint-config) and turns on type-aware rules through `tsrs`, the TypeScript backend oxlint loads by name: `no-unsafe-*`, `no-floating-promises`, `no-unsafe-type-assertion`, `switch-exhaustiveness-check`, type-only imports, `curly`, generic `Array<T>`, and the `react`, `react-hooks`, `jsx-a11y`, `import` and `promise` plugins. Its nkzw base also carries twelve [anti-slop](https://github.com/dmmulroy/anti-slop) rules as `quality/*`, kept in step with upstream by nkzw.
2. **`anti-slop/`**, the local plugin. It holds the six anti-slop rules the preset does not ship (`no-runtime-typeof`, `no-unknown-parameters`, `no-module-mocking`, `no-shape-in-symbol-names`, `require-safety-comment-for-type-assertion`, `require-readable-spacing`) and this repo's own `require-doc-comment` and `require-field-label`.
3. **This repo's settings**: every `correctness` and `suspicious` rule, the extra rules under `rules`, and the overrides below.

The anti-slop rules catch the shortcuts a model takes when it does not understand a value: runtime `typeof` probing, `unknown` parameters and returns, chained or uncommented type assertions, open dictionaries, and widening a known value then asserting it back.

## Exemptions

All exemptions are in `oxlint.config.ts` under `overrides`, each with its reason.

- **I/O boundaries.** These files read data the plugin does not own (Claude Code's stream-json in `process.ts`, Claude transcripts in `transcript.ts`, JSON-RPC in `mcp.ts`, HTTP bodies in `sessions.ts`, state files, dsh session logs) and check it into typed values, so `typeof`, `unknown` and loose dictionaries are allowed there. Code anywhere else gets typed values from them. The type-aware `no-unsafe-*` rules are not relaxed there: a boundary file decodes with checks, not casts. Add each new boundary file to its override when you write it.
- **Tests** (`src/**/*.test.ts`, `tools/**/*.test.ts`) build partial fakes, so they skip the assertion, unknown, dictionary, mocking, shadowing and function-scoping rules. The preset relaxes some of its own `no-unsafe-*` rules for test files too.
- **Command-line scripts.** Tests and everything under `tools/` report to the terminal, so `no-console` is off there. In the client, the browser console is the only place the plugin can report to (dsh gives client plugins no logger), so `src/client/console-report.ts` owns it and carries the one `no-console` exception.
- **`react/react-in-jsx-scope`** is off: the client compiles JSX with the automatic runtime (`jsx: react-jsx`, and the bundle marks `react/jsx-runtime` external).
- **`anti-slop/vendor/`** is upstream's copy of eslint-stylistic's padding rule. It is left as written, apart from the import path, so it is not linted or formatted (`.oxfmtrc.json`).

A type assertion outside these exemptions needs a `// SAFETY:` comment right above it that says why it holds. The preset's `no-unsafe-type-assertion` also rejects an assertion that narrows a type. Check the value instead.

## Type-aware lint needs every file in `tsconfig.json`

The type-aware rules see a file's types only when `tsconfig.json` includes that file. A file outside it reads as `any`, so the rules report false `no-unsafe-*` findings. `include` therefore lists `src`, `tools` and `oxlint.config.ts`. The plugin runs under Node inside dsh, so `tsconfig.json` loads Node's types and not `@types/bun`; the one test that calls Bun's transpiler declares the part it uses.

## Tests

`bun run test:rules` runs under real Node, and `bun run validate` runs it too. It covers two things:

- The upstream `RuleTester` suites in `anti-slop/rules/*.test.ts`. The repo's own two rules have no suite yet.
- `layers.test.ts`. It lints `probe/slop.ts`, a file of deliberate slop, and expects a finding from each layer. A clean lint run looks the same whether a plugin loaded or not, so this is the check that all three are on. The probe folder is skipped by lint unless `LINT_PROBE` is set, and fallow skips it too.

`anti-slop/LICENSE` is upstream's MIT notice, which every copy of the rules has to keep.

## Updating from upstream

- **Preset**: bump `@cloudflare/oxlint-config`. It pins its `@nkzw/oxlint-config`, and the `quality/*` rules come with it. It needs `oxlint` 1.94 or later and `tsrs`.
- **Local anti-slop rules**: compare `anti-slop/rules/` with `src/rules/` of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop). The copy here came from the sveltekit-boilerplate port and changed only these things: imports from `@oxlint/plugins` (and `oxlint/plugins-dev` for `RuleTester`), `bun x oxlint` in place of `pnpm exec oxlint` in the spacing CLI test, and the formatting and doc comments. Check whether nkzw has started shipping one of the six rules. If it has, delete the local copy and its rule line in `oxlint.config.ts`, and rename any override from `anti-slop/<rule>` to `quality/<rule>`.
- **New rules**: switch on anything new from the preset or upstream, then fix what it finds. Do not leave a new rule off.

The plugin's imports name the `.ts` files (`./rules/x.ts`, not `./rules/x.js`). oxlint runs JavaScript plugins under the `node` on PATH. Real Node does not map a `.js` import onto a `.ts` file, so with `.js` names the plugin fails to load and lint fails on every file.
