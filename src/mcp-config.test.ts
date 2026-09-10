// Offline checks for the configured-MCP listing: bun src/mcp-config.test.ts.
import assert from "node:assert/strict";
import { configuredFrom } from "./mcp-config.js";

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
  assert.deepEqual(configuredFrom(claudeJson, mcpJson, "/work/app"), [
    { name: "global", scope: "user", summary: "https://example.test/mcp" },
    { name: "echo", scope: "local", summary: "echo hello" },
    { name: "shared", scope: "project", summary: "bunx srv --db a.sqlite" },
  ]);
  assert.deepEqual(configuredFrom(null, null, "/work/app"), [], "no files, no rows");
  assert.deepEqual(configuredFrom("{not json", "[]", "/work/app"), [], "garbage reads as none");
}

console.log("mcp-config ok");
