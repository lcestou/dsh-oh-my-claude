/**
 * The server's reach into dsh's settings: only the locale namespace, as dsh-client-locale stores
 * it. Two shapes, because dsh moved the read: up to 0.1.6 the service answered a namespace by
 * name, and 0.1.7 replaced that with `describe`, a list of every mounted plugin's live config.
 * Both are optional here, so a dsh with neither reads as English rather than throwing.
 */
export interface LocaleSettingsReader {
    get?(ns: "locale"): {
        preference?: string;
    } | undefined;
    describe?(options?: {
        redact?: boolean;
    }): readonly {
        ns?: unknown;
        value?: unknown;
    }[];
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
    readonly moreLines: "… {n} more lines";
    readonly limitSession: "session limit";
    readonly limitWeekly: "weekly limit";
    readonly limitOpus: "Opus limit";
    readonly limitSonnet: "Sonnet limit";
    readonly limitFable: "Fable limit";
    readonly limitCredit: "usage credit limit";
    readonly limitUsage: "usage limit";
    readonly compacting: "⟳ Compacting context…";
    readonly compactFailed: "⚠ Compaction failed: {error}";
    readonly unknownReason: "unknown reason";
    readonly taskLine: "Task {status}: {detail}";
    readonly taskEnded: "Task {status}";
    readonly taskPaused: "… paused";
    readonly taskCompleted: "completed";
    readonly taskFailed: "failed";
    readonly taskKilled: "killed";
    readonly taskDone: "done";
    readonly modelFallback: "Model fallback";
    readonly modelSwitched: "Model switched";
    readonly requestBlocked: "Request blocked";
    readonly requestBlockedOn: "Request blocked on {from}";
    readonly denied: "Denied {tool}";
    readonly resets: "resets {when}";
    readonly networkDown: "network is down";
    readonly apiError: "API error";
    readonly retryingIn: "Retrying in {s}s";
    readonly retryingInMid: "retrying in {s}s";
    readonly attempt: "attempt {n}/{max}";
    readonly tokensBefore: "{n} tokens before";
    readonly tokensAfter: "{n} after";
    readonly compactManual: "manual";
    readonly compactAuto: "auto";
    readonly compacted: "Context compacted by Claude Code ({parts})";
    readonly listSep: ", ";
    readonly deniedCallsOne: "Claude Code denied {n} tool call that needed approval. Switch Access mode to Full Access to allow them.";
    readonly deniedCallsOther: "Claude Code denied {n} tool calls that needed approval. Switch Access mode to Full Access to allow them.";
    readonly autoBlockedOne: "Auto mode blocked {n} tool call ({reasons}). A Bash permission rule in Claude Code's settings allows such a call; permissionMode bypassPermissions skips the classifier.";
    readonly autoBlockedOther: "Auto mode blocked {n} tool calls ({reasons}). A Bash permission rule in Claude Code's settings allows such a call; permissionMode bypassPermissions skips the classifier.";
    readonly continuingAtReset: "continuing automatically when it resets";
    readonly hitLimit: "You've hit your {name}";
    readonly subagent: "subagent";
    readonly attemptFailed: "{who} attempt{count} failed";
    readonly ranInBridge: "{tool} (ran in bridge)";
    readonly dshTool: "dsh tool";
    readonly noResultRecorded: "No result recorded: the session ended here.";
    readonly noReply: "(no reply)";
    readonly mirrorCut: "… cut here; the whole exchange is in the transcript.";
    readonly btwUsage: "Usage: /btw <your question>";
    readonly btwSent: "Side question sent. The answer opens in the ✻ aside bubble.";
    readonly idleStopped: "claude produced no output for {s}s and was stopped";
    readonly claudeExited: "claude exited {code}: {detail}";
    readonly noOutput: "no output";
    readonly inputDeclined: "{who} asked for input dsh cannot present, declined";
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
