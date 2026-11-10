// The plugin config's `customModels`: rows for models neither the Models API nor the CLI's lineup
// lists, such as an alias a local router sends to another model. They ride the same path as
// settings.json's `modelPicker.options` rows, with a window and effort levels of their own.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOWN_MODELS, mergeCatalog, resolveModelInfo, withCustomModels } from "./catalog.js";
import { aliasNamesIn, readPickerSettings } from "../sessions.js";
import { Config } from "./config.js";
import {
  checkCustomModels,
  CUSTOM_MODELS_FILE,
  CUSTOM_MODELS_MAX,
  loadCustomModels,
  parseCustomModels,
  saveCustomModels,
} from "./custom-models.js";

// Nothing configured: the picker settings pass through untouched, undefined included, so a box
// without the key lists exactly what it listed before.
assert.equal(withCustomModels(undefined, []), undefined);
const fromFile = { options: [{ model: "opus-4-5" }], replaceBuiltInOptions: false };
assert.equal(withCustomModels(fromFile, []), fromFile);
assert.deepEqual(Config({}).customModels, [], "the key defaults to no entries");
const parsed = Config({
  customModels: [{ model: "flash", label: "Flash", contextWindow: 64_000 }],
});
assert.deepEqual(
  parsed.customModels.map((m) => [m.model, m.label, m.contextWindow, m.efforts]),
  [["flash", "Flash", 64_000, []]],
  "an entry keeps what it was given; the schema fills in an empty effort list",
);
assert.throws(() => Config({ customModels: [{ label: "no id" }] }), "an entry needs its model id");

const picker = withCustomModels(undefined, [
  { model: " deepseek-flash ", label: "DeepSeek Flash", contextWindow: 128_000, efforts: ["high"] },
  { model: "bare-alias" },
  { model: "   " },
  { model: "odd", label: " ", contextWindow: 0, efforts: ["max", "turbo", "low"] },
]);
// Each row is marked as the plugin's own (`added`), which is what lets the listing tell it from a
// row settings.json wrote out when it follows the router state.
assert.deepEqual(picker?.options, [
  {
    model: "deepseek-flash",
    label: "DeepSeek Flash",
    contextWindow: 128_000,
    efforts: ["high"],
    added: true,
  },
  { model: "bare-alias", added: true },
  // A blank label and a window that is not a positive whole number are dropped; an effort the CLI
  // does not have goes too, and the rest come back in the CLI's order.
  { model: "odd", efforts: ["low", "max"], added: true },
]);
assert.equal(picker?.replaceBuiltInOptions, false, "the built-in lineup stays");

// In the listing: the label as written, or the id; the window as written, or 200,000.
const rows = mergeCatalog([], KNOWN_MODELS, picker);
const row = (id: string) => rows.find((m) => m.id === id);
assert.equal(row("deepseek-flash")?.name, "DeepSeek Flash");
assert.equal(row("deepseek-flash")?.contextWindow, 128_000);
assert.deepEqual(row("deepseek-flash")?.efforts, ["high"]);
assert.equal(row("bare-alias")?.name, "bare-alias");
assert.equal(row("bare-alias")?.contextWindow, 200_000);
assert.ok(row("claude-opus-5"), "every row the catalog had is still there");
// An entry that only renames a model the catalog knows keeps that model's window and efforts.
const renamed = mergeCatalog(
  [],
  KNOWN_MODELS,
  withCustomModels(undefined, [{ model: "claude-opus-4-5", label: "Old Opus", efforts: [] }]),
).find((m) => m.name === "Old Opus");
assert.equal(renamed?.contextWindow, 200_000);
assert.ok((renamed?.efforts.length ?? 0) > 0, "its own effort levels, not none");

// dsh asks for a model's window before it lets a session switch to it. A custom model resolves with
// the one its entry gave; with no entry, an id no catalog knows has none to report.
const resolved = resolveModelInfo("claude-code", "deepseek-flash", rows);
assert.equal(resolved.name, "DeepSeek Flash");
assert.equal(resolved.context?.contextWindow, 128_000);
assert.deepEqual(
  resolved.reasoning?.efforts.map((e) => e.id),
  ["high"],
);
assert.equal(resolveModelInfo("claude-code", "bare-alias", rows).reasoning, undefined);
assert.equal(
  resolveModelInfo("claude-code", "deepseek-flash", mergeCatalog([], KNOWN_MODELS)).context,
  undefined,
  "without its entry the model has no window",
);

// A model named both here and in settings.json takes the plugin's label and window.
const both = withCustomModels(
  {
    options: [{ model: "deepseek-flash", label: "from settings.json" }],
    replaceBuiltInOptions: false,
  },
  [{ model: "deepseek-flash", label: "DeepSeek Flash", contextWindow: 64_000 }],
);
const merged = mergeCatalog([], KNOWN_MODELS, both).filter((m) => m.id === "deepseek-flash");
assert.deepEqual(
  merged.map((m) => [m.name, m.contextWindow]),
  [["DeepSeek Flash", 64_000]],
);

// settings.json's allowlist still has the last word, as it has over the file's own rows.
const allowed = withCustomModels(
  { options: [], replaceBuiltInOptions: false, availableModels: ["opus"] },
  [{ model: "deepseek-flash" }],
);
assert.equal(
  mergeCatalog([], KNOWN_MODELS, allowed).some((m) => m.id === "deepseek-flash"),
  false,
);
// A router that sends a Claude alias to another model names the alias in settings.json
// (`ANTHROPIC_DEFAULT_SONNET_MODEL_NAME`), and the CLI's own row then carries that name. The
// picker keeps it; without it, the row takes the catalog's name as before.
assert.deepEqual(
  aliasNamesIn({
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: " Local Qwen ",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:15721",
  }),
  { sonnet: "Local Qwen" },
);
const routedRow = {
  value: "sonnet",
  displayName: "Local Qwen",
  resolvedModel: "claude-sonnet-5",
  description: "Local llama · lutechi-llm",
  efforts: [],
};
const nameOf = (cliRow: typeof routedRow, names?: Record<string, string>) =>
  mergeCatalog(
    [cliRow],
    KNOWN_MODELS,
    names ? { options: [], replaceBuiltInOptions: false, aliasNames: names } : undefined,
  ).find((m) => m.id === "claude-sonnet-5")?.name;
assert.equal(nameOf(routedRow, { sonnet: "Local Qwen" }), "Local Qwen", "the router's name stays");
assert.equal(nameOf(routedRow), "Claude Sonnet 5", "no name given: the catalog's, as before");
assert.equal(
  nameOf({ ...routedRow, displayName: "Sonnet" }, { sonnet: "Local Qwen" }),
  "Claude Sonnet 5",
  "a row the CLI did not rename keeps the catalog's name",
);
{
  const dir = mkdtempSync(join(tmpdir(), "omc-alias-names-"));
  try {
    const file = join(dir, "settings.json");
    writeFileSync(
      file,
      JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Local Qwen" } }),
    );
    assert.deepEqual((await readPickerSettings(file))?.aliasNames, { sonnet: "Local Qwen" });
    writeFileSync(file, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://x" } }));
    assert.equal(
      await readPickerSettings(file),
      undefined,
      "an env with no names is no picker say",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The list Settings saves. A request body is parsed first: anything that is not a list of entries
// is refused there, before a rule is looked at.
assert.throws(() => parseCustomModels(undefined), "a body with no list clears nothing");
assert.deepEqual(parseCustomModels([]), [], "an empty list is how a box's models are cleared");
assert.throws(() => parseCustomModels("deepseek-flash"));
assert.throws(() => parseCustomModels([{ label: "no id" }]));
assert.throws(() => parseCustomModels([{ model: "x", contextWindow: "big" }]));

// The rules a parse cannot say. Each refusal is the sentence the form shows.
const kept = checkCustomModels([
  { model: " deepseek-flash ", label: " DeepSeek Flash ", contextWindow: 128_000 },
  { model: "bare", label: "  ", efforts: ["turbo", "high"] },
]);
assert.deepEqual(kept, [
  { model: "deepseek-flash", label: "DeepSeek Flash", contextWindow: 128_000 },
  { model: "bare", efforts: ["high"] },
]);
for (const bad of ["", "two words", "-flag", "default", "x".repeat(201)])
  assert.match(String(checkCustomModels([{ model: bad }])), /^A model id is/, `id ${bad}`);
assert.match(String(checkCustomModels([{ model: "a" }, { model: " a" }])), /already in the list/);
assert.match(String(checkCustomModels([{ model: "a", label: "n".repeat(101) }])), /^A name is/);
for (const bad of [999, 10_000_001, 1.5])
  assert.match(
    String(checkCustomModels([{ model: "a", contextWindow: bad }])),
    /^A context window is/,
    `window ${bad}`,
  );
assert.match(
  String(
    checkCustomModels(
      Array.from({ length: CUSTOM_MODELS_MAX + 1 }, (_, i) => ({ model: `m${i}` })),
    ),
  ),
  /at most 50/,
);

// On disk: one list per mount, an empty list drops the mount, and a file that cannot be read as
// lists is no entries at all, so it can never empty or break the picker.
const dir = mkdtempSync(join(tmpdir(), "omc-custom-models-"));
try {
  assert.deepEqual(await loadCustomModels(dir), {}, "no file yet");
  await saveCustomModels(dir, "claude-code", [
    { model: "deepseek-flash", label: "DeepSeek Flash" },
  ]);
  await saveCustomModels(dir, "claude-code-lilly", [{ model: "other" }]);
  assert.deepEqual(await loadCustomModels(dir), {
    "claude-code": [{ model: "deepseek-flash", label: "DeepSeek Flash" }],
    "claude-code-lilly": [{ model: "other" }],
  });
  await saveCustomModels(dir, "claude-code", []);
  assert.deepEqual(Object.keys(await loadCustomModels(dir)), ["claude-code-lilly"]);
  assert.deepEqual(JSON.parse(readFileSync(CUSTOM_MODELS_FILE(dir), "utf8")), {
    "claude-code-lilly": [{ model: "other" }],
  });
  // One mount's list broke a rule (hand-edited): that mount reads empty, the other is untouched.
  writeFileSync(
    CUSTOM_MODELS_FILE(dir),
    JSON.stringify({ a: [{ model: "two words" }], b: [{ model: "fine" }] }),
  );
  assert.deepEqual(await loadCustomModels(dir), { b: [{ model: "fine" }] });
  for (const text of ["{", "[]", '"x"', '{"a":"not a list"}']) {
    writeFileSync(CUSTOM_MODELS_FILE(dir), text);
    assert.deepEqual(await loadCustomModels(dir), {}, `file ${text}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// Resolution reads the rows before the listing's filters: the adapter hands `resolveModelInfo`
// the merge without `availableModels`, so a session already on an excluded model keeps its window.
{
  const filtered = withCustomModels(
    { options: [], replaceBuiltInOptions: false, availableModels: ["opus"] },
    [{ model: "deepseek-flash", contextWindow: 64_000 }],
  );
  const unfiltered = filtered && { ...filtered, availableModels: undefined };
  const all = mergeCatalog([], KNOWN_MODELS, unfiltered);
  assert.equal(
    resolveModelInfo("claude-code", "deepseek-flash", all).context?.contextWindow,
    64_000,
  );
}
console.log("custom models ok");
