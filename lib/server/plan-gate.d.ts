/** Claude Code's permission mode in which nothing may change. */
export declare const PLAN_MODE = "plan";
/** What Claude reads when a call is refused in plan mode. Read by the model, so it stays English. */
export declare const PLAN_REFUSAL = "plan mode: this tool can change files or start work; finish the plan and call ExitPlanMode first";
/**
 * Bridged tools that only read, so plan mode may run them. An allowlist on purpose: a tool dsh adds
 * later, a `mcp__<server>__<tool>` passthrough of another MCP server (whose effects the bridge cannot
 * know) and `run_code` (a program that can call any tool) are refused until someone reads what they do.
 *
 * Borderline calls, read in dsh's installed tool packages on 2026-11-10:
 * - `web_fetch`, `web_search`: network reads; Claude's own WebFetch also runs in plan mode.
 * - `skill`: loads a skill's text and nothing else (dsh-tool-skill marks the call `kind: "read"`).
 * - `ask_user_question`, `exit_plan_mode`: ask the user; the plan review is how plan mode ends.
 * - `wait_session`, `wait_agent`, `job_output`: wait for and read work already running.
 * - `cordis_inspect_query`: runs a query its provider declares read-only.
 * - `user_terminal_list`, `user_terminal_read` (dsh 0.2.2-rc.2, read in its source 2026-11-11): list
 *   and read the screen of a terminal the user runs in the side panel; both descriptions say "Runs nothing".
 * Refused although they write no files:
 * - `working_directory`: also changes the session's directory (`cd`), not only reads it.
 * - `todo_write`, `present`, `create_goal`, `update_goal`: change dsh's session state; Claude's
 *   own TodoWrite covers a to-do list while planning.
 * - `interrupt_agent`, `send_message`, `job_kill`: act on running work.
 * - `office_convert`, `office_recalculate` (dsh 0.2.2-rc.2): write a converted or recalculated file.
 * - `office_render` (dsh 0.2.2-rc.2): dsh marks it a read, and it writes no workspace file, only page
 *   images into the session's attachment store. Left off the list all the same: it parses the
 *   document in the dsh host process, outside the shell sandbox, and nobody has asked for it.
 * - `load_workspace_dependencies`: reads where a runtime is, but can also install one under dsh's
 *   home when dsh is configured with a root for it.
 */
export declare const PLAN_SAFE_TOOLS: ReadonlySet<string>;
/** True when a call to `name` must be refused: the session is in plan mode and the tool is not on
 *  the read-only list. An undefined mode (no live process to ask) refuses nothing, as before. */
export declare const planRefuses: (name: string, mode: string | undefined) => boolean;
