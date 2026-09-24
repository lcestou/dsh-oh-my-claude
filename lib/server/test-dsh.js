// A stand-in for dsh that behaves like the real one where the plugin's tests were bitten by fakes
// that did not (2026-09-23: an id validator no fake exercised, a transcript id derived as the
// identity, an open helper fed the wrong id). Persistence on a temp directory with real zstd
// frames, dsh's error names, `locate` that needs the cwd, ids in dsh's `session-` form, and the
// transcript id the plugin derives. Test-only; imported by the suites, never by the plugin.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeSessionId, projectDirName } from "./adapter.js";
import { frame, readLog } from "./session-repair.js";
import { registerSessionRoutes } from "./sessions.js";
import { asSessionId } from "./dsh.js";
/** dsh's own error names, matched by name in the plugin the way dsh throws them. */
const named = (name, message) => {
    const e = new Error(message);
    e.name = name;
    return e;
};
/** dsh's directory key for a workspace path: the path with every non-alphanumeric as `-`. */
const cwdKey = (cwd) => `-${cwd.replace(/[^A-Za-z0-9]/g, "-")}-`;
/** dsh's header for a log the fake writes itself. */
const headerOf = (id, cwd, version) => ({
    version,
    id: asSessionId(id),
    createdAt: 0,
    cwd,
    isSeeded: false,
});
/**
 * Build the fake over a fresh directory. Throws only when the directory cannot be made. Every
 * method that stands in for dsh answers the way dsh does on this box's 0.1.7: `create` throws
 * `SessionAlreadyExistsError` when the log file exists, `open` throws
 * `SessionPersistenceNotFoundError` when it does not, `locate` names the current-generation path
 * whether or not the file exists, and `list` answers header snapshots.
 */
export function fakeDsh(root) {
    mkdirSync(root, { recursive: true });
    const projects = join(root, "projects");
    const sessionsRoot = join(root, "sessions");
    mkdirSync(projects, { recursive: true });
    mkdirSync(sessionsRoot, { recursive: true });
    const calls = [];
    const appended = [];
    const refusals = new Map();
    let createFails = false;
    const owned = new Set();
    const headers = new Map();
    const logPath = (id, cwd) => join(sessionsRoot, cwdKey(cwd), id, "session.v4.jsonl.zstd");
    const store = (id, cwd, log) => {
        const file = logPath(id, cwd);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, Buffer.concat([
            frame(JSON.stringify({ type: "session", ...log.header }) + "\n"),
            frame(log.rows.map((r) => JSON.stringify(r)).join("\n") + (log.rows.length ? "\n" : "")),
        ]));
        headers.set(id, log.header);
    };
    const handleFor = (id, cwd) => ({
        header: headers.get(id) ?? headerOf(id, cwd, 4),
        read: async () => ({
            events: existsSync(logPath(id, cwd)) ? readLog(logPath(id, cwd)).rows : [],
        }),
        append: async (events) => {
            calls.push("append");
            // SAFETY: the plugin appends the rows the seed builder made, which are Row-shaped
            const rows = events;
            appended.push(...rows);
            const current = existsSync(logPath(id, cwd)) ? readLog(logPath(id, cwd)) : undefined;
            const header = headers.get(id);
            if (current && header)
                store(id, cwd, { header, rows: [...current.rows, ...rows] });
        },
        flush: async () => void calls.push("flush"),
        close: async () => void calls.push("close"),
    });
    const cwdOf = (id) => {
        const h = headers.get(id);
        return h?.cwd ?? "";
    };
    const persistence = {
        list: async () => [...headers.values()].map((header) => ({ header })),
        create: async (header) => {
            calls.push("create");
            if (createFails)
                throw new Error("disk full");
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
            // dsh's order: a write-open takes the lease before it loads the log, so an owned log says
            // owned before it says refused; a read-open takes no lease and only the loader speaks.
            if (access === "write" && owned.has(id))
                throw named("SessionAlreadyOwnedError", `session ${id} is owned by another handle`);
            const rule = refusals.get(id);
            const refusal = typeof rule === "function" ? rule(readLog(logPath(id, cwd)).rows) : rule;
            if (refusal !== undefined)
                throw new Error(refusal);
            return handleFor(id, cwd);
        },
        locate: (meta) => ({ kind: "jsonl", path: logPath(meta.id, meta.cwd ?? "") }),
    };
    const fake = {
        root,
        persistence,
        calls,
        appended,
        projects,
        projectDir: (cwd) => join(projects, projectDirName(cwd)),
        sessionId: (label) => `session-${createHash("sha256").update(label).digest("hex").slice(0, 8)}-0000-4000-8000-000000000000`,
        transcriptId: claudeSessionId,
        logPath,
        // SAFETY: a test's rows are the JSON shapes dsh stores; they round-trip through the file
        writeLog: (id, cwd, rows, version = 4) => store(id, cwd, { header: headerOf(id, cwd, version), rows: rows }),
        readLog: (id, cwd) => readLog(logPath(id, cwd)),
        writeTranscript: (transcriptId, cwd, rows) => {
            const dir = join(projects, projectDirName(cwd));
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${transcriptId}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
        },
        refuse: (id, rule) => {
            if (rule === undefined)
                refusals.delete(id);
            else
                refusals.set(id, rule);
        },
        failCreate: (on) => {
            createFails = on;
        },
        own: (id, isOwned) => {
            if (isOwned)
                owned.add(id);
            else
                owned.delete(id);
        },
        heal: (stateDir) => ({
            persistence,
            catalog: async () => ({
                currentVersion: 4,
                createRestore: () => ({ decodeRow() { }, finish() { } }),
            }),
            stateDir,
            log() { },
        }),
        ctx: () => ({ sessions: { get: () => undefined }, sessionPersistence: persistence }),
        registry: (cwd) => {
            const attached = [];
            const ws = {
                id: "w1",
                path: cwd,
                title: "w",
                sessionIds: [],
                attachSession: async (sid) => void attached.push(sid),
            };
            const registry = {
                archivedSessionIds: [],
                resolveByPath: async () => ws,
                create: async () => ws,
                enqueueOperation: (op) => op(),
                requireState: () => ({ archivedSessionIds: [] }),
                setState: async () => { },
            };
            return { registry, attached };
        },
        routes: (options = {}) => {
            let handler;
            const cwd = [...headers.values()][0]?.cwd ?? join(root, "work");
            const { registry } = fake.registry(cwd);
            // SAFETY: the routes read the injected host's members named here and nothing else
            const ctx = {
                inject: (_deps, cb) => {
                    cb({
                        webServer: {
                            register: (r) => {
                                handler = r.handler;
                                return () => { };
                            },
                        },
                        connection: { requestRejection: () => undefined },
                        sessions: { get: () => undefined },
                        effect: (fn) => fn(),
                        sessionPersistence: persistence,
                    });
                },
                on() { },
                effect: (fn) => fn(),
            };
            // SAFETY: the options the routes need for the paths the tests drive; a test names the rest
            registerSessionRoutes(ctx, {
                log: () => { },
                projectDir: (p) => [join(projects, projectDirName(p))],
                projectsDir: [projects],
                startedIds: async () => [],
                claudeIdOf: claudeSessionId,
                configDir: join(root, "claude"),
                boxesPath: join(root, "boxes.json"),
                importedDir: join(root, "imported"),
                settingsPath: join(root, "claude", "settings.json"),
                workspaceRegistry: () => registry,
                ...options,
            });
            if (!handler)
                throw new Error("the routes did not register a handler");
            const bound = handler;
            return {
                respond: async (method, url, body) => {
                    const chunks = [];
                    let status = 0;
                    // SAFETY: the request and response the route handler reads and writes, nothing more
                    const res = {
                        writeHead: (s) => void (status = s),
                        end: (b) => void chunks.push(typeof b === "string" ? Buffer.from(b) : b),
                    };
                    const req = {
                        method,
                        url,
                        on: (ev, cb) => {
                            if (ev === "data" && body !== undefined)
                                cb(Buffer.from(body));
                            if (ev === "end")
                                cb();
                        },
                        destroy: () => { },
                    };
                    await bound(req, res);
                    const text = Buffer.concat(chunks).toString("utf8");
                    // SAFETY: the routes answer JSON objects
                    return { status, body: (text ? JSON.parse(text) : {}) };
                },
            };
        },
        dispose: () => rmSync(root, { recursive: true, force: true }),
    };
    return fake;
}
/** The session directories the fake wrote, for a test that wants to count them. */
export const storedSessions = (fake) => existsSync(join(fake.root, "sessions")) ? readdirSync(join(fake.root, "sessions")) : [];
//# sourceMappingURL=test-dsh.js.map