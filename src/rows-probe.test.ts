// Offline self-check: bun src/rows-probe.test.ts. The live probe needs a dsh install and runs in
// the plugin at startup; here the log it sends is checked, and the answer when no dsh is around.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { probeRawToolRows, rawRowsLog } from "./rows-probe.js";
import { tempDir } from "./test-tmp.js";

{
  const { header, rows } = rawRowsLog();
  assert.equal(header.version, 3, "the current format, not one dsh would migrate");
  assert.deepEqual(
    rows.map((r) => r.type),
    [
      "turn/start",
      "step/start",
      "user/message",
      "assistant/message",
      "tool/call",
      "tool/result",
      "assistant/message",
      "step/end",
      "turn/end",
    ],
  );
  const announce = rows.findIndex((r) => r.type === "assistant/message");
  const call = rows.findIndex((r) => r.type === "tool/call");
  const settled = rows.findIndex(
    (r) =>
      r.type === "assistant/message" && (r.data as { message: { id: string } }).message.id === "m",
  );
  assert(announce < call, "the announcement sits ahead of the call, which is what dsh 0.1.7 loads");
  assert(call < settled, "the call sits ahead of the settled text message, as rows mode writes it");
}

{
  // No dsh above this path: rows are off, and the reason says what was missing rather than throwing.
  const off = await probeRawToolRows("/nonexistent/omc-probe/lib/bin.js");
  assert.equal(off.ok, false);
  assert.match(off.reason, /catalog not found/);
}

{
  // The plugin runs on Node, which reads a bare path handed to `import()` as a URL: a Windows path
  // fails as the scheme "c:" (#246) and a `#` in a folder name cuts the path short. Bun imports
  // both, so this half runs the read under Node, from a dsh tree whose folder has a `#` in it.
  const root = join(tempDir("omc-catalog-"), "dsh#1");
  const lib = join(root, "node_modules", "@deepseek-ai", "dsh-session-format-catalog", "lib");
  await mkdir(lib, { recursive: true });
  await writeFile(join(lib, "..", "package.json"), '{"type":"module"}');
  await writeFile(
    join(lib, "index.js"),
    "export const sessionFormatCatalog = { currentVersion: 4 };",
  );
  const probe = fileURLToPath(new URL("./rows-probe.ts", import.meta.url));
  const out = spawnSync(
    "node",
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]); console.log(await m.currentLogVersion(process.argv[2]));",
      pathToFileURL(probe).href,
      join(root, "lib", "bin.js"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(out.stdout.trim(), "4", `Node read the catalog through a # folder: ${out.stderr}`);
  await rm(dirname(root), { recursive: true, force: true });
}

{
  // A global npm install starts dsh as `<prefix>/bin/dsh`, a link into the package's own folder.
  // The catalog sits under the link's target, not above the link: the search has to follow it, or
  // the probe misses the catalog and every native tool call is drawn as inline text.
  const base = tempDir("omc-link-");
  const pkg = join(base, "lib", "node_modules", "dsh");
  const lib = join(pkg, "node_modules", "@deepseek-ai", "dsh-session-format-catalog", "lib");
  await mkdir(lib, { recursive: true });
  await mkdir(join(pkg, "lib"), { recursive: true });
  await mkdir(join(base, "bin"), { recursive: true });
  await writeFile(join(pkg, "lib", "cli.js"), "");
  await writeFile(join(lib, "..", "package.json"), '{"type":"module"}');
  await writeFile(
    join(lib, "index.js"),
    "export const sessionFormatCatalog = { currentVersion: 4, createRestore: () => ({ decodeRow() {}, finish() {} }) };",
  );
  await symlink(join(pkg, "lib", "cli.js"), join(base, "bin", "dsh"));
  const linked = await probeRawToolRows(join(base, "bin", "dsh"));
  assert.deepEqual(linked, { ok: true, reason: "" }, "the probe follows the bin link to dsh");
  await rm(base, { recursive: true, force: true });
}

console.log("rows-probe.test: ok");
