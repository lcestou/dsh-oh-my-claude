import type { PluginContext } from "./dsh.js";
import { ADAPTER_CURRENT } from "./dsh.js";
export { markBusy, takeInterrupted } from "./state.js";
export { forkTranscriptText } from "./transcript.js";
export { Translator, type TranslatorBlock, type FallbackRecord } from "./translator.js";
import { Config } from "./adapter/config.js";
export { boxFor, Config, isOrphanedStandIn, localConfig, remoteCwdFor, remoteWorkspaceFor, setRemoteWorkspaces, } from "./adapter/config.js";
export { type AsideEntry, type AsidesReply, type AwaitingRow, type ControlReply, type ContextUsageReply, type HoldReply, type IdleReply, keepsLiveTurn, type LoginNeed, type LiveTurnReply, type McpAuthReply, type McpStatusReply, type PermissionModeInfo, type PermissionModeReply, type PermissionModeState, type PermissionReadoutReply, registryKey, type RewindPrompt, type RewindReply, skillDoctorReply, type SkillDoctorReply, type SteerCardState, type SteerEditReply, type TurnTotals, type WorkspaceDiffReply, } from "./adapter/types.js";
export { EFFORTS_ALL, getCatalog, KNOWN_MODELS, liveWindowFor, mergeCatalog, modelFromApi, noteLiveWindow, parseCatalogCache, proxyBaseUrl, resolveModelInfo, stableModelId, } from "./adapter/catalog.js";
export { asideAnswerText, selectionContext } from "./adapter/asides.js";
export { claudeSessionId, projectDirName } from "./adapter/transcript-watch.js";
export { attachmentNotes, attachmentsOf, buildPrompt, clientTimeZone, contextSizes, contextSourceOf, type LooseMessage, relayFileHandles, selectTurns, TOOL_TEXT_CAP, steerKey, withoutNativeInstructions, } from "./adapter/prompt.js";
export { accessModeOf, approvalsDisabled, buildArgs, buildInput, commandNames, denyCliFlag, dshToolsGuidance, type ExecLike, forgetCliProbe, mcpToolsByServer, NATIVE_TOOL_MAP, permissionModeFor, probeCli, renameTitle, supports, unknownFlagIn, usesStdin, } from "./adapter/cli.js";
export { afterLastAssistant, diffContext, dropSent, finishReason, forgetSteers, hasPendingTodo, type IdleTarget, interruptOnAbort, isLoginFailure, isOwnSource, isStaleResume, killAfterGrace, LIMIT_TEXT, type LiveTurn, nativeToolRows, noteInterrupt, noticeSource, OUTCOME_MESSAGE, OWN_SOURCE_KIND, RECONNECT_TEXT, relayBlocks, resolvedAgent, RESTART_TEXT, type ResultFrame, type SideQuestion, sideQuestionsIn, stepContextFor, toolResultFor, type TurnRecord, type TurnsReply, type UltracodeState, ultracodeStatus, userPromptCount, WAKE_TEXT, wakeOnlyTurn, wantedUltracode, } from "./adapter/turn.js";
export { ClaudeCodeAdapter } from "./adapter/class.js";
/** Plugin name identifier. */
export declare const name = "dsh-oh-my-claude";
/** Services injected into the plugin by the dsh runtime. */
export declare const inject: string[];
export { ADAPTER_CURRENT };
/** The entry point dsh calls: build the adapter, register its provider and adapter, probe the login, and pin the instance on globalThis so a re-instantiation at boot shares the one already running. */
export declare function apply(ctx: PluginContext, config: Schemastery.TypeT<typeof Config>): void;
