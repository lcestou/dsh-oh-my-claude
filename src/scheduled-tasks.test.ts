// Offline self-check: bun src/scheduled-tasks.test.ts. No CLI, no network.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldTranscript } from "./transcript.js";
import { goalFrom, readDurableTasks, sessionTasksFrom } from "./scheduled-tasks.js";

/** A transcript of one prompt and one assistant step making the given tool calls. */
const transcript = (calls: Array<{ name: string; input: Record<string, unknown> }>) =>
  foldTranscript(
    [
      JSON.stringify({
        type: "user",
        uuid: "u1",
        timestamp: "2026-09-07T02:00:00.000Z",
        message: { content: [{ type: "text", text: "schedule something" }] },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: "2026-09-07T02:00:01.000Z",
        message: {
          id: "msg_1",
          content: calls.map((c, i) => ({
            type: "tool_use",
            id: `call_${i}`,
            name: c.name,
            input: c.input,
          })),
        },
      }),
    ].join("\n"),
  );

// A delete cancels the create before it, and a durable create belongs to the file, not this list.
{
  const folded = transcript([
    { name: "CronCreate", input: { name: "morning", schedule: "0 9 * * 1-5" } },
    { name: "CronCreate", input: { name: "nightly", schedule: "0 2 * * *", durable: true } },
    { name: "CronCreate", input: { name: "hourly", schedule: "0 * * * *" } },
    { name: "CronDelete", input: { name: "hourly" } },
  ]);
  const tasks = sessionTasksFrom(folded);
  assert.deepEqual(
    tasks.map((t) => t.name),
    ["morning"],
    "the deleted one is gone and the durable one is the file's",
  );
  assert.equal(tasks[0]?.schedule, "0 9 * * 1-5");
  assert.equal(tasks[0]?.durable, false);
}

// A create with no name is not a task anyone can refer to, and a tool of another name is not ours.
{
  const folded = transcript([
    { name: "CronCreate", input: { schedule: "0 9 * * *" } },
    { name: "Bash", input: { command: "echo not a cron job" } },
  ]);
  assert.deepEqual(sessionTasksFrom(folded), []);
}

// The last proposal is the goal, and its time is the step that made it.
{
  const folded = transcript([
    { name: "ProposeGoal", input: { goal: "first idea" } },
    { name: "ProposeGoal", input: { goal: "ship the tab" } },
  ]);
  const goal = goalFrom(folded);
  assert.equal(goal?.text, "ship the tab");
  assert.equal(goal?.at, Date.parse("2026-09-07T02:00:01.000Z"));
  assert.equal(goalFrom(transcript([{ name: "Bash", input: { command: "ls" } }])), null);
}

// A missing file is no tasks; a file that does not parse is an error rather than a quiet empty list.
{
  const dir = await mkdtemp(join(tmpdir(), "omc-tasks-"));
  assert.deepEqual(await readDurableTasks({}, dir), []);
  await mkdir(join(dir, ".claude"), { recursive: true });
  const path = join(dir, ".claude", "scheduled_tasks.json");
  await writeFile(path, "{ not json");
  await assert.rejects(() => readDurableTasks({}, dir), /scheduled_tasks\.json/);
  await writeFile(
    path,
    JSON.stringify({ tasks: [{ id: "digest", cron: "0 8 * * *", nextRun: 1_757_212_800_000 }] }),
  );
  const tasks = await readDurableTasks({}, dir);
  assert.deepEqual(tasks, [
    {
      name: "digest",
      description: undefined,
      schedule: "0 8 * * *",
      nextRunAt: 1_757_212_800_000,
      durable: true,
    },
  ]);
  await writeFile(path, JSON.stringify([{ name: "bare list", schedule: "@daily" }]));
  assert.equal((await readDurableTasks({}, dir))[0]?.name, "bare list");
}

console.log("scheduled-tasks: ok");
