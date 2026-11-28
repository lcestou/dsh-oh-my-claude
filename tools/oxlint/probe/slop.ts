// Deliberate slop for tools/oxlint/layers.test.ts: each line trips one lint layer. Lint and dead
// code skip this folder (oxlint.config.ts, .fallowrc.json); the test lints it with LINT_PROBE=1.

export function probe(input: unknown) {
  const kind = typeof input;
  const n = input as string as unknown as number;
  const list = [1, 2].filter((x) => x > 1).map((x) => x * 2);
  Promise.resolve(1);

  return [kind, n, list];
}
