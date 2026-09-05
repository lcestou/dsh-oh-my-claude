// Offline self-check: node src/sessions.test.js. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeBox, registerSessionRoutes } from "./sessions.js";

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
  });
  assert.ok(handler);

  const respond = async (method: string, url: string) => {
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
    const fakeReq = { method, url, on: () => {}, destroy: () => {} } as any;
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
}

console.log("sessions ok");
