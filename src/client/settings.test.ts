// Offline checks for the settings scope note: precedence decides which file wins a key, a scope
// missing from the payload is skipped rather than shifting the order, and unreadable text is quiet.
import assert from "node:assert/strict";
import { overrideNote, type SettingsScopeInfo } from "./settings.js";

const scope = (name: SettingsScopeInfo["scope"], text: string): SettingsScopeInfo => ({
  scope: name,
  path: `/${name}/settings.json`,
  exists: true,
  text,
  readOnly: name === "managed",
});

// The highest-precedence file that also sets a key is the one named for it.
{
  const note = overrideNote(
    [
      scope("managed", `{"model":"opus"}`),
      scope("local", `{"model":"haiku","env":{}}`),
      scope("user", `{"model":"sonnet","env":{},"hooks":{}}`),
    ],
    "user",
  );
  assert.equal(note, "Overridden here: model by the managed file; env by settings.local.json.");
}

// Nothing above the top scope, and nothing shared, both read as no note.
{
  assert.equal(overrideNote([scope("managed", `{"model":"opus"}`)], "managed"), "");
  assert.equal(
    overrideNote([scope("local", `{"env":{}}`), scope("user", `{"model":"sonnet"}`)], "user"),
    "",
  );
}

// Without a directory the payload carries no project or local file; user still reads managed.
{
  const note = overrideNote(
    [scope("managed", `{"permissions":{}}`), scope("user", `{"permissions":{}}`)],
    "user",
  );
  assert.equal(note, "Overridden here: permissions by the managed file.");
}

// A file that is not JSON, and a scope the payload never carried, contribute nothing.
{
  assert.equal(
    overrideNote([scope("local", "not json"), scope("user", `{"model":"sonnet"}`)], "user"),
    "",
  );
  assert.equal(overrideNote([scope("user", `{"model":"sonnet"}`)], "project"), "");
}

// Three keys read as a sentence, not a bare list.
{
  const note = overrideNote(
    [scope("local", `{"a":1,"b":2,"c":3}`), scope("user", `{"a":1,"b":2,"c":3}`)],
    "user",
  );
  assert.equal(note, "Overridden here: a, b and c by settings.local.json.");
}

console.log("settings-scopes ok");
