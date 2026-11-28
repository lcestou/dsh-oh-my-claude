// A stand-in for dsh that behaves like the real one where the plugin's tests were bitten by fakes
// that did not (2026-09-23: an id validator no fake exercised, a transcript id derived as the
// identity, an open helper fed the wrong id). Persistence on a temp directory with real zstd
// frames, dsh's error names, `locate` that needs the cwd, ids in dsh's `session-` form, and the
// transcript id the plugin derives. Test-only; imported by the suites, never by the plugin.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeSessionId, projectDirName } from "./adapter/transcript-watch.js";
import { frame, readLog } from "./session-repair.js";
import type { Header, Row } from "./session-repair.js";
import { registerSessionRoutes } from "./sessions.js";
import type { RouteHost, SessionRouteOptions } from "./sessions.js";
import type { HealHost } from "./session-heal.js";
import { asSessionId } from "./dsh.js";
import type {
  JsonValue,
  SessionEvent,
  SessionHeader,
  SessionPersistence,
  WorkspaceRegistry,
} from "./dsh.js";
import {
  fakePluginContext,
  fakeWorkspace,
  isJson,
  notFaked,
  objectOf,
  parseJson,
  serveRoutes,
} from "./test-context.js";
import type { RouteHandler } from "./test-context.js";

/** dsh's own error names, matched by name in the plugin the way dsh throws them. */
const named = (name: string, message: string): Error => {
  const e = new Error(message);
  e.name = name;

  return e;
};

/** dsh's directory key for a workspace path: the path with every non-alphanumeric as `-`. */
const cwdKey = (cwd: string): string => `-${cwd.replaceAll(/[^A-Za-z0-9]/g, "-")}-`;

/** Whether a stored row is an event dsh's loader would hand back: a numeric seq and time, a JSON
 *  object payload, and the surface fields in their event form. The row itself is the event. */
const isEvent = (row: Row): row is Row & SessionEvent =>
  typeof row.seq === "number" &&
  typeof row.time === "number" &&
  isJson(row.data) &&
  typeof row.data === "object" &&
  row.data !== null &&
  !Array.isArray(row.data) &&
  (row.surfaceOp === undefined || row.surfaceOp === "append") &&
  (row.sourceEventSeqs === undefined ||
    row.sourceEventSeqs.every((ref) => typeof ref === "number"));

/** One stored row as the event dsh's loader answers; throws on a row it would not load. */
const eventOf = (row: Row): SessionEvent => {
  if (!isEvent(row)) {
    throw new Error(`a stored row dsh would not load: ${JSON.stringify(row)}`);
  }

  return row;
};

/** dsh's header for a log the fake writes itself. */
const headerOf = (id: string, cwd: string, version: number): SessionHeader => ({
  version,
  id: asSessionId(id),
  createdAt: 0,
  cwd,
  isSeeded: false,
});

/** One stored log as the fake keeps it: the header line and the rows dsh would read back, as
 *  whatever objects were written; they reach dsh's reader only as JSON in the file. */
interface StoredLog {
  header: SessionHeader;
  rows: ReadonlyArray<object>;
}

/** What a test gets back: dsh's persistence over `root`, the id shapes, the log files, and the
 *  knobs that make dsh refuse or own a log. */
export interface FakeDsh {
  root: string;
  /** dsh's `sessionPersistence`, the four calls the plugin uses, over real files under `root`. */
  persistence: {
    list(): Promise<Array<{ header: SessionHeader }>>;
    create(header: SessionHeader): Promise<{
      append(events: ReadonlyArray<SessionEvent>): Promise<void>;
      flush(): Promise<void>;
      close(): Promise<void>;
    }>;
    open(
      id: string,
      access: "read" | "write",
    ): Promise<{
      header: SessionHeader;
      read(offset?: number): Promise<{ events: Array<Row> }>;
      append(events: ReadonlyArray<SessionEvent>): Promise<void>;
      flush(): Promise<void>;
      close(): Promise<void>;
    }>;
    locate(meta: { id: string; cwd?: string }): { kind: "jsonl"; path: string };
  };
  /** The calls the persistence took, in order: `create`, `append`, `flush`, `close`, `open:read`,
   *  `open:write`. */
  calls: Array<string>;
  /** The events every `append` received, flattened, oldest first. */
  appended: Array<SessionEvent>;
  /** A dsh session id in dsh's own form, `session-<uuid>`, hex throughout, from a short label. */
  sessionId(label: string): string;
  /** The transcript id the plugin keeps a dsh-started session's Claude Code transcript under. */
  transcriptId(dshId: string): string;
  /** The stored log's path for a session in `cwd`, as `locate` answers it. */
  logPath(dshId: string, cwd: string): string;
  /** Write a stored log as dsh would have it on disk and list it. Rows are taken as the tests
   *  build them, plain objects, and read back as dsh's rows. */
  writeLog(dshId: string, cwd: string, rows: ReadonlyArray<object>, version?: number): void;
  /** Read a stored log back through the repair module's reader. */
  readLog(dshId: string, cwd: string): { header: Header; rows: Array<Row> };
  /** Write a Claude Code transcript under `<projects>/<cwd key>/<transcript id>.jsonl`. */
  writeTranscript(transcriptId: string, cwd: string, rows: ReadonlyArray<object>): void;
  /** The `projects` directory the transcripts live under, for `projectDir` options. */
  projects: string;
  /** The transcript directory for one workspace, `<projects>/<cwd key>`, as the routes read it. */
  projectDir(cwd: string): string;
  /** Make dsh refuse `dshId`: a constant message until cleared, or a rule read against the log's
   *  rows on every open, which is how dsh's loader really behaves (a repaired log loads). */
  refuse(
    dshId: string,
    rule: string | ((rows: Array<Row>) => string | undefined) | undefined,
  ): void;
  /** Make the next `create` throw a plain error, the way a full disk would. */
  failCreate(on: boolean): void;
  /** Make a write-open of `dshId` throw `SessionAlreadyOwnedError`, as dsh does while another
   *  handle holds the lock. */
  own(dshId: string, owned: boolean): void;
  /** A `HealHost` over this persistence with a catalog that accepts every log. */
  heal(stateDir: string): HealHost;
  /** The route host `openTranscriptOnce` reads: no session loaded, and this persistence, its reads
   *  checked as dsh's events. The web server's `register` and any session-store method other than
   *  `get` throw if reached. */
  ctx(): RouteHost;
  /** A workspace registry whose one workspace is `cwd`; `attached` lists the sessions attached.
   *  Its methods other than `resolveByPath`, `create` and `unarchiveSession` throw if reached. */
  registry(cwd: string): { registry: WorkspaceRegistry; attached: Array<string> };
  /** Register the plugin's routes against this fake and answer requests to them. `connection`
   *  stands in for dsh's: dsh past 0.2.2-rc.5 (harness #8266) dropped `requestRejection` and
   *  checks the request itself. */
  routes(
    options?: Partial<SessionRouteOptions>,
    connection?: { requestRejection?: () => number | undefined },
  ): Promise<{
    respond(
      method: string,
      url: string,
      body?: string,
    ): Promise<{ status: number; body: Record<string, JsonValue> }>;
  }>;
  /** Remove the temp directory. */
  dispose(): void;
}

/**
 * Build the fake over a fresh directory. Throws only when the directory cannot be made. Every
 * method that stands in for dsh answers the way dsh does on this box's 0.1.7: `create` throws
 * `SessionAlreadyExistsError` when the log file exists, `open` throws
 * `SessionPersistenceNotFoundError` when it does not, `locate` names the current-generation path
 * whether or not the file exists, and `list` answers header snapshots.
 */
export function fakeDsh(root: string): FakeDsh {
  mkdirSync(root, { recursive: true });
  const projects = join(root, "projects");
  const sessionsRoot = join(root, "sessions");
  mkdirSync(projects, { recursive: true });
  mkdirSync(sessionsRoot, { recursive: true });
  const calls: Array<string> = [];
  const appended: Array<SessionEvent> = [];
  const refusals = new Map<string, string | ((rows: Array<Row>) => string | undefined)>();
  let createFails = false;
  const owned = new Set<string>();
  const headers = new Map<string, SessionHeader>();

  const logPath = (id: string, cwd: string) =>
    join(sessionsRoot, cwdKey(cwd), id, "session.v4.jsonl.zstd");

  const store = (id: string, cwd: string, log: StoredLog) => {
    const file = logPath(id, cwd);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      Buffer.concat([
        frame(JSON.stringify({ type: "session", ...log.header }) + "\n"),
        frame(log.rows.map((r) => JSON.stringify(r)).join("\n") + (log.rows.length ? "\n" : "")),
      ]),
    );
    headers.set(id, log.header);
  };

  const handleFor = (id: string, cwd: string) => ({
    header: headers.get(id) ?? headerOf(id, cwd, 4),
    read: async () => ({
      events: existsSync(logPath(id, cwd)) ? readLog(logPath(id, cwd)).rows : [],
    }),
    append: async (events: ReadonlyArray<SessionEvent>) => {
      calls.push("append");
      appended.push(...events);
      const current = existsSync(logPath(id, cwd)) ? readLog(logPath(id, cwd)) : undefined;
      const header = headers.get(id);

      if (current && header) {
        store(id, cwd, { header, rows: [...current.rows, ...events] });
      }
    },
    flush: async () => void calls.push("flush"),
    close: async () => void calls.push("close"),
  });

  const cwdOf = (id: string): string => {
    const h = headers.get(id);

    return h?.cwd ?? "";
  };

  const persistence: FakeDsh["persistence"] = {
    list: async () => [...headers.values()].map((header) => ({ header })),
    create: async (header) => {
      calls.push("create");

      if (createFails) {
        throw new Error("disk full");
      }

      const cwd = header.cwd ?? "";
      const file = logPath(header.id, cwd);

      if (existsSync(file)) {
        throw named("SessionAlreadyExistsError", `session "${header.id}" already exists`);
      }

      store(header.id, cwd, { header, rows: [] });

      return handleFor(header.id, cwd);
    },
    open: async (id, access) => {
      calls.push(`open:${access}`);
      const cwd = cwdOf(id);

      if (!existsSync(logPath(id, cwd))) {
        throw named("SessionPersistenceNotFoundError", `no stored session ${id}`);
      }

      // dsh's order: a write-open takes the lease before it loads the log, so an owned log says
      // owned before it says refused; a read-open takes no lease and only the loader speaks.
      if (access === "write" && owned.has(id)) {
        throw named("SessionAlreadyOwnedError", `session ${id} is owned by another handle`);
      }

      const rule = refusals.get(id);
      const refusal = typeof rule === "function" ? rule(readLog(logPath(id, cwd)).rows) : rule;

      if (refusal !== undefined) {
        throw new Error(refusal);
      }

      return handleFor(id, cwd);
    },
    locate: (meta) => ({ kind: "jsonl", path: logPath(meta.id, meta.cwd ?? "") }),
  };

  // What the routes and `openTranscriptOnce` take as dsh's persistence: this one, with the rows a
  // read hands back checked as the events dsh's loader would answer.
  const routePersistence: SessionPersistence = {
    list: () => persistence.list(),
    create: (header) => persistence.create(header),
    open: async (id, access) => {
      const handle = await persistence.open(id, access);

      return {
        ...handle,
        read: async (offset) => ({ events: (await handle.read(offset)).events.map(eventOf) }),
      };
    },
    locate: (meta) => persistence.locate(meta),
  };

  const fake: FakeDsh = {
    root,
    persistence,
    calls,
    appended,
    projects,
    projectDir: (cwd) => join(projects, projectDirName(cwd)),
    sessionId: (label) =>
      `session-${createHash("sha256").update(label).digest("hex").slice(0, 8)}-0000-4000-8000-000000000000`,
    transcriptId: claudeSessionId,
    logPath,
    // A test's rows are the JSON shapes dsh stores; they round-trip through the file.
    writeLog: (id, cwd, rows, version = 4) =>
      store(id, cwd, { header: headerOf(id, cwd, version), rows: [...rows] }),
    readLog: (id, cwd) => readLog(logPath(id, cwd)),
    writeTranscript: (transcriptId, cwd, rows) => {
      const dir = join(projects, projectDirName(cwd));
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${transcriptId}.jsonl`),
        rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
    },
    refuse: (id, rule) => {
      if (rule === undefined) {
        refusals.delete(id);
      } else {
        refusals.set(id, rule);
      }
    },
    failCreate: (on) => {
      createFails = on;
    },
    own: (id, isOwned) => {
      if (isOwned) {
        owned.add(id);
      } else {
        owned.delete(id);
      }
    },
    heal: (stateDir) => ({
      persistence,
      catalog: async () => ({
        currentVersion: 4,
        createRestore: () => ({ decodeRow() {}, finish() {} }),
      }),
      stateDir,
      log() {},
    }),
    ctx: () => ({
      webServer: { port: 0, register: notFaked("webServer.register") },
      connection: {},
      sessions: fakePluginContext({ sessions: { get: () => undefined } }).sessions,
      sessionPersistence: routePersistence,
    }),
    registry: (cwd) => {
      const attached: Array<string> = [];

      const ws = fakeWorkspace("w1", {
        path: cwd,
        title: "w",
        attachSession: async (sid) => void attached.push(sid),
      });

      const { workspaceRegistry: registry } = fakePluginContext({
        workspaceRegistry: {
          archivedSessionIds: [],
          resolveByPath: async () => ws,
          create: async () => ws,
          unarchiveSession: async () => {},
        },
      });

      return { registry, attached };
    },
    routes: async (options = {}, connection = { requestRejection: () => undefined }) => {
      let handler: RouteHandler | undefined;
      const cwd = [...headers.values()][0]?.cwd ?? join(root, "work");
      const { registry } = fake.registry(cwd);

      // The routes read the injected host's members named here; the rest throw if reached.
      const host = fakePluginContext({
        webServer: {
          port: 0,
          register: (route) => {
            handler = route.handler;

            return () => {};
          },
        },
        connection,
        sessions: { get: () => undefined },
        effect: (fn) => {
          fn();
        },
        sessionPersistence: routePersistence,
        workspaceRegistry: registry,
      });

      // The options the routes need for the paths the tests drive; a test names the rest.
      const defaults: SessionRouteOptions = {
        log: () => {},
        projectDir: (p: string) => [join(projects, projectDirName(p))],
        projectsDir: [projects],
        startedIds: async () => [],
        claudeIdOf: claudeSessionId,
        configDir: join(root, "claude"),
        boxesPath: join(root, "boxes.json"),
        importedDir: join(root, "imported"),
        settingsPath: join(root, "claude", "settings.json"),
        instanceFor: () => undefined,
        instanceForHost: () => ({ configDir: join(root, "claude") }),
      };

      registerSessionRoutes(
        fakePluginContext({
          inject: (_deps, cb) => {
            cb(host);
          },
          on() {},
          effect: (fn) => {
            fn();
          },
        }),
        { ...defaults, ...options },
      );

      if (!handler) {
        throw new Error("the routes did not register a handler");
      }

      const { send } = await serveRoutes(() => handler);

      return {
        respond: async (method, url, body) => {
          const { status, text } = await send(method, url, body);

          return { status, body: text ? objectOf(parseJson(text)) : {} };
        },
      };
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };

  return fake;
}

/** The session directories the fake wrote, for a test that wants to count them. */
export const storedSessions = (fake: FakeDsh): Array<string> =>
  existsSync(join(fake.root, "sessions")) ? readdirSync(join(fake.root, "sessions")) : [];
