// Strings for the chat surface: status row, cost pill, notices, composer controls and the Settings sections (src/client/index.tsx).

/** English. */
export const en = {} as const;

/** Chinese, one per English key. */
export const zh = {} satisfies Record<keyof typeof en, string>;
