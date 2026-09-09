// Offline self-check: node src/sessions.test.js. No CLI, no network.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dshSessionsFor,
  openTranscriptOnce,
  probeBox,
  readPickerSettings,
  registerSessionRoutes,
  slugForDir,
  settingsScopePath,
  isSettingsScope,
  SETTINGS_SCOPES,
} from "./sessions.js";
import { projectDirName } from "./adapter.js";
import type { InstructionFile } from "./instructions.js";

// probeBox forwards init.method and init.body, plus content-type when body is set. Fake fetch, no network.
{
  const calls: [string, { headers?: Record<string, string>; method?: string; body?: string }][] =
    [];
  // SAFETY: partial fake for tests
  const res = (
    status: number,
    headers: Record<string, string> = {},
    body: Record<string, unknown> = {},
  ) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  });
  // SAFETY: partial fake for tests
  const fakeFetch = async (u: string, init?: Record<string, unknown>) => {
    calls.push([u, init as Record<string, unknown>]);
    if (u === "http://box/dsh-oh-my-claude/settings")
      return res(
        200,
        {},
        { path: "~/.claude/settings.json", exists: true, text: "{}\n", mtime: 1 },
      );
    throw new Error("unexpected call to " + u);
  };
  // SAFETY: cast to fetch signature for test double
  const result = await probeBox(
    { name: "box", url: "http://box" },
    fakeFetch as unknown as typeof fetch,
    "settings",
    { method: "PUT", body: JSON.stringify({ text: "{}\n" }) },
  );
  assert.equal(result.ok, true);
  const lastCall = calls[calls.length - 1]!;
  const url = lastCall[0];
  const init = lastCall[1];
  assert.equal(url, "http://box/dsh-oh-my-claude/settings");
  assert.equal(init?.method, "PUT");
  assert.equal(init?.body, JSON.stringify({ text: "{}\n" }));
  assert.equal(
    (init?.headers as Record<string, string> | undefined)?.["content-type"],
    "application/json",
  );
}

// probeBox without init still works unchanged (existing callers).
{
  const calls: string[] = [];
  // SAFETY: partial fake for tests
  const fakeFetch = async (u: string) => {
    calls.push(u);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({ host: "x" }),
    };
  };
  // SAFETY: cast to fetch signature for test double
  await probeBox({ name: "b", url: "http://b" }, fakeFetch as unknown as typeof fetch);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "http://b/dsh-oh-my-claude/status");
}

// Boxes settings routes: 400 when url param missing, 404 when box not found.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-sessions-test-"));
  const boxesPath = join(tmp, "boxes.json");
  await writeFile(
    boxesPath,
    JSON.stringify(
      [
        { name: "a", url: "http://a" },
        { name: "b", url: "http://b" },
      ],
      null,
      2,
    ) + "\n",
    "utf8",
  );

  let handler: ((req: any, res: any) => void) | undefined;
  // SAFETY: partial fake for tests
  const ctx = {
    inject: (deps: string[], cb: (host: any) => void) => {
      cb({
        webServer: {
          register: (r: any) => {
            handler = r.handler as (req: any, res: any) => void;
            return () => {};
          },
        },
        connection: { requestRejection: () => undefined },
        sessions: { get: () => undefined },
        // The instructions routes only answer for a directory a dsh session is open in, so the
        // fake registry has to know the one the assertions below use.
        sessionPersistence: { list: async () => [{ id: "sid1", cwd: "/work/app" }] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath,
    importedDir: join(tmp, "imported"),
    instanceFor: (provider) =>
      provider === "claude-code-other"
        ? { configDir: join(tmp, "other") }
        : provider === "claude-code-box"
          ? { configDir: join(tmp, "box"), sshHost: "box" }
          : undefined,
    rewind: async (sid, uuid, dryRun) => ({ ok: true, dryRun, canRewind: true }),
    settingsPath: join(tmp, "claude", "settings.json"),
  });
  assert.ok(handler);

  const respond = async (method: string, url: string, body?: string, raw = false) => {
    let respBody = "";
    const resChunks: Buffer[] = [];
    // SAFETY: partial fake for tests
    const fakeRes = {
      writeHead: (_s: number, _h: Record<string, string>) => {},
      end: (b: Buffer | string) => {
        if (typeof b === "string") resChunks.push(Buffer.from(b));
        else resChunks.push(b);
      },
    };
    // SAFETY: partial fake for tests
    const fakeReq = {
      method,
      url,
      on: (ev: string, cb: (c?: Buffer) => void) => {
        if (ev === "data" && body !== undefined) cb(Buffer.from(body));
        if (ev === "end") cb();
      },
      destroy: () => {},
    } as any;
    await handler!(fakeReq, fakeRes);
    respBody = Buffer.concat(resChunks).toString("utf8");
    return raw ? respBody : JSON.parse(respBody);
  };

  // 400: missing url param
  let r = await respond("GET", "/dsh-oh-my-claude/boxes/settings");
  assert.equal(r.error, "url parameter required");

  // 404: unknown box url
  r = await respond("GET", "/dsh-oh-my-claude/boxes/settings?url=http://z");
  assert.equal(r.error, "unknown box");

  // Memory routes: list, read, write, delete under <project dir>/memory; names are bare .md files.
  const cwd = "/work/app";
  const mem = `/dsh-oh-my-claude/memory?cwd=${encodeURIComponent(cwd)}`;
  r = await respond("GET", "/dsh-oh-my-claude/memory");
  assert.equal(r.error, "cwd must be a directory a dsh session is open in");
  r = await respond("GET", "/dsh-oh-my-claude/memory?cwd=%2Fsomewhere%2Felse");
  assert.equal(
    r.error,
    "cwd must be a directory a dsh session is open in",
    "memory reads and writes are gated on an open session, like every other file route",
  );
  r = await respond("GET", mem);
  assert.deepEqual(r.files, [], "no memory dir lists empty");
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/memory",
    JSON.stringify({ cwd, name: "../x.md", text: "" }),
  );
  assert.equal(r.error, "name must be a .md file");
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/memory",
    JSON.stringify({ cwd, name: "a.md", text: "---\ndescription: fact a\n---\nA" }),
  );
  assert.equal(r.ok, true);
  r = await respond("GET", mem);
  assert.equal(r.files[0].name, "a.md");
  assert.equal(r.files[0].summary, "fact a");
  r = await respond("GET", `${mem}&name=a.md`);
  // Writes go through `remote-fs`, which ends every file it writes with a newline.
  assert.equal(r.text, "---\ndescription: fact a\n---\nA\n");
  r = await respond("DELETE", `${mem}&name=a.md`);
  assert.equal(r.ok, true);
  r = await respond("GET", `${mem}&name=a.md`);
  assert.equal(r.error, "not found");

  // Memory follows the session's own mount: a save from a session on another box lands in that
  // box's project dir, and this box's list never shows it.
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/memory?provider=claude-code-other",
    JSON.stringify({ cwd, name: "b.md", text: "---\ndescription: fact b\n---\nB\n" }),
  );
  assert.equal(r.ok, true);
  r = await respond("GET", `${mem}&provider=claude-code-other`);
  assert.deepEqual(
    (r.files as { name: string }[]).map((f) => f.name),
    ["b.md"],
    "the other box lists its own memories",
  );
  assert.equal(
    await readFile(join(tmp, "other", "projects", projectDirName(cwd), "memory", "b.md"), "utf8"),
    "---\ndescription: fact b\n---\nB\n",
  );
  r = await respond("GET", mem);
  assert.deepEqual(r.files, [], "this box did not gain the other box's memory");

  // Diagnostics: the tab renders on `ok`, so a reply without it reads as the failure shape and
  // draws an empty error line. Assert the flag is there, not only that the fields are.
  r = await respond("GET", `/dsh-oh-my-claude/diagnostics?cwd=${encodeURIComponent(cwd)}`);
  assert.equal(r.ok, true, "diagnostics reply must carry ok");
  assert.ok(r.runtime, "diagnostics reply carries a runtime block");
  assert.ok(Array.isArray(r.configFiles), "diagnostics reply carries the config file list");

  // The box a read is about follows the session's own mount, not whichever instance registered the
  // routes: a request naming another provider reads that provider's config dir, and one naming a
  // provider the registry has no adapter for falls back to the registering instance.
  r = await respond(
    "GET",
    `/dsh-oh-my-claude/diagnostics?cwd=${encodeURIComponent(cwd)}&provider=claude-code-other`,
  );
  assert.equal(r.runtime.configDir, join(tmp, "other"), "provider picks its own box");
  r = await respond(
    "GET",
    `/dsh-oh-my-claude/diagnostics?cwd=${encodeURIComponent(cwd)}&provider=claude-code-gone`,
  );
  assert.equal(r.runtime.configDir, join(tmp, "claude"), "unknown provider falls back");

  // The CLAUDE.md list follows the same mount: the user-scope file it names is the one in that
  // box's config dir, so the tab never offers this PC's file for a session running elsewhere.
  for (const dir of ["other", "claude"]) await mkdir(join(tmp, dir), { recursive: true });
  await writeFile(join(tmp, "other", "CLAUDE.md"), "# other box\n");
  await writeFile(join(tmp, "claude", "CLAUDE.md"), "# this box\n");
  const userFiles = async (provider: string): Promise<string[]> => {
    const reply = await respond(
      "GET",
      `/dsh-oh-my-claude/instructions?cwd=${encodeURIComponent(cwd)}&provider=${provider}`,
    );
    return (reply.files as InstructionFile[]).filter((f) => f.kind === "User").map((f) => f.path);
  };
  assert.deepEqual(
    await userFiles("claude-code-other"),
    [join(tmp, "other", "CLAUDE.md")],
    "the instructions list reads the named box's user file",
  );
  assert.deepEqual(
    await userFiles("claude-code-gone"),
    [join(tmp, "claude", "CLAUDE.md")],
    "an unknown provider falls back to the registering instance",
  );

  // A mutation names its box the same way a read does. The CLI verbs behind these routes run this
  // instance's binary against this instance's config dir, so on an ssh box they would change this PC
  // while the roster beside them still reported the box: refuse rather than write the wrong machine.
  const onBox = "provider=claude-code-box";
  for (const [path, body, what] of [
    ["/plugins/toggle", { session: "sid1", scope: "user", key: "p@m" }, "plugin changes"],
    ["/plugins/uninstall", { session: "sid1", scope: "user", key: "p@m" }, "plugin changes"],
    [
      "/plugins/marketplace/add",
      { session: "sid1", scope: "user", source: "o/r" },
      "plugin changes",
    ],
    [
      "/plugins/marketplace/remove",
      { session: "sid1", scope: "user", name: "m" },
      "plugin changes",
    ],
    ["/mcp-servers/remove", { session: "sid1", name: "srv" }, "MCP server changes"],
    [
      "/mcp-servers/add",
      { session: "sid1", name: "srv", scope: "user", transport: "stdio", command: "x" },
      "MCP server changes",
    ],
  ] as const) {
    r = await respond("POST", `/dsh-oh-my-claude${path}?${onBox}`, JSON.stringify(body));
    assert.equal(r.error, `${what} do not reach an SSH box yet`, `${path} refuses an ssh box`);
  }
  // Export and import. An imported transcript lands in the plugin's own store, keeps the id its
  // records carry while that is free, and downloads back byte for byte.
  const transcript =
    JSON.stringify({
      type: "user",
      uuid: "i-1",
      sessionId: "11111111-2222-3333-4444-555555555555",
      cwd,
      timestamp: "2026-09-06T10:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "imported prompt" }] },
    }) +
    "\n" +
    JSON.stringify({
      type: "assistant",
      uuid: "i-2",
      timestamp: "2026-09-06T10:00:01Z",
      message: { id: "m9", role: "assistant", content: [{ type: "text", text: "imported reply" }] },
    }) +
    "\n";
  r = await respond("POST", "/dsh-oh-my-claude/import", JSON.stringify({ text: "not jsonl" }));
  assert.equal(r.error, "not a Claude Code transcript", "a file with no turn is refused");
  r = await respond("POST", "/dsh-oh-my-claude/import", JSON.stringify({ text: transcript }));
  assert.equal(r.id, "11111111-2222-3333-4444-555555555555", "a free id is kept");
  assert.equal(r.turns, 1);
  const again = await respond(
    "POST",
    "/dsh-oh-my-claude/import",
    JSON.stringify({ text: transcript }),
  );
  assert.notEqual(again.id, r.id, "a second copy takes a fresh id rather than overwriting");
  r = await respond("GET", "/dsh-oh-my-claude/sessions?all=1");
  const row = (r.sessions as { id: string; imported?: boolean }[]).find(
    (x) => x.id === "11111111-2222-3333-4444-555555555555",
  );
  assert.equal(row?.imported, true, "the merged list shows it, marked as imported");
  const file = await respond(
    "GET",
    "/dsh-oh-my-claude/transcript?id=11111111-2222-3333-4444-555555555555",
    undefined,
    true,
  );
  assert.equal(file, transcript, "the download is the file as it sits on disk");
  r = await respond("GET", "/dsh-oh-my-claude/transcript?id=00000000-0000-0000-0000-000000000000");
  assert.equal(r.error, "transcript not found");

  // Rewind prompt list: user prompts of the session's transcript, newest first, by uuid.
  await mkdir(join(tmp, "claude", "projects", projectDirName(cwd)), { recursive: true });
  const rw = `/dsh-oh-my-claude/rewind?session=sid1&cwd=${encodeURIComponent(cwd)}`;
  r = await respond("GET", rw);
  assert.deepEqual(r.prompts, [], "no transcript: empty list");
  const line = (o: object) => JSON.stringify(o) + "\n";
  await writeFile(
    join(tmp, "claude", "projects", projectDirName(cwd), "sid1.jsonl"),
    line({
      type: "user",
      uuid: "u-1",
      timestamp: "2026-09-05T10:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "first prompt" }] },
    }) +
      line({
        type: "assistant",
        uuid: "a-1",
        timestamp: "2026-09-05T10:00:01Z",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "reply" }] },
      }) +
      line({
        type: "user",
        uuid: "u-2",
        timestamp: "2026-09-05T10:01:00Z",
        message: { role: "user", content: [{ type: "text", text: "second prompt" }] },
      }) +
      line({
        type: "assistant",
        uuid: "a-2",
        timestamp: "2026-09-05T10:01:01Z",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: "reply" }] },
      }),
  );
  r = await respond("GET", rw);
  assert.deepEqual(
    r.prompts.map((p: { id: string; text: string }) => [p.id, p.text]),
    [
      ["u-2", "second prompt"],
      ["u-1", "first prompt"],
    ],
  );
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/rewind",
    JSON.stringify({ session: "sid1", uuid: "nope" }),
  );
  assert.equal(r.error, "session and uuid required");

  // A save carries the mtime the tab read. The CLI writes settings.json itself while a tab sits
  // open, and a whole-file write that ignored that would put the file back without its change.
  const userSettings = join(tmp, "claude", "settings.json");
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/settings",
    JSON.stringify({ text: '{"a":1}\n', scope: "user" }),
  );
  assert.ok(r.mtime > 0, "a save with no mtime is unchecked, as before");
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/settings",
    JSON.stringify({ text: '{"a":2}\n', scope: "user", mtime: 1 }),
  );
  assert.match(String(r.error), /changed since it was opened/, "a stale mtime is refused");
  assert.equal(
    JSON.parse(await readFile(userSettings, "utf8")).a,
    1,
    "the refused save left the file alone",
  );
  r = await respond("GET", "/dsh-oh-my-claude/settings");
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/settings",
    JSON.stringify({ text: '{"a":3}\n', scope: "user", mtime: r.mtime }),
  );
  assert.ok(r.mtime > 0, "the mtime the read answered is accepted");
  assert.equal(JSON.parse(await readFile(userSettings, "utf8")).a, 3);
}

// readPickerSettings: the two picker keys out of settings.json, and undefined for anything else.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-picker-test-"));
  const path = join(tmp, "settings.json");
  await writeFile(
    path,
    JSON.stringify({
      model: "opus",
      availableModels: ["opus", "haiku", 7],
      modelPicker: {
        replaceBuiltInOptions: true,
        options: [
          { model: "opus-4-5", label: "Cheap Opus", description: "ignored here" },
          { label: "no model" },
        ],
      },
    }),
  );
  assert.deepEqual(await readPickerSettings(path), {
    availableModels: ["opus", "haiku"],
    options: [{ model: "opus-4-5", label: "Cheap Opus" }],
    replaceBuiltInOptions: true,
  });

  await writeFile(path, JSON.stringify({ model: "opus" }));
  assert.equal(await readPickerSettings(path), undefined, "neither key: no picker settings");

  await writeFile(path, "{ not json");
  assert.equal(await readPickerSettings(path), undefined, "broken JSON never empties the picker");

  assert.equal(await readPickerSettings(join(tmp, "gone.json")), undefined, "missing file");
}

// settingsScopePath names the file each scope writes, and only project and local need a directory.
{
  const user = "/home/user/.claude/settings.json";
  const cwd = "/home/user/Projects/myapp";

  assert.equal(settingsScopePath("user", user, cwd), user);
  assert.equal(settingsScopePath("user", user, null), user, "the user file needs no directory");
  assert.equal(settingsScopePath("managed", user, null), "/etc/claude-code/managed-settings.json");
  assert.equal(settingsScopePath("project", user, cwd), `${cwd}/.claude/settings.json`);
  assert.equal(settingsScopePath("local", user, cwd), `${cwd}/.claude/settings.local.json`);
  assert.equal(settingsScopePath("project", user, null), undefined, "no directory, no path");
  assert.equal(settingsScopePath("local", user, null), undefined, "no directory, no path");
}

// Only the four names the CLI merges are scopes; anything else a browser sends is rejected.
{
  for (const scope of SETTINGS_SCOPES) assert.ok(isSettingsScope(scope));
  assert.equal(isSettingsScope("managed-settings"), false);
  assert.equal(isSettingsScope(""), false);
  assert.equal(isSettingsScope(undefined), false);
  assert.equal(isSettingsScope(null), false);
  assert.equal(isSettingsScope(7), false);
}

// dshSessionsFor flags a subagent-origin session so the archive can drop it: dsh cannot open one
// standalone. Both the dsh id and the derived Claude id resolve to the same flagged entry.
{
  const claudeIdOf = (id: string) => `claude-${id}`;
  const owned = dshSessionsFor(
    [
      { id: "top", cwd: "/w" },
      { id: "sub", cwd: "/w", origin: "subagent" },
    ],
    "/w",
    claudeIdOf,
  );
  assert.equal(owned.get("top")?.subagent, undefined);
  assert.equal(owned.get("sub")?.subagent, true);
  assert.equal(owned.get("claude-sub")?.subagent, true);
}

// slugForDir bounds to one path segment and disambiguates truncated slugs so two long cwds
// sharing a 48-char prefix never collide onto one workspace dir.
{
  assert.equal(slugForDir("/home/me/app"), "home-me-app");
  assert.equal(slugForDir(""), "x");
  const a = "/home/me/projects/really-long-workspace-name-that-goes-past-forty-eight/alpha";
  const b = "/home/me/projects/really-long-workspace-name-that-goes-past-forty-eight/beta";
  assert.notEqual(slugForDir(a), slugForDir(b), "distinct long cwds get distinct slugs");
  assert.equal(slugForDir(a), slugForDir(a), "same input is stable");
}

// openTranscriptOnce under dsh 0.1.5: a session reaches the sidebar only once it is on its
// workspace's list, and dsh validates the attach against the live session (while entered) or
// persistence (which does not list a session flushed a moment ago). Four ways in, one contract:
// the workspace for the cwd gets attachSession(id), and a fresh seed is attached before leave().
{
  const tmp = await mkdtemp(join(tmpdir(), "omc-open-"));
  const cwd = join(tmp, "work");
  await mkdir(cwd, { recursive: true });
  const dir = join(tmp, "projects", projectDirName(cwd));
  await mkdir(dir, { recursive: true });
  const line = (o: object) => JSON.stringify(o) + "\n";
  const id = "0ba11aa4-46c8-4a48-a360-3ab1bdaf4204";
  await writeFile(
    join(dir, `${id}.jsonl`),
    line({
      type: "user",
      uuid: "u-1",
      sessionId: id,
      cwd,
      timestamp: "2026-09-05T10:00:00Z",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    }) +
      line({
        type: "assistant",
        uuid: "a-1",
        sessionId: id,
        cwd,
        timestamp: "2026-09-05T10:00:01Z",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "hello" }] },
      }),
  );
  const run = async (opts: { inStore: boolean; persisted: boolean; archived: boolean }) => {
    let entered = false;
    const calls: string[] = [];
    const attached: { id: string; entered: boolean }[] = [];
    const ws = {
      id: "w1",
      path: cwd,
      title: "work",
      sessionIds: [],
      attachSession: async (sid: string) => void attached.push({ id: sid, entered }),
    };
    let state: { archivedSessionIds: string[] } = {
      archivedSessionIds: opts.archived ? [id] : [],
    };
    // SAFETY: partial fakes; the function reads only these members
    const ctx = {
      sessions: {
        get: () => (opts.inStore ? { id } : undefined),
        prepare: (sid: string, o: { seed: unknown[] }) => (
          calls.push("prepare"),
          { id: sid, seed: o.seed }
        ),
        enter: () => (
          (entered = true),
          calls.push("enter"),
          () => ((entered = false), calls.push("leave"))
        ),
        announce: () => void calls.push("announce"),
        flush: async () => void calls.push("flush"),
      },
      sessionPersistence: { list: async () => (opts.persisted ? [{ id, cwd }] : []) },
    } as any;
    const registry = {
      get archivedSessionIds() {
        return state.archivedSessionIds;
      },
      resolveByPath: async (p: string) => (p === cwd ? ws : undefined),
      create: async () => ws,
      enqueueOperation: <T>(op: () => Promise<T>) => op(),
      requireState: () => state,
      setState: async (next: { archivedSessionIds: string[] }) => void (state = next),
    } as any;
    const out = await openTranscriptOnce(ctx, [dir], cwd, id, (x) => x, registry);
    return { out, calls, attached, state };
  };

  // Fresh transcript: seeded, and attached while still entered so dsh reads the live header.
  let r = await run({ inStore: false, persisted: false, archived: false });
  assert.equal(r.out.existed, false);
  assert.deepEqual(r.calls, ["prepare", "enter", "announce", "flush", "leave"]);
  assert.deepEqual(r.attached, [{ id, entered: true }], "attached before leave()");
  // Already in the store ("Show"): no seed, still attached.
  r = await run({ inStore: true, persisted: true, archived: false });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.attached, [{ id, entered: false }]);
  // Persisted but unloaded after a restart: the owned branch attaches too.
  r = await run({ inStore: false, persisted: true, archived: false });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.calls, [], "no second seed for a session dsh already holds");
  assert.deepEqual(r.attached, [{ id, entered: false }]);
  // Archived: unarchived through the registry state, then attached.
  r = await run({ inStore: false, persisted: true, archived: true });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.state.archivedSessionIds, []);
  assert.deepEqual(r.attached, [{ id, entered: false }]);
}

console.log("sessions ok");
