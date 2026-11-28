// Typed fakes of dsh's services for the test suites. Test-only: imported only by *.test.ts files
// and the dev checks under tools/, so the plugin never ships it. A suite hands in only the members
// its code path reads; every other required member is a stub that throws `not faked: <name>`, so a
// test that reaches something it did not fake fails loudly at the call instead of reading
// `undefined`.
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { MessageId } from "@deepseek-ai/dsh-llm";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import type { ClientCtx, OptionalServices as ClientServices } from "./client/shared.js";
import { ClaudeProcess } from "./process.js";
import type { ClaudeProcessSpec, TurnPrep } from "./process.js";
import type { JsonRpcReply } from "./mcp.js";
import { asSessionId } from "./dsh.js";
import type {
  Agent,
  JsonValue,
  AgentRegistry,
  ApprovalService,
  OptionalServices,
  PluginContext,
  Session,
  SessionController,
  SessionEvent,
  SessionHeader,
  SessionStore,
  SubprocessHandle,
  UserQuestionService,
  Workspace,
  WorkspaceId,
  WorkspaceRegistry,
} from "./dsh.js";

/** What a suite may hand `fakePluginContext`: any member of the context, with each required
 *  service given in part. The parts are laid over throwing stubs of the rest of that service. */
export type PluginContextOverrides = Partial<
  Omit<
    PluginContext,
    | "llm"
    | "sessions"
    | "agents"
    | "approval"
    | "userQuestions"
    | "workspaceRegistry"
    | "attachments"
  >
> & {
  llm?: Partial<PluginContext["llm"]>;
  sessions?: Partial<SessionStore>;
  agents?: Partial<AgentRegistry>;
  approval?: Partial<ApprovalService>;
  userQuestions?: Partial<UserQuestionService>;
  workspaceRegistry?: Partial<WorkspaceRegistry>;
  attachments?: Partial<PluginContext["attachments"]>;
  /** What `get(name)` answers per optional service; a name left out answers undefined. */
  services?: Partial<OptionalServices>;
};

/** A method stub that throws `not faked: <name>` when called. Its `never` return fits any method
 *  signature, overloaded and generic ones included. */
export const notFaked = (name: string) => (): never => {
  throw new Error(`not faked: ${name}`);
};

/**
 * `base` with every own property of `overrides` copied onto it by descriptor, so a getter in the
 * override stays a live getter instead of being read once the way an object spread reads it. Keys
 * in `skip` are left out, for the members a caller has already merged itself. Mutates `base` and
 * returns it; `undefined` overrides leave it as it was. The values are not checked against `T`
 * here: each exported factory types its own overrides.
 */
function overlay<T extends object, O extends object = Partial<T>>(
  base: T,
  overrides: O | undefined,
  skip: ReadonlyArray<keyof O> = [],
): T {
  if (overrides === undefined) {
    return base;
  }

  const descriptors = Object.getOwnPropertyDescriptors(overrides);

  for (const key of skip) {
    Reflect.deleteProperty(descriptors, key);
  }

  return Object.defineProperties(base, descriptors);
}

/**
 * A whole `PluginContext` from the members a suite needs. `root` is the fake itself unless
 * overridden, `get(name)` answers `services[name]` (undefined for a service not handed in), `logger` is empty (the plugin
 * calls its levels through `?.`), and the methods of every required service throw until faked.
 * Optional members (`on`, `inject`, `webServer`, `commands` …) stay absent unless handed in, the
 * same as on a host that lacks them.
 */
export function fakePluginContext(overrides: PluginContextOverrides = {}): PluginContext {
  const {
    llm,
    sessions,
    agents,
    approval,
    userQuestions,
    workspaceRegistry,
    attachments,
    services = {},
  } = overrides;

  const ctx: PluginContext = {
    get root() {
      return ctx;
    },
    llm: overlay<PluginContext["llm"]>(
      {
        registerConfigurableProviders: notFaked("llm.registerConfigurableProviders"),
        registerAdapter: notFaked("llm.registerAdapter"),
        listProviders: notFaked("llm.listProviders"),
        listModels: notFaked("llm.listModels"),
        resolveCallConfig: notFaked("llm.resolveCallConfig"),
      },
      llm,
    ),
    logger: {},
    sessions: overlay<SessionStore>(
      {
        create: notFaked("sessions.create"),
        prepare: notFaked("sessions.prepare"),
        enter: notFaked("sessions.enter"),
        announce: notFaked("sessions.announce"),
        flush: notFaked("sessions.flush"),
        get: notFaked("sessions.get"),
        list: notFaked("sessions.list"),
        fork: notFaked("sessions.fork"),
      },
      sessions,
    ),
    agents: overlay<AgentRegistry>(
      {
        currentInitiator: notFaked("agents.currentInitiator"),
        requireInitiator: notFaked("agents.requireInitiator"),
        withInitiator: notFaked("agents.withInitiator"),
        withoutInitiator: notFaked("agents.withoutInitiator"),
        setFactory: notFaked("agents.setFactory"),
        create: notFaked("agents.create"),
        resume: notFaked("agents.resume"),
        register: notFaked("agents.register"),
        enter: notFaked("agents.enter"),
        announce: notFaked("agents.announce"),
        get: notFaked("agents.get"),
        list: notFaked("agents.list"),
        roots: notFaked("agents.roots"),
      },
      agents,
    ),
    approval: overlay<ApprovalService>(
      {
        config: {},
        setPolicy: notFaked("approval.setPolicy"),
        request: notFaked("approval.request"),
        overrideOf: notFaked("approval.overrideOf"),
      },
      approval,
    ),
    userQuestions: overlay<UserQuestionService>(
      { ask: notFaked("userQuestions.ask") },
      userQuestions,
    ),
    get: (name) => services[name],
    workspaceRegistry: overlay<WorkspaceRegistry>(
      {
        create: notFaked("workspaceRegistry.create"),
        get: notFaked("workspaceRegistry.get"),
        list: notFaked("workspaceRegistry.list"),
        delete: notFaked("workspaceRegistry.delete"),
        insertBefore: notFaked("workspaceRegistry.insertBefore"),
        archivedSessionIds: [],
        archiveSession: notFaked("workspaceRegistry.archiveSession"),
        resolveByPath: notFaked("workspaceRegistry.resolveByPath"),
        unarchiveSession: notFaked("workspaceRegistry.unarchiveSession"),
      },
      workspaceRegistry,
    ),
    attachments: overlay<PluginContext["attachments"]>(
      { readImage: notFaked("attachments.readImage") },
      attachments,
    ),
  };

  return overlay(ctx, overrides, [
    "llm",
    "sessions",
    "agents",
    "approval",
    "userQuestions",
    "workspaceRegistry",
    "attachments",
    "services",
  ]);
}

/** What a suite may hand `fakeSession`: any member, with the header given in part. */
export type SessionOverrides = Partial<Omit<Session, "header">> & {
  header?: Partial<SessionHeader>;
};

/**
 * A whole `Session` from the members a suite needs. The header defaults to version 0, id
 * `s-fake`, created at 0 and not seeded, with the suite's header fields laid over it; `seq` and
 * `firstLiveSeq` default to 0; every method throws until faked. A getter handed in for `seq`
 * stays live.
 */
export function fakeSession(overrides: SessionOverrides = {}): Session {
  const { header } = overrides;

  return overlay<Session, SessionOverrides>(
    {
      header: {
        version: 0,
        id: asSessionId("s-fake"),
        createdAt: 0,
        isSeeded: false,
        ...header,
      },
      id: asSessionId(header?.id ?? "s-fake"),
      firstLiveSeq: 0,
      seq: 0,
      snapshotEvents: notFaked("session.snapshotEvents"),
      isOwnSeq: notFaked("session.isOwnSeq"),
      append: notFaked("session.append"),
      deriveMessages: notFaked("session.deriveMessages"),
      requestHeader: notFaked("session.requestHeader"),
      requestContext: notFaked("session.requestContext"),
    },
    overrides,
    ["header"],
  );
}

/** A whole `Agent` from the members a suite needs: id `a-fake` unless given, and a `followup`
 *  that throws until faked. Optional members stay absent unless handed in. */
export function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  return overlay<Agent>(
    { id: asSessionId("a-fake"), followup: notFaked("agent.followup") },
    overrides,
  );
}

/** The runtime's own fetch, taken at load: a suite that swaps `globalThis.fetch` for a fake upstream
 *  must not also swap the client `serveRoutes` talks to its own server with. */
const ownFetch = globalThis.fetch;

/** A route handler the way dsh's web server calls one. */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** One answer from `ServedRoutes.send`: the status and the body as text. */
export interface RouteAnswer {
  status: number;
  text: string;
}

/** A running `serveRoutes` server. */
export interface ServedRoutes {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  origin: string;
  send: (method: string, url: string, body?: string) => Promise<RouteAnswer>;
}

/**
 * Serves `current()` on a loopback port over a real socket, so a route handler gets node's own
 * request and response. `send` makes one request and resolves to the whole answer; `origin` is for
 * a suite that needs the raw `fetch`, such as one reading an event stream that never ends.
 * The handler is read per request, so a suite that registers its routes again reaches the new one.
 * A request with no handler registered, or one whose handler throws, rejects `send`'s promise with
 * an error naming the request and carrying the thrown value as its `cause`. The server is unref'd,
 * so a suite never has to close it to exit. Requests are meant to run one at a time.
 */
export async function serveRoutes(current: () => RouteHandler | undefined): Promise<ServedRoutes> {
  // What went wrong on the server side of the request in flight; the caller rethrows it.
  const failures: Array<unknown> = [];

  const server = createServer((req, res) => {
    const handler = current();

    if (handler === undefined) {
      failures.push(new Error("no route handler registered"));
      res.writeHead(500).end();

      return;
    }

    handler(req, res).catch((cause: unknown) => {
      failures.push(cause);

      if (!res.headersSent) {
        res.writeHead(500);
      }

      res.end();
    });
  });

  server.unref();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("the route server has no port");
  }

  const { port }: AddressInfo = address;

  const origin = `http://127.0.0.1:${port}`;

  /** One request through the server, rethrowing whatever the handler threw while answering it. */
  const send = async (method: string, url: string, body?: string): Promise<RouteAnswer> => {
    failures.length = 0;

    const reply = await ownFetch(`${origin}${url}`, { method, body });
    const text = await reply.text();

    if (failures.length > 0) {
      const [cause] = failures;

      throw new Error(`${method} ${url}: ${String(cause)}`, { cause });
    }

    return { status: reply.status, text };
  };

  return { origin, send };
}

/** The field kinds `rowsOf` checks: a `typeof` name, with `?` for a field that may be absent. */
export type FieldKind = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";

/** The TypeScript type each field kind decodes to. */
interface FieldTypes {
  string: string;
  number: number;
  boolean: boolean;
  "string?": string | undefined;
  "number?": number | undefined;
  "boolean?": boolean | undefined;
}

/** One decoded reply row: each field of `F` with the type its kind names. */
export type ReplyRow<F extends Record<string, FieldKind>> = { [K in keyof F]: FieldTypes[F[K]] };

/**
 * `reply` decoded as a list of rows carrying `fields`, for reading a route's JSON reply without a
 * cast. Fails the test with an assertion error when `reply` is not a list, or any row lacks a field
 * of the named kind. Fields left out of `fields` are not checked and not visible in the type.
 */
export function rowsOf<F extends Record<string, FieldKind>>(
  reply: JsonValue | undefined,
  fields: F,
): Array<ReplyRow<F>> {
  /** Whether one row is an object carrying every field of `fields` with the kind it names. */
  const fits = (row: unknown): row is ReplyRow<F> => {
    if (typeof row !== "object" || row === null) {
      return false;
    }

    const present = new Map(Object.entries(row));

    return Object.entries(fields).every(([key, kind]) =>
      kind.endsWith("?")
        ? present.get(key) === undefined || typeof present.get(key) === kind.slice(0, -1)
        : typeof present.get(key) === kind,
    );
  };

  assert.ok(Array.isArray(reply), `expected a list of ${JSON.stringify(fields)}`);

  return reply.map((row) => {
    assert.ok(fits(row), `expected ${JSON.stringify(row)} to carry ${JSON.stringify(fields)}`);

    return row;
  });
}

/** Whether `id` can stand as a workspace id. dsh's registry mints them and a fake registry is that
 *  minter in a suite, so any non-empty string qualifies. */
const isWorkspaceId = (id: string): id is WorkspaceId => id.length > 0;

/** A whole dsh workspace row with id `id`, empty path, title and session list, and an
 *  `attachSession` that throws until faked; `overrides` replace any of them. Throws on an empty id. */
export function fakeWorkspace(
  id: string,
  overrides: Partial<Omit<Workspace, "id">> = {},
): Workspace {
  assert.ok(isWorkspaceId(id), "a workspace id is never empty");

  return overlay<Workspace, Partial<Omit<Workspace, "id">>>(
    {
      id,
      path: "",
      title: "",
      sessionIds: [],
      attachSession: notFaked("workspace.attachSession"),
    },
    overrides,
  );
}

/** A whole `SessionController` from the methods a suite needs; the rest throw until faked. */
export function fakeSessionController(
  overrides: Partial<SessionController> = {},
): SessionController {
  return overlay<SessionController>(
    {
      resolveAgent: notFaked("sessionController.resolveAgent"),
      create: notFaked("sessionController.create"),
      prompt: notFaked("sessionController.prompt"),
      state: notFaked("sessionController.state"),
      wait: notFaked("sessionController.wait"),
    },
    overrides,
  );
}

/** `value` as a JSON object, for reading one level of a parsed reply without a cast; fails the
 *  test when it is anything else (a list, a scalar, null or absent). */
export function objectOf(value: JsonValue | undefined): { [key: string]: JsonValue } {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `expected a JSON object, got ${JSON.stringify(value)}`,
  );

  return value;
}

/** `value` decoded as one row carrying `fields`, the single-object form of `rowsOf`; fails the
 *  test when it is not an object with a field of each named kind. */
export function fieldsOf<F extends Record<string, FieldKind>>(
  value: JsonValue | undefined,
  fields: F,
): ReplyRow<F> {
  const [row] = rowsOf([objectOf(value)], fields);

  assert.ok(row);

  return row;
}

/** A child process handle over in-memory streams that never exits on its own: `terminate` and
 *  `waitForExit` do nothing, and `done` never settles, so nothing outlives the suite. */
export const fakeSubprocessHandle = (): SubprocessHandle => ({
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  stderr: new PassThrough(),
  done: new Promise(() => {}),
  terminate: () => {},
  waitForExit: async () => {},
});

/** A whole process spec: no model, no effort, default mode, no session, in /tmp, with
 *  `overrides` laid over it. */
export const fakeSpec = (overrides: Partial<ClaudeProcessSpec> = {}): ClaudeProcessSpec => ({
  cwd: "/tmp",
  model: undefined,
  effort: null,
  mode: "default",
  sessionId: null,
  temporary: false,
  ...overrides,
});

/**
 * A real `ClaudeProcess` whose child is in-memory streams instead of a CLI, with `overrides` laid
 * over the instance (own properties win over the class's, getters included). The child never
 * exits on its own and `kill` reaches no process, so nothing outlives the suite. `spec` merges
 * over a default one when given in part.
 */
export function fakeClaudeProcess(
  overrides: Partial<Omit<ClaudeProcess, "spec">> & { spec?: Partial<ClaudeProcessSpec> } = {},
): ClaudeProcess {
  const proc = new ClaudeProcess({
    args: [],
    cwd: "/tmp",
    spec: fakeSpec(overrides.spec),
    spawner: () => fakeSubprocessHandle(),
  });

  return overlay(proc, overrides, ["spec"]);
}

/** The options dsh hands an adapter's `stream` for one user prompt `text` in `sessionId` (none
 *  when undefined, as a one-off call carries), on provider `claude-code` and model `model`, with a
 *  signal nothing aborts unless one is given. */
export function userTurn(
  sessionId: string | undefined,
  text = "go",
  {
    model = "m",
    signal = new AbortController().signal,
  }: { model?: string; signal?: AbortSignal } = {},
): GenerateOptions {
  const options: GenerateOptions = {
    provider: "claude-code",
    model,
    messages: [
      {
        id: MessageId(`u-${sessionId ?? "none"}`),
        role: "user",
        content: [{ type: "text", text }],
        source: { kind: "user" },
      },
    ],
    signal,
  };

  if (sessionId !== undefined) {
    options.sessionId = asSessionId(sessionId);
  }

  return options;
}

/** A `ServerResponse` and the text written to it, in order. */
export interface RecordingResponse {
  res: ServerResponse;
  written: Array<string>;
}

/**
 * A real `ServerResponse` on no socket whose writes are recorded in `written`, for code that
 * streams to a response (the event hub). Headers and `end` behave as node's own; nothing reaches
 * a network.
 */
export function recordingResponse(): RecordingResponse {
  const res = new ServerResponse(new IncomingMessage(new Socket()));
  const written: Array<string> = [];

  res.write = (chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));

    return true;
  };

  return { res, written };
}

/** What a suite may hand `fakeClientCtx`: any member of the client context, with each required
 *  service given in part over throwing stubs of the rest. */
export type ClientCtxOverrides = Partial<
  Omit<ClientCtx, "slots" | "sessions" | "workspaces" | "modelDirectories">
> & {
  slots?: Partial<ClientCtx["slots"]>;
  sessions?: Partial<ClientCtx["sessions"]>;
  workspaces?: Partial<ClientCtx["workspaces"]>;
  modelDirectories?: Partial<ClientCtx["modelDirectories"]>;
  /** What `get(name)` answers per optional client service; with none given, `get` is absent. */
  services?: Partial<ClientServices>;
};

/**
 * A whole client `ClientCtx` (what dsh hands the plugin's client) from the members a suite needs.
 * Every required method throws `not faked: <name>` until handed in, the session and workspace
 * lists included; optional members (`effect`, `inject`) stay absent unless given, and `get` is
 * there only when `services` is, answering `services[name]`.
 */
export function fakeClientCtx(overrides: ClientCtxOverrides = {}): ClientCtx {
  const { slots, sessions, workspaces, modelDirectories, services } = overrides;

  /** The optional-service lookup over `services`, typed per name the way dsh's own is. */
  const get = <K extends keyof ClientServices>(name: K): ClientServices[K] | undefined =>
    services?.[name];

  const ctx = overlay<ClientCtx, ClientCtxOverrides>(
    {
      slots: overlay<ClientCtx["slots"]>(
        { inject: notFaked("slots.inject"), register: notFaked("slots.register") },
        slots,
      ),
      sessions: overlay<ClientCtx["sessions"]>(
        {
          list: { getSnapshot: notFaked("sessions.list.getSnapshot") },
          create: notFaked("sessions.create"),
          refresh: notFaked("sessions.refresh"),
        },
        sessions,
      ),
      workspaces: overlay<ClientCtx["workspaces"]>(
        {
          list: {
            getSnapshot: notFaked("workspaces.list.getSnapshot"),
            subscribe: notFaked("workspaces.list.subscribe"),
          },
          create: notFaked("workspaces.create"),
        },
        workspaces,
      ),
      modelDirectories: overlay<ClientCtx["modelDirectories"]>(
        { directoryFor: notFaked("modelDirectories.directoryFor") },
        modelDirectories,
      ),
    },
    overrides,
    ["slots", "sessions", "workspaces", "modelDirectories", "services"],
  );

  if (services) {
    ctx.get = get;
  }

  return ctx;
}

/** Whether `value`, read from JSON, is a JSON document. It is by construction; the check says so
 *  to the type system without a cast. */
export const isJson = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value)
    ? value.every(isJson)
    : typeof value === "object" && Object.values(value).every(isJson));

/** `text` parsed as JSON. Throws a SyntaxError on text that is not JSON. */
export function parseJson(text: string): JsonValue {
  const parsed: unknown = JSON.parse(text);

  assert.ok(isJson(parsed), "JSON.parse answers JSON");

  return parsed;
}

/** The `result` of a JSON-RPC reply body as parsed off the wire; fails the test when the body is
 *  not an object carrying an object result. */
export const rpcWireResult = (body: JsonValue | undefined): { [key: string]: JsonValue } =>
  objectOf(objectOf(body).result);

/** A reply's result as the CLI receives it, parsed back from the JSON text it is sent as; fails the
 *  test on a null reply or one carrying no result. */
export const rpcResult = (reply: JsonRpcReply | null): { [key: string]: JsonValue } => {
  assert.ok(reply?.result, "the request is answered with a result");

  const sent = JSON.stringify(reply);

  return rpcWireResult(parseJson(sent));
};

/** The text of a reply's first content block, undefined when that block carries none. */
export const rpcFirstText = (reply: JsonRpcReply | null): string | undefined =>
  rowsOf(rpcResult(reply).content, { text: "string?" })[0]?.text;

/** The tools a tools/list reply offers, each as the JSON object the CLI reads. */
export const rpcTools = (reply: JsonRpcReply | null): Array<{ [key: string]: JsonValue }> => {
  const { tools: listed } = rpcResult(reply);

  assert.ok(Array.isArray(listed), "tools/list answers a list");

  return listed.map((t) => objectOf(t));
};

/** The names of the tools a tools/list reply offers, in order. */
export const rpcToolNames = (reply: JsonRpcReply | null): Array<string> =>
  rowsOf(rpcResult(reply).tools, { name: "string" }).map((t) => t.name);

/** Whether one listed tool is marked read-only (concurrency-safe) for the CLI. */
export const rpcReadOnly = (tool: { [key: string]: JsonValue }): boolean =>
  fieldsOf(tool.annotations, { readOnlyHint: "boolean" }).readOnlyHint;

/** A session whose log stands at the start of turn 1, step 1, the way dsh hands one to a step,
 *  and whose `append` answers seq 1 for anything written to it. */
export function stepSession(): Session {
  return fakeSession({
    snapshotEvents: (): Array<SessionEvent> => [
      { type: "turn/start", seq: 0, time: 0, data: { turn: 1 } },
      { type: "step/start", seq: 1, time: 0, data: { step: 1 } },
    ],
    append: (type) => ({ type, seq: 1, time: 0, data: {} }),
  });
}

/** A turn's preparation for prompt `go` in /tmp on model `m`, with `overrides` laid over it. */
export const fakePrep = (overrides: Partial<TurnPrep> = {}): TurnPrep => ({
  input: "go",
  spec: fakeSpec({ model: "m" }),
  cwd: "/tmp",
  args: [],
  ...overrides,
});

/** The context `fakeRouteHost` builds and the route handler last registered through it. */
export interface FakeRouteHost {
  ctx: PluginContext;
  handler: () => RouteHandler | undefined;
}

/**
 * A fake plugin context for `registerSessionRoutes`. Its `inject` hands the callback a host whose web
 * server keeps the last route handler registered, whose persistence lists `persisted` (each as a
 * version-0 header with that id and cwd), and whose workspace registry is `workspaceRegistry` over
 * throwing stubs, or one where every id is a live workspace when none is given. `handler()` reads the latest registration, so a block that registers twice reaches
 * the second.
 */
export function fakeRouteHost({
  persisted = [],
  workspaceRegistry,
}: {
  persisted?: Array<{ id: string; cwd: string }>;
  workspaceRegistry?: Partial<WorkspaceRegistry>;
} = {}): FakeRouteHost {
  let handler: RouteHandler | undefined;

  const host = fakePluginContext({
    webServer: {
      port: 0,
      register: (route) => {
        handler = route.handler;

        return () => {};
      },
    },
    connection: { requestRejection: () => undefined },
    sessions: { get: () => undefined },
    sessionPersistence: {
      list: async () =>
        persisted.map(({ id, cwd }) => ({
          version: 0,
          id: asSessionId(id),
          cwd,
          createdAt: 0,
          isSeeded: false,
        })),
      create: notFaked("sessionPersistence.create"),
      open: notFaked("sessionPersistence.open"),
    },
    // With no registry handed in, every id is a live workspace: what the routes saw before, on a
    // host without one, which kept every remote-workspace row.
    workspaceRegistry: workspaceRegistry ?? {
      get: (id) => fakeWorkspace(id),
      archivedSessionIds: [],
    },
    effect: (fn) => {
      fn();
    },
  });

  return {
    ctx: fakePluginContext({
      inject: (_deps, cb) => {
        cb(host);
      },
    }),
    handler: () => handler,
  };
}
