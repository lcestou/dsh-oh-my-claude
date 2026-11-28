// @cloudflare/oxlint-config (on @nkzw/oxlint-config) is the base: type-aware rules through tsrs,
// plus twelve anti-slop rules nkzw maintains as its `quality` plugin. The local anti-slop plugin
// carries only what the preset lacks (tools/oxlint/README.md).
import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [cloudflare],
  env: cloudflare.env,
  ignorePatterns: [
    ...cloudflare.ignorePatterns,
    // Build output, committed because dsh loads it.
    "lib/**",
    // Upstream's vendored copy, kept as written (only the import path differs) so the next sync
    // is a plain diff.
    "tools/oxlint/anti-slop/vendor/**",
    // Deliberate slop that tools/oxlint/layers.test.ts lints on its own, with LINT_PROBE set.
    ...(process.env["LINT_PROBE"] === "1" ? [] : ["tools/oxlint/probe/**"]),
  ],
  // The preset leaves categories off; this repo also wants every correctness and suspicious rule.
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  // anti-slop: the shortcuts a model reaches for when it does not understand a value. The preset
  // turns on twelve of its rules as `quality/*`; the local plugin carries the other six plus this
  // repo's doc-comment and field-label rules.
  jsPlugins: ["./tools/oxlint/anti-slop/index.ts"],
  rules: {
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/require-doc-comment": "error",
    "anti-slop/require-field-label": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    // The client compiles JSX with the automatic runtime (tsconfig `jsx: react-jsx`, and the
    // bundle marks react/jsx-runtime external), so no component needs React in scope.
    "react/react-in-jsx-scope": "off",
    "jsx-a11y/control-has-associated-label": "error",
    "jsx-a11y/label-has-associated-control": "error",
    "jsx-a11y/prefer-tag-over-role": "error",
    "jsx-a11y/no-autofocus": "error",
    "jsx-a11y/no-static-element-interactions": "error",
    "jsx-a11y/no-noninteractive-element-interactions": "error",
    // anti-slop/no-unknown-parameters lets an `unknown` parameter through only when it is named
    // `cause`, and typescript/use-unknown-in-catch-callback-variable wants catch callbacks typed
    // `unknown`, so `cause` is the one name that satisfies all three rules.
    "unicorn/catch-error-name": ["error", { ignore: ["^cause$"] }],
    "unicorn/consistent-function-scoping": "error",
    "unicorn/no-array-sort": "error",
    "no-unused-vars": "error",
    "no-shadow": "error",
    "prefer-const": "error",
    "typescript/no-explicit-any": "error",
  },
  overrides: [
    // Tests and the checks under tools/ are command-line scripts: the terminal is where they
    // report, and there is no test runner to report through.
    {
      files: ["src/**/*.test.ts", "tools/**"],
      rules: {
        "no-console": "off",
      },
    },
    // Tests stand partial fakes in for dsh services and feed the translator events it has never
    // seen (tools/oxlint/README.md).
    {
      files: ["src/**/*.test.ts", "tools/**/*.test.ts"],
      rules: {
        "anti-slop/require-safety-comment-for-type-assertion": "off",
        "anti-slop/require-doc-comment": "off",
        "quality/no-chained-type-assertions": "off",
        "anti-slop/no-unknown-parameters": "off",
        "quality/no-known-value-widening": "off",
        "quality/no-unsafe-dictionary-type": "off",
        "anti-slop/no-runtime-typeof": "off",
        "no-shadow": "off",
        "unicorn/consistent-function-scoping": "off",
        "anti-slop/no-module-mocking": "off",
        "quality/no-conditional-empty-object-spread": "off",
      },
    },
    // Permission modes arrive from the CLI and from dsh as untyped strings.
    {
      files: ["src/permissions.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
    // I/O boundaries: files that read data the plugin does not own (stream-json, transcripts,
    // JSON-RPC, HTTP bodies, files on disk) and check it into typed values.
    {
      files: [
        "src/anthropic-status.ts",
        "src/decode.ts",
        "src/process.ts",
        "src/rows-probe.ts",
        "src/stars.ts",
        "src/remote-fs.ts",
        "src/hold.ts",
        "src/reach.ts",
        "src/keeper.ts",
        "src/test-gate-files.ts",
        "src/transcript.ts",
        "src/search.ts",
        "src/mcp.ts",
        "src/mcp-add-remove.ts",
        "src/plugins.ts",
        "src/report.ts",
        "src/sessions.ts",
        "src/notify-store.ts",
        "src/scheduled-tasks.ts",
        "src/state.ts",
        "src/claude-update.ts",
        "src/usage.ts",
        "src/translator.ts",
        "src/client/shared.ts",
        "src/routes/files.ts",
        "src/routes/settings.ts",
        "src/routes/status.ts",
        "src/routes/controls.ts",
        "src/routes/tasks.ts",
      ],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
    {
      files: [
        "src/anthropic-status.ts",
        "src/decode.ts",
        "src/process.ts",
        "src/remote-fs.ts",
        "src/hold.ts",
        "src/transcript.ts",
        "src/search.ts",
        "src/mcp.ts",
        "src/mcp-add-remove.ts",
        "src/plugins.ts",
        "src/report.ts",
        "src/sessions.ts",
        "src/notify-store.ts",
        "src/scheduled-tasks.ts",
        "src/state.ts",
        "src/claude-update.ts",
        "src/usage.ts",
        "src/translator.ts",
        "src/routes/settings.ts",
      ],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
      },
    },
    {
      files: ["src/sessions.ts", "src/usage.ts"],
      rules: {
        "quality/no-unknown-returns": "off",
      },
    },
    {
      files: [
        "src/decode.ts",
        "src/anthropic-status.ts",
        "src/process.ts",
        "src/hold.ts",
        "src/reach.ts",
        "src/report.ts",
        "src/transcript.ts",
        "src/search.ts",
        "src/sessions.ts",
        "src/notify-store.ts",
        "src/scheduled-tasks.ts",
        "src/state.ts",
        "src/claude-update.ts",
        "src/usage.ts",
        "src/translator.ts",
      ],
      rules: {
        "quality/no-unsafe-dictionary-type": "off",
      },
    },
    // Reads and rewrites dsh session logs, whose lines are untyped JSON.
    {
      files: ["src/session-repair.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "quality/no-unsafe-dictionary-type": "off",
        "quality/no-known-value-widening": "off",
      },
    },
    // Dev checks that read dsh's and the CLI's JSON (JSON-RPC stdout, session logs, package files)
    // and decode it into typed values.
    {
      files: ["tools/cli-compaction-check.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "quality/no-unsafe-dictionary-type": "off",
      },
    },
    // Test-only fakes: Node's server.address() answers `AddressInfo | string | null`, and only
    // typeof tells the string form apart.
    {
      files: ["src/test-context.ts"],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
    // Dev checks that load dsh's or Playwright's modules by path and check the one function they
    // call before calling it.
    {
      files: [
        "tools/dsh-session-repair.ts",
        "tools/probe-notice-source.ts",
        "tools/playwright/pw.ts",
      ],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
      },
    },
    // The scratch dsh test harness drives dsh's untyped service surface.
    {
      files: ["src/test-dsh.ts"],
      rules: {
        "anti-slop/no-unknown-parameters": "off",
        "quality/no-chained-type-assertions": "off",
        "quality/no-unsafe-dictionary-type": "off",
        "anti-slop/no-runtime-typeof": "off",
      },
    },
    // Rule options arrive from the lint config as untyped JSON.
    {
      files: [
        "tools/oxlint/anti-slop/rules/require-safety-comment-for-type-assertion.ts",
        "tools/oxlint/anti-slop/rules/no-runtime-typeof.ts",
      ],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-unknown-parameters": "off",
        "quality/no-unsafe-dictionary-type": "off",
        "quality/no-chained-type-assertions": "off",
      },
    },
  ],
});
