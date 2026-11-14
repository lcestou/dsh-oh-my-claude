import { createHash } from "node:crypto";
// What `isolate: true` hands Claude Code instead of the user's own Claude settings: the flags that
// keep every settings file, MCP server and hook out, the settings it passes itself, and the
// environment that switches off what those files might have switched off, and more.
/**
 * Settings passed with `--settings` under `isolate`. With every setting source off, these are the
 * only settings the CLI reads. Each one turns off a feature that would keep a record or a channel
 * of its own beside dsh's: notes the model saves for later sessions, a recap written for someone
 * coming back to a terminal, a co-author line or git guidance in commits, and the web-fetch domain
 * check that phones home before a fetch.
 */
export const ISOLATED_SETTINGS = {
    autoMemoryEnabled: false,
    awaySummaryEnabled: false,
    includeCoAuthoredBy: false,
    attribution: { commit: "", pr: "" },
    includeGitInstructions: false,
    skipWebFetchPreflight: true,
};
/**
 * Environment for a local Claude under `isolate`. The user's `~/.claude/settings.json` is where a
 * telemetry or traffic switch usually lives, and it is not read any more, so the plugin sets them
 * itself. The rest switch off what dsh does for itself (CLAUDE.md and memory files, file
 * checkpoints, bundled skills, the advisor that asks another model mid-task, next-prompt guesses,
 * which are model calls of their own). An empty value removes the name (`childEnv`):
 * `CLAUDE_CODE_SIMPLE` would skip the subscription login and `CLAUDE_CODE_EFFORT_LEVEL` would
 * override dsh's effort pick. `MCP_TOOL_TIMEOUT` goes far past the plugin's usual hour, since a
 * relayed dsh tool (a subagent, an approval someone answers tomorrow) takes as long as it takes,
 * held under setTimeout's 2^31 ms ceiling, past which a timer fires at once.
 * `MAX_MCP_OUTPUT_TOKENS` lets a dsh result through whole, so dsh's own truncation and spilling
 * decide what the model reads.
 */
export const ISOLATED_ENV = {
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    DISABLE_ERROR_REPORTING: "1",
    DISABLE_FEEDBACK_COMMAND: "1",
    DISABLE_BUG_COMMAND: "1",
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    CLAUDE_CODE_SEND_FEEDBACK: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_FEATURE_FLAGS: "1",
    DISABLE_AUTOUPDATER: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: "1",
    CLAUDE_CODE_DISABLE_ADVISOR_TOOL: "1",
    CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING: "1",
    CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "",
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false",
    CLAUDE_CODE_SIMPLE: "",
    CLAUDE_CODE_EFFORT_LEVEL: "",
    MCP_TOOL_TIMEOUT: "2000000000",
    MAX_MCP_OUTPUT_TOKENS: "1000000",
};
/**
 * A short digest of the config that decides how Claude Code is started past what the process spec
 * already names: the built-in tools, the tool loading and the isolation. Undefined while all three
 * are at their defaults, so a spec on a default config keys exactly as it did before they existed.
 */
export function engineDigest(config) {
    const { builtinTools, toolLoading, isolate } = config;
    const plain = builtinTools.length === 1 &&
        builtinTools[0] === "default" &&
        toolLoading === "claude" &&
        !isolate;
    if (plain)
        return undefined;
    const text = JSON.stringify([builtinTools, toolLoading, isolate]);
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
//# sourceMappingURL=isolate.js.map