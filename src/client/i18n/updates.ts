// Strings for the Claude Code update card (src/client/claude-updates.tsx).

/** English. */
export const en = {} as const;

/** Chinese, one per English key. */
export const zh = {} satisfies Record<keyof typeof en, string>;
