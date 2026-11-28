// The accounts routes as the session registration mounts them: an account added through the
// dispatch is saved and handed to the adapter, every tab is told, and an SSH box cannot take the
// account's name (the two share one provider-id namespace).
import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./accounts.js";
import { probeRuntime, registerSessionRoutes } from "./sessions.js";
import { tempDir } from "./test-tmp.js";
import type { JsonValue } from "./dsh.js";
import { EventHub } from "./events.js";
import { fakeRouteHost, notFaked, objectOf, parseJson, serveRoutes } from "./test-context.js";

const tmp = tempDir("omc-sess-acct-");

// The registration reads the host's web server, connection, store and persistence only.
let routes = fakeRouteHost();
const { ctx } = routes;

const published: Array<string> = [];

// A hub that records each event's kind instead of sending it anywhere.
const hub = new EventHub();

hub.publish = (e) => {
  published.push(e.kind);
};

const changed: Array<Array<Account>> = [];

registerSessionRoutes(ctx, {
  log: () => {},
  projectDir: () => [join(tmp, "claude", "projects")],
  projectsDir: [join(tmp, "claude", "projects")],
  startedIds: async () => [],
  claudeIdOf: (id: string) => id,
  configDir: join(tmp, "claude"),
  sshBoxesPath: join(tmp, "ssh-boxes.json"),
  instanceFor: () => undefined,
  instanceForHost: () => undefined,
  // The accounts routes and the ssh-boxes PUT only publish on the hub.
  events: {
    hub,
    snapshot: notFaked("events.snapshot"),
    replies: {
      liveTurn: notFaked("replies.liveTurn"),
      turns: notFaked("replies.turns"),
      asides: notFaked("replies.asides"),
      idle: notFaked("replies.idle"),
      permissionMode: notFaked("replies.permissionMode"),
    },
  },
  accounts: {
    path: join(tmp, "accounts.json"),
    onChange: (a) => {
      changed.push(a);
    },
    localMounts: () => [],
    mounted: () => new Set(),
  },
});

/** One request through the registered dispatch: status and parsed body. */
const respond = async (method: string, url: string, body?: JsonValue) => {
  const { send } = await serveRoutes(routes.handler);
  const answer = await send(method, url, body === undefined ? undefined : JSON.stringify(body));

  return { status: answer.status, body: objectOf(parseJson(answer.text)) };
};

let r = await respond("POST", "/dsh-oh-my-claude/accounts", { name: "Work", configDir: "" });

assert.equal(r.status, 200, "the dispatch reaches the accounts group");

assert.deepEqual(changed.at(-1), [{ name: "Work", configDir: "~/.claude-work" }]);

assert.deepEqual(JSON.parse(readFileSync(join(tmp, "accounts.json"), "utf8")), changed.at(-1));

assert.ok(published.includes("boxes"), "every tab is told");

r = await respond("PUT", "/dsh-oh-my-claude/ssh-boxes", {
  boxes: [{ name: "work", host: "nova" }],
});

assert.equal(r.status, 400, "an SSH box cannot take an account's name");

r = await respond("PUT", "/dsh-oh-my-claude/ssh-boxes", {
  boxes: [{ name: "Nova", host: "nova" }],
});

assert.equal(r.status, 200);

assert.equal(
  published.filter((k) => k === "boxes").length,
  2,
  "a saved box list tells every tab too",
);

// The status route reads an account's own live count, through the loginKey instanceFor carries.
// Registered again without an ssh-box file, so the read stays offline (no npm check).
{
  const counted: Array<string> = [];
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: () => [join(tmp, "claude", "projects")],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    command: "/bin/false",
    instanceFor: (p) =>
      p === "claude-code-work"
        ? { configDir: join(tmp, "work"), command: "/bin/false", loginKey: "dir:/w" }
        : undefined,
    instanceForHost: () => undefined,
    liveCount: (key) => {
      counted.push(key);

      return key === "dir:/w" ? 3 : 1;
    },
  });
  const work = await respond("GET", "/dsh-oh-my-claude/status?provider=claude-code-work");
  assert.equal(work.body.running, 3, "the account's processes, not This box's");
  const own = await respond("GET", "/dsh-oh-my-claude/status");
  assert.equal(own.body.running, 1, "This box keeps its own count");
  assert.deepEqual(counted, ["dir:/w", ""]);
}

// The runtime probe asks `claude auth status` under the mount's own config dir. A stand-in CLI
// reports logged in only when it sees that dir, as the real one reads its login from it.
{
  const dir = tempDir("omc-probe-dir-");
  const cli = join(dir, "fake-claude");
  writeFileSync(
    cli,
    `#!/bin/sh\nif [ "$1" = auth ]; then [ "$CLAUDE_CONFIG_DIR" = "${dir}/acct" ] && echo '{"loggedIn":true}' || echo '{"loggedIn":false}'; else echo 1.0; fi\n`,
  );
  chmodSync(cli, 0o755);
  const st = await probeRuntime(join(dir, "acct"), cli, "");
  assert.equal(st.loggedIn, true, "the status probe runs under the mount's config dir");
}

// Plugin and MCP writes from an account's session run under the account's config dir: the panel
// reads that dir back, so a write to This box's dir would change the wrong login and look like a
// no-op. A stand-in CLI records the dir it saw for each verb.
{
  const dir = tempDir("omc-verb-dir-");
  const cli = join(dir, "fake-claude");
  const seen = join(dir, "seen.log");
  writeFileSync(cli, `#!/bin/sh\necho "$1 $2 $CLAUDE_CONFIG_DIR" >> ${seen}\n`);
  chmodSync(cli, 0o755);
  const project = join(dir, "project");
  mkdirSync(project);

  // As above, with one session open in a directory; `respond` reaches this registration now.
  routes = fakeRouteHost({ persisted: [{ id: "s1", cwd: project }] });

  registerSessionRoutes(routes.ctx, {
    log: () => {},
    projectDir: () => [join(tmp, "claude", "projects")],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    command: "/bin/false",
    instanceFor: (p) =>
      p === "claude-code-work" ? { configDir: join(dir, "work"), command: cli } : undefined,
    instanceForHost: () => undefined,
  });
  const q = "?provider=claude-code-work";

  const posts: Array<[string, JsonValue]> = [
    ["/plugins/toggle", { key: "a@m", scope: "user", enable: false }],
    ["/plugins/uninstall", { key: "a@m", scope: "user" }],
    ["/plugins/marketplace/add", { source: "owner/repo", scope: "user" }],
    ["/plugins/marketplace/remove", { name: "m", scope: "user" }],
    [
      "/mcp-servers/add",
      { name: "x", scope: "user", transport: "http", url: "http://x.test", session: "s1" },
    ],
    ["/mcp-servers/remove", { name: "x", session: "s1" }],
  ];

  for (const [path, body] of posts) {
    const r = await respond("POST", `/dsh-oh-my-claude${path}${q}`, body);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body)}`);
  }

  assert.deepEqual(
    readFileSync(seen, "utf8").trim().split("\n"),
    [
      `plugin disable ${dir}/work`,
      `plugin uninstall ${dir}/work`,
      `plugin marketplace ${dir}/work`,
      `plugin marketplace ${dir}/work`,
      `mcp add-json ${dir}/work`,
      `mcp remove ${dir}/work`,
    ],
    "every plugin and MCP write runs the account's CLI under the account's config dir",
  );
}

console.log("sessions accounts ok");
