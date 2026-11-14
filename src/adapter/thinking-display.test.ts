import assert from "node:assert/strict";
import { buildArgs } from "./cli.js";
import { Config } from "./config.js";
import { engineDigest } from "./isolate.js";

const flags = new Set(["--tools", "--effort"]); // as probed: --help hides --thinking-display
const args = (thinkingDisplay: "" | "summarized", purpose?: "session-title") => {
  const opts: Parameters<typeof buildArgs>[0] = {
    model: "sonnet",
    config: Config({ thinkingDisplay }),
    flags,
    promptText: "",
  };
  if (purpose) opts.purpose = purpose;
  return buildArgs(opts);
};

const at = (a: string[]) => a.indexOf("--thinking-display");
assert.equal(at(args("")), -1, "default: no flag");
const on = args("summarized");
assert.equal(on[at(on) + 1], "summarized");
assert.equal(at(args("summarized", "session-title")), -1, "side calls stay without it");

const base = { builtinTools: ["default"], toolLoading: "claude", isolate: false };
assert.equal(engineDigest(base), undefined);
assert.notEqual(engineDigest({ ...base, thinkingDisplay: "summarized" }), undefined);
console.log("thinking-display ok");
