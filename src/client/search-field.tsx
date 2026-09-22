// A search box in the shape of dsh's own (its archived-sessions search): the magnifier inside on the
// left, a 32 px field recessed to the base layer, dsh's quieter border. The plugin's three searches
// were the generic text field, which sat a shade lighter than the panel and, inside a column, had
// its height taken by `flex: 1` down to 17 px.
import { IconSearchOutlineMedium } from "./icons.js";
import type { CSSProperties } from "react";

import { T } from "./shared.js";

/** The field itself: dsh's measurements, with the left padding clearing the icon. */
const FIELD: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 32,
  padding: "0 12px 0 36px",
  borderRadius: 8,
  border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,.25))",
  background: "var(--dsw-alias-bg-base, transparent)",
  color: T.text,
  font: "inherit",
  // The panel's rows are 13 px; inheriting would take the host's larger body size.
  fontSize: 13,
};

/**
 * A labelled search input with dsh's magnifier. `hook` names the `data-omc-*` attribute a check
 * selects it by, and `style` sizes the wrapper, which is what sits in the caller's layout; the
 * wrapper does not grow or shrink unless `style` says so, so a column never squeezes it.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  id,
  hook,
  style,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  id?: string;
  hook?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        flex: "none",
        color: T.faint,
        ...style,
      }}
    >
      <span style={{ position: "absolute", left: 12, display: "flex", pointerEvents: "none" }}>
        <IconSearchOutlineMedium size={16} />
      </span>
      <input
        type="search"
        id={id}
        {...(hook ? { [hook]: "" } : {})}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={FIELD}
      />
    </div>
  );
}
