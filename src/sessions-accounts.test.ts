// The accounts routes as the session registration mounts them: an account added through the
// dispatch is saved and handed to the adapter, every tab is told, and an SSH box cannot take the
// account's name (the two share one provider-id namespace).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./accounts.js";
import { registerSessionRoutes } from "./sessions.js";
import { tempDir } from "./test-tmp.js";

const tmp = tempDir("omc-sess-acct-");
let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
// SAFETY: partial fake of the plugin context; the registration reads these services only
const ctx = {
  inject: (_deps: string[], cb: (host: unknown) => void) =>
    cb({
      webServer: {
        register: (r: { handler: typeof handler }) => {
          handler = r.handler;
          return () => {};
        },
      },
      connection: { requestRejection: () => undefined },
      sessions: { get: () => undefined },
      sessionPersistence: { list: async () => [] },
      effect: (fn: () => void) => fn(),
    }),
} as never;
const published: string[] = [];
const changed: Account[][] = [];
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
  // SAFETY: the accounts routes and the ssh-boxes PUT only publish on the hub
  events: { hub: { publish: (e: { kind: string }) => published.push(e.kind) } } as never,
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
const respond = async (method: string, url: string, body?: object) => {
  let status = 0;
  const out: Buffer[] = [];
  const res = {
    writeHead: (s: number) => {
      status = s;
    },
    end: (b: Buffer | string) => out.push(Buffer.from(b)),
  };
  const req = {
    method,
    url,
    on: (ev: string, cb: (c?: Buffer) => void) => {
      if (ev === "data" && body !== undefined) cb(Buffer.from(JSON.stringify(body)));
      if (ev === "end") cb();
    },
    destroy: () => {},
  };
  await handler?.(req, res);
  return { status, body: JSON.parse(Buffer.concat(out).toString("utf8")) };
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
  const counted: string[] = [];
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
console.log("sessions accounts ok");
