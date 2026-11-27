// The plan-window history on disk: the usage route's one store, read once and written back in the
// background. Server only; the pure fold and view it calls are usage-history.ts's.
import z from "@deepseek-ai/schemastery";
import { historyView, pruneLogins, recordWindows } from "./usage-history.js";
import type { HistoryFile, HistoryRow, HistoryWindow } from "./usage-history.js";

/** One row as written. Every field is required, so a row missing one is refused rather than filled
 *  in, which is what the validator does with a field that is merely absent from a schema. */
const Row = z.object({
  series: z.string().required(),
  resetsAt: z.number().required(),
  peak: z.number().required(),
  firstAt: z.number().required(),
  lastAt: z.number().required(),
});

/** The file around the rows: logins checked as a map only, so one login whose value is not a list,
 *  or one bad row, costs that login or that row and not the whole file. */
const File = z.object({ logins: z.dict(z.any()) });

/** The history file, or an empty one when the text is not JSON or not this shape (a torn write, an
 *  older build's, a hand edit). A malformed row is dropped alone; the rest of its login survives. */
export function parseUsageHistory(text: string): HistoryFile {
  const out: HistoryFile = { version: 1, logins: {} };
  let file: ReturnType<typeof File>;

  try {
    file = File(JSON.parse(text));
  } catch {
    return out;
  }

  for (const [key, list] of Object.entries(file.logins)) {
    if (!Array.isArray(list)) {
      continue;
    }

    const rows: Array<HistoryRow> = [];

    for (const raw of list) {
      try {
        rows.push(Row(raw));
      } catch {
        // A row that is not a row: dropped alone.
      }
    }

    out.logins[key] = rows;
  }

  return out;
}

/**
 * The store behind the usage route: loads the file once, folds each fresh reply in, and writes the
 * whole file in the background one write at a time, each snapshotting the map as it starts, so a
 * slow write never lands over a later one. A failed write is dropped, not retried: memory keeps the
 * rows and the next change writes them again. `read` and `write` are the caller's (`readFile`,
 * `writeJson`), so tests can hand in their own.
 */
export function createUsageHistory(
  read: () => Promise<string>,
  write: (value: HistoryFile) => Promise<void>,
) {
  const logins = new Map<string, Array<HistoryRow>>();
  let loaded: Promise<void> | undefined;

  /** Reads the file once per store; a missing or damaged file leaves the map empty, and a login
   *  already in memory wins over the one on disk. */
  const load = (): Promise<void> =>
    (loaded ??= read()
      .then(parseUsageHistory)
      .catch(() => parseUsageHistory(""))
      .then((file) => {
        for (const [key, rows] of Object.entries(file.logins)) {
          if (!logins.has(key)) {
            logins.set(key, rows);
          }
        }
      }));

  let saving: Promise<void> = Promise.resolve();

  /** Queues a write of the whole map behind the one before it; a failure is swallowed. */
  const save = () => {
    saving = saving
      .then(() => write({ version: 1, logins: Object.fromEntries(logins) }))
      .catch(() => undefined);
  };

  return {
    /** Folds one fresh reply into `login`'s rows; writes only when a row changed. */
    record: async (login: string, windows: ReadonlyArray<HistoryWindow>, fetchedAt: number) => {
      await load();
      const rows = logins.get(login) ?? [];
      const next = recordWindows(rows, windows, fetchedAt);

      if (next === rows) {
        return;
      }

      logins.set(login, next);
      // Every login, not only this one: a login nobody reads any more would otherwise keep its
      // rows for ever.
      const pruned = pruneLogins(logins, fetchedAt);
      logins.clear();

      for (const [key, value] of pruned) {
        logins.set(key, value);
      }

      save();
    },
    /** `login`'s ended windows as of `now`; `{}` for a login never recorded. */
    view: async (login: string, now: number) => {
      await load();

      return historyView(logins.get(login) ?? [], now);
    },
  };
}
