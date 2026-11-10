// The plugin config's `customModels`: rows for models neither the Models API nor the CLI's lineup
// lists, such as an alias a local router sends to another model. They ride the same path as
// settings.json's `modelPicker.options` rows, with a window and effort levels of their own.
import { strict as assert } from "node:assert";
import { KNOWN_MODELS, mergeCatalog, resolveModelInfo, withCustomModels } from "./catalog.js";
import { Config } from "./config.js";

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
assert.deepEqual(picker?.options, [
  { model: "deepseek-flash", label: "DeepSeek Flash", contextWindow: 128_000, efforts: ["high"] },
  { model: "bare-alias" },
  // A blank label and a window that is not a positive whole number are dropped; an effort the CLI
  // does not have goes too, and the rest come back in the CLI's order.
  { model: "odd", efforts: ["low", "max"] },
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
console.log("custom models ok");
