// The plugin's toggle, shared by the Settings rows and anything nested under them.

/** dsh's own settings switch, drawn with its measurements and colour tokens: a 36 by 20 pill with a
 *  16 px thumb that slides 16 px, brand-coloured when on. Its class names are generated per build,
 *  so the look is copied rather than the class borrowed. Disabled, it dims and ignores clicks. */
export function Switch({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        boxSizing: "border-box",
        position: "relative",
        flex: "0 0 auto",
        width: 36,
        height: 20,
        padding: 2,
        border: 0,
        borderRadius: 10,
        background: on ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l3)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 120ms ease",
      }}
    >
      <span
        style={{
          display: "block",
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--dsw-alias-label-primary-foreground)",
          transform: on ? "translateX(16px)" : "none",
          transition: "transform 120ms ease",
        }}
      />
    </button>
  );
}
