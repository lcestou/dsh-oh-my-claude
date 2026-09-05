# oxlint anti-slop rules

`anti-slop/` is the custom oxlint plugin shared with the pewtron repo: fifteen rules against the
shortcuts a model reaches for when it does not understand a value (runtime `typeof` probing,
`unknown` parameters and returns, chained or uncommented type assertions, widening a known value
and asserting it back). Wired in `.oxlintrc.json` through `@oxlint/plugins`.

Three deliberate deviations from pewtron:

- `no-object-parameters` is off for the whole repo. React components take a props object by
  contract, and dsh's own adapter and tool APIs pass option objects; the rule cannot tell those
  from lazy bags.
- The four files that decode untrusted input (`process.ts` for Claude Code's stream-json,
  `transcript.ts` for Claude transcripts, `mcp.ts` for JSON-RPC, `sessions.ts` for HTTP bodies)
  keep `typeof`, `unknown` parameters and returns, and loose dictionaries: those files are the
  I/O boundary the rules tell everyone else to decode at.

- Test files (`src/**/*.test.ts`) are exempt from the assertion, unknown, dictionary, shadowing and
  function-scoping rules.
  Tests stand partial fakes in for dsh services and feed the translator events it has never
  seen; those are casts by nature, and a SAFETY sentence on each would say the same thing two
  hundred times. The fakes are built through four helpers at the top of `adapter.test.ts`, each
  carrying the one SAFETY comment that matters.
