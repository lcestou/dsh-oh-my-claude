// The CLI reports cost as a running total and each turn stores its own part of it. A result frame
// that carries no cost must leave the running total alone, or the next turn is charged the session.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "../dsh.js";
import type { ClaudeEvent } from "../process.js";
import {
  fakeClaudeProcess,
  fakePluginContext,
  fakeSession,
  fakeSpec,
  userTurn,
} from "../test-context.js";
import { ClaudeCodeAdapter } from "./class.js";
import { Config } from "./config.js";

const dir = await mkdtemp(join(tmpdir(), "omc-cost-probe-"));

try {
  const session = fakeSession({
    snapshotEvents: (): Array<SessionEvent> => [
      { type: "turn/start", seq: 0, time: 0, data: { turn: 1 } },
      { type: "step/start", seq: 1, time: 0, data: { step: 1 } },
    ],
    append: (type) => ({ type, seq: 1, time: 0, data: {} }),
  });

  const a = new ClaudeCodeAdapter(
    fakePluginContext({
      on() {},
      sessions: { get: () => session },
      agents: { get: () => undefined },
    }),
    Config({ resume: true }),
  );

  a.stateDir = dir;
  const queue: Array<ClaudeEvent> = [];

  const proc = fakeClaudeProcess({
    busy: false,
    // The old fakes carried both: alive, with an exit code already set.
    alive: true,
    exitCode: 0,
    staleResults: 0,
    countStaleResults: () => 0,
    spec: { model: "m" },
    costSoFar: 3,
    apiMsSoFar: 0,
    promptSentAt: 0,
    write: () => true,
    nextEvent: async () => queue.shift() ?? null,
    kill: () => {},
  });

  const prep = { input: "go", spec: fakeSpec({ model: "m" }), cwd: "/tmp", args: [] };

  a.acquire = async () => ({ prep, proc });
  a.reconnectIfStale = async () => {};

  a.watchTranscript = async () => {};

  a.pumpMirror = async () => {};

  const turn = async (result: { total_cost_usd?: number; duration_ms: number }) => {
    queue.push({
      type: "result",
      subtype: "success",
      is_error: false,
      ...result,
    });

    for await (const _ of a.stream(userTurn("scost"))) {
      // Drained for the turn record the result leaves behind.
    }
  };

  await turn({ duration_ms: 1000 });
  assert.equal(proc.costSoFar, 3, "the total survives a frame without a figure");
  await turn({ total_cost_usd: 3.5, duration_ms: 1000 });
  const costs = a.turnBuffer.get("scost")?.map((r) => r.costUsd);
  assert.deepEqual(costs, [0, 0.5], "a result with no cost leaves the running total alone");
  // A total of 0 is a figure: the counter restarted (`/clear`), and the next turn counts from it.
  await turn({ total_cost_usd: 0, duration_ms: 1000 });
  await turn({ total_cost_usd: 0.2, duration_ms: 1000 });
  const later = a.turnBuffer.get("scost")?.map((r) => r.costUsd);
  assert.deepEqual(later?.slice(2), [0, 0.2], "a reset to 0 is taken as the new total");
  assert.ok(
    a.turnBuffer.get("scost")?.every((r) => !("noTotals" in r)),
    "the marker is not stored",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("turn cost ok");
