// The version of dsh this plugin runs beside, the remote workspace registry, the config schema and the shape it produces.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { createRequire } from "node:module";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveCommand } from "../process.js";
import { STATE_DIR } from "../state.js";
import { versionOf } from "../report.js";
import type { RemoteWorkspace } from "../sessions.js";

// dsh's own version for the bug report, read off the package this plugin is loaded beside.
// Unknown when the plugin runs from a checkout without dsh's tree in reach.
export const DSH_VERSION: string | null = (() => {
  try {
    return versionOf(createRequire(import.meta.url)("@deepseek-ai/dsh-llm/package.json"));
  } catch {
    return null;
  }
})();

/** Live placeholder→remote map for remote workspaces, shared by every box's ssh spawner. Loaded at
 * boot and replaced whenever the panel edits the list, so a redirect applies without a dsh restart. */
let remoteWorkspaces: RemoteWorkspace[] = [];
/** Replace the redirect map: the boot read and every panel edit land here. Exported so the offline
 * suite can drive the two lookups below without a dsh mount. */
export function setRemoteWorkspaces(workspaces: RemoteWorkspace[]): void {
  remoteWorkspaces = workspaces;
  remoteWorkspacesKnown = true;
}
/** Whether the map above has been fed at all: before the routes' first read lands, an empty map
 *  means "not read yet", not "no remote workspaces". */
let remoteWorkspacesKnown = false;
/** Where every remote workspace's stand-in folder lives. */
const STAND_INS = join(STATE_DIR, "remote-workspaces");
/**
 * Whether `cwd` is the stand-in of a remote workspace that no longer exists. Removing a box, or
 * deleting the workspace, drops its row and its stand-in folder, but dsh keeps the sessions and
 * lists them under Ungrouped with the stand-in as their cwd. A turn there has no box to run on:
 * spawned here it died on a missing directory as "claude exited -1: no output" (seen live
 * 2026-09-17), and on an ssh box's own provider it would have run in the far `$HOME` instead.
 */
export const isOrphanedStandIn = (cwd: string): boolean =>
  remoteWorkspacesKnown && cwd.startsWith(`${STAND_INS}/`) && remoteWorkspaceFor(cwd) === undefined;
/** The real remote path for a placeholder workspace on `host`, or `cwd` unchanged. */
export function remoteCwdFor(host: string, cwd: string): string {
  return remoteWorkspaces.find((w) => w.host === host && w.path === cwd)?.remoteCwd ?? cwd;
}
/** The box a turn runs on: this instance's own host when it has one, else the box a remote-workspace
 * cwd belongs to. The choice is by truthiness because `sshHost` defaults to `""`, not undefined.
 * `??` treats that empty string as an answer, which is how a local provider's turn came to probe the
 * local binary for flags while its spawn ran on the box (2026-09-09: `--forward-subagent-text`, a
 * flag this box's CLI has and the box's 2.1.123 does not). */
export const boxFor = (sshHost: string | undefined, workspaceHost: string | undefined) =>
  sshHost || workspaceHost || undefined;

/** The remote workspace whose local placeholder is `cwd`, if any. A session opened on this cwd must
 * run over SSH on that box regardless of the provider chosen, so a local provider does not sit in the
 * empty placeholder dir. */
export function remoteWorkspaceFor(cwd: string): RemoteWorkspace | undefined {
  return remoteWorkspaces.find((w) => w.path === cwd);
}

/** Configuration shape produced by the Config schema with defaults applied. */
export type Config = {
  command: string;
  /** Unset unless the plugin config names one; the Settings switch decides then (spawn-mode.ts). */
  spawn?: "keeper" | "node" | "dsh";
  sshHost: string;
  configDir: string;
  permissionMode:
    | "dsh"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto"
    | "manual";
  hiddenModels: string[];
  customModels: CustomModel[];
  allowedTools: string[];
  disallowedTools: string[];
  builtinTools: string[];
  toolLoading: "claude" | "dsh";
  followToolSet: boolean;
  addDirs: string[];
  pluginDirs: string[];
  pluginUrls: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  titleModel: string;
  toolActivity: boolean;
  toolsInline?: boolean;
  hookRows: boolean;
  resume: boolean;
  idleTimeoutMs: number;
  toolTextLimit: number;
  dshTools: boolean;
  systemPrompt: "claude" | "dsh";
  verbatimPrompts: boolean;
  fastMode: boolean;
  commandBridge: boolean;
  redactSecrets: boolean;
  persistTodos: boolean;
  cliCompaction: boolean;
  debug: boolean;
  approvals: boolean;
  processIdleMs: number;
  maxProcesses: number;
  providerId: string;
  providerName: string;
};

/** One `customModels` entry: a model the picker offers although neither the Models API nor the
 *  CLI's own lineup lists it, such as an alias a local router sends to another model. The shape
 *  (the id passed to the CLI as written, a label for the picker, an optional window and effort
 *  levels) is the one @chopstick1009 asked for in #259. */
export interface CustomModel {
  /** Passed to `claude --model` exactly as written. */
  model: string;
  /** The name the picker shows; the id when absent. */
  label?: string;
  /** The model's context window in tokens; 200,000 when absent. */
  contextWindow?: number;
  /** Effort levels the model takes; none when absent, and the effort picker stays hidden. */
  efforts?: string[];
}

/** Configuration schema for Claude Code plugin settings. */
export const Config = z.object({
  command: z
    .string()
    .default("claude")
    .description("Claude Code binary: a name on PATH or an absolute path"),
  // No default on purpose: unset (or keeper) means the Settings switch decides; node or dsh wins.
  spawn: z
    .union(["keeper", "node", "dsh"])
    .description(
      "How the Claude Code process is started. Unset or 'keeper' follows Settings → Oh My Claude → Keep Claude running across dsh restarts (on: 'keeper', off: 'dsh'); 'node' or 'dsh' here wins over that switch and locks it. 'keeper': under a small keeper outside dsh's process tree (its own systemd user scope when available), so a dsh restart leaves Claude running and the new dsh reattaches; an SSH box holds the far claude the same way. 'node': directly, as dsh's child. 'dsh': through dsh's subprocess seam (ctx.subprocess), which ends Claude and everything it started when dsh shuts down; the plugin passes the credential-shaped env vars (KEY/TOKEN/SECRET/PASSWORD) dsh runs with through the seam's scrub and puts the installer folders on PATH, and with a remote provider mounted on that seam a remote workspace runs Claude Code on that machine",
    ),
  sshHost: z
    .string()
    .default("")
    .description(
      "Run this instance's Claude Code on a remote host over SSH (e.g. 'user@box' or an ssh_config alias). Empty = local. This box's harness drives the far `claude` with `ssh -o BatchMode=yes`; nothing runs on the remote but the CLI, using the remote's own ~/.claude login. Needs a working SSH key to the host. With the Settings switch Keep Claude running across dsh restarts on (the default) the far claude is held in a session of its own on the box, so a dsh restart here reattaches to it, and with it off the far claude ends with the ssh connection; the dsh MCP bridge does not reach the remote",
    ),
  permissionMode: z
    .union(["dsh", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto", "manual"])
    .default("dsh")
    .description(
      "Claude Code permission mode for tools the child runs on its own. 'dsh' follows the session's access mode switch: read-only → plan, workspace-write → acceptEdits, danger-full-access → bypassPermissions",
    ),
  hiddenModels: z
    .array(z.string())
    .default([])
    .description(
      "Model ids to leave out of the model picker: the exact id, or the id plus a date stamp. Display only",
    ),
  customModels: z
    .array(
      z.object({
        model: z.string().required().description("The id passed to `claude --model`"),
        label: z.string().description("The name shown in the picker"),
        contextWindow: z.number().step(1).min(1).description("Context window in tokens"),
        efforts: z.array(z.string()).description("Effort levels: low, medium, high, xhigh, max"),
      }),
    )
    .default([])
    .description(
      "Extra rows for the model picker: models the lineup does not list, such as an alias a local router sends to another model. `model` goes to `claude --model` as written",
    ),
  allowedTools: z.array(z.string()).default([]).description("Extra --allowedTools entries"),
  disallowedTools: z.array(z.string()).default([]).description("--disallowedTools entries"),
  builtinTools: z
    .array(z.string())
    .default(["default"])
    .description(
      "Claude Code's own tools, passed as --tools: 'default' for all of them, or the names to keep (for example ToolSearch), or an empty list for none. A dsh file tool (read, write, edit, glob, grep, ls) whose Claude Code counterpart is left out is offered over the dsh bridge instead, so dsh runs it with its own cards, sandbox and approvals",
    ),
  toolLoading: z
    .union(["claude", "dsh"])
    .default("claude")
    .description(
      "Which bridged dsh tools Claude sees up front. 'claude': Claude Code decides, and it defers every MCP tool behind its ToolSearch. 'dsh': the tools dsh loads up front for a native model are marked for Claude Code to load up front too (the MCP _meta key anthropic/alwaysLoad); only the ones dsh defers stay behind ToolSearch",
    ),
  followToolSet: z
    .boolean()
    .default(false)
    .description(
      "Start a new Claude process (resuming the same conversation) before a session's next turn when the dsh tools the bridge offers it changed: a tool added or removed by a plugin, an MCP server or a dsh update, or a changed parameter schema or deferral. Claude Code lists a server's tools once, when it starts, so without this a new tool shows up only after the process happens to restart",
    ),
  addDirs: z.array(z.string()).default([]).description("Extra --add-dir directories"),
  pluginDirs: z
    .array(z.string())
    .default([])
    .description(
      "Load an uninstalled local plugin for this session only: each becomes --plugin-dir <path> (a directory or a .zip). A path the CLI's LocalPluginDirsAllowedByPolicy blocks is refused by the CLI at spawn",
    ),
  pluginUrls: z
    .array(z.string())
    .default([])
    .description(
      "Fetch a plugin .zip from a URL for this session only: each becomes --plugin-url <url>",
    ),
  maxTurns: z
    .number()
    .step(1)
    .min(1)
    .description("--max-turns cap per request; unset = CLI default"),
  maxBudgetUsd: z.number().min(0).description("--max-budget-usd per request; unset = no cap"),
  titleModel: z.string().default("haiku").description("Model for session-title requests"),
  toolActivity: z
    .boolean()
    .default(true)
    .description("Show Claude Code tool calls and results as native tool rows"),
  toolsInline: z
    .boolean()
    .description(
      "Render tool calls as inline text (true) or as dsh's native tool rows (false). Unset: rows once the startup check finds the running dsh loads them back, inline until then. The switch in Settings > Oh My Claude overrides this per box.",
    ),
  hookRows: z
    .boolean()
    .default(true)
    .description(
      "Show Claude Code hook starts and results as reasoning lines (adds --include-hook-events)",
    ),
  resume: z
    .boolean()
    .default(true)
    .description("Keep one Claude Code session per dsh session via --session-id/--resume"),
  idleTimeoutMs: z
    .number()
    .step(1)
    .min(1000)
    .default(1_800_000)
    .description(
      "Kill the child when no stream event arrives for this long (a running tool emits nothing until it ends)",
    ),
  toolTextLimit: z
    .number()
    .step(1)
    .min(100)
    .default(600)
    .description("Characters of tool arguments/results shown in the activity blocks"),
  dshTools: z
    .boolean()
    .default(true)
    .description("Expose dsh tools (subagents, jobs, skills...) to Claude Code over MCP"),
  systemPrompt: z
    .union(["claude", "dsh"])
    .default("claude")
    .description(
      "Whose system prompt Claude reads. 'claude': Claude Code's own, with the plugin's dsh tool guidance appended; dsh's system prompt is not sent. 'dsh': dsh's system prompt replaces Claude Code's (--system-prompt, recorded fresh on every spawn), followed by the tool guidance, and dsh's mid-session system updates go into the turn as system lines, so Claude reads what a native model would. A changed dsh prompt starts a new Claude process on the session's next turn",
    ),
  verbatimPrompts: z
    .boolean()
    .default(false)
    .description(
      "Send dsh's prompts to Claude Code exactly as given (the Agent SDK's verbatimPrompts, Claude Code 2.1.248 or later): no @path expansion, no slash-command dispatch, and none of the context Claude Code attaches at a turn's start (nested CLAUDE.md files, skill and tool listings, reminders). dsh has already added what it wants the model to read. The plugin's own command lines (/compact and the bridged commands) are still sent as commands",
    ),
  fastMode: z
    .boolean()
    .default(false)
    .description(
      "Launch each Claude process with fast mode enabled (--settings fastMode); the bridged /fast then toggles it per session",
    ),
  commandBridge: z
    .boolean()
    .default(true)
    .description(
      "Register Claude Code's slash commands (skills, custom commands) as dsh /commands that send the line to Claude",
    ),
  redactSecrets: z
    .boolean()
    .default(true)
    .description(
      "Mask values of env vars named *KEY, *TOKEN, *SECRET, *PASSWORD or *CREDENTIAL in Claude's tool results before they reach dsh",
    ),
  persistTodos: z
    .boolean()
    .default(true)
    .description(
      "Keep the todo list on screen across messages and resume (dsh clears it each turn by default)",
    ),
  cliCompaction: z
    .boolean()
    .default(true)
    .description(
      "When dsh compacts a Claude session, have that session's Claude Code run /compact (or reuse the compaction it just made) and hand dsh its summary, so both sides compact once, at dsh's threshold, with one summary. While Claude Code is mid-turn the compaction waits: the session compacts once it is idle, a subagent or team member at the start of its next turn. A session moving to another provider keeps dsh's own summarizer",
    ),
  continueAfterLimit: z
    .boolean()
    .default(true)
    .description(
      "When a usage limit ends a turn, wait for the reset and continue the task on its own, as the CLI does",
    ),
  debug: z.boolean().default(false).description("Log spawn arguments (minus the prompt) per call"),
  approvals: z
    .boolean()
    .default(true)
    .description(
      "Route Claude Code permission prompts and AskUserQuestion to dsh dialogs (--permission-prompt-tool stdio)",
    ),
  processIdleMs: z
    .number()
    .step(1)
    .min(10_000)
    .default(30 * 60 * 1000)
    .description("Kill a session's idle Claude Code process after this long without a turn"),
  maxProcesses: z
    .number()
    .step(1)
    .min(1)
    .default(4)
    .description("Cap on live Claude Code processes; the longest-idle one is evicted first"),
  configDir: z
    .string()
    .default("")
    .description(
      "Claude Code config dir for this plugin instance (exported as CLAUDE_CONFIG_DIR); empty = CLAUDE_CONFIG_DIR env or ~/.claude",
    ),
  ownTranscripts: z
    .boolean()
    .default(false)
    .description(
      "Keep this instance's transcripts in the plugin's own state dir instead of ~/.claude/projects; the CLI runs against a config dir whose login, settings, commands and skills are symlinks back to the real one",
    ),
  providerId: z
    .string()
    .default("claude-code")
    .description(
      "Provider id; 'claude-code' is the default, anything starting with 'claude-code-' mounts a second instance",
    ),
  providerName: z
    .string()
    .default("")
    .description(
      "Display name for this instance in the model picker; empty = 'Oh My Claude' for the default id, else 'Oh My Claude (<suffix>)'",
    ),
});

/** The config as this box runs it, as a copy. A bare local `command` becomes the absolute path
 *  `resolveCommand` finds, so a dsh started with a short PATH (DSH Desktop from the macOS Dock)
 *  still reaches the CLI; a remote one is left alone, the far box has its own PATH. On Windows the
 *  keeper gives way to a plain child: it needs a Unix socket and `systemd-run`, neither of which
 *  exists there, so a keeper spawn would fail every turn. */
export function localConfig<T extends { command: string; sshHost: string; spawn?: string }>(
  config: T,
  platform: NodeJS.Platform = process.platform,
  resolve: (command: string) => string = resolveCommand,
): T {
  const out = { ...config };
  if (!out.sshHost) out.command = resolve(out.command);
  if (platform === "win32" && out.spawn === "keeper") out.spawn = "node";
  return out;
}
