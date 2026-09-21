// Words many areas share. Area files hold their own; a string lands here only when three or more
// areas use it verbatim.

/** English. */
export const en = {
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.copyBlocked": "Copy blocked",
  "common.remove": "Remove",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.close": "Close",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.unknownError": "unknown error",
} as const;

/** Chinese, one per English key. */
export const zh = {
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.copyBlocked": "无法复制",
  "common.remove": "移除",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.close": "关闭",
  "common.loading": "加载中…",
  "common.retry": "重试",
  "common.unknownError": "未知错误",
} satisfies Record<keyof typeof en, string>;
