// Offline checks for the Tune tab's settings edits: the file keeps every key it already had,
// a control at its default removes its key, and a bad auto-compact value never reaches the file.
import assert from "node:assert/strict";
import { readTunables, updateSettings } from "./tune.js";

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
}

console.log("tune ok");
