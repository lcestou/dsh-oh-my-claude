// A stand-in for dsh that behaves like the real one where the plugin's tests were bitten by fakes
// that did not (2026-09-23: an id validator no fake exercised, a transcript id derived as the
// identity, an open helper fed the wrong id). Persistence on a temp directory with real zstd
// frames, dsh's error names, `locate` that needs the cwd, ids in dsh's `session-` form, and the
// transcript id the plugin derives. Test-only; imported by the suites, never by the plugin.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeSessionId, projectDirName } from "./adapter.js";
import { frame, readLog, type Header, type Row } from "./session-repair.js";
import { registerSessionRoutes, type SessionRouteOptions } from "./sessions.js";
import type { HealHost } from "./session-heal.js";
import { asSessionId, type JsonValue, type PluginContext, type SessionHeader } from "./dsh.js";

/** dsh's own error names, matched by name in the plugin the way dsh throws them. */
const named = (name: string, message: string): Error => {
  const e = new Error(message);
  e.name = name;
  return e;
};

/** dsh's directory key for a workspace path: the path with every non-alphanumeric as `-`. */
const cwdKey = (cwd: string): string => `-${cwd.replace(/[^A-Za-z0-9]/g, "-")}-`;

/** dsh's header for a log the fake writes itself. */
const headerOf = (id: string, cwd: string, version: number): SessionHeader => ({
  version,
  id: asSessionId(id),
  createdAt: 0,
  cwd,
  isSeeded: false,
});

/** One stored log as the fake keeps it: the header line and the rows dsh would read back. */
interface StoredLog {
  header: SessionHeader;
  rows: Row[];
}

/** What a test gets back: dsh's persistence over `root`, the id shapes, the log files, and the
 *  knobs that make dsh refuse or own a log. */
export interface FakeDsh {
  root: string;
  /** dsh's `sessionPersistence`, the four calls the plugin uses, over real files under `root`. */
  persistence: {
    list(): Promise<Array<{ header: SessionHeader }>>;
    create(header: SessionHeader): Promise<{
      append(events: readonly unknown[]): Promise<void>;
      flush(): Promise<void>;
      close(): Promise<void>;
    }>;
    open(
      id: string,
      access: "read" | "write",
    ): Promise<{
      header: SessionHeader;
      read(offset?: number): Promise<{ events: Row[] }>;
      append(events: readonly unknown[]): Promise<void>;
      flush(): Promise<void>;
      close(): Promise<void>;
    }>;
    locate(meta: { id: string; cwd?: string }): { kind: "jsonl"; path: string };
  };
  /** The calls the persistence took, in order: `create`, `append`, `flush`, `close`, `open:read`,
   *  `open:write`. */
  calls: string[];
  /** The events every `append` received, flattened, oldest first. */
  appended: Row[];
  /** A dsh session id in dsh's own form, `session-<uuid>`, hex throughout, from a short label. */
  sessionId(label: string): string;
  /** The transcript id the plugin keeps a dsh-started session's Claude Code transcript under. */
  transcriptId(dshId: string): string;
  /** The stored log's path for a session in `cwd`, as `locate` answers it. */
  logPath(dshId: string, cwd: string): string;
  /** Write a stored log as dsh would have it on disk and list it. Rows are taken as the tests
   *  build them, plain objects, and read back as dsh's rows. */
  writeLog(dshId: string, cwd: string, rows: readonly object[], version?: number): void;
  /** Read a stored log back through the repair module's reader. */
  readLog(dshId: string, cwd: string): { header: Header; rows: Row[] };
  /** Write a Claude Code transcript under `<projects>/<cwd key>/<transcript id>.jsonl`. */
  writeTranscript(transcriptId: string, cwd: string, rows: object[]): void;
  /** The `projects` directory the transcripts live under, for `projectDir` options. */
  projects: string;
  /** The transcript directory for one workspace, `<projects>/<cwd key>`, as the routes read it. */
  projectDir(cwd: string): string;
  /** Make dsh refuse `dshId`: a constant message until cleared, or a rule read against the log's
   *  rows on every open, which is how dsh's loader really behaves (a repaired log loads). */
  refuse(dshId: string, rule: string | ((rows: Row[]) => string | undefined) | undefined): void;
  /** Make the next `create` throw a plain error, the way a full disk would. */
  failCreate(on: boolean): void;
  /** Make a write-open of `dshId` throw `SessionAlreadyOwnedError`, as dsh does while another
   *  handle holds the lock. */
  own(dshId: string, owned: boolean): void;
  /** A `HealHost` over this persistence with a catalog that accepts every log. */
  heal(stateDir: string): HealHost;
  /** A `PluginContext` slice for `openTranscriptOnce`: no session loaded, this persistence. */
  ctx(): { sessions: { get(): undefined }; sessionPersistence: FakeDsh["persistence"] };
  /** A workspace registry whose one workspace is `cwd`; `attached` lists the sessions attached. */
  registry(cwd: string): { registry: object; attached: string[] };
  /** Register the plugin's routes against this fake and answer requests to them. */
  routes(options?: Partial<SessionRouteOptions>): {
    respond(
      method: string,
      url: string,
      body?: string,
    ): Promise<{ status: number; body: Record<string, JsonValue> }>;
  };
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
  const calls: string[] = [];
  const appended: Row[] = [];
  const refusals = new Map<string, string | ((rows: Row[]) => string | undefined)>();
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
    append: async (events: readonly unknown[]) => {
      calls.push("append");
      // SAFETY: the plugin appends the rows the seed builder made, which are Row-shaped
      const rows = events as Row[];
      appended.push(...rows);
      const current = existsSync(logPath(id, cwd)) ? readLog(logPath(id, cwd)) : undefined;
      const header = headers.get(id);
      if (current && header) store(id, cwd, { header, rows: [...current.rows, ...rows] });
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
      if (createFails) throw new Error("disk full");
      const cwd = header.cwd ?? "";
      const file = logPath(header.id, cwd);
      if (existsSync(file))
        throw named("SessionAlreadyExistsError", `session "${header.id}" already exists`);
      store(header.id, cwd, { header, rows: [] });
      return handleFor(header.id, cwd);
    },
    open: async (id, access) => {
      calls.push(`open:${access}`);
      const cwd = cwdOf(id);
      if (!existsSync(logPath(id, cwd)))
        throw named("SessionPersistenceNotFoundError", `no stored session ${id}`);
      const rule = refusals.get(id);
      const refusal = typeof rule === "function" ? rule(readLog(logPath(id, cwd)).rows) : rule;
      if (refusal !== undefined) throw new Error(refusal);
      if (access === "write" && owned.has(id))
        throw named("SessionAlreadyOwnedError", `session ${id} is owned by another handle`);
      return handleFor(id, cwd);
    },
    locate: (meta) => ({ kind: "jsonl", path: logPath(meta.id, meta.cwd ?? "") }),
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
    // SAFETY: a test's rows are the JSON shapes dsh stores; they round-trip through the file
    writeLog: (id, cwd, rows, version = 4) =>
      store(id, cwd, { header: headerOf(id, cwd, version), rows: rows as Row[] }),
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
      if (rule === undefined) refusals.delete(id);
      else refusals.set(id, rule);
    },
    failCreate: (on) => {
      createFails = on;
    },
    own: (id, isOwned) => {
      if (isOwned) owned.add(id);
      else owned.delete(id);
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
    ctx: () => ({ sessions: { get: () => undefined }, sessionPersistence: persistence }),
    registry: (cwd) => {
      const attached: string[] = [];
      const ws = {
        id: "w1",
        path: cwd,
        title: "w",
        sessionIds: [],
        attachSession: async (sid: string) => void attached.push(sid),
      };
      const registry = {
        archivedSessionIds: [],
        resolveByPath: async () => ws,
        create: async () => ws,
        enqueueOperation: <T>(op: () => Promise<T>) => op(),
        requireState: () => ({ archivedSessionIds: [] }),
        setState: async () => {},
      };
      return { registry, attached };
    },
    routes: (options = {}) => {
      let handler: ((req: unknown, res: unknown) => void) | undefined;
      const cwd = [...headers.values()][0]?.cwd ?? join(root, "work");
      const { registry } = fake.registry(cwd);
      // SAFETY: the routes read the injected host's members named here and nothing else
      const ctx = {
        inject: (_deps: string[], cb: (host: unknown) => void) => {
          cb({
            webServer: {
              register: (r: { handler: (req: unknown, res: unknown) => void }) => {
                handler = r.handler;
                return () => {};
              },
            },
            connection: { requestRejection: () => undefined },
            sessions: { get: () => undefined },
            effect: (fn: () => void) => fn(),
            sessionPersistence: persistence,
          });
        },
        on() {},
        effect: (fn: () => void) => fn(),
      } as unknown as PluginContext;
      // SAFETY: the options the routes need for the paths the tests drive; a test names the rest
      registerSessionRoutes(ctx, {
        log: () => {},
        projectDir: (p: string) => [join(projects, projectDirName(p))],
        projectsDir: [projects],
        startedIds: async () => [],
        claudeIdOf: claudeSessionId,
        configDir: join(root, "claude"),
        boxesPath: join(root, "boxes.json"),
        importedDir: join(root, "imported"),
        settingsPath: join(root, "claude", "settings.json"),
        workspaceRegistry: () => registry,
        ...options,
      } as unknown as SessionRouteOptions);
      if (!handler) throw new Error("the routes did not register a handler");
      const bound = handler;
      return {
        respond: async (method, url, body) => {
          const chunks: Buffer[] = [];
          let status = 0;
          // SAFETY: the request and response the route handler reads and writes, nothing more
          const res = {
            writeHead: (s: number) => void (status = s),
            end: (b: Buffer | string) =>
              void chunks.push(typeof b === "string" ? Buffer.from(b) : b),
          };
          const req = {
            method,
            url,
            on: (ev: string, cb: (c?: Buffer) => void) => {
              if (ev === "data" && body !== undefined) cb(Buffer.from(body));
              if (ev === "end") cb();
            },
            destroy: () => {},
          };
          await bound(req, res);
          const text = Buffer.concat(chunks).toString("utf8");
          // SAFETY: the routes answer JSON objects
          return { status, body: (text ? JSON.parse(text) : {}) as Record<string, JsonValue> };
        },
      };
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
  return fake;
}

/** The session directories the fake wrote, for a test that wants to count them. */
export const storedSessions = (fake: FakeDsh): string[] =>
  existsSync(join(fake.root, "sessions")) ? readdirSync(join(fake.root, "sessions")) : [];
