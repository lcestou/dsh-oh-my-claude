// The second opinion: the card above the composer and its Settings row.

/** English. */
export const en = {
  "secondOpinion.title": "Second opinion",
  "secondOpinion.ready": "Files changed this turn: {count}",
  "secondOpinion.run": "Get a second opinion",
  "secondOpinion.running": "{model} is reviewing this turn's changes…",
  "secondOpinion.clean": "{model} found nothing to fix.",
  "secondOpinion.found": "{model} raised {count} · {took}",
  "secondOpinion.partial":
    "Reviewed {reviewed} of {count} files. The rest did not fit in one review.",
  "secondOpinion.kind.bug": "Bug",
  "secondOpinion.kind.risk": "Risk",
  "secondOpinion.kind.note": "Note",
  "secondOpinion.send": "Send to Claude",
  "secondOpinion.sendAll": "Send all to Claude",
  "secondOpinion.sendOneAria": "Send finding {n} to Claude",
  "secondOpinion.dismissAria": "Close the second opinion",
  "secondOpinion.actionFailed": "That did not go through. Try again.",
  "secondOpinion.fail.gone": "{model} is no longer offered by dsh. Pick another model in Settings.",
  "secondOpinion.fail.timeout": "{model} did not answer within 10 minutes.",
  "secondOpinion.fail.error": "{model} failed: {detail}",
  "secondOpinion.fail.empty": "{model} sent back no review.",
  "secondOpinion.settingDesc":
    "After a Claude turn that changes files in a git repository, another model you pick from dsh's providers reviews that turn's changes and lists what it finds above the composer. Nothing goes to Claude unless you send it. Each review uses that provider's tokens, and a local model can take several minutes.",
  "secondOpinion.modelAria": "Model for the second opinion",
  "secondOpinion.off": "Off",
  "secondOpinion.unavailable": "{model} (not available)",
  "secondOpinion.auto": "Review every turn that changes files",
  "secondOpinion.noModels":
    "dsh has no other model to review with. Add a provider in dsh's settings first.",
  "secondOpinion.saveFailed": "Could not save. Try again.",
} as const;

/** Chinese. */
export const zh = {
  "secondOpinion.title": "第二意见",
  "secondOpinion.ready": "本轮改动的文件：{count}",
  "secondOpinion.run": "获取第二意见",
  "secondOpinion.running": "{model} 正在审查本轮的改动…",
  "secondOpinion.clean": "{model} 没有发现需要修改的地方。",
  "secondOpinion.found": "{model} 提出 {count} 条 · {took}",
  "secondOpinion.partial": "已审查 {count} 个文件中的 {reviewed} 个，其余的放不进一次审查。",
  "secondOpinion.kind.bug": "缺陷",
  "secondOpinion.kind.risk": "风险",
  "secondOpinion.kind.note": "备注",
  "secondOpinion.send": "发给 Claude",
  "secondOpinion.sendAll": "全部发给 Claude",
  "secondOpinion.sendOneAria": "把第 {n} 条发给 Claude",
  "secondOpinion.dismissAria": "关闭第二意见",
  "secondOpinion.actionFailed": "操作没有成功，请重试。",
  "secondOpinion.fail.gone": "dsh 已不再提供 {model}。请在设置中另选一个模型。",
  "secondOpinion.fail.timeout": "{model} 在 10 分钟内没有回应。",
  "secondOpinion.fail.error": "{model} 出错：{detail}",
  "secondOpinion.fail.empty": "{model} 没有返回审查结果。",
  "secondOpinion.settingDesc":
    "Claude 的某一轮改动了 git 仓库中的文件后，由你从 dsh 的提供商中选的另一个模型审查这一轮的改动，并把发现列在输入框上方。只有你发送时才会交给 Claude。每次审查都会消耗该提供商的 token，本地模型可能要几分钟。",
  "secondOpinion.modelAria": "第二意见使用的模型",
  "secondOpinion.off": "关闭",
  "secondOpinion.unavailable": "{model}（不可用）",
  "secondOpinion.auto": "每轮改动文件后自动审查",
  "secondOpinion.noModels": "dsh 没有可用于审查的其他模型。请先在 dsh 的设置中添加提供商。",
  "secondOpinion.saveFailed": "保存失败，请重试。",
} as const;
