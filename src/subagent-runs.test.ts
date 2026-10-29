// subagentRunsOf: files described from the parent's Task calls, strays under their own id, newest first.
import assert from "node:assert/strict";
import { subagentRunsOf } from "./subagent-runs.js";
import type { FoldedTranscript } from "./transcript.js";

const folded: FoldedTranscript = {
  title: undefined,
  createdAt: 0,
  permissionMode: undefined,
  agents: new Map([
    ["call-1", "aaa111"],
    ["call-2", "bbb222"],
  ]),
  turns: [
    {
      id: "u1",
      time: 10,
      content: [{ type: "text", text: "go" }],
      steps: [
        {
          msgId: "m1",
          id: "s1",
          time: 11,
          model: undefined,
          content: [],
          calls: [
            {
              id: "call-1",
              name: "Task",
              arguments: { description: "Review the diff", subagent_type: "reviewer", prompt: "…" },
            },
            { id: "call-2", name: "Task", arguments: { description: "", prompt: "…" } },
          ],
          results: new Map(),
        },
      ],
    },
  ],
};

{
  const runs = subagentRunsOf(folded, [
    "agent-bbb222.jsonl",
    "agent-aaa111.jsonl",
    "notes.txt",
    "agent-ccc333.jsonl",
  ]);
  assert.deepEqual(runs, [
    { agentId: "bbb222", description: "bbb222", subagentType: undefined, time: 11 },
    { agentId: "aaa111", description: "Review the diff", subagentType: "reviewer", time: 11 },
    { agentId: "ccc333", description: "ccc333", time: 0 },
  ]);
}
{
  assert.deepEqual(subagentRunsOf(undefined, ["agent-x.jsonl"]), [
    { agentId: "x", description: "x", time: 0 },
  ]);
}
