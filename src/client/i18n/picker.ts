// Strings for the model picker additions (src/client/picker.tsx).

/** English. */
export const en = {} as const;

/** Chinese, one per English key. */
export const zh = {} satisfies Record<keyof typeof en, string>;
