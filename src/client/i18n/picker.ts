// Strings for the model picker additions (src/client/picker.tsx).
//
// The Add workspace dialog's own copy (title, Home, New folder, …) is read from dsh's
// `directory-browser` dictionary, not from here; these are only the strings this plugin adds on top:
// the box dropdown and its errors.

/** English. */
export const en = {
  "picker.thisBox": "This box",
  "picker.box": "Box",
  "picker.noListing": "dsh's directory listing is not available",
} as const;

/** Chinese, one per English key. */
export const zh = {
  "picker.thisBox": "本机",
  "picker.box": "主机",
  "picker.noListing": "dsh 的目录列表不可用",
} satisfies Record<keyof typeof en, string>;
