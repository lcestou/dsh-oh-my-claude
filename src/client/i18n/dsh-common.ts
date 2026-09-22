// Words dsh already translates in its own `common` namespace (dsh-client-locale). The plugin does not
// register these: a key missing from `oh-my-claude` falls through to dsh's `common`, so the button
// says exactly what dsh's own buttons say, in every language dsh ships and any it adds. The English
// here is only for a dsh with no locale service, where `t()` answers from this table.

/** English fallback for the dsh `common` keys the plugin uses; keys are dsh's own, unprefixed. */
export const en = {
  copy: "Copy",
  copied: "Copied",
  "copy.failed": "Copy failed",
  cancel: "Cancel",
  close: "Close",
  loading: "Loading…",
  save: "Save",
  edit: "Edit",
} as const;
