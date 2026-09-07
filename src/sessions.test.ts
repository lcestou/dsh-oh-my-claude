// Offline self-check: node src/sessions.test.js. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeBox, readPickerSettings, registerSessionRoutes } from "./sessions.js";

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
        sessions: {},
        sessionPersistence: { list: async () => [] },
        effect: (fn: () => void | (() => void)) => fn(),
      });
    },
  } as any;
  registerSessionRoutes(ctx, {
    log: () => {},
    projectDir: (cwd: string) => join(tmp, "projects", cwd),
    projectsDir: join(tmp, "projects"),
    startedIds: async () => [],
    claudeIdOf: (id: string) => id,
    configDir: join(tmp, "claude"),
    boxesPath,
    rewind: async (sid, uuid, dryRun) => ({ ok: true, dryRun, canRewind: true }),
  });
  assert.ok(handler);

  const respond = async (method: string, url: string, body?: string) => {
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
    return JSON.parse(respBody);
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
  assert.equal(r.error, "cwd must be an absolute path");
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
  assert.equal(r.text, "---\ndescription: fact a\n---\nA");
  r = await respond("DELETE", `${mem}&name=a.md`);
  assert.equal(r.ok, true);
  r = await respond("GET", `${mem}&name=a.md`);
  assert.equal(r.error, "not found");

  // Rewind prompt list: user prompts of the session's transcript, newest first, by uuid.
  const rw = `/dsh-oh-my-claude/rewind?session=sid1&cwd=${encodeURIComponent(cwd)}`;
  r = await respond("GET", rw);
  assert.deepEqual(r.prompts, [], "no transcript: empty list");
  const line = (o: object) => JSON.stringify(o) + "\n";
  await writeFile(
    join(tmp, "projects", cwd, "sid1.jsonl"),
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

console.log("sessions ok");
