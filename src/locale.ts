// The few strings the server writes that a person reads: the plan review dialog, the "not logged
// in" tag on the provider name, the login failure shown in the chat, and the descriptions of the
// plugin's own slash commands. Everything else the server writes is read by Claude (prompts,
// notices) or matched by code, and stays English.
//
// The language is the one stored under dsh's Settings → General (`locale.preference`, read through
// dsh's settings service). A browser that never picked one follows its own language, which the
// server cannot see; those readers get English here while the client, which can, shows Chinese.

/**
 * The server's reach into dsh's settings: only the locale namespace, as dsh-client-locale stores
 * it. Two shapes, because dsh moved the read: up to 0.1.6 the service answered a namespace by
 * name, and 0.1.7 replaced that with `describe`, a list of every mounted plugin's live config.
 * Both are optional here, so a dsh with neither reads as English rather than throwing.
 */
export interface LocaleSettingsReader {
  get?(ns: "locale"): { preference?: string } | undefined;
  describe?(options?: { redact?: boolean }): readonly { ns?: unknown; value?: unknown }[];
}

/** The stored language tag, through whichever read this dsh offers, or undefined for neither. */
const preferenceOf = (read: LocaleSettingsReader): string | undefined => {
  const named = read.get?.("locale")?.preference;
  if (named !== undefined) return named;
  for (const entry of read.describe?.({ redact: true }) ?? []) {
    if (entry.ns !== "locale") continue;
    // SAFETY: the descriptor's value is the entry's live config, which for dsh-client-locale is
    // `{ preference }`; anything else reads as no preference through the optional chain below.
    const value = entry.value as { preference?: string } | undefined;
    if (value?.preference !== undefined) return value.preference;
  }
  return undefined;
};

const EN = {
  notLoggedIn: "not logged in",
  planHeader: "Plan review",
  planQuestion: "Approve this plan and leave plan mode?",
  planApprove: "Approve",
  planApproveDetail: "Leave plan mode and carry the plan out.",
  planKeep: "Keep planning",
  planKeepDetail: "Stay in plan mode; your feedback goes to Claude.",
  loginFailure:
    "Claude Code is not logged in on {host}. Use Log in above the composer, or run `claude auth login` in a terminal there, then send your message again. ({detail})",
  loggedOutError: "not logged in on {host}. Log in under Settings, Oh My Claude, Boxes",
  temporaryCommand: "Oh My Claude: keep no Claude transcript for this session (toggle)",
  btwCommand: "Oh My Claude: ask Claude a quick side question without interrupting the turn",
  btwHint: "<your question>",
  // Tool header words, written into the chat as each tool runs. dsh keeps Bash, Grep and Glob in
  // English on its own cards, so those are not here; the rest follow dsh's own card labels.
  toolRead: "Read",
  toolWrite: "Write",
  toolEdit: "Edit",
  toolNotebookEdit: "Notebook edit",
  toolWebFetch: "Web fetch",
  toolWebSearch: "Web search",
  toolTodoWrite: "Todo write",
  toolTask: "Task",
  toolExitPlanMode: "Exit plan mode",
  toolEnterPlanMode: "Enter plan mode",
  toolSlashCommand: "Slash command",
  toolBashOutput: "Bash output",
  toolKillShell: "Kill shell",
  toolResult: "Result",
  toolError: "Error",
  // Status lines the translator writes into the chat as a turn runs.
  moreLines: "… {n} more lines",
  limitSession: "session limit",
  limitWeekly: "weekly limit",
  limitOpus: "Opus limit",
  limitSonnet: "Sonnet limit",
  limitFable: "Fable limit",
  limitCredit: "usage credit limit",
  limitUsage: "usage limit",
  compacting: "⟳ Compacting context…",
  compactFailed: "⚠ Compaction failed: {error}",
  unknownReason: "unknown reason",
  taskLine: "Task {status}: {detail}",
  taskEnded: "Task {status}",
  taskPaused: "… paused",
  taskCompleted: "completed",
  taskFailed: "failed",
  taskKilled: "killed",
  taskDone: "done",
  modelFallback: "Model fallback",
  modelSwitched: "Model switched",
  requestBlocked: "Request blocked",
  requestBlockedOn: "Request blocked on {from}",
  denied: "Denied {tool}",
  resets: "resets {when}",
  networkDown: "network is down",
  apiError: "API error",
  retryingIn: "Retrying in {s}s",
  retryingInMid: "retrying in {s}s",
  attempt: "attempt {n}/{max}",
  tokensBefore: "{n} tokens before",
  tokensAfter: "{n} after",
  compactManual: "manual",
  compactAuto: "auto",
  compacted: "Context compacted by Claude Code ({parts})",
  listSep: ", ",
  deniedCallsOne:
    "Claude Code denied {n} tool call that needed approval. Switch Access mode to Full Access to allow them.",
  deniedCallsOther:
    "Claude Code denied {n} tool calls that needed approval. Switch Access mode to Full Access to allow them.",
  autoBlockedOne:
    "Auto mode blocked {n} tool call ({reasons}). A Bash permission rule in Claude Code's settings allows such a call; permissionMode bypassPermissions skips the classifier.",
  autoBlockedOther:
    "Auto mode blocked {n} tool calls ({reasons}). A Bash permission rule in Claude Code's settings allows such a call; permissionMode bypassPermissions skips the classifier.",
  continuingAtReset: "continuing automatically when it resets",
  hitLimit: "You've hit your {name}",
  subagent: "subagent",
  attemptFailed: "{who} attempt{count} failed",
  ranInBridge: "{tool} (ran in bridge)",
  dshTool: "dsh tool",
  resultPending: "(still running when dsh took over this step; the output shows in the next step)",
  noResultRecorded: "No result recorded: the session ended here.",
  seededSystemPrompt:
    "No system prompt recorded: these turns were restored from a Claude Code transcript, and Claude Code ran them with its own prompt.",
  noReply: "(no reply)",
  mirrorCut: "… cut here; the whole exchange is in the transcript.",
  btwUsage: "Usage: /btw <your question>",
  btwSent: "Side question sent. The answer opens in the ✻ aside bubble.",
  idleStopped: "claude produced no output for {s}s and was stopped",
  claudeExited: "claude exited {code}: {detail}",
  noOutput: "no output",
  inputDeclined: "{who} asked for input dsh cannot present, declined",
} as const;

/** A key of the server's own strings. */
export type ServerKey = keyof typeof EN;

const ZH = {
  notLoggedIn: "未登录",
  planHeader: "计划审阅",
  planQuestion: "同意执行这份计划并退出计划模式？",
  planApprove: "同意执行",
  planApproveDetail: "退出计划模式，按计划执行。",
  planKeep: "继续规划",
  planKeepDetail: "留在计划模式；你的反馈会发给 Claude。",
  loginFailure:
    "Claude Code 在 {host} 上未登录。请点击输入框上方的登录，或在那台主机的终端里运行 `claude auth login`，然后重新发送消息。（{detail}）",
  loggedOutError: "在 {host} 上未登录。请在 设置 → Oh My Claude → 主机 中登录",
  temporaryCommand: "Oh My Claude：此会话不保留 Claude 记录（开关）",
  btwCommand: "Oh My Claude：向 Claude 快速提一个旁问，不打断当前回合",
  btwHint: "<你的问题>",
  toolRead: "读取",
  toolWrite: "写入",
  toolEdit: "编辑",
  toolNotebookEdit: "编辑笔记本",
  toolWebFetch: "网页获取",
  toolWebSearch: "网页搜索",
  toolTodoWrite: "更新任务清单",
  toolTask: "子智能体",
  toolExitPlanMode: "退出计划模式",
  toolEnterPlanMode: "进入计划模式",
  toolSlashCommand: "指令",
  toolBashOutput: "Bash 输出",
  toolKillShell: "结束 Shell",
  toolResult: "输出",
  toolError: "失败",
  moreLines: "… 其余 {n} 行",
  limitSession: "会话额度",
  limitWeekly: "每周额度",
  limitOpus: "Opus 额度",
  limitSonnet: "Sonnet 额度",
  limitFable: "Fable 额度",
  limitCredit: "用量额度上限",
  limitUsage: "用量上限",
  compacting: "⟳ 正在压缩上下文…",
  compactFailed: "⚠ 压缩失败：{error}",
  unknownReason: "未知原因",
  taskLine: "任务{status}：{detail}",
  taskEnded: "任务{status}",
  taskPaused: "… 已暂停",
  taskCompleted: "已完成",
  taskFailed: "失败",
  taskKilled: "已终止",
  taskDone: "已完成",
  modelFallback: "已切换到备用模型",
  modelSwitched: "已切换模型",
  requestBlocked: "请求被拦截",
  requestBlockedOn: "请求在 {from} 上被拦截",
  denied: "已拒绝 {tool}",
  resets: "{when} 重置",
  networkDown: "网络已断开",
  apiError: "API 错误",
  retryingIn: "{s} 秒后重试",
  retryingInMid: "{s} 秒后重试",
  attempt: "第 {n}/{max} 次尝试",
  tokensBefore: "压缩前 {n} token",
  tokensAfter: "压缩后 {n}",
  compactManual: "手动",
  compactAuto: "自动",
  compacted: "Claude Code 已压缩上下文（{parts}）",
  listSep: "，",
  deniedCallsOne: "Claude Code 拒绝了 {n} 次需要批准的工具调用。将访问模式切换为完全权限即可允许。",
  deniedCallsOther:
    "Claude Code 拒绝了 {n} 次需要批准的工具调用。将访问模式切换为完全权限即可允许。",
  autoBlockedOne:
    "自动模式拦截了 {n} 次工具调用（{reasons}）。在 Claude Code 设置中添加 Bash 权限规则可允许这类调用；permissionMode 设为 bypassPermissions 会跳过分类器。",
  autoBlockedOther:
    "自动模式拦截了 {n} 次工具调用（{reasons}）。在 Claude Code 设置中添加 Bash 权限规则可允许这类调用；permissionMode 设为 bypassPermissions 会跳过分类器。",
  continuingAtReset: "重置后将自动继续",
  hitLimit: "已达到{name}",
  subagent: "子智能体",
  attemptFailed: "{who} 第{count} 次尝试失败",
  ranInBridge: "{tool}（在桥接中运行）",
  dshTool: "dsh 工具",
  resultPending: "（dsh 接管此步骤时仍在运行；输出将显示在下一步骤中）",
  noResultRecorded: "未记录结果：会话在此结束。",
  seededSystemPrompt:
    "未记录系统提示：这些轮次从 Claude Code 会话记录恢复，由 Claude Code 自带的提示驱动。",
  noReply: "（无回复）",
  mirrorCut: "… 在此截断；完整对话在会话记录中。",
  btwUsage: "用法：/btw <你的问题>",
  btwSent: "旁问已发送。回答会显示在 ✻ 旁问气泡中。",
  idleStopped: "claude 连续 {s} 秒没有输出，已停止",
  claudeExited: "claude 已退出（{code}）：{detail}",
  noOutput: "无输出",
  inputDeclined: "{who} 请求了 dsh 无法显示的输入，已拒绝",
} satisfies Record<ServerKey, string>;

let reader: LocaleSettingsReader | undefined;

/** Point the server strings at dsh's settings service; without one (a test, an older dsh) they stay
 *  English. Returns the disposer that forgets it. */
export function bindServerLocale(settings: LocaleSettingsReader | undefined): () => void {
  reader = settings;
  return () => {
    if (reader === settings) reader = undefined;
  };
}

/** Whether the stored preference is Chinese; any `zh…` tag counts. A read that throws (the
 *  namespace not registered yet) reads as English. */
export function serverIsChinese(read: LocaleSettingsReader | undefined = reader): boolean {
  try {
    if (read === undefined) return false;
    return preferenceOf(read)?.toLowerCase().startsWith("zh") ?? false;
  } catch {
    return false;
  }
}

/** The server string for `key` in the stored language, `{name}` placeholders filled. */
export function serverText(key: ServerKey, params?: Record<string, string>): string {
  const text: string = serverIsChinese() ? ZH[key] : EN[key];
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole) : text;
}
