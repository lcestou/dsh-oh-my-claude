// Words several areas of the plugin share that dsh's own `common` namespace does not have. The
// shared words dsh does have (Copy, Cancel, Loading…) come from dsh itself; see ./dsh-common.ts.

/** English. */
export const en = {
  "common.remove": "Remove",
  "common.unknownError": "unknown error",
} as const;

/** Chinese, one per English key. */
export const zh = {
  "common.remove": "移除",
  "common.unknownError": "未知错误",
} satisfies Record<keyof typeof en, string>;
