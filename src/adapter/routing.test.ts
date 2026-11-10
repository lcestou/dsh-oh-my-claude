// Where a mount's Claude Code traffic goes, and what the model listing does about it: the state
// read from the env a router leaves behind, the listing filtered by that state, and the watch
// that notices a router being switched.
import { strict as assert } from "node:assert";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { KNOWN_MODELS, mergeCatalog, resolveModelInfo, withCustomModels } from "./catalog.js";
import { finishReason } from "./turn.js";
import {
  routeEnvIn,
  routeOf,
  routeSignature,
  SETTINGS_SETTLE_MS,
  unwatchSettings,
  watchSettingsIn,
} from "./routing.js";

// What CC Switch 4.0.29 wrote into settings.json `env` with routing on (2026-11-10), the token
// left out. The alias ids stay Claude's; the names say where each really goes.
const ccSwitch = {
  ANTHROPIC_BASE_URL: "http://127.0.0.1:15721",
  ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Local Qwen",
  ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-5-5",
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Local Qwen small",
  ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "lutechi-llm",
};
const routedEnv = routeEnvIn(ccSwitch);
assert.equal(routedEnv.baseUrl, "http://127.0.0.1:15721");
assert.equal(routedEnv.cloud, false);
assert.deepEqual(routedEnv.aliasNames, {
  sonnet: "Local Qwen",
  haiku: "Local Qwen small",
  opus: "lutechi-llm",
});
assert.equal(routeEnvIn({ ANTHROPIC_BASE_URL: "  " }).baseUrl, undefined, "a blank URL is none");
// The CLI's cloud switches: on with any value but the usual words for off.
assert.equal(routeEnvIn({ CLAUDE_CODE_USE_BEDROCK: "1" }).cloud, true);
assert.equal(routeEnvIn({ CLAUDE_CODE_USE_VERTEX: "true" }).cloud, true);
assert.equal(routeEnvIn({ CLAUDE_CODE_USE_FOUNDRY: "0" }).cloud, false);
assert.equal(routeEnvIn({ CLAUDE_CODE_USE_BEDROCK: "false" }).cloud, false);

// The signature moves with the variables that route, and with nothing else.
assert.equal(
  routeSignature(routedEnv),
  routeSignature(routeEnvIn({ ...ccSwitch, EDITOR: "vim", ANTHROPIC_AUTH_TOKEN: "other" })),
);
assert.notEqual(routeSignature(routedEnv), routeSignature(routeEnvIn({})));
assert.notEqual(
  routeSignature(routedEnv),
  routeSignature(routeEnvIn({ ...ccSwitch, ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "GLM" })),
  "a provider switched in the router renames an alias",
);

// The state. `known` stands in for the kept probe answer.
const local = { ssh: false, forwards: false };
const says = (answer: boolean | undefined) => () => answer;
const never = () => assert.fail("no endpoint is asked when no URL is in force");
assert.deepEqual(routeOf(routeEnvIn({}), local, never), { state: "direct" });
assert.deepEqual(
  routeOf(routeEnvIn({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }), local, never),
  { state: "direct" },
  "Anthropic's own URL is no proxy",
);
assert.deepEqual(routeOf(routedEnv, local, says(false)), {
  state: "routed",
  host: "127.0.0.1:15721",
});
assert.deepEqual(
  routeOf(routeEnvIn({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" }), local, says(true)),
  { state: "direct", host: "127.0.0.1:8787" },
  "a proxy that forwards to Anthropic is not a router",
);
assert.deepEqual(
  routeOf(routedEnv, local, says(undefined)),
  { state: "unknown", host: "127.0.0.1:15721" },
  "an endpoint that does not answer is not known to be anything",
);
assert.deepEqual(
  routeOf(routedEnv, { ssh: false, forwards: true }, never),
  { state: "direct", host: "127.0.0.1:15721" },
  "the Proxy reaches Anthropic switch outranks the endpoint",
);
assert.deepEqual(routeOf(routedEnv, { ssh: true, forwards: false }, never), { state: "unknown" });
assert.deepEqual(
  routeOf(routeEnvIn({ ...ccSwitch, CLAUDE_CODE_USE_BEDROCK: "1" }), local, never),
  { state: "unknown" },
  "with a cloud switch on the CLI does not call the base URL",
);
assert.equal(
  routeOf(routeEnvIn({ ANTHROPIC_BASE_URL: "not a url" }), local, says(false)).host,
  "not a url",
);

// The listing. A lineup as the CLI answers it behind the router: the three aliases carry the
// router's names, and Fable, which the router did not name, keeps its own.
const cli = [
  { value: "default", displayName: "Default (recommended)", resolvedModel: "claude-opus-5" },
  { value: "sonnet", displayName: "Local Qwen", resolvedModel: "claude-sonnet-5" },
  { value: "opus", displayName: "lutechi-llm", resolvedModel: "claude-opus-5" },
  { value: "haiku", displayName: "Local Qwen small", resolvedModel: "claude-haiku-4-5" },
  { value: "fable", displayName: "Fable", resolvedModel: "claude-fable-5-1" },
].map((row) => ({ ...row, description: "", efforts: [] }));
const picker = withCustomModels(
  {
    options: [{ model: "by-hand", label: "Written in settings.json" }],
    replaceBuiltInOptions: false,
    aliasNames: routedEnv.aliasNames,
  },
  [
    { model: "lutechi-llm", label: "Local LLM", contextWindow: 256_000 },
    // An added row for a model Anthropic lists: it answers without a router.
    { model: "claude-opus-4-5", label: "Old Opus" },
  ],
);
const idsFor = (state: "direct" | "routed" | "unknown", claudeToo = false, lineup = cli) =>
  mergeCatalog(lineup, KNOWN_MODELS, picker, { state, claudeToo }).map((m) => m.id);
const everything = mergeCatalog(cli, KNOWN_MODELS, picker).map((m) => m.id);
assert.ok(everything.includes("lutechi-llm") && everything.includes("claude-fable-5-1"));

// Unknown, and no route at all, list every row.
assert.deepEqual(idsFor("unknown"), everything);

// Direct: the model only a router answers for is out; everything else stays, the added row for
// a real Claude model and the hand-written row included.
const direct = idsFor("direct");
assert.equal(direct.includes("lutechi-llm"), false, "a router-only model is not offered");
assert.ok(direct.includes("claude-opus-4-5"), "an added Claude model answers without a router");
assert.ok(direct.includes("by-hand"), "settings.json's own rows are not the plugin's to hide");
assert.deepEqual(
  direct,
  everything.filter((id) => id !== "lutechi-llm"),
);
// Once a session has run on it the CLI lists the model itself; that copy goes too.
const listedByCli = [
  ...cli,
  { value: "lutechi-llm", displayName: "lutechi-llm", resolvedModel: "lutechi-llm" },
].map((row) => ({ ...row, description: "", efforts: [] }));
assert.equal(idsFor("direct", false, listedByCli).includes("lutechi-llm"), false);

// Routed, the router having named aliases: Default, the named aliases and every row someone
// added or wrote out. Claude's own rows are set aside.
const routed = idsFor("routed");
const named = (id: string) =>
  mergeCatalog(cli, KNOWN_MODELS, picker, { state: "routed", claudeToo: false }).find(
    (m) => m.id === id,
  )?.name;
assert.ok(routed.includes("default"));
assert.equal(named("claude-sonnet-5"), "Local Qwen");
assert.equal(named("claude-haiku-4-5"), "Local Qwen small");
assert.ok(routed.includes("lutechi-llm") && routed.includes("by-hand"));
assert.ok(routed.includes("claude-opus-4-5"), "an added row stays whatever it names");
assert.equal(routed.includes("claude-fable-5-1"), false, "an alias the router did not name");
assert.equal(
  routed.some((id) => id.startsWith("claude-") && named(id)?.startsWith("Claude ")),
  false,
  "no row still reads as one of Claude's own",
);
// The switch keeps Claude's rows listed.
assert.deepEqual(idsFor("routed", true), everything);

// A lineup from before the router was switched on names nothing yet. Nothing is set aside until
// the lineup agrees with the file, so the menu is never emptied by a stale lineup.
const stale = cli.map((row) =>
  row.value === "default" ? row : { ...row, displayName: row.value },
);
assert.deepEqual(
  idsFor("routed", false, stale),
  mergeCatalog(stale, KNOWN_MODELS, picker).map((m) => m.id),
);
// A gateway that names no alias passes model names through: its Claude rows are real and stay.
const gateway = withCustomModels(undefined, [{ model: "gpt-5", label: "GPT-5" }]);
assert.deepEqual(
  mergeCatalog(stale, KNOWN_MODELS, gateway, { state: "routed", claudeToo: false }).map(
    (m) => m.id,
  ),
  mergeCatalog(stale, KNOWN_MODELS, gateway).map((m) => m.id),
);

// CC Switch connected straight to a provider (its "direct" mode, recorded 2026-11-10): every
// alias is pointed at the provider's model and only two are named. The unnamed one is the
// router's all the same, because its target is not a Claude model and the lineup agrees.
{
  const straight = routeEnvIn({
    ANTHROPIC_BASE_URL: "http://127.0.0.1:8080/v1",
    ANTHROPIC_MODEL: "lutechi-llm",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "lutechi-llm",
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Local Qwen",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "lutechi-llm",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Local Qwen small",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "lutechi-llm",
  });
  assert.deepEqual(straight.aliasModels, {
    sonnet: "lutechi-llm",
    haiku: "lutechi-llm",
    opus: "lutechi-llm",
  });
  assert.notEqual(routeSignature(straight), routeSignature(routedEnv));
  const lineup = [
    { value: "default", displayName: "Default (recommended)", resolvedModel: "lutechi-llm" },
    { value: "sonnet", displayName: "Local Qwen", resolvedModel: "lutechi-llm" },
    { value: "opus", displayName: "lutechi-llm", resolvedModel: "lutechi-llm" },
    { value: "haiku", displayName: "Local Qwen small", resolvedModel: "lutechi-llm" },
    { value: "fable", displayName: "Fable", resolvedModel: "claude-fable-5-1" },
  ].map((row) => ({ ...row, description: "", efforts: [] }));
  const listed = (models: Record<string, string>) =>
    mergeCatalog(
      lineup,
      KNOWN_MODELS,
      {
        options: [],
        replaceBuiltInOptions: false,
        aliasNames: straight.aliasNames,
        aliasModels: models,
      },
      { state: "routed", claudeToo: false },
    ).map((m) => m.id);
  assert.deepEqual(listed(straight.aliasModels), ["default", "sonnet", "opus", "haiku"]);
  // A Claude id on an alias is a version pin, not a remap: that alias is not the router's.
  assert.deepEqual(listed({ ...straight.aliasModels, opus: "claude-opus-4-5" }), [
    "default",
    "sonnet",
    "haiku",
  ]);
}

// A session on a row the listing leaves out still resolves it, window and all: the adapter
// resolves against the unfiltered rows.
const full = mergeCatalog(cli, KNOWN_MODELS, picker);
assert.equal(resolveModelInfo("claude-code", "lutechi-llm", full).context?.contextWindow, 256_000);

// The turn that fails because its model needs a router says so; any other failure, and the same
// failure on any other model, keeps the CLI's words.
// The frame is the CLI's own (2.1.322, `claude -p --model lutechi-llm` against Anthropic).
const refusal = {
  is_error: true,
  api_error_status: 404,
  result:
    "There's an issue with the selected model (lutechi-llm). It may not exist or you may not have access to it.",
};
const failure = (reason: ReturnType<typeof finishReason>) =>
  reason.kind === "error" ? reason.failure.message : "";
assert.match(failure(finishReason(refusal, undefined, "Local LLM")), /^Local LLM only answers/);
assert.match(failure(finishReason(refusal)), /issue with the selected model/);
assert.match(
  failure(finishReason({ is_error: true, result: "Prompt is too long" }, undefined, "Local LLM")),
  /^Prompt is too long/,
);

// The watch: only a settings file counts, a burst of writes is one call, and a save by rename
// (write a temp file, move it over) is seen, which a watch on the file itself would miss.
{
  const dir = mkdtempSync(join(tmpdir(), "omc-route-watch-"));
  try {
    let calls = 0;
    let other = 0;
    watchSettingsIn(dir, "claude-code", () => assert.fail("replaced by the next call"));
    watchSettingsIn(dir, "claude-code", () => calls++);
    watchSettingsIn(dir, "claude-code-second", () => other++);
    const settle = () => sleep(SETTINGS_SETTLE_MS + 250);
    await sleep(50);
    writeFileSync(join(dir, "history.jsonl"), "{}\n");
    writeFileSync(join(dir, ".credentials.json"), "{}");
    await settle();
    assert.equal(calls, 0, "what the CLI writes on every start is not a settings change");
    writeFileSync(join(dir, "settings.json"), "{}");
    writeFileSync(join(dir, "settings.json"), '{"env":{}}');
    await settle();
    assert.equal(calls, 1, "one call per burst");
    assert.equal(other, 1, "every mount watching the directory hears it");
    writeFileSync(join(dir, "settings.json.tmp"), '{"env":{"ANTHROPIC_BASE_URL":"http://x"}}');
    renameSync(join(dir, "settings.json.tmp"), join(dir, "settings.json"));
    await settle();
    assert.equal(calls, 2, "a save by rename is seen");
    // A directory that is not there is skipped without a throw.
    watchSettingsIn(join(dir, "missing"), "claude-code", () => {});
  } finally {
    unwatchSettings();
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("ok routing");
