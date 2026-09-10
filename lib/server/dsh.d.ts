import type { ContentBlock, GenerateOptions, Message } from "@deepseek-ai/dsh-llm";
/** Map of providerId → adapter on globalThis (hot-reload cross-plugin process adoption; per-instance). */
export declare const ADAPTER_CURRENT: unique symbol;
/** Map of providerId → timer on globalThis (scoped outside cordis to survive plugin re-instantiation). */
export declare const RESUME_TIMER: unique symbol;
/** Symbol for the Claude process registry on globalThis (adopted processes across hot reloads). */
export declare const PROCESS_REGISTRY: unique symbol;
/** Per-session turn accounting on globalThis: the route registered at boot must read the buffer a hot-reloaded adapter fills. */
export declare const TURN_RECORDS: unique symbol;
/** The CLI's last slash-command catalog, so a hot-reloaded adapter re-registers the bridge without a new init frame. */
export declare const COMMAND_CATALOG: unique symbol;
/** dsh session ids marked temporary (/temporary): their Claude processes keep no transcript. */
export declare const TEMPORARY_SESSIONS: unique symbol;
/** Per-session permission-mode overrides on globalThis: the panel writes them through the default
 * mount while the mount that spawns the session reads them, so the map cannot be per-instance. */
export declare const PERMISSION_MODE_OVERRIDES: unique symbol;
/** The same brand dsh-llm puts on GenerateOptions.sessionId, so ids flow through without casts. */
export type SessionId = NonNullable<GenerateOptions["sessionId"]>;
/** Any JSON document; what MCP tool arguments and relay payloads are made of. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
/** dsh session ids are plain strings on the wire; this is the one place they get their brand. */
export declare const asSessionId: (id: string) => SessionId;
/** Mirrors: @deepseek-ai/dsh-session/lib/types/types.d.ts */
export interface SessionHeader {
    readonly version: number;
    readonly id: SessionId;
    readonly createdAt: number;
    readonly cwd?: string;
    readonly parentSession?: SessionId;
    readonly isSeeded: boolean;
    readonly origin?: "subagent";
    readonly delegationDepth?: number;
    readonly agentPreset?: string;
}
/** Mirrors: @deepseek-ai/dsh-session/lib/types/index.d.ts */
export interface SessionEvent {
    type: string;
    seq: number;
    time: number;
    data: Record<string, JsonValue>;
    surfaceOp?: "append";
    sourceEventSeqs?: number[];
}
export interface Session {
    readonly header: SessionHeader;
    readonly id: SessionId;
    readonly firstLiveSeq: number;
    eventAt(seq: number): SessionEvent | undefined;
    snapshotEvents(fromSeq?: number, toSeqExclusive?: number): readonly SessionEvent[];
    ownEvents(): readonly SessionEvent[];
    isOwnSeq(seq: number): boolean;
    get seq(): number;
    append<T extends string>(type: T, data: Record<string, JsonValue>, ...opts: unknown[]): SessionEvent;
    deriveMessages(): Message[];
    requestHeader(): {
        version: number;
    } | undefined;
    requestContext(): {
        provider?: string;
        model?: string;
    } | undefined;
}
export interface SessionStore {
    create(id?: SessionId, options?: {
        seed?: readonly SessionEvent[];
        meta?: {
            cwd?: string;
            createdAt?: number;
        };
    }): Session;
    prepare(id?: SessionId, options?: {
        seed?: readonly SessionEvent[];
        meta?: {
            cwd?: string;
            createdAt?: number;
        };
    }): Session;
    enter(session: Session): () => void;
    announce(session: Session): void;
    flush(session: Session): Promise<boolean>;
    get(id: SessionId): Session | undefined;
    list(): Session[];
    fork(source: Session | SessionId, boundary?: number, childSessionId?: SessionId): Session;
    on?(event: string, cb: (...args: unknown[]) => void): void;
}
/** Mirrors: @deepseek-ai/dsh-agent/lib/types/types.d.ts */
export interface Agent {
    readonly id: SessionId;
    readonly session?: Session;
    ctx?: PluginContext;
    followup(message: Message): void;
}
/** Mirrors: @deepseek-ai/dsh-agent/lib/types/index.d.ts */
export interface AgentRegistry {
    currentInitiator(): Agent | undefined;
    requireInitiator(): Agent;
    withInitiator<T>(agent: Agent, operation: () => T): T;
    withoutInitiator<T>(operation: () => T): T;
    setFactory(factory: {
        createAgent: (ctx: PluginContext, opts: JsonValue) => Promise<Agent>;
        resume: (ctx: PluginContext, opts: JsonValue) => Promise<Agent>;
    }): () => void;
    create(options: {
        sessionId: SessionId;
        meta?: {
            cwd?: string;
        };
    }): Promise<{
        agent: Agent;
        dispose: () => Promise<void>;
    }>;
    resume(options: {
        resumeSessionId: SessionId;
    }): Promise<{
        agent: Agent;
        dispose: () => Promise<void>;
    }>;
    register(agent: Agent): () => void;
    enter(agent: Agent, owner: Agent | undefined): () => void;
    announce(agent: Agent): void;
    get(id: SessionId): Agent | undefined;
    list(): Agent[];
    roots(): Agent[];
}
/** Mirrors: @deepseek-ai/dsh-subprocess/lib/types/types.d.ts */
export interface SubprocessHandle {
    stdin: import("node:stream").Writable;
    stdout: import("node:stream").Readable;
    stderr: import("node:stream").Readable;
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    terminate(): void;
    waitForExit(): Promise<void>;
}
export interface SubprocessSpawnSpec {
    argv: readonly string[];
    cwd: string;
    stdio: {
        stdin: "ignore" | "pipe" | {
            data: string;
        };
        stdout: "pipe" | "inherit" | {
            maxBytes: number;
            spill?: {
                maxBytes: number;
            };
        };
        stderr: "pipe" | "inherit" | {
            maxBytes: number;
            spill?: {
                maxBytes: number;
            };
        };
    };
    graceMs: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
}
/** Mirrors: @deepseek-ai/dsh-subprocess/lib/types/index.d.ts */
export interface SubprocessRuntime {
    resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>;
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    spawnTerminal(spec: SubprocessSpawnSpec & {
        terminal?: true;
    }): Promise<SubprocessHandle>;
}
/** Mirrors: @deepseek-ai/dsh-user-approval/lib/types/index.d.ts */
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
export interface ApprovalRequest {
    readonly agent: Agent;
    readonly toolName: string;
    readonly callId?: string;
    readonly reason?: string;
    readonly signal?: AbortSignal;
}
export interface ApprovalService {
    config: {
        policy?: "ask" | "never";
    };
    setPolicy(agent: Agent, policy: "ask" | "never"): void;
    request(req: ApprovalRequest): Promise<ApprovalOutcome>;
    overrideOf(session: Session): "ask" | "never" | undefined;
}
/** Mirrors: @deepseek-ai/dsh-user-questions/lib/types/index.d.ts */
export interface AskUserQuestionItem {
    id: string;
    question: string;
    header?: string;
    options: Array<{
        label: string;
        description?: string;
    }>;
    multiSelect: boolean;
    /** Supporting markdown under the question; with a plan-review intent dsh renders it as the plan. */
    detail?: string;
    /** Presentation intent dsh recognises (`plan-review`: `detail` is a plan, `approve` names the yes option). */
    intent?: {
        kind: "plan-review";
        approve: string;
    };
}
export interface AskUserQuestionRequest {
    agent?: Agent;
    signal?: AbortSignal;
    questions: AskUserQuestionItem[];
}
export interface AskUserQuestionAnswer {
    answers?: Array<{
        id: string;
        custom?: string;
        selected?: string[];
    }>;
}
export interface UserQuestionService {
    ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
}
/** Mirrors: @deepseek-ai/dsh-workspace/lib/types/index.d.ts */
export type WorkspaceId = string & {
    readonly __brand: "WorkspaceId";
};
export interface Workspace {
    id: WorkspaceId;
    path: string;
    title: string;
    sessionIds: SessionId[];
    /** Put a flushed session on this workspace's list; dsh checks its stored cwd is this path. */
    attachSession(sessionId: SessionId): Promise<void>;
}
export interface WorkspaceRegistry {
    create(path: string, title?: string): Promise<Workspace>;
    get(id: WorkspaceId): Workspace | undefined;
    list(): Workspace[];
    delete(id: WorkspaceId): Promise<boolean>;
    insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>;
    get archivedSessionIds(): readonly SessionId[];
    archiveSession(sessionId: SessionId): Promise<void>;
    resolveByPath(path: string): Promise<Workspace | undefined>;
    enqueueOperation?<T>(operation: () => Promise<T>): Promise<T>;
    requireState(): WorkspaceRegistryState;
    setState(state: WorkspaceRegistryState): Promise<void>;
}
/** The registry's persisted state; only the archived list is read or rewritten here. */
export interface WorkspaceRegistryState {
    archivedSessionIds: readonly SessionId[];
    [key: string]: JsonValue | readonly SessionId[] | undefined;
}
/** Mirrors: @deepseek-ai/dsh-session/lib/types/index.d.ts (sessionController shape used by adapter) */
export interface SessionController {
    resolveAgent(id: string): Promise<Agent>;
    create(opts: {
        sessionId?: string;
        workspaceId?: WorkspaceId | string;
        cwd?: string;
        agentPreset?: string;
    }): Promise<{
        sessionId: SessionId;
    }>;
    prompt(request: {
        sessionId: SessionId;
        requestId: string;
        content: Array<{
            type: "text";
            text: string;
        }>;
    }, signal?: AbortSignal): Promise<void>;
    agents: {
        selectForNextRequest(agent: Agent | undefined, route: {
            provider: string;
            model: string;
        }): void;
    };
}
/** Mirrors: @deepseek-ai/dsh-attachment/lib/types/index.d.ts */
export interface ImageAttachmentRef {
    readonly attachmentId: string;
    readonly mediaType: string;
    readonly originalDimensions?: {
        width: number;
        height: number;
    };
}
export interface StoredImageAttachment {
    data: ArrayBuffer;
    ref: ImageAttachmentRef;
}
/** Mirrors: @deepseek-ai/dsh-tools/lib/types/index.d.ts (minimal tool registry shape) */
export interface ToolSchema {
    name: string;
    description: string;
    parameters: Record<string, JsonValue>;
}
/** What one tool call carries into execute(). */
export interface ToolExec {
    agent: Agent;
    signal: AbortSignal;
    name: string;
    arguments: Record<string, JsonValue>;
    callId: string;
}
/** A registered dsh tool as the MCP bridge drives it: execute, then render if the tool renders. */
export interface DshTool {
    execute(args: Record<string, JsonValue>, exec: ToolExec): Promise<JsonValue>;
    output?: {
        render?: (args: Record<string, JsonValue>, returned: JsonValue) => JsonValue;
    };
}
export interface DshToolsRegistry {
    schemas(agent: Agent): ToolSchema[];
    get(name: string, agent: Agent): DshTool | undefined;
}
/** Mirrors: @deepseek-ai/dsh-host-webserver/lib/types/index.d.ts */
export interface WebServer {
    readonly port: number;
    register(route: {
        kind: "prefix";
        path: string;
        handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => Promise<void>;
    }): () => void;
}
/** Mirrors: @deepseek-ai/dsh-client-connection (host half): trusted-host plus login-cookie check. */
export interface ConnectionPolicy {
    requestRejection(req: import("node:http").IncomingMessage): number | undefined;
}
/** Mirrors: @deepseek-ai/dsh-session-persistence-jsonl/lib/types/index.d.ts */
export interface SessionPersistence {
    /** dsh 0.1.5 answers `{ header, revision, sizeBytes? }` snapshots; older dsh answered headers. */
    list(): Promise<Array<SessionHeader | {
        header: SessionHeader;
    }>>;
    /** Opens the write handle that owns a new session's log; the only way events reach disk. */
    create(header: SessionHeader, options?: {
        inheritedEventCount?: number;
    }): Promise<SessionWriteHandle>;
}
/** Mirrors: @deepseek-ai/dsh-session-persistence/lib/types/handle.d.ts (write half). */
export interface SessionWriteHandle {
    append(events: readonly SessionEvent[]): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
/** Mirrors: @deepseek-ai/cordis/lib/types/context.d.ts intersected with dsh service augmentations */
export interface PluginContext {
    root: PluginContext;
    baseUrl?: string;
    llm: {
        registerConfigurableProviders: (providers: Array<{
            provider: string;
            displayName: string;
            settingsNs: string;
            settingsPath: string[];
        }>) => import("@deepseek-ai/dsh-llm").DirectoryRegistrationHandle;
        registerAdapter: (providers: string[], adapter: import("@deepseek-ai/dsh-llm").LlmAdapter) => import("@deepseek-ai/dsh-llm").AdapterRegistrationHandle;
    };
    logger: {
        [level: string]: ((msg: string) => void) | undefined;
    };
    sessions: SessionStore;
    agents: AgentRegistry;
    approval: ApprovalService;
    userQuestions: UserQuestionService;
    /** Optional-service lookup (cordis `ctx.get`); undefined when the provider is absent. */
    get(name: "commands"): PluginContext["commands"];
    get(name: "sessionTitle"): PluginContext["sessionTitle"];
    get(name: "workspaceRegistry"): WorkspaceRegistry | undefined;
    /** dsh-commands (`/name` in the composer); optional so a host without it still mounts the plugin. */
    commands?: {
        register(definition: {
            name: string;
            description: string;
            /** `attachments: true` admits composer attachments; without it dsh's executor refuses
             *  an invocation carrying any ("/name does not accept attachments"). */
            input?: {
                hint?: string;
                attachments?: boolean;
            };
            recordInput?: boolean;
            handler: (invocation: {
                agent: Agent;
                rawInput: string;
                /** The admitted image and file blocks, in submission order; empty unless declared. */
                attachments: readonly ContentBlock[];
                signal: AbortSignal;
            }) => {
                kind: "success";
                text?: string;
            } | {
                kind: "error";
                text: string;
            };
        }): () => void;
        find(agent: Agent, name: string): object | undefined;
    };
    /**
     * Mirrors: @deepseek-ai/dsh-session-title/lib/types/index.d.ts. Optional so a host without the
     * service still mounts the plugin. `rename` is synchronous, appends a `session/title` event with
     * source `user` (which pins the title against automatic generation), and throws when the title
     * normalizes to empty or the session is not live.
     */
    sessionTitle?: {
        /** Upstream returns the accepted snapshot; the plugin ignores it, so the mirror says void. */
        rename(session: Session, title: string): void;
    };
    workspaceRegistry: WorkspaceRegistry;
    subprocess?: SubprocessRuntime;
    attachments: {
        readImage: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>;
    };
    tools?: DshToolsRegistry;
    sessionController?: SessionController;
    sessionPersistence?: SessionPersistence;
    webServer?: WebServer;
    connection?: ConnectionPolicy;
    on?(event: string, cb: (...args: unknown[]) => void): void;
    emit?(event: string, ...args: unknown[]): void;
    /** Runs `cb` once every named service is mounted; `host` is the scoped context. */
    inject?(deps: string[], cb: (host: PluginContext) => void): void;
    /** Registers a disposable side effect; the callback returns its disposer. */
    effect?(fn: () => (() => void) | void, label?: string): void;
}
