// Strings for the directory browser (src/client/browser.tsx).
//
// The dialog's copy (title, Home, New folder, Open, …) comes through the `t` prop, which reads
// dsh's own `directory-browser` dictionary. Only the strings that dictionary has no key for live
// here; right now that is the breadcrumb nav's label.

/** English. */
export const en = {
  "browser.folderPath": "Folder path",
} as const;

/** Chinese, one per English key. */
export const zh = {
  "browser.folderPath": "文件夹路径",
} satisfies Record<keyof typeof en, string>;
