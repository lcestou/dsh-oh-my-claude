// MCP bridge: exposes the dsh tools visible to a session's agent (subagents, jobs, skills, ...) to
// the Claude Code process of that session over MCP Streamable HTTP, so a Claude parent can fan out
// to dsh subagents and they show up under the session like any other child. Shell and file tools are
// left out: Claude Code has its own. Guarded by a per-process key that only the adapter knows.
import { randomUUID } from "node:crypto";
import { readBody } from "./sessions.js";

export const MCP_PATH = "/dsh-llm-claude/mcp";
export const KEY_HEADER = "x-dsh-llm-claude-key";
const PROTOCOL = "2025-06-18";
const BODY_LIMIT = 1024 * 1024;
/** dsh tools Claude Code already has natively; proxying them would only confuse the model. */
const HIDDEN = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "multi_edit",
  "glob",
  "grep",
  "ls",
  "run_code",
]);

const textOf = (blocks) =>
  (Array.isArray(blocks) ? blocks : [blocks])
    .map((b) =>
      b && typeof b === "object" && typeof b.text === "string" ? b.text : JSON.stringify(b),
    )
    .join("\n");

/** One JSON-RPC request against the tools visible to `agent`. Returns null for notifications. */
export async function handleRpc(msg, { tools, agent, signal, version }) {
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: msg.params?.protocolVersion ?? PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "dsh", version },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: tools
          .schemas(agent)
          .filter((t) => !HIDDEN.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
      });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      const tool = HIDDEN.has(name) ? undefined : tools.get(name, agent);
      if (!tool)
        return reply({ content: [{ type: "text", text: `unknown tool ${name}` }], isError: true });
      try {
        const exec = { agent, signal, name, arguments: args, callId: randomUUID() };
        const returned = await tool.execute(args, exec);
        const rendered = tool.output?.render ? tool.output.render(args, returned) : returned;
        return reply({ content: [{ type: "text", text: textOf(rendered) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: String(e?.message ?? e) }], isError: true });
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `unknown method ${msg.method}` },
      };
  }
}

const send = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(value === undefined ? "" : JSON.stringify(value));
};

/**
 * Mount `POST /dsh-llm-claude/mcp/<dsh session id>`. Resolves once the web server is up with the
 * base URL and key the adapter must hand to `claude --mcp-config`.
 */
export function registerMcpBridge(ctx, { log, version }) {
  const key = randomUUID();
  return new Promise((resolve) => {
    ctx.inject(["webServer", "tools", "agents"], (ctx) => {
      ctx.effect(() =>
        ctx.webServer.register({
          kind: "prefix",
          path: MCP_PATH,
          handler: async (req, res) => {
            if (req.headers[KEY_HEADER] !== key) return send(res, 403, { error: "forbidden" });
            if (req.method !== "POST") return send(res, 405, { error: "POST only" });
            const sessionId = decodeURIComponent(
              (req.url ?? "").slice(MCP_PATH.length + 1).split("?")[0],
            );
            const agent = ctx.agents.get(sessionId);
            if (!agent) return send(res, 404, { error: `no live agent for session ${sessionId}` });
            const controller = new AbortController();
            // Node fires the request's own "close" once the body is consumed; the response's
            // fires when the client actually goes away.
            res.on("close", () => {
              if (!res.writableFinished) controller.abort();
            });
            try {
              const msg = await readBody(req, BODY_LIMIT);
              const out = await handleRpc(msg, {
                tools: ctx.tools,
                agent,
                signal: controller.signal,
                version,
              });
              return out === null ? send(res, 202) : send(res, 200, out);
            } catch (e) {
              log("warn", `mcp bridge: ${e?.message ?? e}`);
              return send(res, 400, { error: String(e?.message ?? e) });
            }
          },
        }),
      );
      resolve({ base: `http://127.0.0.1:${ctx.webServer.port}`, key });
    });
  });
}
