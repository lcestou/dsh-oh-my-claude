// The few strings the server writes that a person reads: the plan review dialog, the "not logged
// in" tag on the provider name, the login failure shown in the chat, and the descriptions of the
// plugin's own slash commands. Everything else the server writes is read by Claude (prompts,
// notices) or matched by code, and stays English.
//
// The language is the one stored under dsh's Settings → General (`locale.preference`, read through
// dsh's settings service). A browser that never picked one follows its own language, which the
// server cannot see; those readers get English here while the client, which can, shows Chinese.
const EN = {
    notLoggedIn: "not logged in",
    planHeader: "Plan review",
    planQuestion: "Approve this plan and leave plan mode?",
    planApprove: "Approve",
    planApproveDetail: "Leave plan mode and carry the plan out.",
    planKeep: "Keep planning",
    planKeepDetail: "Stay in plan mode; your feedback goes to Claude.",
    loginFailure: "Claude Code is not logged in on {host}. Use Log in above the composer, or run `claude auth login` in a terminal there, then send your message again. ({detail})",
    loggedOutError: "not logged in on {host}. Log in under Settings, Oh My Claude, Boxes",
    temporaryCommand: "Oh My Claude: keep no Claude transcript for this session (toggle)",
    btwCommand: "Oh My Claude: ask Claude a quick side question without interrupting the turn",
    btwHint: "<your question>",
};
const ZH = {
    notLoggedIn: "未登录",
    planHeader: "计划审阅",
    planQuestion: "同意执行这份计划并退出计划模式？",
    planApprove: "同意执行",
    planApproveDetail: "退出计划模式，按计划执行。",
    planKeep: "继续规划",
    planKeepDetail: "留在计划模式；你的反馈会发给 Claude。",
    loginFailure: "Claude Code 在 {host} 上未登录。请点击输入框上方的登录，或在那台机器的终端里运行 `claude auth login`，然后重新发送消息。（{detail}）",
    loggedOutError: "在 {host} 上未登录。请在 设置 → Oh My Claude → 主机 中登录",
    temporaryCommand: "Oh My Claude：此会话不保留 Claude 记录（开关）",
    btwCommand: "Oh My Claude：向 Claude 快速提一个旁支问题，不打断当前回合",
    btwHint: "<你的问题>",
};
let reader;
/** Point the server strings at dsh's settings service; without one (a test, an older dsh) they stay
 *  English. Returns the disposer that forgets it. */
export function bindServerLocale(settings) {
    reader = settings;
    return () => {
        if (reader === settings)
            reader = undefined;
    };
}
/** Whether the stored preference is Chinese; any `zh…` tag counts. A read that throws (the
 *  namespace not registered yet) reads as English. */
export function serverIsChinese(read = reader) {
    try {
        return read?.get("locale")?.preference?.toLowerCase().startsWith("zh") ?? false;
    }
    catch {
        return false;
    }
}
/** The server string for `key` in the stored language, `{name}` placeholders filled. */
export function serverText(key, params) {
    const text = serverIsChinese() ? ZH[key] : EN[key];
    return params ? text.replace(/\{(\w+)\}/g, (whole, name) => params[name] ?? whole) : text;
}
//# sourceMappingURL=locale.js.map