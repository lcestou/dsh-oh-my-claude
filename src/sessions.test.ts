// Offline self-check: node src/sessions.test.js. No CLI, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dshSessionsFor,
  openTranscriptOnce,
  probeBox,
  readPickerSettings,
  readRemoteWorkspaces,
  readSshBoxes,
  syncRemoteWorkspaces,
  registerSessionRoutes,
  withoutSubagents,
  slugForDir,
  settingsScopePath,
  isSettingsScope,
  SETTINGS_SCOPES,
  SSH_TRANSCRIPT_LISTER,
  readHints,
} from "./sessions.js";
import { projectDirName } from "./adapter.js";
import type {
  FallbackRecord,
  LiveTurn,
  McpStatusReply,
  PermissionReadoutReply,
} from "./adapter.js";
import type { InstructionFile } from "./instructions.js";
import type { TranscriptListItem } from "./transcript.js";

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
  // Two remote workspaces: the placeholder dirs dsh stores, and the real paths on their boxes.
  const localWorkspace = join(tmp, "remote-workspaces", "wsbox__app");
  const sshWorkspace = join(tmp, "remote-workspaces", "sshbox__app");
  const remoteWorkspacesPath = join(tmp, "remote-workspaces.json");
  await writeFile(
    remoteWorkspacesPath,
    JSON.stringify([
      {
        name: "app",
        host: "wsbox",
        remoteCwd: "/srv/app",
        path: localWorkspace,
        workspaceId: "w-ws",
      },
      {
        name: "far",
        host: "sshbox",
        remoteCwd: "/srv/far",
        path: sshWorkspace,
        workspaceId: "w-ssh",
      },
    ]),
    "utf8",
  );
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
        sessionPersistence: {
          list: async () => [
            { id: "sid1", cwd: "/work/app" },
            { id: "sid2", cwd: localWorkspace },
            { id: "sid3", cwd: sshWorkspace },
          ],
        },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    remoteWorkspacesPath,
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
    // The workspace's box, found by hostname. `wsbox` is deliberately mounted without an sshHost so
    // the reads below stay offline; `sshbox` carries one, which is what the refusals hang on.
    instanceForHost: (host) =>
      host === "wsbox"
        ? { configDir: join(tmp, "wsbox") }
        : { configDir: join(tmp, "box"), sshHost: host },
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
  const userFiles = async (at: string, provider: string): Promise<string[]> => {
    const reply = await respond(
      "GET",
      `/dsh-oh-my-claude/instructions?cwd=${encodeURIComponent(at)}&provider=${provider}`,
    );
    return (reply.files as InstructionFile[]).filter((f) => f.kind === "User").map((f) => f.path);
  };
  assert.deepEqual(
    await userFiles(cwd, "claude-code-other"),
    [join(tmp, "other", "CLAUDE.md")],
    "the instructions list reads the named box's user file",
  );
  assert.deepEqual(
    await userFiles(cwd, "claude-code-gone"),
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

  // A remote workspace's files are on its box under the real remote path, whichever model the
  // session runs. Every cwd-scoped read follows the workspace, not the `?provider=` beside it:
  // before this, a session on a remote workspace listed this PC's memories and CLAUDE.md files,
  // under a project dir slugged from the empty placeholder directory.
  const wsMem = `/dsh-oh-my-claude/memory?cwd=${encodeURIComponent(localWorkspace)}`;
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/memory",
    JSON.stringify({
      cwd: localWorkspace,
      name: "w.md",
      text: "---\ndescription: on the box\n---\nW",
    }),
  );
  assert.equal(r.ok, true);
  assert.equal(
    await readFile(
      join(tmp, "wsbox", "projects", projectDirName("/srv/app"), "memory", "w.md"),
      "utf8",
    ),
    "---\ndescription: on the box\n---\nW\n",
    "the write lands on the workspace's box, under the remote path",
  );
  r = await respond("GET", `${wsMem}&provider=claude-code-other`);
  assert.deepEqual(
    (r.files as { name: string }[]).map((f) => f.name),
    ["w.md"],
    "another model selected does not move the workspace's memories",
  );
  await mkdir(join(tmp, "wsbox"), { recursive: true });
  await writeFile(join(tmp, "wsbox", "CLAUDE.md"), "# ws box\n");
  assert.deepEqual(
    await userFiles(localWorkspace, "claude-code-other"),
    [join(tmp, "wsbox", "CLAUDE.md")],
    "the instructions list reads the workspace box's user file, not the selected model's",
  );
  r = await respond(
    "GET",
    `/dsh-oh-my-claude/diagnostics?cwd=${encodeURIComponent(localWorkspace)}`,
  );
  assert.equal(r.runtime.configDir, join(tmp, "wsbox"), "diagnostics report the workspace's box");

  // And a mutation for a workspace on a real ssh box is refused the same way a session on that
  // box's model is: without the cwd check it would have run the verb here, against a placeholder.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/plugins/toggle",
    JSON.stringify({ session: "sid3", scope: "user", key: "p@m" }),
  );
  assert.equal(
    r.error,
    "plugin changes do not reach an SSH box yet",
    "a remote workspace refuses a plugin change with no provider named at all",
  );
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

type RouteReply = { status: number; body: Record<string, any> };

/**
 * Drives one route handler with a fake req/res pair and hands back the status beside the parsed
 * body. The status is half of what the route tests assert: a 400, a 404 and a 409 all carry an
 * `error`, so a test that reads the text alone passes on the wrong one. Takes a getter rather than
 * the handler, because every block below registers its routes twice - once without the bag entry to
 * prove the 404, once with it - and the second registration replaces the handler the first captured.
 */
const responder =
  (handler: () => ((req: any, res: any) => void) | undefined) =>
  async (method: string, url: string, body?: string): Promise<RouteReply> => {
    const resChunks: Buffer[] = [];
    let status = 0;
    // SAFETY: partial fake for tests
    const fakeRes = {
      writeHead: (s: number, _h: Record<string, string>) => {
        status = s;
      },
      end: (b: Buffer | string) => {
        if (typeof b === "string") resChunks.push(Buffer.from(b));
        else resChunks.push(b);
      },
    } as any;
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
    await handler()!(fakeReq, fakeRes);
    return { status, body: JSON.parse(Buffer.concat(resChunks).toString("utf8")) };
  };

// The steer card's routes: GET /side-questions carries the waiting steers, and POST /steer-edit
// validates its body and passes the edit (or, with no text, the removal) through.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-steer-edit-test-"));
  let handler: ((req: any, res: any) => void) | undefined;
  const calls: Array<{ sid: string; id: string; text: string | null }> = [];
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
        sessionPersistence: { list: async () => [] },
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
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    steersFor: (sid: string) => (sid === "s1" ? [{ id: "m1", text: "first", at: 1 }] : []),
    editSteer: async (sid: string, id: string, text: string | null) => {
      calls.push({ sid, id, text });
      return id === "late"
        ? { ok: false as const, reason: "sent" as const }
        : { ok: true as const };
    },
  });
  assert.ok(handler);
  const respond = responder(() => handler);

  let r = await respond("GET", "/dsh-oh-my-claude/side-questions?session=s1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.steers, [{ id: "m1", text: "first", at: 1 }]);
  r = await respond("GET", "/dsh-oh-my-claude/side-questions?session=s2");
  assert.deepEqual(r.body.steers, []);

  r = await respond("POST", "/dsh-oh-my-claude/steer-edit", JSON.stringify({ id: "m1" }));
  assert.equal(r.status, 400);
  r = await respond("POST", "/dsh-oh-my-claude/steer-edit", JSON.stringify({ session: "s1" }));
  assert.equal(r.status, 400);
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/steer-edit",
    JSON.stringify({ session: "s1", id: "m1", text: "   " }),
  );
  assert.equal(r.status, 400, "blank text is refused, not treated as a removal");
  assert.equal(calls.length, 0);

  r = await respond(
    "POST",
    "/dsh-oh-my-claude/steer-edit",
    JSON.stringify({ session: "s1", id: "m1", text: "second" }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1), { sid: "s1", id: "m1", text: "second" });
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/steer-edit",
    JSON.stringify({ session: "s1", id: "m1" }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1), { sid: "s1", id: "m1", text: null }, "no text is a removal");
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/steer-edit",
    JSON.stringify({ session: "s1", id: "late", text: "x" }),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, "sent");
}

// POST /side-questions: 400 when session or question is missing, 404 when askAside is absent,
// and 200 that proves the callback received the parsed body.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-side-question-test-"));
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
        sessionPersistence: { list: async () => [] },
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
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
  });
  assert.ok(handler);

  const respond = responder(() => handler);

  // 404: askAside is absent from the bag.
  let r = await respond(
    "POST",
    "/dsh-oh-my-claude/side-questions",
    JSON.stringify({ session: "s", question: "q" }),
  );
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not found");

  // Now register with askAside and sideQuestions in place.
  const ring = new Map<string, any[]>();
  let received: { session: string; question: string; withDiff: boolean; path: string } | undefined;
  const askAside = async (
    sid: string,
    question: string,
    seed: { withDiff: boolean; path: string },
  ) => {
    received = { session: sid, question, withDiff: seed.withDiff, path: seed.path };
    ring.set(sid, (ring.get(sid) ?? []).concat([{ id: "a1", question, pending: false }]));
    return { ok: true };
  };
  // Re-register with the callbacks; registerSessionRoutes is called once per ctx but we pass a new one.
  // SAFETY: partial fake for tests
  const ctx2 = {
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
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx2, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    askAside,
    sideQuestions: ring,
  });

  // 400: missing session.
  r = await respond("POST", "/dsh-oh-my-claude/side-questions", JSON.stringify({ question: "q" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session and question required");

  // 400: missing question.
  r = await respond("POST", "/dsh-oh-my-claude/side-questions", JSON.stringify({ session: "s" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session and question required");

  // 400: a JSON object where a string belongs. Coerced with String() it would read
  // "[object Object]", pass the non-empty check and reach the ring as a question nobody wrote.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/side-questions",
    JSON.stringify({ session: {}, question: ["a", "b"] }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session and question required");

  // 200: valid body; the callback received session, trimmed question, withDiff, and path.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/side-questions",
    JSON.stringify({
      session: "sid1",
      question: "  what changed?  ",
      withDiff: true,
      path: "a.ts",
    }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(received?.session, "sid1");
  assert.equal(received?.question, "what changed?");
  assert.equal(received?.withDiff, true);
  assert.equal(received?.path, "a.ts");
  assert.equal(ring.get("sid1")?.[0]?.question, "what changed?");

  // What askAside was handed since the last look, clearing as it reads. A plain re-read would not
  // do: assigning `received = undefined` narrows it for the rest of the block, and the compiler has
  // no way to know the next request writes it again from inside the callback.
  const took = () => {
    const seen = received;
    received = undefined;
    return seen;
  };

  // A recap is asked once per session however many tabs notice the same return. The second post
  // answers ok so the tab that lost has nothing to report, but it never reaches askAside.
  took();
  const recap = JSON.stringify({ session: "sid2", question: "recap", recap: true });
  r = await respond("POST", "/dsh-oh-my-claude/side-questions", recap);
  assert.equal(r.body.duplicate, undefined, "the first tab's recap goes out");
  assert.equal(took()?.session, "sid2");
  r = await respond("POST", "/dsh-oh-my-claude/side-questions", recap);
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true, "the second tab's copy is dropped");
  assert.equal(took(), undefined, "and never reaches askAside");

  // Another session is another return: the guard is per session, not a lock on the feature.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/side-questions",
    JSON.stringify({ session: "sid3", question: "recap", recap: true }),
  );
  assert.equal(r.body.duplicate, undefined);
  assert.equal(took()?.session, "sid3");

  // Only recaps are deduplicated. A question someone typed twice was meant twice.
  const typed = JSON.stringify({ session: "sid2", question: "again?" });
  await respond("POST", "/dsh-oh-my-claude/side-questions", typed);
  took();
  r = await respond("POST", "/dsh-oh-my-claude/side-questions", typed);
  assert.equal(r.body.duplicate, undefined);
  assert.equal(took()?.question, "again?", "a typed repeat goes out both times");
  console.log("ask-route ok");
}

// GET /permissions: 400 when session is missing, 404 when permissionReadout is absent,
// and 200 that returns both lists with decoded content.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-permissions-test-"));
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
        sessionPersistence: { list: async () => [] },
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
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
  });
  assert.ok(handler);

  const respond = responder(() => handler);

  // 404: permissionReadout is absent from the bag.
  let r = await respond("GET", "/dsh-oh-my-claude/permissions?session=sid1");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "permission readout not available");

  // Now register with permissionReadout in place.
  const permissionReadout = async (sid: string): Promise<PermissionReadoutReply> => ({
    ok: true,
    rules: [{ behavior: "allow", source: "project", rule: "ReadFile", text: "Allow reading" }],
    directories: [{ path: "/home/user/proj", source: "workspace" }],
    managedOnly: false,
    hooks: [{ event: "PreToolUse", matcher: "Bash", source: "", text: `Before bash in ${sid}` }],
  });
  // Re-register with the callback; registerSessionRoutes is called once per ctx but we pass a new one.
  // SAFETY: partial fake for tests
  const ctx2 = {
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
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx2, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    permissionReadout,
  });

  // 400: missing session.
  r = await respond("GET", "/dsh-oh-my-claude/permissions");
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session param required");

  // 200: valid request; the callback returned both lists.
  r = await respond("GET", "/dsh-oh-my-claude/permissions?session=sid1");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.rules.length, 1);
  assert.equal(r.body.rules[0].behavior, "allow");
  assert.equal(r.body.directories.length, 1);
  assert.equal(r.body.managedOnly, false);
  assert.equal(r.body.hooks.length, 1);
  assert.equal(r.body.hooks[0].event, "PreToolUse");
  console.log("permissions-route ok");
}

// GET /live-turn: `{}` when no turn is running; with a turn parked on a dsh tool, the tool's name
// and how long the relay has been out, so the status row can say what the turn is waiting on.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-live-turn-test-"));
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
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  const liveTurn = new Map<string, LiveTurn>([
    ["waiting", { at: 1, output: 120, tool: true, relay: { name: "bash", at: Date.now() - 5000 } }],
    ["writing", { at: 1, output: 40 }],
  ]);
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    liveTurn,
  });
  assert.ok(handler);
  const respond = responder(() => handler);

  let r = await respond("GET", "/dsh-oh-my-claude/live-turn");
  assert.equal(r.status, 400, "no session param");

  r = await respond("GET", "/dsh-oh-my-claude/live-turn?session=nobody");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {}, "no turn running: an empty reply");

  r = await respond("GET", "/dsh-oh-my-claude/live-turn?session=waiting");
  assert.equal(r.status, 200);
  assert.equal(r.body.tokens, 120);
  assert.equal(r.body.tool, true);
  assert.equal(r.body.relayName, "bash", "the dsh tool the turn is parked on");
  assert.ok(
    r.body.relayMs >= 5000 && r.body.relayMs < 6000,
    `how long the relay has been out, got ${r.body.relayMs}`,
  );

  r = await respond("GET", "/dsh-oh-my-claude/live-turn?session=writing");
  assert.equal(r.status, 200);
  assert.equal(r.body.tokens, 40);
  assert.equal(r.body.relayName, undefined, "no relay out: no name");
  assert.equal(r.body.relayMs, undefined, "and no age");
  console.log("live-turn-route ok");
}

// POST /mcp-servers/ask: 400 when session or name is missing, 404 when mcp.ask is absent,
// and 200 that proves the callback received session, name and the boolean.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-mcp-ask-test-"));
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
        sessionPersistence: { list: async () => [] },
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
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
  });
  assert.ok(handler);

  const respond = responder(() => handler);

  // 404: mcp is absent from the bag.
  let r = await respond(
    "POST",
    "/dsh-oh-my-claude/mcp-servers/ask",
    JSON.stringify({ session: "s", name: "n", ask: true }),
  );
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not found");

  // Now register with mcp.ask in place.
  let receivedMcpAsk: { session: string; name: string; ask: boolean } | undefined;
  const mcp = {
    status: async (): Promise<McpStatusReply> => ({ ok: true, servers: [] }),
    reconnect: async () => ({ ok: true }),
    ask: async (sid: string, name: string, ask: boolean) => {
      receivedMcpAsk = { session: sid, name, ask };
      return { ok: true };
    },
    authenticate: async () => ({ ok: true }),
  };
  // Re-register with the callback; registerSessionRoutes is called once per ctx but we pass a new one.
  // SAFETY: partial fake for tests
  const ctx2 = {
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
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx2, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    mcp,
  });

  // 400: missing session.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/mcp-servers/ask",
    JSON.stringify({ name: "n", ask: true }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session and name required");

  // 400: missing name.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/mcp-servers/ask",
    JSON.stringify({ session: "s", ask: true }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "session and name required");

  // 200: valid body with ask true; the callback received session, name and true.
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/mcp-servers/ask",
    JSON.stringify({ session: "sid1", name: "my-server", ask: true }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(receivedMcpAsk?.session, "sid1");
  assert.equal(receivedMcpAsk?.name, "my-server");
  assert.equal(receivedMcpAsk?.ask, true);

  // 200: valid body with ask false (missing asks defaults to false per the side-questions pattern).
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/mcp-servers/ask",
    JSON.stringify({ session: "sid2", name: "other" }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(receivedMcpAsk?.session, "sid2");
  assert.equal(receivedMcpAsk?.name, "other");
  assert.equal(receivedMcpAsk?.ask, false);

  console.log("mcp-ask-route ok");
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

  await writeFile(path, JSON.stringify({ maxEffortLevel: "high" }));
  assert.deepEqual(
    await readPickerSettings(path),
    { options: [], replaceBuiltInOptions: false, maxEffortLevel: "high" },
    "a lone maxEffortLevel yields a picker with the cap",
  );

  await writeFile(
    path,
    JSON.stringify({ modelSettings: { "opus-4-5": { maxEffortLevel: "low" } } }),
  );
  assert.deepEqual(
    await readPickerSettings(path),
    { options: [], replaceBuiltInOptions: false, modelEffortCaps: { "opus-4-5": "low" } },
    "a lone modelSettings cap yields per-model caps",
  );

  await writeFile(path, JSON.stringify({ availableModels: ["opus"], maxEffortLevel: "banana" }));
  assert.deepEqual(
    await readPickerSettings(path),
    { options: [], replaceBuiltInOptions: false, availableModels: ["opus"] },
    "an out-of-enum cap is dropped, the rest stays",
  );
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

// dshSessionsFor reads dsh 0.1.5's list() snapshots, which wrap the header, as well as the bare
// headers older dsh returned. Under 0.1.5 the bare read found nothing, so no archived row was ever
// marked as dsh's own: Open re-seeded a session dsh already held, and archive/unarchive never applied.
{
  const owned = dshSessionsFor(
    [{ header: { id: "s-new", cwd: "/w" } }, { id: "s-old", cwd: "/w" }],
    "/w",
    (id) => id,
    new Set(["s-new"]),
  );
  assert.deepEqual(owned.get("s-new"), { id: "s-new", archived: true }, "snapshot shape is read");
  assert.deepEqual(owned.get("s-old"), { id: "s-old", archived: false }, "bare header still read");
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
  // Every listing drops it, not just this cwd's: the all-boxes view used to keep the row, whose
  // Show answered "subagent Sessions require their durable parent address".
  assert.deepEqual(
    withoutSubagents([
      { id: "a", dsh: owned.get("top") },
      { id: "b", dsh: owned.get("sub") },
      { id: "c" },
    ]),
    [{ id: "a", dsh: { id: "top", archived: false } }, { id: "c" }],
  );
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
  const run = async (opts: {
    inStore: boolean;
    persisted: boolean;
    archived: boolean;
    /** dsh's id for the persisted session when it differs from the transcript's. */
    dshId?: string;
  }) => {
    const dshId = opts.dshId ?? id;
    const calls: string[] = [];
    const attached: { id: string; events: number }[] = [];
    let written: { header: Record<string, unknown>; events: unknown[] } | undefined;
    const ws = {
      id: "w1",
      path: cwd,
      title: "work",
      sessionIds: [],
      attachSession: async (sid: string) =>
        void attached.push({ id: sid, events: written?.events.length ?? 0 }),
    };
    let state: { archivedSessionIds: string[] } = {
      archivedSessionIds: opts.archived ? [dshId] : [],
    };
    // SAFETY: partial fakes; the function reads only these members
    const ctx = {
      sessions: {
        get: () => (opts.inStore ? { id } : undefined),
      },
      sessionPersistence: {
        list: async () => (opts.persisted ? [{ header: { id: dshId, cwd } }] : []),
        create: async (header: Record<string, unknown>) => {
          calls.push("create");
          written = { header, events: [] };
          return {
            append: async (events: unknown[]) => {
              calls.push("append");
              written?.events.push(...events);
            },
            flush: async () => void calls.push("flush"),
            close: async () => void calls.push("close"),
          };
        },
      },
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
    const out = await openTranscriptOnce(
      ctx,
      [dir],
      cwd,
      id,
      (x) => (x === dshId ? id : x),
      registry,
    );
    return { out, calls, attached, state, written };
  };

  // Fresh transcript: the seed reaches storage through a persistence write handle, and the
  // workspace attach names a session whose log is already on disk.
  let r = await run({ inStore: false, persisted: false, archived: false });
  assert.equal(r.out.existed, false);
  assert.deepEqual(r.calls, ["create", "append", "flush", "close"]);
  assert.equal(r.written?.header.id, id);
  assert.equal(r.written?.header.cwd, cwd);
  assert.equal(r.written?.header.isSeeded, false);
  assert.equal(r.written?.events.length, r.out.events, "every seed event was appended");
  assert.ok((r.out.events ?? 0) > 0, "the transcript's turn produced events");
  assert.deepEqual(
    r.attached,
    [{ id, events: r.out.events }],
    "attached after the log was written",
  );
  // Already in the store ("Show"): no seed, still attached.
  r = await run({ inStore: true, persisted: true, archived: false });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.attached, [{ id, events: 0 }]);
  // Archived while the store still holds it: the early return used to skip the unarchive, and the
  // client hides archived sessions, so Restore opened nothing.
  r = await run({ inStore: true, persisted: true, archived: true });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.state.archivedSessionIds, []);
  assert.deepEqual(r.attached, [{ id, events: 0 }]);
  // Persisted but unloaded after a restart: the owned branch attaches too.
  r = await run({ inStore: false, persisted: true, archived: false });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.calls, [], "no second seed for a session dsh already holds");
  assert.deepEqual(r.attached, [{ id, events: 0 }]);
  // Archived: unarchived through the registry state, then attached.
  r = await run({ inStore: false, persisted: true, archived: true });
  assert.equal(r.out.existed, true);
  assert.deepEqual(r.state.archivedSessionIds, []);
  assert.deepEqual(r.attached, [{ id, events: 0 }]);
  // A session the plugin started: the row carries the transcript's id, dsh knows its own. The
  // attach must name dsh's, or dsh answers "session persistence holds no such session".
  const dshId = "d5h00000-0000-4000-8000-000000000001";
  r = await run({ inStore: false, persisted: true, archived: true, dshId });
  assert.equal(r.out.id, dshId);
  assert.deepEqual(r.attached, [{ id: dshId, events: 0 }], "attached under dsh's id");
}

// The two on-disk lists the panel reads at boot, and how each treats a file it does not like. They
// differ on purpose: a bad SSH box entry fails the whole file (a half-applied roster would mount a
// box under the wrong name), while a bad remote-workspace entry is dropped and the rest still load
// (one broken redirect must not take every other workspace's sessions off its box). Neither may
// throw: both are read before anything is on screen, and a throw there is a blank panel.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-readers-test-"));
  const write = async (name: string, text: string) => {
    const path = join(tmp, name);
    await writeFile(path, text, "utf8");
    return path;
  };

  const boxes = await readSshBoxes(
    await write("boxes.json", JSON.stringify([{ name: "box1", host: "host1" }])),
  );
  assert.deepEqual(boxes, [{ name: "box1", host: "host1" }]);
  assert.deepEqual(
    await readSshBoxes(
      await write(
        "boxes-bad.json",
        JSON.stringify([{ name: "good", host: "host1" }, { host: "host2" }]),
      ),
    ),
    [],
    "an entry with no name fails the file, rather than mounting the boxes around it",
  );
  assert.deepEqual(await readSshBoxes(await write("boxes-broken.json", "{ not json")), []);
  assert.deepEqual(
    await readSshBoxes(join(tmp, "gone.json")),
    [],
    "never added: no boxes, no throw",
  );

  const ws = (name: string, extra: Record<string, string> = {}) => ({
    name,
    host: "box1",
    remoteCwd: `/srv/${name}`,
    path: `/local/${name}`,
    workspaceId: `ws-${name}`,
    ...extra,
  });
  assert.deepEqual(
    await readRemoteWorkspaces(await write("ws.json", JSON.stringify([ws("app")]))),
    [ws("app")],
  );
  const partial = { ...ws("bad"), workspaceId: "" };
  assert.deepEqual(
    (
      await readRemoteWorkspaces(
        await write("ws-partial.json", JSON.stringify([ws("good"), partial, ws("also-good")])),
      )
    ).map((w) => w.name),
    ["good", "also-good"],
    "an entry with no workspace id is dropped; the workspaces beside it still redirect",
  );
  assert.deepEqual(await readRemoteWorkspaces(await write("ws-broken.json", "{ broken")), []);
  assert.deepEqual(await readRemoteWorkspaces(join(tmp, "gone.json")), []);
}

// The lister that runs on an SSH box, run here against a fake home. It is a string of JavaScript
// rather than an import, so nothing else type-checks it and nothing else notices when it drifts
// from `listTranscripts`. Both must survive a transcript whose first prompt is one enormous line.
{
  const home = await mkdtemp(join(tmpdir(), "dsh-oh-my-claude-ssh-home-"));
  const proj = join(home, ".claude", "projects", "-proj-app");
  await mkdir(proj, { recursive: true });
  const line = (o: unknown) => JSON.stringify(o) + "\n";
  const small = "aaaaaaaa-1111-4111-8111-111111111111";
  const huge = "bbbbbbbb-2222-4222-8222-222222222222";
  await writeFile(
    join(proj, `${small}.jsonl`),
    line({ type: "user", cwd: "/proj/app", message: { role: "user", content: "fix the widget" } }),
  );
  await writeFile(
    join(proj, `${huge}.jsonl`),
    line({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", data: "A".repeat(400 * 1024) } },
          { type: "text", text: "what is in this image" },
        ],
      },
    }),
  );
  // Run by whatever runtime runs this suite; a box runs it under node. The script sticks to the
  // CommonJS subset both accept, which is the point of checking it here rather than over ssh.
  const out = execFileSync(process.execPath, ["-e", SSH_TRANSCRIPT_LISTER], {
    env: { ...process.env, HOME: home },
    maxBuffer: 1 << 24,
  }).toString();
  // SAFETY: the script writes `JSON.stringify` of the array it built; a parse failure is the
  // failure this check is for.
  const rows = JSON.parse(out) as TranscriptListItem[];
  assert.deepEqual(
    rows.map((r) => r.id).toSorted(),
    [small, huge].toSorted(),
    "a first prompt past the 256 KB head still lists",
  );
  const one = rows.find((r) => r.id === small);
  assert.ok(one);
  assert.equal(one.title, "fix the widget");
  assert.equal(one.cwd, "/proj/app");
  assert.equal(one.turns, 1);
  const big = rows.find((r) => r.id === huge);
  assert.ok(big);
  assert.equal(big.title, "what is in this image");
  assert.equal(big.turns, 1);
}

// The remote-workspace file follows dsh's registry. The sidebar's trash deletes a workspace in the
// registry and never tells this plugin, so a row whose id the registry no longer has is dropped on
// the next read: gone from the answer, from the file, and its placeholder dir with it. Without a
// registry nothing is dropped, since "cannot ask" is not "deleted".
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-rws-sync-test-"));
  const kept = join(tmp, "remote-workspaces", "box__kept");
  const ghost = join(tmp, "remote-workspaces", "box__ghost");
  await mkdir(kept, { recursive: true });
  await mkdir(ghost, { recursive: true });
  const rows = [
    { name: "kept", host: "box", remoteCwd: "/srv/kept", path: kept, workspaceId: "w-kept" },
    { name: "ghost", host: "box", remoteCwd: "/srv/ghost", path: ghost, workspaceId: "w-ghost" },
  ];
  const remoteWorkspacesPath = join(tmp, "remote-workspaces.json");
  await writeFile(remoteWorkspacesPath, JSON.stringify(rows), "utf8");

  // No registry: the rows come back as they are and the file is left alone.
  const blind = await syncRemoteWorkspaces(remoteWorkspacesPath, undefined);
  assert.equal(blind.workspaces.length, 2, "no registry: both rows answered");
  assert.equal(blind.dropped.length, 0, "no registry: nothing dropped");
  assert.equal(JSON.parse(await readFile(remoteWorkspacesPath, "utf8")).length, 2);

  const published: string[][] = [];
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
        sessionPersistence: { list: async () => [] },
        // dsh's registry after a sidebar trash: it knows `w-kept` and nothing else.
        workspaceRegistry: { get: (id: string) => (id === "w-kept" ? { id } : undefined) },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    remoteWorkspacesPath,
    onRemoteWorkspaces: (ws) => {
      published.push(ws.map((w) => w.workspaceId));
    },
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
  });
  assert.ok(handler);
  const respond = responder(() => handler);

  const r = await respond("GET", "/dsh-oh-my-claude/remote-workspaces");
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.workspaces.map((w: { workspaceId: string }) => w.workspaceId),
    ["w-kept"],
    "GET answers only the row the registry still has",
  );
  const onDisk = JSON.parse(await readFile(remoteWorkspacesPath, "utf8"));
  assert.deepEqual(
    onDisk.map((w: { workspaceId: string }) => w.workspaceId),
    ["w-kept"],
    "the ghost row left the file",
  );
  await assert.rejects(access(ghost), "the ghost's placeholder dir is removed");
  await access(kept);
  assert.deepEqual(
    published,
    [["w-kept", "w-ghost"], ["w-kept"]],
    "the redirect map gets the seed, then the reconciled list, and nothing per read",
  );
  console.log("remote-workspace sync ok");
}

// Removing a box removes the remote workspaces pinned to it, through the same deletion the card's
// own Remove does. A row whose dsh delete threw stays whole, file row and placeholder dir both:
// dsh still draws that workspace, and a row dropped under it would be a sidebar entry nothing
// redirects and nothing puts back.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-rws-cascade-test-"));
  const dirOf = (slug: string) => join(tmp, "remote-workspaces", slug);
  const row = (id: string, host: string) => ({
    name: id,
    host,
    remoteCwd: `/srv/${id}`,
    path: dirOf(id),
    workspaceId: id,
  });
  const rows = [row("wa", "hosta"), row("wb1", "hostb"), row("wb2", "hostb")];
  for (const r of rows) await mkdir(r.path, { recursive: true });
  const remoteWorkspacesPath = join(tmp, "remote-workspaces.json");
  const sshBoxesPath = join(tmp, "ssh-boxes.json");
  await writeFile(remoteWorkspacesPath, JSON.stringify(rows), "utf8");
  const boxA = { name: "A", host: "hosta" };
  const boxB = { name: "B", host: "hostb" };
  await writeFile(sshBoxesPath, JSON.stringify([boxA, boxB]), "utf8");

  const deleted: string[] = [];
  const failing = new Set<string>(["wb2"]);
  const mounted: string[][] = [];
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
        sessionPersistence: { list: async () => [] },
        // Every row is a live workspace to dsh; a delete of an id in `failing` throws the way a
        // failed table write does.
        workspaceRegistry: {
          get: (id: string) => ({ id }),
          delete: async (id: string) => {
            deleted.push(id);
            if (failing.has(id)) throw new Error("table write failed");
            return true;
          },
        },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    remoteWorkspacesPath,
    sshBoxesPath,
    onSshBoxes: (boxes) => {
      mounted.push(boxes.map((b) => b.host));
    },
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
  });
  assert.ok(handler);
  const respond = responder(() => handler);
  const idsOnDisk = async () =>
    (await readRemoteWorkspaces(remoteWorkspacesPath)).map((w) => w.workspaceId);

  // Box B goes: wb1 leaves with it, wb2's delete throws so wb2 stays whole, wa is another box's.
  let r = await respond("PUT", "/dsh-oh-my-claude/ssh-boxes", JSON.stringify({ boxes: [boxA] }));
  assert.equal(r.status, 200, "the box list is saved even when one workspace would not go");
  assert.deepEqual(r.body.boxes, [boxA]);
  assert.deepEqual(deleted, ["wb1", "wb2"], "only the removed box's workspaces are deleted in dsh");
  assert.deepEqual(await idsOnDisk(), ["wa", "wb2"], "a row whose delete failed stays in the file");
  await assert.rejects(access(dirOf("wb1")), "the removed workspace's placeholder is gone");
  await access(dirOf("wb2"));
  await access(dirOf("wa"));
  assert.deepEqual(mounted, [["hosta"]], "the mounts are reconciled after the cascade");

  // The same list again removes no box, so it touches no workspace.
  r = await respond("PUT", "/dsh-oh-my-claude/ssh-boxes", JSON.stringify({ boxes: [boxA] }));
  assert.equal(r.status, 200);
  assert.deepEqual(deleted, ["wb1", "wb2"], "no box removed, no workspace deleted");

  // The card's Remove on the stuck row: refused while dsh refuses, gone once dsh lets go.
  r = await respond(
    "DELETE",
    "/dsh-oh-my-claude/remote-workspaces",
    JSON.stringify({ path: dirOf("wb2") }),
  );
  assert.equal(r.status, 502, "a delete dsh refused is an error, not a silent success");
  assert.match(r.body.error, /still in the sidebar/);
  assert.deepEqual(await idsOnDisk(), ["wa", "wb2"]);
  await access(dirOf("wb2"));
  failing.clear();
  r = await respond(
    "DELETE",
    "/dsh-oh-my-claude/remote-workspaces",
    JSON.stringify({ path: dirOf("wb2") }),
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.workspaces.map((w: { workspaceId: string }) => w.workspaceId),
    ["wa"],
  );
  assert.deepEqual(await idsOnDisk(), ["wa"]);
  await assert.rejects(access(dirOf("wb2")));
  console.log("remote-workspace cascade ok");
}

console.log("sessions ok");

// CLI calls made by the routes export CLAUDE_CONFIG_DIR only for a dir that is not the CLI's own
// default: exporting the default moves the CLI's .claude.json into the config dir, a shadow file
// nothing else reads.
{
  const { cliEnvFor } = await import("./sessions.js");
  const { CLAUDE_HOME } = await import("./state.js");
  assert.equal(cliEnvFor(undefined), process.env, "no dir: the process env as is");
  assert.equal(cliEnvFor(CLAUDE_HOME), process.env, "the default dir: nothing exported");
  assert.equal(cliEnvFor("/tmp/omc-other-home").CLAUDE_CONFIG_DIR, "/tmp/omc-other-home");
}

// readHints keeps true and finite non-negative numbers; drops everything else.
{
  const dir = await mkdtemp(join(tmpdir(), "omc-hints-"));
  const hintsPath = join(dir, "hints.json");
  await writeFile(
    hintsPath,
    '{"a": true, "b": false, "n": 3.5, "neg": -1, "s": "x", "inf": 1e999}\n',
  );
  assert.deepStrictEqual(await readHints(hintsPath), { a: true, n: 3.5 });
  const emptyPath = join(dir, "missing.json");
  assert.deepStrictEqual(await readHints(emptyPath), {});
}

// GET /side-questions carries the session's fallback record in the `fallback` field, and a session
// with no record answers null. Mirrors the POST block's fake ctx and route registration.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-fallback-route-test-"));
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
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  const rec: FallbackRecord = {
    sessionId: "sid1",
    kind: "model_refusal_fallback",
    from: "Fable 5.1",
    to: "Opus 4.8",
    direction: "sticky",
    scope: "session",
    category: "cyber",
    at: 1_700_000_000_000,
  };
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: (cwd: string) => [join(tmp, "claude", "projects", projectDirName(cwd))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    sessionFallbacks: new Map([["sid1", rec]]),
  });
  assert.ok(handler);
  const respond = responder(() => handler);

  let r = await respond("GET", "/dsh-oh-my-claude/side-questions?session=sid1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.fallback, rec, "the session's fallback record rides the response");

  r = await respond("GET", "/dsh-oh-my-claude/side-questions?session=other");
  assert.equal(r.status, 200);
  assert.equal(r.body.fallback, null, "a session with no fallback answers null");
  console.log("fallback-route ok");
}

// Skill routes: create validates scope and name and refuses a duplicate; file PUT and remove refuse
// a path the listing does not name and a plugin-scope skill.
{
  const tmp = await mkdtemp(join(tmpdir(), "dsh-skills-edit-test-"));
  const cwd = "/work/app";
  // A plugin skill on disk, so the listing carries a plugin-scope entry the guards must refuse.
  await mkdir(join(tmp, "claude", "plugins"), { recursive: true });
  await writeFile(
    join(tmp, "claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "p@m": [{ installPath: join(tmp, "plug") }] } }),
    "utf8",
  );
  await mkdir(join(tmp, "plug", "skills", "pfoo"), { recursive: true });
  await writeFile(
    join(tmp, "plug", "skills", "pfoo", "SKILL.md"),
    "---\nname: pfoo\ndescription: a plugin skill\n---\nbody\n",
    "utf8",
  );
  const pluginPath = join(tmp, "plug", "skills", "pfoo", "SKILL.md");

  let handler: ((req: any, res: any) => void) | undefined;
  // SAFETY: partial fake for tests
  const ctx = {
    inject: (_deps: string[], cb: (host: any) => void) => {
      cb({
        webServer: {
          register: (r: any) => {
            handler = r.handler as (req: any, res: any) => void;
            return () => {};
          },
        },
        connection: { requestRejection: () => undefined },
        sessions: { get: () => undefined },
        sessionPersistence: { list: async () => [{ id: "s1", cwd }] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: (c: string) => [join(tmp, "claude", "projects", projectDirName(c))],
    projectsDir: [join(tmp, "claude", "projects")],
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath: join(tmp, "boxes.json"),
    importedDir: join(tmp, "imported"),
    instanceFor: () => undefined,
    instanceForHost: () => ({ configDir: join(tmp, "box") }),
    reloadSkills: async () => ({ ok: true, live: true }),
  });
  assert.ok(handler);
  const respond = responder(() => handler);

  // create: a plugin scope is refused
  let r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/create",
    JSON.stringify({ session: "s1", cwd, name: "ok-name", scope: "plugin" }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "scope is user or project");

  // create: a bad name is refused
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/create",
    JSON.stringify({ session: "s1", cwd, name: "../x", scope: "user" }),
  );
  assert.equal(r.status, 400);
  assert.equal(
    r.body.error,
    "A skill name is lowercase letters, digits and hyphens, e.g. my-skill.",
  );

  // create: ok, then the same name again is a 409
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/create",
    JSON.stringify({ session: "s1", cwd, name: "dup", scope: "user", description: "d" }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.path, join(tmp, "claude", "skills", "dup", "SKILL.md"));
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/create",
    JSON.stringify({ session: "s1", cwd, name: "dup", scope: "user" }),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "A skill called dup already exists in user skills.");

  // file PUT: a path the listing does not name is refused
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/skills/file",
    JSON.stringify({ session: "s1", cwd, path: join(tmp, "nope", "SKILL.md"), text: "x" }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "not a listed skill");

  // file PUT: a plugin-scope skill is read-only
  r = await respond(
    "PUT",
    "/dsh-oh-my-claude/skills/file",
    JSON.stringify({ session: "s1", cwd, path: pluginPath, text: "x" }),
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Plugin skills are read-only; edit them where the plugin ships them.");

  // remove: a plugin-scope skill is read-only
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/remove",
    JSON.stringify({ session: "s1", cwd, path: pluginPath }),
  );
  assert.equal(r.status, 403);
  assert.equal(
    r.body.error,
    "Plugin skills are read-only; remove them where the plugin ships them.",
  );

  // remove: an unlisted path is refused
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/remove",
    JSON.stringify({ session: "s1", cwd, path: join(tmp, "nope", "SKILL.md") }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "not a listed skill");

  // remove: the created user skill is deleted, and its SKILL.md is gone from disk
  const dupPath = join(tmp, "claude", "skills", "dup", "SKILL.md");
  r = await respond(
    "POST",
    "/dsh-oh-my-claude/skills/remove",
    JSON.stringify({ session: "s1", cwd, path: dupPath }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(
    await access(dupPath).then(
      () => "exists",
      () => "gone",
    ),
    "gone",
  );
  console.log("skills-routes ok");
}
