// Plan-mode gate for the MCP bridge. Every bridged tool carries `readOnlyHint: true` so Claude Code
// runs parallel calls side by side, and Claude Code's plan mode runs a read-only-hinted MCP tool
// without asking (probed on CLI 2.1.322). Without this gate a session in plan mode could run dsh's
// shell or start subagents while Claude is meant to be only planning. The bridge asks `planRefuses`
// before every tools/call, with the mode the session's CLI is in at that moment.
/** Claude Code's permission mode in which nothing may change. */
export const PLAN_MODE = "plan";
/** What Claude reads when a call is refused in plan mode. Read by the model, so it stays English. */
export const PLAN_REFUSAL = "plan mode: this tool can change files or start work; finish the plan and call ExitPlanMode first";
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
 * Refused although they write no files:
 * - `working_directory`: also changes the session's directory (`cd`), not only reads it.
 * - `todo_write`, `present`, `create_goal`, `update_goal`: change dsh's session state; Claude's
 *   own TodoWrite covers a to-do list while planning.
 * - `interrupt_agent`, `send_message`, `job_kill`: act on running work.
 */
export const PLAN_SAFE_TOOLS = new Set([
    "ask_user_question",
    "cordis_inspect_list",
    "cordis_inspect_query",
    "exit_plan_mode",
    "get_goal",
    "job_list",
    "job_output",
    "list_agents",
    "list_mcp_resource_templates",
    "list_mcp_resources",
    "list_subagent_models",
    "load_workspace_dependencies",
    "read_image",
    "read_mcp_resource",
    "schedule_list",
    "schedule_view",
    "session_event_read",
    "session_event_search",
    "session_event_trace",
    "session_search",
    "session_trace",
    "skill",
    "team_task_get",
    "team_task_list",
    "terminal_list",
    "terminal_read",
    "wait_agent",
    "wait_session",
    "web_fetch",
    "web_search",
]);
/** True when a call to `name` must be refused: the session is in plan mode and the tool is not on
 *  the read-only list. An undefined mode (no live process to ask) refuses nothing, as before. */
export const planRefuses = (name, mode) => mode === PLAN_MODE && !PLAN_SAFE_TOOLS.has(name);
//# sourceMappingURL=plan-gate.js.map