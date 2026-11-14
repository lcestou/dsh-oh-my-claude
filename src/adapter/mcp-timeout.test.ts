// The bridge's MCP server entry carries its own timeout, so Claude Code does not abort a relayed
// dsh tool that stays silent past its 300 s idle limit.
import { strict as assert } from "node:assert";
import { buildArgs } from "./cli.js";
import { Config } from "./config.js";

const args = buildArgs({ model: "m", config: new Config({}), mcp: { url: "http://x/mcp/s" } });
const dsh = JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "{}").mcpServers.dsh;
assert.equal(dsh.timeout, 3_600_000);
assert.equal(dsh.type, "http");

// Under `isolate` the entry takes isolate's longer limit: the CLI reads this field before
// MCP_TOOL_TIMEOUT for the server's total, so the hour would cut it back.
{
  const iso = buildArgs({
    model: "m",
    config: new Config({ isolate: true }),
    mcp: { url: "http://x/mcp/s" },
  });
  const entry = JSON.parse(iso[iso.indexOf("--mcp-config") + 1] ?? "{}").mcpServers.dsh;
  assert.equal(entry.timeout, 2_000_000_000);
}

console.log("mcp-timeout: ok");
