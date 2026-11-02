// The plugin's composer shortcuts as rows in dsh's own Keyboard shortcuts dialog (Settings →
// General → Edit shortcuts, or Mod+/). dsh lists a plugin's fixed input actions there, read-only,
// and keeps their keys from being assigned to an editable command; the keys themselves are
// handled by each feature's own listener (`recall.ts`, `history-search.tsx`, `edit-last.ts`),
// not dispatched by dsh, so a row here says what the plugin does, it does not make it do it.
import { HINTS_EVENT, loadHints } from "./hints.js";
import { t, type OmcKey } from "./i18n.js";
import type { ClientCtx } from "./shared.js";

/** One physical combination, as dsh's shortcuts service takes it. */
interface Binding {
  code: string;
  modifiers: readonly ("control" | "alt" | "shift" | "meta")[];
}

/** The slice of dsh's `shortcuts` service this file calls (dsh-client-shortcuts `Shortcuts`),
 *  read with `ctx.get` since a dsh without the service answers undefined. */
interface Shortcuts {
  registerFixed(command: {
    id: string;
    label: () => string;
    keys: readonly string[];
    bindings: readonly [Binding, ...Binding[]];
    group: "input";
  }): () => void;
  describeBinding(binding: Binding): { keys: readonly string[] };
}

/** One row: the hint that switches the feature off, its label, and its keys in the order a
 *  person presses them (a repeated step repeats its binding, as dsh's own Esc Esc row does). */
interface Row {
  id: string;
  hint: string;
  label: OmcKey;
  presses: readonly [Binding, ...Binding[]];
}

/** The three composer gestures the plugin adds, in the order the Settings card lists them. */
export const ROWS: readonly Row[] = [
  {
    id: "omc.recall",
    hint: "recallOff",
    label: "main.settingsUi.recallTitle",
    presses: [
      { code: "ArrowUp", modifiers: [] },
      { code: "ArrowDown", modifiers: [] },
    ],
  },
  {
    id: "omc.historySearch",
    hint: "historySearchOff",
    label: "main.settingsUi.historyTitle",
    presses: [{ code: "KeyR", modifiers: ["control"] }],
  },
  {
    id: "omc.editLast",
    hint: "editLastOff",
    label: "main.settingsUi.editLastTitle",
    presses: [
      { code: "Escape", modifiers: [] },
      { code: "Escape", modifiers: [] },
    ],
  },
];

/**
 * Keeps one dialog row per switched-on feature while the plugin is mounted. Rows follow the hints
 * store: switching a feature off in Settings removes its row, on puts it back, on every tab. Does
 * nothing on a dsh without the shortcuts service. A registration dsh refuses (an id it already
 * has, a code it does not know) is logged and skipped, never thrown, so the rest of the plugin
 * still mounts. Returns the disposer that removes every row.
 */
export function mountShortcutRows(ctx: ClientCtx): () => void {
  const shortcuts = ctx.get?.<Shortcuts>("shortcuts");
  if (!shortcuts) return () => {};
  const live = new Map<string, () => void>();
  // A hints read still in flight when the plugin is disposed must not register rows nobody will
  // remove.
  let disposed = false;
  const sync = () =>
    loadHints().then((hints) => {
      if (disposed) return;
      for (const row of ROWS) {
        const on = hints[row.hint] !== true;
        const had = live.get(row.id);
        if (on && !had) {
          try {
            live.set(
              row.id,
              shortcuts.registerFixed({
                id: row.id,
                label: () => t(row.label),
                keys: row.presses.flatMap((b) => shortcuts.describeBinding(b).keys),
                bindings: row.presses,
                group: "input",
              }),
            );
          } catch (e) {
            console.warn(`oh-my-claude: shortcut row ${row.id} not listed:`, e);
          }
        } else if (!on && had) {
          had();
          live.delete(row.id);
        }
      }
    });
  const onHints = () => void sync();
  void sync();
  window.addEventListener(HINTS_EVENT, onHints);
  return () => {
    disposed = true;
    window.removeEventListener(HINTS_EVENT, onHints);
    for (const off of live.values()) off();
    live.clear();
  };
}
