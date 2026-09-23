// Offline self-check for the row mark: the mark slot paints `data-omc-claude` on the rows whose
// running session is a Claude mount, and the scan's fallback matches by the same titles, so this
// is the one function they share. If it names the wrong rows the scan tints the wrong dots, and the
// check fails before either path runs.
import { strict as assert } from "node:assert";
import type { ClientCtx } from "./shared.js";
import { claudeRunningTitles } from "./index.js";

// A cold ctx: `directoryFor` throws because the tab never opened these rows, so isClaudeSession
// falls back to the list projection, and running + displayTitle come off each row.
const coldCtx = (byId: Record<string, unknown>): ClientCtx =>
  ({
    modelDirectories: {
      directoryFor: () => {
        throw new Error("cold row: no scope");
      },
    },
    sessions: { list: { getSnapshot: () => ({ byId }) } },
  }) as unknown as ClientCtx;

// Both the running Claude rows contribute their title; the running non-Claude row and the idle
// Claude row do not, so the scan tints exactly the running Claude dots.
{
  const titles = claudeRunningTitles(
    coldCtx({
      a: {
        id: "a",
        running: true,
        displayTitle: "Recipe",
        projectionValues: { modelSelection: { next: { provider: "claude-code-nova" } } },
      },
      b: {
        id: "b",
        running: true,
        displayTitle: "Build",
        projectionValues: { modelSelection: { next: { provider: "claude-code" } } },
      },
      c: {
        id: "c",
        running: true,
        displayTitle: "Search",
        projectionValues: { modelSelection: { next: { provider: "deepseek" } } },
      },
      d: {
        id: "d",
        running: false,
        displayTitle: "Done",
        projectionValues: { modelSelection: { next: { provider: "claude-code" } } },
      },
    }),
  );
  assert.deepEqual(
    [...titles].toSorted(),
    ["Build", "Recipe"],
    "only the running Claude rows are named",
  );
}

// A running Claude row with no title contributes nothing, and a missing snapshot answers empty.
{
  const noTitle = claudeRunningTitles(
    coldCtx({
      s1: {
        id: "s1",
        running: true,
        projectionValues: { modelSelection: { next: { provider: "claude-code" } } },
      },
    }),
  );
  assert.deepEqual([...noTitle], [], "a row without a title is skipped");
  assert.deepEqual([...claudeRunningTitles(coldCtx({}))], [], "no rows answers an empty set");
  const none = {
    sessions: { list: { getSnapshot: () => undefined } },
  } as unknown as ClientCtx;
  assert.deepEqual([...claudeRunningTitles(none)], [], "a missing snapshot answers an empty set");
}

console.log("mark: ok");
