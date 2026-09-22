/** The server's reach into dsh's settings: only the locale namespace, as dsh-client-locale stores it. */
export interface LocaleSettingsReader {
    get(ns: "locale"): {
        preference?: string;
    } | undefined;
}
declare const EN: {
    readonly notLoggedIn: "not logged in";
    readonly planHeader: "Plan review";
    readonly planQuestion: "Approve this plan and leave plan mode?";
    readonly planApprove: "Approve";
    readonly planApproveDetail: "Leave plan mode and carry the plan out.";
    readonly planKeep: "Keep planning";
    readonly planKeepDetail: "Stay in plan mode; your feedback goes to Claude.";
    readonly loginFailure: "Claude Code is not logged in on {host}. Use Log in above the composer, or run `claude auth login` in a terminal there, then send your message again. ({detail})";
    readonly loggedOutError: "not logged in on {host}. Log in under Settings, Oh My Claude, Boxes";
    readonly temporaryCommand: "Oh My Claude: keep no Claude transcript for this session (toggle)";
    readonly btwCommand: "Oh My Claude: ask Claude a quick side question without interrupting the turn";
    readonly btwHint: "<your question>";
    readonly toolRead: "Read";
    readonly toolWrite: "Write";
    readonly toolEdit: "Edit";
    readonly toolNotebookEdit: "Notebook edit";
    readonly toolWebFetch: "Web fetch";
    readonly toolWebSearch: "Web search";
    readonly toolTodoWrite: "Todo write";
    readonly toolTask: "Task";
    readonly toolExitPlanMode: "Exit plan mode";
    readonly toolEnterPlanMode: "Enter plan mode";
    readonly toolSlashCommand: "Slash command";
    readonly toolBashOutput: "Bash output";
    readonly toolKillShell: "Kill shell";
    readonly toolResult: "Result";
    readonly toolError: "Error";
};
/** A key of the server's own strings. */
export type ServerKey = keyof typeof EN;
/** Point the server strings at dsh's settings service; without one (a test, an older dsh) they stay
 *  English. Returns the disposer that forgets it. */
export declare function bindServerLocale(settings: LocaleSettingsReader | undefined): () => void;
/** Whether the stored preference is Chinese; any `zh…` tag counts. A read that throws (the
 *  namespace not registered yet) reads as English. */
export declare function serverIsChinese(read?: LocaleSettingsReader | undefined): boolean;
/** The server string for `key` in the stored language, `{name}` placeholders filled. */
export declare function serverText(key: ServerKey, params?: Record<string, string>): string;
export {};
