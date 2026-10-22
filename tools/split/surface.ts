#!/usr/bin/env bun
/**
 * Prints the plugin's frozen surface, the things the module split must not change, so a
 * diff between two runs of this output is exactly what a chunk changed. Each line is one
 * item prefixed by its section name, sorted within the section, no timestamps, so the
 * output is byte-stable. Compare it with tools/split/baseline.txt. Reads only, writes
 * nothing. Dev tool, deleted when the split is done.
 *
 *   bun tools/split/surface.ts > tools/split/baseline.txt
 *   bun tools/split/surface.ts | diff - tools/split/baseline.txt
 *
 * Sections, in this order: bytes (the size of lib/client.js), export (every export name
 * in lib/server/adapter.d.ts), proto (the adapter's prototype members), hook (every
 * distinct data-omc-* and omc-* string in lib/client.js), route (every distinct path
 * string after ${ROUTE_PREFIX}/ in the .ts files under src/), i18n (every quoted
 * dictionary key in src/client/i18n, printed once even though each appears in both
 * dictionaries), config (the config schema serialized).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ClaudeCodeAdapter, Config } from "../../lib/server/adapter.js";

const ROOT = new URL("../..", import.meta.url).pathname;

/** Prints one sorted section: the section name, then a space, then the item. */
function section(name: string, items: Iterable<string>): void {
  for (const item of [...items].toSorted()) console.log(`${name} ${item}`);
}

/** Export names from the built entry's declaration file: the single-name line shapes the
 *  build emits, plus a brace line, which gives one name per entry inside it. */
function exportNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const direct =
      /^export (?:declare )?(?:const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/.exec(
        line,
      );
    if (direct?.[1]) {
      names.add(direct[1]);
      continue;
    }
    const braces = /^export \{([^}]*)\}/.exec(line);
    if (!braces?.[1]) continue;
    for (const entry of braces[1].split(",")) {
      const name = entry.trim().replace(/^type\s+/, "");
      if (name) names.add(name.includes(" as ") ? name.slice(name.lastIndexOf(" as ") + 4) : name);
    }
  }
  return names;
}

/** Distinct matches of a pattern across the given text. */
function matches(text: string, pattern: RegExp): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    if (match[0]) found.add(match[0]);
  }
  return found;
}

const clientJs = readFileSync(join(ROOT, "lib/client.js"), "utf8");

console.log(`bytes ${statSync(join(ROOT, "lib/client.js")).size}`);

section("export", exportNames(readFileSync(join(ROOT, "lib/server/adapter.d.ts"), "utf8")));

section("proto", Object.getOwnPropertyNames(ClaudeCodeAdapter.prototype));

section("hook", matches(clientJs, /(?:data-)?omc-[a-z0-9-]+/g));

const routes = new Set<string>();
for (const file of readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })) {
  if (!file.endsWith(".ts")) continue;
  const text = readFileSync(join(ROOT, "src", file), "utf8");
  for (const match of text.matchAll(/\$\{ROUTE_PREFIX\}\/([a-z0-9-]+)/g)) {
    if (match[1]) routes.add(match[1]);
  }
}
section("route", routes);

const keys = new Set<string>();
for (const file of readdirSync(join(ROOT, "src/client/i18n")).filter((f) => f.endsWith(".ts"))) {
  const text = readFileSync(join(ROOT, "src/client/i18n", file), "utf8");
  for (const match of text.matchAll(/^\s*"([a-z0-9_]+\.[^"]+)"\s*:/gm)) {
    if (match[1]) keys.add(match[1]);
  }
}
section("i18n", keys);

/** One schema node as schemastery serializes it: a `uid`, and references to other nodes by
 *  uid under `inner`, `list` and `dict`; everything else is data. */
interface SchemaNode {
  uid?: number;
  inner?: number;
  list?: number[];
  dict?: Record<string, number>;
  type?: string;
  meta?: Record<string, string | number | boolean>;
  value?: string | number | boolean;
}

/** The serialized schema with its uids renumbered in order of first appearance. schemastery
 *  numbers every schema it creates from one process-wide counter, so the absolute uids move
 *  whenever a module that builds a schema loads earlier or later; after the split more modules
 *  load before the entry, and the numbers would shift with no change to the schema. The shape
 *  and the order of the refs table are what the baseline pins. */
function renumbered(json: { uid: number; refs: Record<string, SchemaNode> }): string {
  const ids = new Map<number, number>();
  const id = (uid: number): number => {
    const known = ids.get(uid);
    if (known !== undefined) return known;
    ids.set(uid, ids.size + 1);
    return ids.size;
  };
  const refs: Record<string, SchemaNode> = {};
  for (const [key, node] of Object.entries(json.refs)) {
    const copy: SchemaNode = { ...node };
    if (node.uid !== undefined) copy.uid = id(node.uid);
    if (node.inner !== undefined) copy.inner = id(node.inner);
    if (node.list !== undefined) copy.list = node.list.map(id);
    if (node.dict !== undefined)
      copy.dict = Object.fromEntries(Object.entries(node.dict).map(([k, v]) => [k, id(v)]));
    refs[String(id(Number(key)))] = copy;
  }
  return JSON.stringify({ uid: id(json.uid), refs });
}

// Through JSON, the way the schema travels anyway: toJSON's static type is the live Schema class,
// and the serialized form is the {uid, refs} table the renumbering reads.
const serialized: { uid: number; refs: Record<string, SchemaNode> } = JSON.parse(
  JSON.stringify(Config.toJSON()),
);
console.log(`config ${renumbered(serialized)}`);
