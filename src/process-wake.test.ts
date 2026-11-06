// A control_response no waiter takes is consumed rather than queued, and only a turn's own frames
// count as output an adopted process wakes its session for (#241).
import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { ClaudeProcess } from "./process.js";

const stdout = new PassThrough();
const acked: number[] = [];
const proc = new ClaudeProcess({
  args: [],
  cwd: "/tmp",
  command: "claude",
  spec: {
    cwd: "/tmp",
    model: undefined,
    effort: null,
    mode: "default",
    sessionId: null,
    temporary: false,
  },
  spawner: () => ({
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    done: new Promise(() => {}),
    terminate() {},
    ack: (i: number) => {
      acked.push(i);
    },
  }),
});
proc.controlListener = () => false; // the adapter's resolveControl after the waiter timed out
const feed = async (frame: object) => {
  stdout.write(`${JSON.stringify(frame)}\n`);
  await new Promise((r) => setTimeout(r, 10));
};

await feed({
  type: "control_response",
  response: { subtype: "success", request_id: "omc-late", response: {} },
});
assert.equal(proc.queue.lines.length, 0, "a late control_response is not queued");
assert.deepEqual(acked, [0], "and is acked, so a keeper does not replay it");
assert.equal(proc.hasTurnOutput(), false);

for (const frame of [
  { type: "system", subtype: "init" },
  { type: "keep_alive" },
  { type: "rate_limit_event" },
  { type: "auth_status" },
  { type: "something_new" },
])
  await feed(frame);
assert.equal(proc.hasTurnOutput(), false, "notices and unknown frames wake nobody");

proc.lastUsed = 0;
await feed({ type: "keep_alive" });
assert.equal(proc.lastUsed, 0, "a keep_alive is not Claude working");
await feed({ type: "tool_progress", tool_use_id: "t1", elapsed_time_seconds: 30 });
assert.ok(proc.lastUsed > 0, "tool_progress counts as use, so the idle reaper waits");

await feed({ type: "system", subtype: "task_notification", status: "completed" });
assert.equal(proc.hasTurnOutput(), true, "a finished background task wakes");
for (const type of [
  "assistant",
  "user",
  "result",
  "stream_event",
  "control_request",
  "tool_progress",
]) {
  proc.queue.lines.length = 0;
  await feed({ type });
  assert.equal(proc.hasTurnOutput(), true, `${type} wakes`);
}
console.log("process-wake ok");
process.exit(0);
