// Offline self-check: bun src/mcp-add-remove.test.ts. No CLI, no file, no network.
import assert from "node:assert/strict";
import { buildAddServer, isMcpName, isMcpScope, scopeNeedsCwd } from "./mcp-add-remove.js";

/** The built server of a form that was meant to be accepted; a refusal fails where it happened. */
const built = (out: ReturnType<typeof buildAddServer>) => {
  if ("error" in out) assert.fail(out.error);
  return out;
};

// A name is one argv word: no dash in front, no spaces, nothing the shell or the CLI would read.
{
  for (const ok of ["fs", "my_server", "a-b", "@scope/name", "x1"]) assert.ok(isMcpName(ok), ok);
  for (const bad of ["", "-s", " fs", "a b", "a;b", "a$b", 7, null, undefined])
    assert.equal(isMcpName(bad), false, JSON.stringify(bad));
}

// Only `user` is global; the other two are read from a directory, so the route needs the cwd.
{
  assert.equal(scopeNeedsCwd("user"), false);
  assert.equal(scopeNeedsCwd("local"), true);
  assert.equal(scopeNeedsCwd("project"), true);
  assert.ok(isMcpScope("project"));
  assert.equal(isMcpScope("managed"), false, "the CLI takes it, this form does not offer it");
}

// A stdio server: one argument per line, env only when there is some.
{
  const out = built(
    buildAddServer({
      name: "fs",
      scope: "user",
      transport: "stdio",
      command: "  npx  ",
      args: "-y\n@modelcontextprotocol/server-filesystem\n\n/tmp\n",
      env: "TOKEN=abc\nEMPTY=\n",
    }),
  );
  assert.equal(out.scope, "user");
  assert.deepEqual(out.json, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    env: { TOKEN: "abc", EMPTY: "" },
  });

  const bare = built(
    buildAddServer({ name: "x", scope: "local", transport: "stdio", command: "x" }),
  );
  assert.deepEqual(bare.json, { type: "stdio", command: "x", args: [] }, "no env key when empty");
  assert.deepEqual(
    built(
      buildAddServer({ name: "x", scope: "local", transport: "stdio", command: "x", env: "  " }),
    ).json,
    { type: "stdio", command: "x", args: [] },
    "blank lines are not env",
  );
}

// An http or sse server: an absolute http(s) URL and optional headers.
{
  const out = built(
    buildAddServer({
      name: "api",
      scope: "project",
      transport: "http",
      url: " https://example.com/mcp ",
      headers: "Authorization: Bearer x\nX-Trace: 1",
    }),
  );
  assert.deepEqual(out.json, {
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer x", "X-Trace": "1" },
  });
  assert.deepEqual(
    built(buildAddServer({ name: "s", scope: "user", transport: "sse", url: "http://h/e" })).json,
    {
      type: "sse",
      url: "http://h/e",
    },
  );
}

// Everything the form can get wrong is refused here, not by the CLI at spawn.
{
  const refused = (form: Parameters<typeof buildAddServer>[0], why: string) => {
    const out = buildAddServer(form);
    assert.ok("error" in out, why);
  };
  refused({ scope: "user", transport: "stdio", command: "x" }, "no name");
  refused(
    { name: "-rf", scope: "user", transport: "stdio", command: "x" },
    "a name read as a flag",
  );
  refused({ name: "a", scope: "managed", transport: "stdio", command: "x" }, "a scope not offered");
  refused(
    { name: "a", scope: "user", transport: "grpc", url: "http://h" },
    "a transport that is not one",
  );
  refused({ name: "a", scope: "user", transport: "stdio", command: "   " }, "no command");
  refused({ name: "a", scope: "user", transport: "http", url: "example.com" }, "no scheme");
  refused({ name: "a", scope: "user", transport: "http", url: "javascript:alert(1)" }, "not http");
  refused({ name: "a", scope: "user", transport: "http" }, "no url at all");
  refused(
    { name: "a", scope: "user", transport: "stdio", command: "x", env: "not an assignment" },
    "an env line without =",
  );
  refused(
    { name: "a", scope: "user", transport: "stdio", command: "x", env: "1BAD=x" },
    "an env name a shell would not take",
  );
  refused(
    { name: "a", scope: "user", transport: "http", url: "http://h", headers: "no colon here" },
    "a header line without a colon",
  );
}

console.log("mcp-add-remove ok");
