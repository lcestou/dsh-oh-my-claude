// IF A PERSON READS IT ON SCREEN, IT GOES THROUGH t().
//
// i18n.test.ts proves every key has English and Chinese. This proves the other half: that no
// on-screen text skips the dictionary. Without it, a new label written straight into JSX ships in
// English to a Chinese dsh and nothing notices until someone looks at the screen.
//
// Blunt on purpose. Each client component file is run through Bun's own TSX transpiler, which turns
// JSX into calls where text children and props are plain string literals, one per line. Any literal
// with letters that sits where a person would read it (JSX text, a ternary among children, an
// aria-label, title, placeholder, alt or label prop) fails the gate unless ALLOWED below names it
// with a reason. Code that writes the DOM by hand (textContent, setAttribute on a label) is checked
// in the source the same way. A false positive costs one ALLOWED line; a false negative costs a
// reader English in a Chinese UI.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The slice of Bun's global this check uses: its TSX transpiler. The suite runs under Bun; the
 *  typecheck does not load Bun's types, so the shape is named here. */
declare const Bun: {
  Transpiler: new (options: {
    loader: "tsx";
    tsconfig: { compilerOptions: { jsx: "react-jsx" } };
  }) => { transformSync(code: string): string };
};

const DIR = fileURLToPath(new URL(".", import.meta.url));

/** Text allowed to reach the screen untranslated, each with the reason it stays as written. */
const ALLOWED = new Map<string, string>([
  ["Oh My Claude", "product name, and dsh's settings nav row is found by it"],
  ["MCP", "protocol name"],
  ["Stdio", "MCP transport identifier the CLI takes"],
  ["SSE", "MCP transport identifier the CLI takes"],
  ["HTTP", "MCP transport identifier the CLI takes"],
  ["settings.json", "file name"],
  ["CLAUDE.md", "file name"],
  ["Claude Code", "product name"],
  ["Headroom", "product name"],
  ["GitHub", "product name"],
  ["Notion", "product name"],
  ["Sentry", "product name"],
  ["Slack", "product name"],
  ["Stripe", "product name"],
  ["Asana", "product name"],
  ["HubSpot", "product name"],
  ["Tailscale", "product name"],
  ["Bash(npm run:*)", "permission-rule syntax example, typed as written"],
]);

/** One untranslated string, where it was found. */
interface Hit {
  file: string;
  line: number;
  text: string;
}

const LITERAL = /"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const PROP = /^\s*(?:"aria-label"|"aria-description"|title|placeholder|alt|label):\s*(.*?),?$/;

/** Whether a literal reads as words a person sees: two letters in a row, and not a code token such
 *  as a data hook, CSS, a path or a URL. */
function looksLikeCopy(text: string): boolean {
  let s = text.trim();
  // A template's `${…}` parts are code; only the words around them are read.
  for (let prev = ""; prev !== s;) {
    prev = s;
    s = s.replace(/\$\{[^{}]*\}/g, " ").trim();
  }
  // A stylesheet written as a string (a rule body in braces) is CSS, not copy.
  if (/\{[^}]*:[^}]*\}/.test(s)) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (ALLOWED.has(s)) return false;
  // Code tokens: identifiers, hooks, CSS, paths, URLs, placeholders-only templates.
  if (/^[\w.:/@#~$-]+$/.test(s) && !/^[A-Z][a-z]+$/.test(s) && !/\s/.test(s)) return false;
  if (/^(https?:|\/|\.\/|~\/|data:|#|var\(|rgba?\(|calc\()/.test(s)) return false;
  if (/^\$\{[^}]*\}$/.test(s)) return false;
  return true;
}

/** One double-quoted or backtick string literal, as a regex source. */
const STR = '("(?:[^"\\\\]|\\\\.)*"|\\x60(?:[^\\x60\\\\]|\\\\.)*\\x60)';
/** A `t(...)` key, a comparison operand, or a string-method argument: literals code reads, not people. */
const CODE_LITERAL = new RegExp(
  `\\bt\\(\\s*${STR}|[!=]==?\\s*${STR}|${STR}\\s*[!=]==?|\\.(?:startsWith|endsWith|includes|indexOf|split|replace|replaceAll|match|test)\\(\\s*${STR}`,
  "g",
);

/** The literals on one transpiled line, after removing the ones only code reads (see CODE_LITERAL).
 *  A line of CSS written as a string yields none. */
function literalsOf(line: string): string[] {
  if (/@keyframes|@media|[a-z-]+:[^;{}"]+;/.test(line)) return [];
  const bare = line.replace(CODE_LITERAL, " ");
  return [...bare.matchAll(LITERAL)].map((m) => m[1] ?? m[2] ?? "");
}

/** Every on-screen literal in one component file, found in Bun's transpiled output. */
function scanJsx(file: string): Hit[] {
  const out = new Bun.Transpiler({
    loader: "tsx",
    tsconfig: { compilerOptions: { jsx: "react-jsx" } },
  }).transformSync(readFileSync(join(DIR, file), "utf8"));
  const hits: Hit[] = [];
  const lines = out.split("\n");
  // Indents of the `children: [` arrays the current line sits inside.
  const open: number[] = [];
  lines.forEach((line, i) => {
    const indent = line.length - line.trimStart().length;
    while (open.length && indent <= open.at(-1)! && /^\s*\]/.test(line)) open.pop();
    const inChildren = open.length > 0 && indent > open.at(-1)!;
    const texts: string[] = [];
    const child = /^\s*children:\s*(.*?),?$/.exec(line);
    if (child && !child[1]!.startsWith("[")) texts.push(...literalsOf(child[1]!));
    const prop = PROP.exec(line);
    if (prop) texts.push(...literalsOf(prop[1]!));
    // Only a direct element of the array is a child; deeper lines are props and handler bodies.
    const direct = inChildren && indent === open.at(-1)! + 2;
    if (direct && !/^\s*(\w+|"[\w-]+"):/.test(line)) texts.push(...literalsOf(line));
    for (const text of texts) if (looksLikeCopy(text)) hits.push({ file, line: i + 1, text });
    if (/children:\s*\[$/.test(line)) open.push(indent);
  });
  return hits;
}

/** Text written into the DOM by hand in any client file: `textContent`, `innerText`, `title` or
 *  `placeholder` assigned a literal, or a label attribute set to one. */
function scanDom(file: string): Hit[] {
  const hits: Hit[] = [];
  readFileSync(join(DIR, file), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const assign = /\.(?:textContent|innerText|title|placeholder)\s*=\s*(["`].*)$/.exec(line);
      const attr = /setAttribute\(\s*"(?:aria-label|title|placeholder|alt)",\s*(["`].*)$/.exec(
        line,
      );
      for (const m of [assign, attr]) {
        if (!m) continue;
        for (const text of literalsOf(m[1]!))
          if (looksLikeCopy(text)) hits.push({ file, line: i + 1, text });
      }
    });
  return hits;
}

const files = readdirSync(DIR).filter(
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$/.test(f),
);
const hits = [
  ...files.filter((f) => f.endsWith(".tsx")).flatMap(scanJsx),
  ...files.flatMap(scanDom),
];

// The scanner itself: a planted English label is caught, a translated one and a hook are not.
{
  const planted = new Bun.Transpiler({
    loader: "tsx",
    tsconfig: { compilerOptions: { jsx: "react-jsx" } },
  })
    .transformSync(
      'const A = () => <div aria-label="Close it" data-omc-x="x">{t("a.b")}<b>Hello there</b>{n ? "two items" : t("c")}{tab === "Memory" && <i />}</div>;',
    )
    .split("\n");
  const found = planted.flatMap((l) => literalsOf(l)).filter(looksLikeCopy);
  assert.ok(found.includes("Close it"), "a literal aria-label is caught");
  assert.ok(found.includes("Hello there"), "JSX text is caught");
  assert.ok(found.includes("two items"), "a literal in a ternary is caught");
  assert.ok(!found.includes("a.b") && !found.includes("x"), "t() keys and hooks are not");
  assert.ok(!found.includes("Memory"), "a comparison operand is not");
}

assert.deepEqual(
  hits.map((h) => `${h.file}:${h.line} ${JSON.stringify(h.text)}`),
  [],
  "on-screen text that skips t(): route it through the dictionary, or add it to ALLOWED with a reason",
);
