import { type GenerateOptions } from "@deepseek-ai/dsh-llm";
import type { JsonValue, ToolSchema } from "../dsh.js";
import { type RowsSupport } from "../rows-probe.js";
import { Config } from "./config.js";
import { type LooseMessage } from "./prompt.js";
/** Claude permission mode for a dsh access mode, or undefined for one this table does not know. */
export declare const modeForAccess: (accessMode: string) => string | undefined;
/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export declare function accessModeOf(messages: LooseMessage[] | undefined): string | undefined;
/** dsh's approval-policy line rides in the same runtime-context injection as the file policy, and
 *  only while the policy is "never"; the last snapshot wins, so a switch back to "ask" clears it. */
export declare function approvalsDisabled(messages: LooseMessage[] | undefined): boolean;
/** The CLI's permission mode for a turn: the configured one, or the one dsh's access mode maps to. */
export declare function permissionModeFor(config: Schemastery.TypeT<typeof Config>, accessMode: string | undefined): string;
/** Probe whether this target supports raw tool rows once and cache the answer, so repeated callers share one ssh probe instead of one per session. */
export declare const rowsSupported: () => Promise<RowsSupport>;
/** Forget what was probed on `host` ("" for this box): after `claude update` there, the flag set
 *  and the denials belong to a binary that is gone, and the next spawn probes the new one. */
export declare function forgetCliProbe(host: string): void;
/** The flag in `error: unknown option '--x'`, however the CLI wrapped the line. */
export declare function unknownFlagIn(text: string): string | undefined;
/** Record a flag the target's CLI refused. False when it was already known bad, which is what stops
 * a retry loop: the second refusal of the same flag is a real failure, not something to retry. */
export declare function denyCliFlag(command: string, host: string | undefined, flag: string): boolean;
/** The slice of node's execFile the probe uses; tests hand in a fake with this shape. */
export type ExecLike = (cmd: string, args: string[], opts: {
    timeout: number;
}, cb: (err: Error | null, stdout: string | Buffer) => void) => void;
/** The target binary's version and the flags its `--help` lists, probed once per binary. */
export declare function probeCli(exec?: ExecLike, command?: string, host?: string): Promise<{
    flags: Set<string> | null;
    version: string;
}>;
/**
 * Checks if a CLI flag is supported. Returns true if flags are unknown
 * (probe failed) to assume support.
 */
export declare const supports: (flags: Set<string> | null | undefined, flag: string) => boolean;
/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export declare const usesStdin: (flags: Set<string> | null | undefined) => boolean;
/**
 * The text appended to the system prompt whenever dsh tools are bridged. Claude Code's own Agent
 * tool spawns children dsh cannot see (no card, no header count, no notice), so subagents must go
 * through the bridged tools, and a background command through dsh's shell tool.
 *
 * It names only what `tools` holds, the schemas the bridge will list for this session. What dsh
 * offers differs by box and by session: the shell tool is `pwsh` on Windows and `bash` elsewhere,
 * a persistent shell takes no `run_in_background`, the preset subagent tools depend on the agent
 * preset, and `subagent` takes a provider and model (with `list_subagent_models` beside it) only
 * in a session that has a model-selection policy. Naming a tool that is not there sends Claude
 * looking for it and then back to a native background shell dsh cannot see.
 *
 * With `tools` undefined (no live agent to ask) only the opening sentence is sent: the bridge
 * answers that session with nothing either.
 */
export declare function dshToolsGuidance(tools?: readonly ToolSchema[]): string;
/**
 * The argument list for one `claude -p` spawn: every flag this plugin sends, in one place.
 *
 * Almost every flag is guarded by `supports`, which asks what this particular CLI binary
 * advertises, so an older Claude Code on a remote box is never handed a flag it would refuse and
 * die on; the feature quietly goes without instead. The one exception worth knowing is
 * `--tools default`, which looks redundant and is not: without it the CLI keeps
 * `AskUserQuestion` out of `-p` runs, so Claude could never ask the person anything.
 *
 * An auxiliary call, a title or a compaction, returns early with one turn, no tools and no session
 * of its own, and never carries a permission mode, allowed tools, budget or resume. Everything
 * after that early return applies only to a real conversation turn.
 */
export declare function buildArgs({ model, reasoningEffort, system, purpose, config, session, accessMode, flags, promptText, mcp, temporary, permissionMode, }: Pick<GenerateOptions, "reasoningEffort" | "system" | "purpose"> & {
    model: string | undefined;
    config: Schemastery.TypeT<typeof Config>;
    session?: {
        id: string;
        resuming: boolean;
    } | undefined;
    accessMode?: string | undefined;
    flags?: Set<string> | null;
    promptText?: string;
    /** The bridge for this session, with the dsh tools it will list (see `dshToolsGuidance`). */
    mcp?: {
        url: string;
        key: string;
        tools?: readonly ToolSchema[] | undefined;
    } | undefined;
    /** /temporary: keep no Claude transcript for this session. */
    temporary?: boolean;
    /** Optional permission mode override; if provided, used instead of computing from config. */
    permissionMode?: string;
}): string[];
/** One stream-json input line: the user turn with text and inline images. `uuid` goes on the line so a later `cancel_async_message` can name it. */
export declare function buildInput(prompt: string, images: Array<{
    mediaType: string;
    data: string;
}>, uuid?: string): string;
/** Names from the CLI's init frame that dsh's command grammar accepts (lowercase, `[a-z0-9_-]`), deduped. */
export declare function commandNames(value: JsonValue | undefined): string[];
/**
 * Bare tool names per MCP server, from the init frame's `mcp__<server>__<tool>` ids. Every known
 * server gets an entry, empty when it contributes nothing; an id whose server is not in the list
 * is dropped rather than guessed at.
 */
export declare function mcpToolsByServer(serverNames: readonly string[], toolIds: readonly string[]): Map<string, string[]>;
/** Bridged Claude commands are registered as `/claude-<name>` in dsh. */
export declare const BRIDGE_PREFIX = "claude-";
/**
 * Names dsh's own client half owns, which the host registry cannot answer for. A host command of
 * one of these makes dsh's menu throw where it merges the two lists ("contribution /X collides with
 * a host command"), and the menu goes blank rather than losing one row. Read out of dsh's client
 * bundles, where a contribution is a `commandUi.register({ name })`; a host command dsh registers
 * normally needs no entry here, since its own registry throws on the duplicate and the bridge falls
 * back to the prefixed name.
 */
export declare const CLIENT_COMMANDS: Set<string>;
/**
 * The dsh title a bridged command should set: the trimmed argument when this is Claude's rename
 * with one. An empty argument returns undefined so the line reaches Claude unchanged and the CLI
 * answers with its own usage message.
 */
export declare function renameTitle(cmd: string, rawInput: string): string | undefined;
export declare const NATIVE_TOOL_MAP: {
    readonly Bash: "bash";
    readonly PowerShell: "pwsh";
    readonly Read: "read";
    readonly Edit: "edit";
    readonly Write: "write";
    readonly Grep: "grep";
    readonly Glob: "glob";
    readonly WebFetch: "web_fetch";
    readonly WebSearch: "web_search";
    readonly MultiEdit: "edit";
    readonly TodoWrite: "todo_write";
    readonly Task: "task";
    readonly NotebookEdit: "notebook_edit";
    readonly BashOutput: "bash_output";
    readonly KillShell: "kill_shell";
    readonly ExitPlanMode: "exit_plan_mode";
    readonly EnterPlanMode: "enter_plan_mode";
    readonly SlashCommand: "slash_command";
};
/** The text dsh's title provider sends: its one framed user message, joined when there are more. */
export declare function titleInput(messages: GenerateOptions["messages"]): string;
