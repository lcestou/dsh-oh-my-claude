// Dev-only check, run by hand: proves that the arg list the adapter's skillDoctor builds
// (buildArgs with purpose "session-title": --tools "" --max-turns 1 --no-session-persistence) still
// makes /skill-doctor return its report in -p. It spawns one real `claude` and spends no model
// tokens (the command is synthetic; measured 2026-09-19 returning at ~2.3 s with no model turn).
// Not a suite test: it needs a logged-in `claude` on PATH. Run: bun tools/skill-doctor-probe.ts
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
import { fits } from "../src/schema-fits.js";

const args = [
  "-p",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--verbose",
  "--tools",
  "",
  "--max-turns",
  "1",
  "--no-session-persistence",
  "--model",
  "claude-haiku-4-5-20251001",
];

const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
const t0 = Date.now();

/** The CLI's closing frame: its text and whether it failed. Any other frame does not fit. */
const ResultFrame = z.object({
  type: z.const("result").required(),
  is_error: z.union([z.const(undefined), z.boolean()]),
  result: z.union([z.const(undefined), z.string()]),
});

let report: string | undefined;
let isError: boolean | undefined;
let buf = "";

child.stdout.on("data", (d: Buffer) => {
  buf += d.toString();
  let nl = buf.indexOf("\n");

  while (nl !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    nl = buf.indexOf("\n");

    if (line.trim() === "") {
      continue;
    }

    let raw: unknown;

    try {
      raw = JSON.parse(line);
    } catch {
      // not JSON: ignore, like the plugin's own reader
      continue;
    }

    if (fits(ResultFrame, raw)) {
      const frame = ResultFrame(raw);
      isError = frame.is_error;
      report = frame.result ?? "";
    }
  }
});

const frame = {
  type: "user",
  message: { role: "user", content: [{ type: "text", text: "/skill-doctor" }] },
};

child.stdin.write(`${JSON.stringify(frame)}\n`);

child.stdin.end();

const timer = setTimeout(() => {
  console.log("FAIL: no result frame in 25 s");
  child.kill();
  process.exit(1);
}, 25_000);

child.on("close", () => {
  clearTimeout(timer);
  const ms = Date.now() - t0;
  const ok = isError === false && (report ?? "").startsWith("Skills loaded this session");
  console.log(`result in ${ms} ms, is_error=${isError}`);
  console.log((report ?? "(no report)").split("\n").slice(0, 6).join("\n"));
  console.log(ok ? "PASS" : "FAIL");
  process.exit(ok ? 0 : 1);
});
