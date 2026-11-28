// The box colour pickers and the sheet that applies them. The same swatch sits before each row's
// name in Boxes and in the Box colours list in Customize; both write the hint
// `boxColour:<providerId>`, so a pick in one shows in the other and in every other tab through
// HINTS_EVENT. The colours themselves come from box-colours.ts.
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { boxColourKey, boxColourSheet, boxColours, THIS_BOX_PROVIDER } from "./box-colours.js";
import { HINTS_EVENT, loadHints, useHintValue } from "./hints.js";
import { t, useLocale } from "./i18n.js";
import { BOXES_EVENT } from "./picker.js";
import { ROUTE, T, btn, readJson } from "./shared.js";

/** One box as the colour pickers name it: its provider id, and the host or account name the
 *  label is built from. */
export type BoxEntry = { provider: string; host: string | null; name?: string | null };

/** Every mounted box from `GET /models?all=1`, the list the swatches and the sheet work from;
 *  undefined when the read fails, so a caller keeps what it last drew rather than dropping every
 *  box but This one until the next change. */
const loadBoxList = (): Promise<Array<BoxEntry> | undefined> =>
  fetch(`${ROUTE}/models?all=1`)
    .then((r) => readJson<{ models?: Array<BoxEntry> }>(r))
    .then((b) => (b.models ?? []).map(({ provider, host, name }) => ({ provider, host, name })))
    .catch(() => undefined);

/** The label a box goes by in the pickers: an account's name, an SSH box's host, or This box. */
export const boxLabel = (b: BoxEntry): string => b.name ?? b.host ?? t("main.sessions.thisBox");

/**
 * Keep `<style id="omc-box-colours">` in step with the hints and the box list: rebuilt on every
 * hints change (a box colour or the accent, picked here or in another tab) and every box added
 * or removed. Only the newest read lands, so two changes in quick succession cannot paint the
 * older one last. Returns the teardown that removes the sheet and the listeners.
 */
export function startBoxColours(): () => void {
  let latest = 0;
  let live = true;

  /** Read hints and boxes and rewrite the sheet; a read that a newer one overtook is dropped. */
  const paint = () => {
    const mine = ++latest;
    void (async () => {
      const [hints, boxes] = await Promise.all([loadHints(), loadBoxList()]);

      if (!live || mine !== latest || !boxes) {
        return;
      }

      let el = document.getElementById("omc-box-colours");

      if (!el) {
        el = document.createElement("style");
        el.id = "omc-box-colours";
        document.head.append(el);
      }

      el.textContent = boxColourSheet(
        hints,
        boxes.map((b) => b.provider),
      );
    })();
  };

  paint();
  window.addEventListener(HINTS_EVENT, paint);
  window.addEventListener(BOXES_EVENT, paint);

  return () => {
    live = false;
    window.removeEventListener(HINTS_EVENT, paint);
    window.removeEventListener(BOXES_EVENT, paint);
    document.getElementById("omc-box-colours")?.remove();
  };
}

/**
 * Every box's current colour, with the box list: re-read on HINTS_EVENT (a pick here, in the other
 * picker, or in another tab, and the accent the automatic shades follow) and on BOXES_EVENT.
 * Empty until the first read lands.
 */
export function useBoxColours(): { boxes: Array<BoxEntry>; colours: Map<string, string> } {
  const [state, setState] = useState<{ boxes: Array<BoxEntry>; colours: Map<string, string> }>({
    boxes: [],
    colours: new Map(),
  });

  useEffect(() => {
    let live = true;
    let latest = 0;

    /** Read hints and boxes together; only the newest read lands. */
    const load = () => {
      const mine = ++latest;
      void (async () => {
        const [hints, boxes] = await Promise.all([loadHints(), loadBoxList()]);

        if (!live || mine !== latest || !boxes) {
          return;
        }

        setState({
          boxes,
          colours: boxColours(
            hints,
            boxes.map((b) => b.provider),
          ),
        });
      })();
    };

    load();
    window.addEventListener(HINTS_EVENT, load);
    window.addEventListener(BOXES_EVENT, load);

    return () => {
      live = false;
      window.removeEventListener(HINTS_EVENT, load);
      window.removeEventListener(BOXES_EVENT, load);
    };
  }, []);

  return state;
}

/** The swatch: a native colour input in a small rounded square, so it opens the system picker and
 *  takes the keyboard like any input. Square, not round: a round one beside a Boxes row's name read
 *  as a second status dot over the green or red one under it. */
const SWATCH: CSSProperties = {
  width: 16,
  height: 16,
  padding: 0,
  border: `1px solid ${T.border}`,
  borderRadius: 4,
  background: "none",
  cursor: "pointer",
  flex: "none",
  overflow: "hidden",
  // The inner swatch of a native colour input carries its own padding and border.
  appearance: "none",
};

/** Inline sheet for the inner swatch of a native colour input, which only pseudo-elements reach;
 *  added once per page. */
const ensureSwatchStyle = (): void => {
  if (document.getElementById("omc-box-swatch-style")) {
    return;
  }

  const el = document.createElement("style");
  el.id = "omc-box-swatch-style";
  el.textContent =
    "[data-omc-box-colour]::-webkit-color-swatch-wrapper{padding:0}" +
    "[data-omc-box-colour]::-webkit-color-swatch{border:none;border-radius:3px}" +
    "[data-omc-box-colour]::-moz-color-swatch{border:none;border-radius:3px}";
  document.head.append(el);
};

/**
 * One box's colour picker. `colour` is the box's colour now (picked or automatic); a pick writes
 * the hint on `change`, not `input`, so a drag through the system picker posts once. With `reset`,
 * a Reset button shows while a colour is picked and clears it back to the automatic shade.
 */
export function BoxColourSwatch({
  provider,
  name,
  colour,
  reset = false,
}: {
  provider: string;
  name: string;
  colour: string | undefined;
  reset?: boolean;
}) {
  useLocale();
  ensureSwatchStyle();
  const [picked, setPicked] = useHintValue(boxColourKey(provider));

  return (
    <>
      <input
        type="color"
        data-omc-box-colour={provider}
        aria-label={t("boxColours.pick", { name })}
        title={t("boxColours.pick", { name })}
        value={colour ?? "#888888"}
        onChange={(e) => setPicked(Number.parseInt(e.target.value.slice(1), 16))}
        style={SWATCH}
      />
      {reset && picked !== undefined && (
        <button
          type="button"
          style={btn}
          data-omc-box-colour-reset={provider}
          aria-label={t("boxColours.reset", { name })}
          onClick={() => setPicked(null)}
        >
          {t("main.settingsUi.reset")}
        </button>
      )}
    </>
  );
}

/**
 * The Box colours list under the accent in Customize: one line per box with its swatch and Reset.
 * Shown only with more than one box, where colours have something to tell apart.
 */
export function BoxColoursList() {
  useLocale();
  const { boxes, colours } = useBoxColours();

  if (boxes.length < 2) {
    return null;
  }

  // This box first, then the others in the order their shades are numbered.
  const ordered = boxes.toSorted((a, b) =>
    a.provider === THIS_BOX_PROVIDER
      ? -1
      : b.provider === THIS_BOX_PROVIDER
        ? 1
        : a.provider.localeCompare(b.provider),
  );

  return (
    <div data-omc-box-colours="" style={{ display: "grid", gap: 6, fontSize: 13 }}>
      <div>{t("boxColours.title")}</div>
      <div style={{ color: T.faint, fontSize: 12 }}>{t("boxColours.hint")}</div>
      {ordered.map((b) => (
        <div
          key={b.provider}
          data-omc-box-colour-row={b.provider}
          style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}
        >
          <BoxColourSwatch
            provider={b.provider}
            name={boxLabel(b)}
            colour={colours.get(b.provider)}
            reset
          />
          <span style={{ color: colours.get(b.provider) ?? T.text }}>{boxLabel(b)}</span>
        </div>
      ))}
    </div>
  );
}
