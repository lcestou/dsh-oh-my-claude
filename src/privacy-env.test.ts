// Offline self-check: bun src/privacy-env.test.ts. The privacy switches set in dsh's environment
// reach every Claude child, near or far: SSH boxes, held processes and remote workspaces start from
// the far shell, so they are passed along explicitly.
import assert from "node:assert/strict";
import { holdStartScript } from "./hold.js";
import { childEnv, forwardedEnv, seamSpawner, sshInvocation } from "./process.js";

// The privacy switches a person might set for everything dsh spawns.
const PRIVATE = {
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  DO_NOT_TRACK: "",
  HOME: "/home/u",
};
assert.deepEqual(forwardedEnv(PRIVATE), [
  ["DISABLE_TELEMETRY", "1"],
  ["DISABLE_ERROR_REPORTING", "1"],
  ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"],
]);

// A local child inherits them unchanged.
{
  const env = childEnv(PRIVATE);
  for (const key of [
    "DISABLE_TELEMETRY",
    "DISABLE_ERROR_REPORTING",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  ])
    assert.equal(env[key], "1", `${key} reaches a local claude`);
}

// A child on another machine starts from that machine's shell, so each path carries them.
{
  const script =
    sshInvocation("nova", "claude", ["-p"], "/w", undefined, PRIVATE).args.at(-1) ?? "";
  assert.match(
    script,
    /exec env DISABLE_TELEMETRY='1' DISABLE_ERROR_REPORTING='1' CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1' MCP_TOOL_TIMEOUT=/,
    "an ssh box's claude gets them",
  );
  assert.doesNotMatch(script, /DO_NOT_TRACK|HOME=/, "only what is set, and only the switches");

  const held = holdStartScript("abc-1", "/w", "claude", ["-p"], undefined, PRIVATE);
  assert.match(
    held,
    /env DISABLE_TELEMETRY='\\''1'\\'' DISABLE_ERROR_REPORTING=/,
    "a held process gets them",
  );

  let env: Record<string, string> | undefined;
  // SAFETY: the fake carries the one method the spawner calls
  const spawn = seamSpawner(
    { spawn: (spec: any) => ((env = spec.env), {} as any) } as any,
    PRIVATE,
  );
  spawn("claude", ["-p"], "/w");
  assert.equal(
    env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    "1",
    "a remote workspace's claude gets them",
  );
  assert.equal(env?.HOME, undefined, "still no dsh env leak");
}
console.log("privacy-env ok");
