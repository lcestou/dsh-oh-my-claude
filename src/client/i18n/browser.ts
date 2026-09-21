// Strings for the session browser (src/client/browser.tsx).

/** English. */
export const en = {} as const;

/** Chinese, one per English key. */
export const zh = {} satisfies Record<keyof typeof en, string>;
