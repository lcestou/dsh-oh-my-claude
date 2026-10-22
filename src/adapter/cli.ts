// The CLI probe, the flag guard, the argument and input builders, and the tool-name maps for the bridge.
// Declarations here came out of src/adapter.ts unchanged, each with the comment above it.
import { execFile } from "node:child_process";
import { type GenerateOptions } from "@deepseek-ai/dsh-llm";
import type { JsonValue, ToolSchema } from "../dsh.js";
import { KEY_HEADER } from "../mcp-config.js";
import { shq, sshArgs, userTurnLine } from "../process.js";
import { probeRawToolRows, type RowsSupport } from "../rows-probe.js";
import { Config } from "./config.js";
import { textOf, type LooseMessage } from "./prompt.js";

const MODE_FOR_ACCESS = {
  "read-only": "plan",
  "workspace-write": "acceptEdits",
  "danger-full-access": "bypassPermissions",
} as const satisfies Record<string, string>;
/** Claude permission mode for a dsh access mode, or undefined for one this table does not know. */
export const modeForAccess = (accessMode: string): string | undefined =>
  // SAFETY: the key is checked against the table before it is used as its index
  Object.hasOwn(MODE_FOR_ACCESS, accessMode)
    ? MODE_FOR_ACCESS[accessMode as keyof typeof MODE_FOR_ACCESS]
    : undefined;

/** dsh's access-mode switch arrives as text in the runtime-context injection; the last snapshot wins. */
export function accessModeOf(messages: LooseMessage[] | undefined): string | undefined {
  let mode: string | undefined;
  for (const m of messages ?? []) {
    if (m.role !== "user") continue;
    const found = textOf(m.content).match(/Current DSH file policy: ([a-z-]+)/);
    if (found) mode = found[1];
  }
  return mode;
}

/** dsh's approval-policy line rides in the same runtime-context injection as the file policy, and
 *  only while the policy is "never"; the last snapshot wins, so a switch back to "ask" clears it. */
export function approvalsDisabled(messages: LooseMessage[] | undefined): boolean {
  let disabled = false;
  for (const m of messages ?? []) {
    if (m.role !== "user") continue;
    const text = textOf(m.content);
    if (!text.includes("Current DSH file policy:")) continue;
    disabled = text.includes("Approval prompts are disabled in this session");
  }
  return disabled;
}

/** The CLI's permission mode for a turn: the configured one, or the one dsh's access mode maps to. */
export function permissionModeFor(
  config: Schemastery.TypeT<typeof Config>,
  accessMode: string | undefined,
): string {
  if (config.permissionMode !== "dsh") return config.permissionMode;
  return modeForAccess(accessMode ?? "") ?? "acceptEdits";
}

// ---------------------------------------------------------------------------
// CLI probe: Claude Code auto-updates itself, so flags are checked against `claude --help` once per
// process and anything missing is left out. Unknown = assume supported (probe failed, older CLI).

const cliProbes = new Map<string, Promise<{ flags: Set<string> | null; version: string }>>();

/**
 * Whether the running dsh loads a log holding raw tool rows: one probe per process, on first ask.
 *
 * Per process is the right scope even with several mounts: the question is about the dsh that owns
 * the session log, and every session's log lives in this dsh whatever box its Claude runs on. A
 * remote box runs `claude`, never a second dsh, so there is nothing per-mount to ask.
 */
let rowsProbe: Promise<RowsSupport> | undefined;

/** Probe whether this target supports raw tool rows once and cache the answer, so repeated callers share one ssh probe instead of one per session. */
export const rowsSupported = (): Promise<RowsSupport> => (rowsProbe ??= probeRawToolRows());
/** Flags a target's binary rejected at runtime, per probe key. A probe can be wrong. A box's CLI
 * updates under us, `--help` comes back empty over a stalled ssh and every flag then reads as
 * supported, and the CLI's answer to a flag it does not have is exit 1 before the first frame. What
 * it printed is better evidence than the probe, so it is remembered and the flag is never sent to
 * that binary again. */
const deniedFlags = new Map<string, Set<string>>();
/** Forget what was probed on `host` ("" for this box): after `claude update` there, the flag set
 *  and the denials belong to a binary that is gone, and the next spawn probes the new one. */
export function forgetCliProbe(host: string): void {
  for (const map of [cliProbes, deniedFlags])
    for (const key of map.keys()) if (key.startsWith(`${host}::`)) map.delete(key);
}
/** Every flag buildArgs guards with supports(). An unprobed binary is assumed to have all of them;
 * this list is what "all of them" means once one has to be taken away. */
const GUARDED_FLAGS = [
  "--input-format",
  "--include-partial-messages",
  "--forward-subagent-text",
  "--include-hook-events",
  "--effort",
  "--settings",
  "--append-system-prompt",
  "--no-session-persistence",
  "--permission-mode",
  "--permission-prompt-tool",
  "--tools",
  "--plugin-dir",
  "--plugin-url",
  "--max-budget-usd",
  "--session-id",
  "--resume",
  "--mcp-config",
];
/** The flag in `error: unknown option '--x'`, however the CLI wrapped the line. */
export function unknownFlagIn(text: string): string | undefined {
  return /unknown option '(--[a-zA-Z][\w-]*)'/.exec(text)?.[1];
}
/** Record a flag the target's CLI refused. False when it was already known bad, which is what stops
 * a retry loop: the second refusal of the same flag is a real failure, not something to retry. */
export function denyCliFlag(command: string, host: string | undefined, flag: string): boolean {
  const key = `${host ?? ""}::${command}`;
  const set = deniedFlags.get(key) ?? new Set<string>();
  if (set.has(flag)) return false;
  set.add(flag);
  deniedFlags.set(key, set);
  return true;
}
/** The slice of node's execFile the probe uses; tests hand in a fake with this shape. */
export type ExecLike = (
  cmd: string,
  args: string[],
  opts: { timeout: number },
  cb: (err: Error | null, stdout: string | Buffer) => void,
) => void;

/** The target binary's version and the flags its `--help` lists, probed once per binary. */
// SAFETY: execFile's overloads include exactly this call shape; the alias only narrows them
export function probeCli(exec: ExecLike = execFile as ExecLike, command = "claude", host?: string) {
  // One probe per target binary: the local `claude`, or a box's `claude` reached over ssh. A single
  // global cache used to let the first provider's flag set stand in for every box, so an older remote
  // claude was handed flags it does not have (e.g. --forward-subagent-text) and exited 1.
  const key = `${host ?? ""}::${command}`;
  let probe = cliProbes.get(key);
  if (!probe) {
    probe = (async () => {
      const run = (args: string[]) =>
        new Promise<string>((resolve) => {
          const cmd = host ? "ssh" : command;
          const cmdArgs = host ? sshArgs(host, [command, ...args].map(shq).join(" ")) : args;
          exec(cmd, cmdArgs, { timeout: host ? 15000 : 8000 }, (err, stdout) =>
            resolve(err ? "" : String(stdout)),
          );
        });
      const [help, version] = await Promise.all([run(["--help"]), run(["--version"])]);
      const flags = new Set(help.match(/--[a-zA-Z-]+/g) ?? []);
      // A probe that answered nothing is not an answer. Dropping it from the cache costs one more
      // `--help` next turn and keeps a single stalled ssh from deciding this box's flags for the
      // life of the process.
      if (flags.size === 0) cliProbes.delete(key);
      return { flags: flags.size > 0 ? flags : null, version: version.trim() || "unknown" };
    })();
    cliProbes.set(key, probe);
  }
  return probe.then(({ flags, version }) => {
    const bad = deniedFlags.get(key);
    if (!bad?.size) return { flags, version };
    // Unknown flags mean "assume everything", so a denial has to be subtracted from the full list
    // rather than from nothing.
    const base = flags ?? new Set(GUARDED_FLAGS);
    return { flags: new Set([...base].filter((f) => !bad.has(f))), version };
  });
}

/**
 * Checks if a CLI flag is supported. Returns true if flags are unknown
 * (probe failed) to assume support.
 */
export const supports = (flags: Set<string> | null | undefined, flag: string) =>
  !flags || flags.has(flag);

/** Text mode when the CLI lacks --input-format: prompt goes positional, images are dropped. */
export const usesStdin = (flags: Set<string> | null | undefined) =>
  supports(flags, "--input-format");

/** Whether a bridged tool's JSON schema declares `param`; false for a tool that is not there and
 *  for a schema with no `properties` object (`Object()` turns either into something `in` accepts). */
const takes = (tool: ToolSchema | undefined, param: string): boolean =>
  param in Object(tool?.parameters.properties);

/** A dsh tool's name as Claude sees it over the bridge. */
const bridgedName = (tool: string): string => `mcp__dsh__${tool}`;

/** "a", "a and b", "a, b and c". */
const listed = (items: string[]): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

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
export function dshToolsGuidance(tools: readonly ToolSchema[] = []): string {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out = ["dsh tools are available as mcp__dsh__* over MCP."];

  const subagent = byName.get("subagent");
  const presets = tools.map((t) => t.name).filter((n) => /^(subagent|researcher)_/.test(n));
  if (subagent || presets.length > 0) {
    out.push(
      "For any subagent, worker, helper or a specific model, use those and never the built-in",
      "Agent/Task tool: a native Agent child is invisible to dsh (no card, no header count, no",
      "completion notice, no transcript).",
    );
    if (subagent && takes(subagent, "provider")) {
      out.push(`${bridgedName("subagent")} takes provider and model for a named route;`);
      if (byName.has("list_subagent_models"))
        out.push(`${bridgedName("list_subagent_models")} lists the allowed routes;`);
      out.push("omit both for the default.");
    } else if (subagent) {
      out.push(`${bridgedName("subagent")} runs a child on the default route.`);
    }
    if (presets.length > 0)
      out.push(
        `${listed(presets.map(bridgedName))} ${presets.length > 1 ? "run children" : "runs a child"} too.`,
      );
    out.push(
      "run_in_background: false returns the answer inline; background returns an id and the",
      "notice arrives next turn.",
    );
  }
  if (byName.has("open_session"))
    out.push(`${bridgedName("open_session")} makes a new top-level session, not a child.`);

  const shell = [byName.get("bash"), byName.get("pwsh")].find((t) => takes(t, "run_in_background"));
  if (shell) {
    const jobs = [
      byName.has("job_output") ? `read output with \`${bridgedName("job_output")}\`` : "",
      byName.has("job_kill") ? `stop with \`${bridgedName("job_kill")}\`` : "",
    ].filter(Boolean);
    const native = shell.name === "bash" ? "native `Bash`" : "the native shell tool";
    out.push(
      "Long-running or background commands (test suites, builds, code reviews, watchers, anything",
      `you would run with \`run_in_background\`) go through \`${bridgedName(shell.name)}\` with`,
      "`run_in_background: true`; dsh registers the job, shows its card and panel entry, and the",
      `finish notice arrives next turn${jobs.length > 0 ? `; ${jobs.join(", ")}` : ""}.`,
      `Short foreground commands stay on ${native}; do not use ${native} \`run_in_background\``,
      "because dsh cannot see it.",
    );
  }
  return out.join(" ");
}

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
export function buildArgs({
  model,
  reasoningEffort,
  system,
  purpose,
  config,
  session,
  accessMode,
  flags,
  promptText,
  mcp,
  temporary = false,
  permissionMode,
}: Pick<GenerateOptions, "reasoningEffort" | "system" | "purpose"> & {
  model: string | undefined;
  config: Schemastery.TypeT<typeof Config>;
  session?: { id: string; resuming: boolean } | undefined;
  accessMode?: string | undefined;
  flags?: Set<string> | null;
  promptText?: string;
  /** The bridge for this session, with the dsh tools it will list (see `dshToolsGuidance`). */
  mcp?: { url: string; key: string; tools?: readonly ToolSchema[] | undefined } | undefined;
  /** /temporary: keep no Claude transcript for this session. */
  temporary?: boolean;
  /** Optional permission mode override; if provided, used instead of computing from config. */
  permissionMode?: string;
}) {
  const args = ["-p"];
  if (usesStdin(flags)) args.push("--input-format", "stream-json");
  else args.push(promptText ?? "");
  args.push("--output-format", "stream-json", "--verbose");
  if (supports(flags, "--include-partial-messages")) args.push("--include-partial-messages");
  if (supports(flags, "--forward-subagent-text")) args.push("--forward-subagent-text");
  if (config.hookRows && supports(flags, "--include-hook-events"))
    args.push("--include-hook-events");
  if (model) args.push("--model", model);
  if (reasoningEffort && supports(flags, "--effort")) args.push("--effort", reasoningEffort);
  // In -p mode /fast only works in a session launched with fast mode in --settings (fast-mode docs).
  if (config.fastMode && supports(flags, "--settings"))
    args.push("--settings", JSON.stringify({ fastMode: true }));
  const appended = [system, mcp ? dshToolsGuidance(mcp.tools) : ""].filter(Boolean).join("\n\n");
  if (appended && supports(flags, "--append-system-prompt")) {
    args.push("--append-system-prompt", appended);
  }
  if (purpose) {
    // Auxiliary calls (title, compaction): one turn, no tools, no session of their own. Without
    // --no-session-persistence each one still leaves a transcript under the scratch project dir.
    args.push("--tools", "", "--max-turns", "1");
    if (supports(flags, "--no-session-persistence")) args.push("--no-session-persistence");
    return args;
  }
  if (temporary && supports(flags, "--no-session-persistence"))
    args.push("--no-session-persistence");
  if (supports(flags, "--permission-mode")) {
    const mode = permissionMode ?? permissionModeFor(config, accessMode);
    args.push("--permission-mode", mode);
  }
  if (config.approvals && usesStdin(flags) && supports(flags, "--permission-prompt-tool")) {
    args.push("--permission-prompt-tool", "stdio");
  }
  // "default" is what the Agent SDK passes; without it the CLI keeps AskUserQuestion out of -p runs.
  if (supports(flags, "--tools")) args.push("--tools", "default");
  if (config.allowedTools.length > 0) args.push("--allowedTools", ...config.allowedTools);
  if (config.disallowedTools.length > 0) args.push("--disallowedTools", ...config.disallowedTools);
  for (const d of config.addDirs) args.push("--add-dir", d);
  // Session-only plugins: a per-spawn flag, not a settings write, so they never touch the roster.
  if (supports(flags, "--plugin-dir"))
    for (const d of config.pluginDirs) args.push("--plugin-dir", d);
  if (supports(flags, "--plugin-url"))
    for (const u of config.pluginUrls) args.push("--plugin-url", u);
  if (config.maxTurns) args.push("--max-turns", String(config.maxTurns));
  if (config.maxBudgetUsd && supports(flags, "--max-budget-usd")) {
    args.push("--max-budget-usd", String(config.maxBudgetUsd));
  }
  if (session && supports(flags, "--session-id") && supports(flags, "--resume")) {
    args.push(session.resuming ? "--resume" : "--session-id", session.id);
  }
  if (mcp && supports(flags, "--mcp-config")) {
    const dsh = { type: "http", url: mcp.url, headers: { [KEY_HEADER]: mcp.key } };
    args.push("--mcp-config", JSON.stringify({ mcpServers: { dsh } }));
  }
  return args;
}

/** One stream-json input line: the user turn with text and inline images. `uuid` goes on the line so a later `cancel_async_message` can name it. */
export function buildInput(
  prompt: string,
  images: Array<{ mediaType: string; data: string }>,
  uuid?: string,
): string {
  const content: Array<{
    type: string;
    text?: string;
    source?: { type: string; media_type: string; data: string };
  }> = [{ type: "text", text: prompt }];
  for (const img of images) {
    if (!img.data) continue; // by path only; `attachmentNotes` says where
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType, data: img.data },
    });
  }
  return userTurnLine(content, uuid);
}

// ---------------------------------------------------------------------------
// stream-json → dsh chunks

/** Names from the CLI's init frame that dsh's command grammar accepts (lowercase, `[a-z0-9_-]`), deduped. */
export function commandNames(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const v of value) if (String(v) === v && /^[a-z0-9][a-z0-9_-]*$/.test(v)) out.add(v);
  return [...out];
}
/**
 * The CLI flattens a server name into a tool id, so the id never carries a space, a dot or a
 * colon: compare a normalized form of both sides rather than the literal name.
 */
/** Replacing before lowercasing keeps this one code unit in, one code unit out: everything a
 *  case fold could change the length of has already become an underscore. */
function serverKey(text: string): string {
  return text.replace(/[^A-Za-z0-9-]/g, "_").toLowerCase();
}

/**
 * Bare tool names per MCP server, from the init frame's `mcp__<server>__<tool>` ids. Every known
 * server gets an entry, empty when it contributes nothing; an id whose server is not in the list
 * is dropped rather than guessed at.
 */
export function mcpToolsByServer(
  serverNames: readonly string[],
  toolIds: readonly string[],
): Map<string, string[]> {
  const keys = new Map<string, string>();
  const out = new Map<string, string[]>();
  for (const server of serverNames) {
    keys.set(serverKey(server), server);
    out.set(server, []);
  }
  for (const id of toolIds) {
    if (!id.startsWith(MCP_TOOL_PREFIX)) continue;
    const rest = id.slice(MCP_TOOL_PREFIX.length);
    // Normalizing is character-for-character, so an offset into the normalized form is also an
    // offset into `rest` and the bare name keeps its original case. Longest key wins: one server
    // name can be a prefix of another, and the tool name itself may contain the separator.
    const normalized = serverKey(rest);
    let owner = "";
    let ownerKey = "";
    for (const [key, server] of keys)
      if (normalized.startsWith(`${key}__`) && key.length > ownerKey.length) {
        owner = server;
        ownerKey = key;
      }
    if (ownerKey === "") continue;
    out.get(owner)?.push(rest.slice(ownerKey.length + 2));
  }
  for (const bare of out.values()) bare.sort();
  return out;
}
/** Every MCP-contributed tool id the CLI reports starts with this. */
const MCP_TOOL_PREFIX = "mcp__";
/** Bridged Claude commands are registered as `/claude-<name>` in dsh. */
export const BRIDGE_PREFIX = "claude-";
/**
 * Names dsh's own client half owns, which the host registry cannot answer for. A host command of
 * one of these makes dsh's menu throw where it merges the two lists ("contribution /X collides with
 * a host command"), and the menu goes blank rather than losing one row. Read out of dsh's client
 * bundles, where a contribution is a `commandUi.register({ name })`; a host command dsh registers
 * normally needs no entry here, since its own registry throws on the duplicate and the bridge falls
 * back to the prefixed name.
 */
export const CLIENT_COMMANDS = new Set(["model"]);
/** Claude's rename command, and the alias its catalog also offers. */
const RENAME_COMMANDS = new Set(["rename", "name"]);
/**
 * The dsh title a bridged command should set: the trimmed argument when this is Claude's rename
 * with one. An empty argument returns undefined so the line reaches Claude unchanged and the CLI
 * answers with its own usage message.
 */
export function renameTitle(cmd: string, rawInput: string): string | undefined {
  if (!RENAME_COMMANDS.has(cmd)) return undefined;
  const title = rawInput.trim();
  return title.length > 0 ? title : undefined;
}
// Claude Code tool names → dsh tool name that the client-ui-tool presenter recognises.
// Unknown names fall through to the generic "others" row.
export const NATIVE_TOOL_MAP = {
  Bash: "bash",
  // Claude Code's shell tool on a Windows box without Git Bash. dsh draws `pwsh` with the same
  // shell card as `bash`.
  PowerShell: "pwsh",
  Read: "read",
  Edit: "edit",
  Write: "write",
  Grep: "grep",
  Glob: "glob",
  WebFetch: "web_fetch",
  WebSearch: "web_search",
  // Same presenter as Edit: the client draws both from a diff, and the input shape only differs in
  // carrying several edits.
  MultiEdit: "edit",
  // The rest of Claude's own tools. They have no dsh row variant. dsh classifies anything outside
  // its own table as `others`, but the inline markdown path keys its icon, name and renderer off
  // this name, and without an entry each of these printed as a raw JSON dump under a sparkle.
  TodoWrite: "todo_write",
  Task: "task",
  NotebookEdit: "notebook_edit",
  BashOutput: "bash_output",
  KillShell: "kill_shell",
  ExitPlanMode: "exit_plan_mode",
  EnterPlanMode: "enter_plan_mode",
  SlashCommand: "slash_command",
} as const;

/** The text dsh's title provider sends: its one framed user message, joined when there are more. */
export function titleInput(messages: GenerateOptions["messages"]): string {
  const parts: string[] = [];
  for (const m of messages)
    for (const b of m.content) if (b.type === "text" && b.text) parts.push(b.text);
  return parts.join("\n").trim();
}
