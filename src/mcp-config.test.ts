// Offline checks for the configured-MCP listing: bun src/mcp-config.test.ts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredFrom, listConfiguredMcp } from "./mcp-config.js";

{
  const claudeJson = JSON.stringify({
    mcpServers: { global: { type: "http", url: "https://example.test/mcp" } },
    projects: {
      "/work/app": { mcpServers: { echo: { command: "echo", args: ["hello"] } } },
      "/elsewhere": { mcpServers: { other: { command: "x" } } },
    },
  });
  const mcpJson = JSON.stringify({
    mcpServers: { shared: { command: "bunx", args: ["srv", "--db", "a.sqlite"] } },
  });
  assert.deepEqual(configuredFrom(claudeJson, [mcpJson], "/work/app"), [
    { name: "global", scope: "user", summary: "https://example.test/mcp" },
    { name: "echo", scope: "local", summary: "echo hello" },
    { name: "shared", scope: "project", summary: "bunx srv --db a.sqlite" },
  ]);
  assert.deepEqual(configuredFrom(null, [null], "/work/app"), [], "no files, no rows");
  assert.deepEqual(configuredFrom("{not json", ["[]"], "/work/app"), [], "garbage reads as none");
  // `.mcp.json` files from the session's directory upwards: every level counts, and a name two
  // levels share is listed once, from the nearer one.
  const above = JSON.stringify({
    mcpServers: { shared: { command: "old" }, root: { command: "root-only" } },
  });
  assert.deepEqual(
    configuredFrom(null, [mcpJson, null, above], "/work/app").map((r) => r.summary),
    ["bunx srv --db a.sqlite", "root-only"],
  );
}

// A session in a subdirectory of a repository: local servers are filed under the repository's
// root, not the session's directory, and the root's `.mcp.json` counts beside the session's own.
{
  const tmp = await mkdtemp(join(tmpdir(), "omc-mcp-config-"));
  const root = join(tmp, "repo");
  const sub = join(root, "packages", "app");
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(sub, { recursive: true });
  const claudeJsonPath = join(tmp, ".claude.json");
  await writeFile(
    claudeJsonPath,
    JSON.stringify({ projects: { [root]: { mcpServers: { local: { command: "l" } } } } }),
  );
  await writeFile(
    join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: { up: { command: "u" } } }),
  );
  await writeFile(
    join(sub, ".mcp.json"),
    JSON.stringify({ mcpServers: { own: { command: "o" } } }),
  );
  assert.deepEqual(
    (await listConfiguredMcp(sub, claudeJsonPath)).map((r) => `${r.scope}:${r.name}`),
    ["local:local", "project:own", "project:up"],
  );
}

console.log("mcp-config ok");
