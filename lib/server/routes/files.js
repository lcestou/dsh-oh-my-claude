import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UNHANDLED } from "./context.js";
import { asSessionId } from "../dsh.js";
import { isWritableInstructions, listInstructions } from "../instructions.js";
import { listConfiguredMcp } from "../mcp-config.js";
import { deleteMemory, listMemory } from "../memory.js";
import { homeAt, readAt, readTextAt, removeDirAt, writeAt } from "../remote-fs.js";
import { isWritableSkillScope, listSkills, skillTargetPath, skillTemplate, validSkillName, } from "../skills.js";
import { foldTranscript } from "../transcript.js";
/** The files group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function filesRoutes(c) {
    return async (req, res, url) => {
        const { IMPORT_LIMIT, ROUTE_PREFIX, applyReloadSkills, claudeHomeOf, cliEnvFor, idIn, idTaken, importedDir, json, knownCwd, log, memoryDirAt, mtimeOf, projectsDir, readBody, routeHost, sessionPersistence, targetOf, validId, validMemoryName, writeWithBackup, } = c;
        // Import: a transcript file from anywhere lands in the plugin's own state dir under a
        // free id, and the merged list picks it up. `projects/` is left alone on purpose.
        // The CLI owns that directory, and a foreign session has no cwd it ever ran in.
        if (importedDir && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/import`) {
            const body = await readBody(req, IMPORT_LIMIT);
            if (typeof body.text !== "string" || body.text.trim() === "")
                return json(res, 400, { error: "text required" });
            const folded = foldTranscript(body.text);
            if (folded.turns.length === 0)
                return json(res, 400, { error: "not a Claude Code transcript" });
            // An id that is already here would overwrite a live session's record, so a clash
            // takes a fresh one; the transcript's own records keep the original inside.
            const wanted = validId(body.id) ? body.id : idIn(body.text);
            const free = wanted !== undefined &&
                !(await idTaken((x) => routeHost.sessions.get(asSessionId(x)) !== undefined, projectsDir, importedDir, wanted))
                ? wanted
                : randomUUID();
            await mkdir(importedDir, { recursive: true });
            await writeFile(join(importedDir, `${free}.jsonl`), body.text, "utf8");
            log("info", `imported transcript ${free} (${folded.turns.length} turns)`);
            return json(res, 200, { ok: true, id: free, turns: folded.turns.length });
        }
        // Claude's auto-memory for a workspace: list, read, write, delete one file.
        if (url.pathname === `${ROUTE_PREFIX}/memory`) {
            const body = req.method === "GET" ? {} : await readBody(req, 1024 * 1024);
            const cwd = await knownCwd(url.searchParams.get("cwd") ?? body.cwd, sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            const dir = await memoryDirAt(box, at);
            const name = url.searchParams.get("name") ?? body.name;
            if (req.method === "GET" && name === undefined)
                return json(res, 200, { dir, files: await listMemory(box, dir) });
            if (!validMemoryName(name))
                return json(res, 400, { error: "name must be a .md file" });
            const path = join(dir, name);
            if (req.method === "GET") {
                // No catch: a box that cannot be reached is a 500 the tab shows, not a 404 that
                // opens the memory blank for the next Save to write over.
                const read = await readAt(box, path);
                return read === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { text: read.text });
            }
            if (req.method === "PUT") {
                if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                await writeAt(box, path, body.text);
                log("info", `memory ${name} saved (${body.text.length} chars)`);
                return json(res, 200, { ok: true });
            }
            if (req.method === "DELETE") {
                await deleteMemory(box, dir, name);
                log("info", `memory ${name} deleted`);
                return json(res, 200, { ok: true });
            }
            return json(res, 405, { error: "method not allowed" });
        }
        // Instructions: the CLAUDE.md files the CLI loads for this workspace. The list is
        // recomputed per request and is the allowlist: a path it does not name is refused,
        // so the browser cannot read or write a file outside the hierarchy.
        // The skills the CLI can reach for the session's directory, with their scope, read
        // from the box the session runs on. One listing per tab open; nothing polls.
        if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/skills`) {
            const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            return json(res, 200, {
                skills: await listSkills(at, await claudeHomeOf(box), box),
            });
        }
        // Create a skill: write a template SKILL.md into <scope>/skills/<name>/, then ask the
        // live process to re-read skills so the new /command registers now. User and project
        // scope only; a plugin's skills are edited where the plugin ships them.
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/skills/create`) {
            const body = await readBody(req);
            const scope = String(body.scope ?? "");
            if (!isWritableSkillScope(scope))
                return json(res, 400, { error: "scope is user or project" });
            if (typeof body.name !== "string" || !validSkillName(body.name))
                return json(res, 400, {
                    error: "A skill name is lowercase letters, digits and hyphens, e.g. my-skill.",
                });
            const cwd = await knownCwd(body.cwd, sessionPersistence);
            const { box, cwd: at } = targetOf(url, cwd);
            const target = skillTargetPath(scope, body.name, await claudeHomeOf(box), at ?? undefined);
            if (target === null)
                return json(res, 400, { error: "project skills need a workspace open" });
            if ((await readTextAt(box, target)) !== null)
                return json(res, 409, {
                    error: `A skill called ${body.name} already exists in ${body.scope} skills.`,
                });
            await writeAt(box, target, skillTemplate(body.name, String(body.description ?? "")));
            log("info", `skill ${body.name} created (${body.scope})`);
            return json(res, 200, {
                ok: true,
                path: target,
                live: await applyReloadSkills(body.session),
            });
        }
        // Read or write one existing SKILL.md, allowlisted against the current listing the way
        // /instructions/file is: a path the listing does not name is refused, and a plugin
        // skill cannot be written.
        if (url.pathname === `${ROUTE_PREFIX}/skills/file`) {
            const body = req.method === "GET" ? {} : await readBody(req);
            const cwd = await knownCwd(url.searchParams.get("cwd") ?? body.cwd, sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            const skills = await listSkills(at, await claudeHomeOf(box), box);
            const path = req.method === "GET" ? url.searchParams.get("path") : body.path;
            const entry = skills.find((s) => s.path === path);
            if (entry === undefined)
                return json(res, 400, { error: "not a listed skill" });
            if (req.method === "GET") {
                const read = await readAt(box, entry.path);
                return read === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { path: entry.path, text: read.text, mtime: read.mtimeMs });
            }
            if (req.method === "PUT") {
                if (!isWritableSkillScope(entry.scope))
                    return json(res, 403, {
                        error: "Plugin skills are read-only; edit them where the plugin ships them.",
                    });
                if (!entry.path.endsWith("SKILL.md"))
                    return json(res, 400, { error: "not a SKILL.md" });
                if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                const written = await writeWithBackup(box, entry.path, body.text, mtimeOf(body));
                log("info", `skill ${entry.name} saved (${body.text.length} chars)`);
                return json(res, 200, {
                    ...written,
                    live: await applyReloadSkills(body.session),
                });
            }
            return json(res, 405, { error: "method not allowed" });
        }
        // Remove a skill: delete its whole directory, then re-read. The path must be one the
        // listing named and a writable scope; the delete target is the listed SKILL.md's
        // directory, never a raw client value.
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/skills/remove`) {
            const body = await readBody(req);
            const cwd = await knownCwd(body.cwd, sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            const skills = await listSkills(at, await claudeHomeOf(box), box);
            const entry = skills.find((s) => s.path === body.path);
            if (entry === undefined)
                return json(res, 400, { error: "not a listed skill" });
            if (!isWritableSkillScope(entry.scope))
                return json(res, 403, {
                    error: "Plugin skills are read-only; remove them where the plugin ships them.",
                });
            await removeDirAt(box, dirname(entry.path));
            log("info", `skill ${entry.name} removed (${entry.scope})`);
            return json(res, 200, { ok: true, live: await applyReloadSkills(body.session) });
        }
        // Pick up skills edited on disk outside the tab, the way the CLI's /reload-skills does.
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/skills/reload`) {
            const body = await readBody(req);
            return json(res, 200, { ok: true, live: await applyReloadSkills(body.session) });
        }
        // The servers the CLI is configured with for the session's directory, by scope, from
        // the config files rather than `claude mcp list` (which connects to each one).
        if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/configured`) {
            const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            // Where that instance's CLI keeps .claude.json: inside an exported config dir,
            // else beside the home's .claude, the same rule cliEnvFor applies to the calls.
            const claudeJson = cliEnvFor(box.configDir).CLAUDE_CONFIG_DIR
                ? join(box.configDir, ".claude.json")
                : join(await homeAt(box), ".claude.json");
            return json(res, 200, { servers: await listConfiguredMcp(at, claudeJson, box) });
        }
        if (url.pathname === `${ROUTE_PREFIX}/instructions` ||
            url.pathname === `${ROUTE_PREFIX}/instructions/file`) {
            const body = req.method === "GET" ? {} : await readBody(req);
            const cwd = await knownCwd(url.searchParams.get("cwd") ?? body.cwd, sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            const files = await listInstructions(at, await claudeHomeOf(box), box);
            if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/instructions`)
                return json(res, 200, { files });
            const path = req.method === "GET" ? url.searchParams.get("path") : body.path;
            const file = files.find((f) => f.path === path);
            if (file === undefined)
                return json(res, 400, { error: "not a loaded instructions file" });
            if (req.method === "GET") {
                // No catch: a box that cannot be reached is a 500 the editor shows, not a 404
                // that opens the file blank for the next save to write over.
                const read = await readAt(box, file.path);
                return read === null
                    ? json(res, 404, { error: "not found" })
                    : json(res, 200, { path: file.path, text: read.text, mtime: read.mtimeMs });
            }
            if (req.method === "PUT") {
                if (file.kind === "Managed")
                    return json(res, 403, { error: "the managed file is read-only" });
                if (!isWritableInstructions(file.path))
                    return json(res, 403, {
                        error: "only markdown instructions files are editable",
                    });
                if (typeof body.text !== "string")
                    return json(res, 400, { error: "text required" });
                const written = await writeWithBackup(box, file.path, body.text, mtimeOf(body));
                log("info", `instructions ${file.path} saved (${body.text.length} chars)`);
                return json(res, 200, written);
            }
            return json(res, 405, { error: "method not allowed" });
        }
        return UNHANDLED;
    };
}
//# sourceMappingURL=files.js.map