import z from "@deepseek-ai/schemastery";
import type { RemoteWorkspace } from "../sessions.js";
export declare const DSH_VERSION: string | null;
/** Replace the redirect map: the boot read and every panel edit land here. Exported so the offline
 * suite can drive the two lookups below without a dsh mount. */
export declare function setRemoteWorkspaces(workspaces: RemoteWorkspace[]): void;
/**
 * Whether `cwd` is the stand-in of a remote workspace that no longer exists. Removing a box, or
 * deleting the workspace, drops its row and its stand-in folder, but dsh keeps the sessions and
 * lists them under Ungrouped with the stand-in as their cwd. A turn there has no box to run on:
 * spawned here it died on a missing directory as "claude exited -1: no output" (seen live
 * 2026-09-17), and on an ssh box's own provider it would have run in the far `$HOME` instead.
 */
export declare const isOrphanedStandIn: (cwd: string) => boolean;
/** The real remote path for a placeholder workspace on `host`, or `cwd` unchanged. */
export declare function remoteCwdFor(host: string, cwd: string): string;
/** The box a turn runs on: this instance's own host when it has one, else the box a remote-workspace
 * cwd belongs to. The choice is by truthiness because `sshHost` defaults to `""`, not undefined.
 * `??` treats that empty string as an answer, which is how a local provider's turn came to probe the
 * local binary for flags while its spawn ran on the box (2026-09-09: `--forward-subagent-text`, a
 * flag this box's CLI has and the box's 2.1.123 does not). */
export declare const boxFor: (sshHost: string | undefined, workspaceHost: string | undefined) => string | undefined;
/** The remote workspace whose local placeholder is `cwd`, if any. A session opened on this cwd must
 * run over SSH on that box regardless of the provider chosen, so a local provider does not sit in the
 * empty placeholder dir. */
export declare function remoteWorkspaceFor(cwd: string): RemoteWorkspace | undefined;
/** Configuration shape produced by the Config schema with defaults applied. */
export type Config = {
    command: string;
    spawn: "node" | "dsh";
    sshHost: string;
    configDir: string;
    permissionMode: "dsh" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto" | "manual";
    hiddenModels: string[];
    allowedTools: string[];
    disallowedTools: string[];
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
    fastMode: boolean;
    commandBridge: boolean;
    redactSecrets: boolean;
    persistTodos: boolean;
    debug: boolean;
    approvals: boolean;
    processIdleMs: number;
    maxProcesses: number;
    providerId: string;
    providerName: string;
};
/** Configuration schema for Claude Code plugin settings. */
export declare const Config: z<Schemastery.ObjectS<{
    command: z<string, string>;
    spawn: z<"dsh" | "keeper" | "node", "dsh" | "keeper" | "node">;
    sshHost: z<string, string>;
    permissionMode: z<"acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan", "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan">;
    hiddenModels: z<string[], string[]>;
    allowedTools: z<string[], string[]>;
    disallowedTools: z<string[], string[]>;
    addDirs: z<string[], string[]>;
    pluginDirs: z<string[], string[]>;
    pluginUrls: z<string[], string[]>;
    maxTurns: z<number, number>;
    maxBudgetUsd: z<number, number>;
    titleModel: z<string, string>;
    toolActivity: z<boolean, boolean>;
    toolsInline: z<boolean, boolean>;
    hookRows: z<boolean, boolean>;
    resume: z<boolean, boolean>;
    idleTimeoutMs: z<number, number>;
    toolTextLimit: z<number, number>;
    dshTools: z<boolean, boolean>;
    fastMode: z<boolean, boolean>;
    commandBridge: z<boolean, boolean>;
    redactSecrets: z<boolean, boolean>;
    persistTodos: z<boolean, boolean>;
    continueAfterLimit: z<boolean, boolean>;
    debug: z<boolean, boolean>;
    approvals: z<boolean, boolean>;
    processIdleMs: z<number, number>;
    maxProcesses: z<number, number>;
    configDir: z<string, string>;
    ownTranscripts: z<boolean, boolean>;
    providerId: z<string, string>;
    providerName: z<string, string>;
}>, Schemastery.ObjectT<{
    command: z<string, string>;
    spawn: z<"dsh" | "keeper" | "node", "dsh" | "keeper" | "node">;
    sshHost: z<string, string>;
    permissionMode: z<"acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan", "acceptEdits" | "auto" | "bypassPermissions" | "dontAsk" | "dsh" | "manual" | "plan">;
    hiddenModels: z<string[], string[]>;
    allowedTools: z<string[], string[]>;
    disallowedTools: z<string[], string[]>;
    addDirs: z<string[], string[]>;
    pluginDirs: z<string[], string[]>;
    pluginUrls: z<string[], string[]>;
    maxTurns: z<number, number>;
    maxBudgetUsd: z<number, number>;
    titleModel: z<string, string>;
    toolActivity: z<boolean, boolean>;
    toolsInline: z<boolean, boolean>;
    hookRows: z<boolean, boolean>;
    resume: z<boolean, boolean>;
    idleTimeoutMs: z<number, number>;
    toolTextLimit: z<number, number>;
    dshTools: z<boolean, boolean>;
    fastMode: z<boolean, boolean>;
    commandBridge: z<boolean, boolean>;
    redactSecrets: z<boolean, boolean>;
    persistTodos: z<boolean, boolean>;
    continueAfterLimit: z<boolean, boolean>;
    debug: z<boolean, boolean>;
    approvals: z<boolean, boolean>;
    processIdleMs: z<number, number>;
    maxProcesses: z<number, number>;
    configDir: z<string, string>;
    ownTranscripts: z<boolean, boolean>;
    providerId: z<string, string>;
    providerName: z<string, string>;
}>>;
/** The config as this box runs it, as a copy. A bare local `command` becomes the absolute path
 *  `resolveCommand` finds, so a dsh started with a short PATH (DSH Desktop from the macOS Dock)
 *  still reaches the CLI; a remote one is left alone, the far box has its own PATH. On Windows the
 *  keeper gives way to a plain child: it needs a Unix socket and `systemd-run`, neither of which
 *  exists there, so a keeper spawn would fail every turn. */
export declare function localConfig<T extends {
    command: string;
    sshHost: string;
    spawn: string;
}>(config: T, platform?: NodeJS.Platform, resolve?: (command: string) => string): T;
