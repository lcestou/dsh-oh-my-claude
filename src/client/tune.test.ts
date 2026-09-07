// Offline checks for the Tune tab's settings edits: the file keeps every key it already had,
// a control at its default removes its key, and a bad auto-compact value never reaches the file.
import assert from "node:assert/strict";
import { isFable, noTrailers, readTunables, updateSettings } from "./tune.js";

// A key the file does not have yet is added.
{
  const r = updateSettings("{}", "outputStyle", "Explanatory");
  assert.equal(r.error, undefined);
  assert.equal(JSON.parse(r.text).outputStyle, "Explanatory");
}

// An existing key is replaced, and the keys around it survive in their original order.
{
  const before = JSON.stringify({
    a: 1,
    outputStyle: "Default",
    b: 2,
    alwaysThinkingEnabled: true,
  });
  const r = updateSettings(before, "outputStyle", "Learning");
  assert.equal(r.error, undefined);
  const after = JSON.parse(r.text);
  assert.equal(after.outputStyle, "Learning");
  assert.deepEqual(Object.keys(after), ["a", "outputStyle", "b", "alwaysThinkingEnabled"]);
}

// Back to the CLI's own default: the key goes away rather than being written as false or null.
{
  const r = updateSettings(
    JSON.stringify({ outputStyle: "Learning", other: 1 }),
    "outputStyle",
    undefined,
  );
  assert.equal(r.error, undefined);
  assert.ok(!("outputStyle" in JSON.parse(r.text)), "key removed, not nulled");
  assert.equal(JSON.parse(r.text).other, 1);
}

// Auto-compact takes whole positive token counts only.
{
  assert.equal(updateSettings("{}", "autoCompactWindow", 8000).error, undefined);
  assert.match(String(updateSettings("{}", "autoCompactWindow", 0).error), /positive whole number/);
  assert.match(
    String(updateSettings("{}", "autoCompactWindow", 1.5).error),
    /positive whole number/,
  );
}

// Either cache TTL key takes the CLI's own two values, and nothing else reaches the file.
{
  const r = updateSettings("{}", "promptCacheTtl", "1h");
  assert.equal(r.error, undefined);
  assert.equal(JSON.parse(r.text).promptCacheTtl, "1h");
  const s = updateSettings("{}", "subagentPromptCacheTtl", "5m");
  assert.equal(s.error, undefined);
  assert.equal(JSON.parse(s.text).subagentPromptCacheTtl, "5m");
  assert.match(String(updateSettings("{}", "promptCacheTtl", "30m").error), /5m or 1h/);
  assert.match(String(updateSettings("{}", "subagentPromptCacheTtl", 3600).error), /5m or 1h/);
}

// Switching a set TTL keeps every other key, and their order, exactly as the file had them.
{
  const before = JSON.stringify({ a: 1, promptCacheTtl: "5m", model: "opus" });
  const r = updateSettings(before, "promptCacheTtl", "1h");
  assert.equal(r.error, undefined);
  const after = JSON.parse(r.text);
  assert.equal(after.promptCacheTtl, "1h");
  assert.deepEqual(Object.keys(after), ["a", "promptCacheTtl", "model"]);
}

// Default on a TTL row: the key goes away, so the CLI picks the TTL for itself again.
{
  const r = updateSettings(
    JSON.stringify({ subagentPromptCacheTtl: "1h", other: 1 }),
    "subagentPromptCacheTtl",
    undefined,
  );
  assert.equal(r.error, undefined);
  assert.ok(!("subagentPromptCacheTtl" in JSON.parse(r.text)), "key removed, not nulled");
  assert.equal(JSON.parse(r.text).other, 1);
}

// A file that is not JSON, or not an object, is reported rather than overwritten.
{
  assert.ok(updateSettings("{oops", "outputStyle", "Learning").error);
  assert.match(String(updateSettings("[1,2]", "outputStyle", "Learning").error), /JSON object/);
}

// Two spaces and a trailing newline, the way Claude Code writes the file itself.
{
  const r = updateSettings('{\n  "other": 1\n}\n', "alwaysThinkingEnabled", true);
  assert.equal(r.error, undefined);
  assert.equal(r.text, '{\n  "other": 1,\n  "alwaysThinkingEnabled": true\n}\n');
}

// Reading back: only values of the right type count, so a hand-edited file cannot break a control.
{
  assert.deepEqual(readTunables("{}"), {});
  assert.deepEqual(readTunables("not json"), {});
  assert.deepEqual(
    readTunables(
      JSON.stringify({
        outputStyle: "Learning",
        alwaysThinkingEnabled: true,
        autoCompactWindow: 8000,
      }),
    ),
    { outputStyle: "Learning", alwaysThinkingEnabled: true, autoCompactWindow: 8000 },
  );
  assert.deepEqual(
    readTunables(
      JSON.stringify({ alwaysThinkingEnabled: "yes", autoCompactWindow: "8000", outputStyle: "" }),
    ),
    {},
    "wrong types read as unset",
  );
  assert.deepEqual(readTunables(JSON.stringify({ promptCacheTtl: "1h" })), {
    promptCacheTtl: "1h",
  });
  assert.deepEqual(
    readTunables(JSON.stringify({ promptCacheTtl: 3600, subagentPromptCacheTtl: "forever" })),
    {},
    "a TTL that is not 5m or 1h reads as unset",
  );
}

// Advisor model is set when it is a non-empty string.
{
  const r = updateSettings("{}", "advisorModel", "claude-opus-5");
  assert.equal(r.error, undefined);
  assert.equal(JSON.parse(r.text).advisorModel, "claude-opus-5");
}

// Advisor model reads as unset when it is empty.
{
  assert.deepEqual(readTunables(JSON.stringify({ advisorModel: "claude-opus-5" })), {
    advisorModel: "claude-opus-5",
  });
  assert.deepEqual(
    readTunables(JSON.stringify({ advisorModel: "", outputStyle: "Learning" })),
    { outputStyle: "Learning" },
    "empty advisor reads as unset",
  );
  // A non-string advisor (after JSON parsing) is treated as unset, same as outputStyle does.
  assert.deepEqual(
    readTunables('{"advisorModel": null, "outputStyle": "Explanatory"}'),
    { outputStyle: "Explanatory" },
    "null advisor reads as unset",
  );
}

// Back to Off: the key goes away, so the CLI picks its own default.
{
  const r = updateSettings(
    JSON.stringify({ advisorModel: "claude-opus-5", other: 1 }),
    "advisorModel",
    undefined,
  );
  assert.equal(r.error, undefined);
  assert.ok(!("advisorModel" in JSON.parse(r.text)), "key removed, not nulled");
  assert.equal(JSON.parse(r.text).other, 1);
}

// The Fable family is what the credits guard keys on; nothing else may match it.
{
  assert.equal(isFable("claude-fable-5-1"), true);
  assert.equal(isFable("claude-opus-5"), false);
  assert.equal(isFable(undefined), false, "Off is not a Fable advisor");
  assert.equal(isFable(true), false, "a boolean is no model id");
}

console.log("tune ok");

/** The written document, or the refusal as a thrown error: every block below expects a write. */
const written = (r: ReturnType<typeof updateSettings>) => {
  if (r.error !== undefined) throw new Error(r.error);
  return JSON.parse(r.text);
};

// The two deadlines take the CLI's enum and nothing else; "never" is a value, not an absent key.
{
  assert.equal(written(updateSettings("{}", "dialogExpiry", "10m")).dialogExpiry, "10m");
  assert.equal(
    written(updateSettings("{}", "askUserQuestionTimeout", "never")).askUserQuestionTimeout,
    "never",
  );
  assert.match(String(updateSettings("{}", "dialogExpiry", "2h").error), /60s, 5m, 10m or never/);
  assert.equal(
    "dialogExpiry" in written(updateSettings('{"dialogExpiry":"5m"}', "dialogExpiry", undefined)),
    false,
    "back to the default removes the key",
  );
  assert.deepEqual(readTunables('{"dialogExpiry":"10m","askUserQuestionTimeout":"60s"}'), {
    dialogExpiry: "10m",
    askUserQuestionTimeout: "60s",
  });
  assert.deepEqual(
    readTunables('{"dialogExpiry":"2h"}'),
    {},
    "a value off the enum reads as unset",
  );
}

// The output sizes are refused outside the range the CLI clamps to, rather than written and clamped.
{
  assert.equal(written(updateSettings("{}", "bashOutputMaxChars", 8000)).bashOutputMaxChars, 8000);
  assert.match(
    String(updateSettings("{}", "bashOutputMaxChars", 100).error),
    /between 4000 and 128000/,
  );
  assert.match(
    String(updateSettings("{}", "taskOutputMaxChars", 200_000).error),
    /between 4000 and 128000/,
  );
  assert.match(String(updateSettings("{}", "taskOutputMaxChars", 8000.5).error), /whole number/);
  assert.deepEqual(readTunables('{"bashOutputMaxChars":30000,"taskOutputMaxChars":32000}'), {
    bashOutputMaxChars: 30000,
    taskOutputMaxChars: 32000,
  });
}

// Attribution is nested in the file and flat in the tab. An empty string is a written value, since
// that is how the CLI is told to add nothing; only an absent value removes the field.
{
  const one = updateSettings('{"model":"opus"}', "attribution.commit", "");
  if (one.error !== undefined) throw new Error(one.error);
  assert.deepEqual(JSON.parse(one.text), { model: "opus", attribution: { commit: "" } });
  const two = updateSettings(one.text, "attribution.sessionUrl", false);
  if (two.error !== undefined) throw new Error(two.error);
  assert.deepEqual(JSON.parse(two.text).attribution, { commit: "", sessionUrl: false });
  const back = updateSettings(two.text, "attribution.commit", undefined);
  if (back.error !== undefined) throw new Error(back.error);
  assert.deepEqual(JSON.parse(back.text).attribution, { sessionUrl: false }, "one field goes");
  const empty = updateSettings(back.text, "attribution.sessionUrl", undefined);
  assert.deepEqual(written(empty), { model: "opus" }, "the object goes with its last field");

  const read = readTunables('{"attribution":{"commit":"","pr":"mine","sessionUrl":false}}');
  assert.equal(read["attribution.commit"], "", "an empty string reads as set, not as absent");
  assert.equal(read["attribution.pr"], "mine");
  assert.equal(read["attribution.sessionUrl"], false);
  assert.deepEqual(
    readTunables('{"attribution":{"commit":7,"pr":true}}'),
    {},
    "wrong types read as unset",
  );
  assert.deepEqual(
    readTunables('{"attribution":"none"}'),
    {},
    "a non-object attribution reads as unset",
  );

  assert.equal(noTrailers(read), false, "a custom PR text is still a trailer");
  assert.equal(
    noTrailers(readTunables('{"attribution":{"commit":"","pr":"","sessionUrl":false}}')),
    true,
  );
  assert.equal(
    noTrailers({ "attribution.commit": "", "attribution.pr": "" }),
    false,
    "all three or nothing",
  );
  assert.equal(noTrailers({}), false);
}

// The fallback model reads like the advisor: an absent, empty or boolean value is no model id.
{
  assert.equal(
    written(updateSettings("{}", "fallbackModel", "claude-sonnet-5")).fallbackModel,
    "claude-sonnet-5",
  );
  assert.equal(
    readTunables('{"fallbackModel":"claude-sonnet-5"}').fallbackModel,
    "claude-sonnet-5",
  );
  assert.equal(readTunables('{"fallbackModel":""}').fallbackModel, undefined);
  assert.equal(readTunables('{"fallbackModel":true}').fallbackModel, undefined);
}
