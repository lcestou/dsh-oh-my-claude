// The accounts routes against a fake adapter: add saves and mounts and tells every tab, an id a
// hand-written mount holds is refused, remove withdraws, the hand-written mount is listed
// read-only, and a login runs under the account's own config dir and key.
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Account } from "../accounts.js";
import type { JsonValue } from "../dsh.js";
import { pollSshLogin, THIS_BOX } from "../ssh-login.js";
import { accountsRoutes } from "./accounts.js";
import type { AccountRouteCtx, LocalMount } from "./accounts.js";
import { UNHANDLED } from "./context.js";
import { setTimeout as sleep } from "node:timers/promises";
import { fieldsOf, objectOf, rowsOf } from "../test-context.js";

const dir = mkdtempSync(join(tmpdir(), "omc-acct-"));
const path = join(dir, "accounts.json");
const mounted = new Map<string, Account>();

const profile: LocalMount = {
  provider: "claude-code-side",
  name: "Side",
  home: "/home/u/.claude-side",
  loginKey: "dir:/home/u/.claude-side",
  command: "/opt/side/claude",
};

const calls: Array<string> = [];

/** Config dirs the stand-in CLI has logged out. */
const loggedOut = new Set<string>();
let body: { [key: string]: JsonValue } = {};

// What the group answered, as the JSON the browser receives.
let answer: { status: number; value: JsonValue } = { status: 0, value: null };

const ctx: AccountRouteCtx = {
  ROUTE_PREFIX: "/p",
  path,
  home: "/home/u",
  defaultHome: "/home/u/.claude",
  command: "claude",
  json: (_res, status, value) => {
    const sent = JSON.stringify(value);

    answer = { status, value: JSON.parse(sent) };
  },
  readBody: async () => body,
  // Logged in only under the work account's dir, as the real CLI reads its login from there.
  // A logout takes the login away until the next run of the suite, as the real one does.
  run: async (cmd, args, env) => {
    calls.push(`${cmd} ${args.join(" ")} @${env?.CLAUDE_CONFIG_DIR ?? "-"}`);
    const dir = env?.CLAUDE_CONFIG_DIR ?? "";

    if (args[1] === "logout") {
      loggedOut.add(dir);
    }

    return {
      out: `{"loggedIn": ${dir === "/home/u/.claude-work" && !loggedOut.has(dir) && args[0] === "auth" && args[1] === "status"}}`,
    };
  },
  cliEnvFor: (d) => ({ PATH: process.env.PATH, CLAUDE_CONFIG_DIR: d }),
  loggedIn: (out) => out.includes('"loggedIn": true'),
  status: async () => ({ loggedIn: true }),
  forgetIdentity: () => calls.push("forget"),
  sshIds: async () => ["claude-code-nova"],
  localMounts: () => [
    profile,
    ...[...mounted].map(([provider, a]) => ({
      provider,
      name: a.name,
      home: a.configDir.replace("~", "/home/u"),
      loginKey: `dir:${a.configDir.replace("~", "/home/u")}`,
      // Empty: the route falls back to `c.command`, which a login case below points at a stand-in.
      command: "",
    })),
  ],
  mounted: () => new Set(mounted.keys()),
  onChange: (accounts) => {
    mounted.clear();

    for (const a of accounts) {
      mounted.set(`claude-code-${a.name.toLowerCase()}`, a);
    }
  },
  liveCount: () => 2,
  loginDone: (k) => calls.push(`loginDone ${k}`),
  logoutDone: (k) => calls.push(`logoutDone ${k}`),
  onLoginStatus: (p, on) => calls.push(`status ${p} ${on}`),
  publish: () => calls.push("publish"),
  log: () => {},
};

const route = accountsRoutes(ctx);

/** One request through the group; the answer lands in `answer`. */
const hit = async (method: string, path: string, b: { [key: string]: JsonValue } = {}) => {
  body = b;
  answer = { status: 0, value: null };
  // The group reads `method` off the request and the body through readBody, nothing else; the
  // fake json never touches the response.
  const req = new IncomingMessage(new Socket());
  req.method = method;

  return route(req, new ServerResponse(req), new URL(`http://dsh${path}`));
};

// Add: saved normalised, mounted, every tab told.
await hit("POST", "/p/accounts", { name: "Work", configDir: "~/.claude-work/" });

assert.equal(answer.status, 200);

assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), [
  { name: "Work", configDir: "~/.claude-work" },
]);

assert.ok(mounted.has("claude-code-work"));

assert.ok(calls.includes("publish"));

const listed = rowsOf(objectOf(answer.value).accounts, { provider: "string", source: "string" });

assert.deepEqual(
  listed.map((r) => `${r.provider}:${r.source}`),
  ["claude-code-work:plugin", "claude-code-side:profile"],
  "the hand-written mount is listed after the plugin's own",
);

// Refusals: a hand-written id (409), an SSH box's id, the default dir.
await hit("POST", "/p/accounts", { name: "Side" });

assert.equal(answer.status, 409);

await hit("POST", "/p/accounts", { name: "Nova" });

assert.equal(answer.status, 400);

await hit("POST", "/p/accounts", { name: "Main", configDir: "~/.claude" });

assert.equal(answer.status, 400);

assert.match(fieldsOf(answer.value, { error: "string" }).error, /~\/\.claude/);

// Status: one row per account with its running count.
await hit("GET", "/p/accounts/status");

const statusRows = objectOf(answer.value).accounts;

assert.ok(Array.isArray(statusRows), "status answers a list");

const rows = statusRows.map((r) => ({
  status: fieldsOf(objectOf(r).status, { running: "number" }),
}));

assert.deepEqual(
  rows.map((r) => r.status.running),
  [2, 2],
);

// Login runs under the account's dir; logout logs that dir out and stops that login's sessions.
calls.length = 0;

await hit("POST", "/p/accounts/login/logout", { provider: "claude-code-work" });

assert.deepEqual(calls, [
  "claude auth logout @/home/u/.claude-work",
  "claude auth status @/home/u/.claude-work",
  "forget",
  "logoutDone dir:/home/u/.claude-work",
  "status claude-code-work false",
  "publish",
]);

// A logout the CLI did not carry out (the status still says logged in) is reported, and nothing is
// stopped or marked logged out.
{
  const realRun = ctx.run;
  ctx.run = async (cmd, args, env) => {
    calls.push(`${cmd} ${args.join(" ")} @${env?.CLAUDE_CONFIG_DIR ?? "-"}`);

    return args[1] === "status"
      ? { out: '{"loggedIn": true}' }
      : { out: "", error: "keychain locked" };
  };

  calls.length = 0;
  await hit("POST", "/p/accounts/login/logout", { provider: "claude-code-work" });
  assert.equal(answer.status, 500, "a failed logout is an error");
  assert.ok(!calls.some((x) => x.startsWith("logoutDone")), "and stops no session");
  ctx.run = realRun;
}

loggedOut.clear(); // the login cases below start from a logged-in work account again

// A hand-written mount with a `command:` of its own logs out through that binary, not the default.
calls.length = 0;

await hit("POST", "/p/accounts/login/logout", { provider: "claude-code-side" });

assert.equal(
  calls[0],
  "/opt/side/claude auth logout @/home/u/.claude-side",
  "logout runs the mount's own claude",
);

await hit("POST", "/p/accounts/login/start", { provider: "claude-code-default" });

assert.equal(answer.status, 400, "an id that is no local mount is refused");

// The login steps through the real start route: a stand-in CLI prints a sign-in URL naming the
// config dir it saw, then waits until `go` exists (30 s at most, so a failed run leaves nothing
// behind), as the real one waits for the browser.
const go = join(dir, "go");
const cli = join(dir, "fake-claude");

writeFileSync(
  cli,
  `#!/bin/sh\necho "https://claude.com/cai/oauth/authorize?d=$CLAUDE_CONFIG_DIR"\ni=0; while [ ! -e ${go} ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done\n`,
);

chmodSync(cli, 0o755);

ctx.command = cli;

/** Poll the work account's login until it stops being pending (the CLI has exited). */
const pollUntilDone = async () => {
  for (let i = 0; i < 100; i++) {
    await hit("POST", "/p/accounts/login/poll", { provider: "claude-code-work" });

    if (!fieldsOf(answer.value, { pending: "boolean?" }).pending) {
      return;
    }

    await sleep(100);
  }

  assert.fail("the login never finished");
};

{
  await hit("POST", "/p/accounts/login/start", { provider: "claude-code-work" });
  assert.match(
    String(fieldsOf(answer.value, { url: "string?" }).url),
    /d=\/home\/u\/\.claude-work$/,
    "the login runs under the account's config dir",
  );
  await hit("POST", "/p/accounts/login/poll", { provider: "claude-code-work" });
  // Through a copy: an assertion on `answer.value` itself would narrow its type for the rest of the
  // file.
  const polled: unknown = answer.value;
  assert.deepEqual(polled, { pending: true });
  assert.equal(
    (await pollSshLogin(THIS_BOX, async () => false)).pending,
    false,
    "the account's login is held under its own key, not This box's",
  );
  calls.length = 0;
  writeFileSync(go, "");
  await pollUntilDone();
  const finished: unknown = answer.value;
  assert.deepEqual(finished, { done: true, loggedIn: true }, "verified under the account's dir");
  assert.ok(calls.includes(`${cli} auth status @/home/u/.claude-work`));
  assert.ok(calls.includes("forget"), "the cached identity is dropped");
  assert.ok(
    calls.includes("loginDone dir:/home/u/.claude-work"),
    "the session's login card clears",
  );
  rmSync(go);
}

// Remove cancels a login still running on the account, so it cannot finish into a dir nobody owns.
await hit("POST", "/p/accounts/login/start", { provider: "claude-code-work" });

assert.ok(fieldsOf(answer.value, { url: "string?" }).url);

// Remove: withdrawn and gone from the file; an unknown id is a 404.
await hit("POST", "/p/accounts/remove", { provider: "claude-code-work" });

assert.equal(answer.status, 200);

assert.equal(mounted.size, 0);

assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), []);

mounted.set("claude-code-work", { name: "Work", configDir: "~/.claude-work" });

await hit("POST", "/p/accounts/login/poll", { provider: "claude-code-work" });

assert.match(
  String(fieldsOf(answer.value, { error: "string?" }).error),
  /no login in progress/,
  "remove cancelled the account's login",
);

mounted.clear();

writeFileSync(go, "");

await hit("POST", "/p/accounts/remove", { provider: "claude-code-work" });

assert.equal(answer.status, 404);

// Two adds at once (two tabs) both land: writes run one after the other, each on the saved list.
await Promise.all([
  hit("POST", "/p/accounts", { name: "A" }),
  hit("POST", "/p/accounts", { name: "B" }),
]);

assert.deepEqual(
  rowsOf(JSON.parse(readFileSync(path, "utf8")), { name: "string" }).map((a) => a.name),
  ["A", "B"],
);

// An accounts.json that does not parse, or parses but breaks the rules, is never overwritten:
// both writes refuse with 500.
for (const bad of ["{ not json", '[{"name":"x","configDir":"relative"}]']) {
  writeFileSync(path, bad);
  await hit("POST", "/p/accounts", { name: "Later" });
  assert.equal(answer.status, 500);
  assert.match(fieldsOf(answer.value, { error: "string" }).error, /accounts\.json/);
  await hit("POST", "/p/accounts/remove", { provider: "claude-code-later" });
  assert.equal(answer.status, 500);
  assert.equal(readFileSync(path, "utf8"), bad, "the file is left as it was");
  await hit("GET", "/p/accounts");
  assert.equal(answer.status, 200, "a read still answers, with the hand-written row");
}

// Anything else falls through to the next group.
assert.equal(await hit("GET", "/p/ssh-boxes"), UNHANDLED);

console.log("accounts routes ok");
