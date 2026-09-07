// Offline self-check: bun src/plugins.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { pluginRoster } from "./plugins.js";

const scopes = (files: Record<string, unknown>) =>
  Object.entries(files).map(([scope, value]) => ({ scope, text: JSON.stringify(value) }));

// Nothing set, and a file that is not JSON: an empty roster either way, and no throw.
{
  assert.deepEqual(pluginRoster(scopes({ user: {} })), { plugins: [], marketplaces: [] });
  assert.deepEqual(pluginRoster([{ scope: "user", text: "{ nope" }]), {
    plugins: [],
    marketplaces: [],
  });
}

// Per key, the highest scope decides, and the scope it came from is reported with it.
{
  const out = pluginRoster(
    scopes({
      local: { enabledPlugins: { "formatter@tools": false } },
      project: { enabledPlugins: { "formatter@tools": true, "linter@tools": true } },
      user: { enabledPlugins: { "linter@tools": false } },
    }),
  );
  assert.deepEqual(out.plugins, [
    { key: "formatter@tools", enabled: false, scope: "local" },
    { key: "linter@tools", enabled: true, scope: "project" },
  ]);
}

// The extended values: a version constraint, an object that carries one, and one that says off.
{
  const out = pluginRoster(
    scopes({
      user: {
        enabledPlugins: {
          "a@m": ">=1.2.0",
          "b@m": { version: "2.0.0" },
          "c@m": { enabled: false, version: "3.0.0" },
          "d@m": { note: "no version here" },
        },
      },
    }),
  );
  assert.deepEqual(out.plugins, [
    { key: "a@m", enabled: true, detail: ">=1.2.0", scope: "user" },
    { key: "b@m", enabled: true, detail: "2.0.0", scope: "user" },
    { key: "c@m", enabled: false, detail: "3.0.0", scope: "user" },
    { key: "d@m", enabled: true, detail: '{"note":"no version here"}', scope: "user" },
  ]);
}

// Marketplaces: the source read back as one line, whatever shape it was written in.
{
  const out = pluginRoster(
    scopes({
      user: {
        extraKnownMarketplaces: {
          // The nested shape the CLI actually writes: a descriptor under a `source` key.
          team: { source: { source: "github", repo: "acme/plugins" } },
          dir: { source: { source: "directory", path: "/home/me/.claude/mkt" } },
          // A flat descriptor still reads, and a bare string is taken as written.
          web: { source: "url", url: "https://example.com/m.json" },
          plain: "github:acme/other",
        },
      },
    }),
  );
  assert.deepEqual(out.marketplaces, [
    { name: "dir", source: "directory:/home/me/.claude/mkt", scope: "user" },
    { name: "plain", source: "github:acme/other", scope: "user" },
    { name: "team", source: "github:acme/plugins", scope: "user" },
    { name: "web", source: "url:https://example.com/m.json", scope: "user" },
  ]);
}

// The alias is read as the key, and marked; a file spelling both has its alias ignored, as the CLI
// ignores it.
{
  const alias = pluginRoster(
    scopes({ project: { additionalMarketplaces: { team: { source: "skills-dir" } } } }),
  );
  assert.deepEqual(alias.marketplaces, [
    { name: "team", source: "skills-dir", scope: "project", alias: true },
  ]);
  const both = pluginRoster(
    scopes({
      project: {
        extraKnownMarketplaces: { kept: { source: "skills-dir" } },
        additionalMarketplaces: { dropped: { source: "skills-dir" } },
      },
    }),
  );
  assert.deepEqual(
    both.marketplaces.map((m) => m.name),
    ["kept"],
  );
}

// A marketplace named in two files belongs to the higher one.
{
  const out = pluginRoster(
    scopes({
      managed: { extraKnownMarketplaces: { team: { source: "skills-dir" } } },
      user: { extraKnownMarketplaces: { team: { source: "github", repo: "acme/plugins" } } },
    }),
  );
  assert.deepEqual(out.marketplaces, [{ name: "team", source: "skills-dir", scope: "managed" }]);
}

console.log("plugins ok");
