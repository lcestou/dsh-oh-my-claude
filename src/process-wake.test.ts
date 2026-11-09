// A control_response no waiter takes is consumed rather than queued, and only a turn's own frames
// count as output an adopted process wakes its session for (#241); an exit callback that throws
// does not take the host down (#251).
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
// A throw from the exit callback stays inside closed() (#251): it runs in the child's `done`
// settlement, and an unhandled rejection there exits the whole dsh host.
let ran = false;
proc.closed(1, () => {
  ran = true;
  throw new Error('cannot get required service "sessions" in inactive context');
});
assert.ok(ran, "the exit callback still runs");
assert.equal(proc.alive, false, "and the process reads as ended");
const warned = await new Promise<string>((r) => process.once("warning", (w) => r(w.message)));
assert.match(
  warned,
  /exit callback failed: cannot get required service/,
  "and the throw is logged",
);
console.log("process-wake ok");
process.exit(0);
