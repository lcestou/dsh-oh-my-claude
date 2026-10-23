import { UNHANDLED } from "./context.js";
import { listInstructions } from "../instructions.js";
import { isMarketplaceSource, isPluginId, pluginRoster } from "../plugins.js";
import { claudeMdDisabledBy, featureSwitches } from "../switches.js";
/** The settings group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function settingsRoutes(c) {
    return async (req, res, url) => {
        const { ROUTE_PREFIX, SETTINGS_SCOPES, applyReload, awaiting, boxOf, claudeHomeOf, cliEnvFor, command, configDir, continueAfterLimit, isSettingsScope, json, knownCwd, log, mtimeOf, notOnBox, parseSettingsText, pluginErrors, pluginScopeCwd, pluginWarnings, readBody, readSettings, run, scopePathAt, sessionPersistence, settingsPath, settingsTexts, targetOf, userSettingsPathOf, workspaceAt, writeWithBackup, } = c;
        if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings`) {
            const box = boxOf(url);
            const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
            if (req.method === "GET")
                return json(res, 200, await readSettings(box, userPath));
            if (req.method === "PUT") {
                const body = await readBody(req, 1024 * 1024);
                const text = body.text;
                const scope = body.scope ?? "user";
                if (!isSettingsScope(scope))
                    return json(res, 400, { error: "unknown settings scope" });
                if (scope === "managed")
                    return json(res, 400, { error: "managed settings are read-only" });
                const cwd = await knownCwd(body.cwd, sessionPersistence);
                // A project or local write lands in the session's directory or its repository's
                // root (`scopePathAt`), so it goes to the
                // box that directory is on: a remote workspace's path is real over there and the
                // write is an ssh write like any other. Any other session on a box still has a
                // local cwd that need not exist there, which is what this refuses.
                const target = targetOf(url, cwd);
                const onWorkspace = workspaceAt(cwd) !== undefined;
                if (target.box.sshHost && scope !== "user" && !onWorkspace)
                    return json(res, 400, {
                        error: "project and local settings do not reach an SSH box yet",
                    });
                const path = await scopePathAt(target.box, scope, userPath, target.cwd);
                if (path === undefined)
                    return json(res, 400, {
                        error: "project and local settings need a directory a dsh session is open in",
                    });
                const parsed = parseSettingsText(text);
                if (parsed.error !== undefined)
                    return json(res, 400, { error: parsed.error });
                const settingsText = typeof text === "string" ? text : "";
                const written = await writeWithBackup(scope === "user" ? box : target.box, path, settingsText, mtimeOf(body));
                log("info", `${scope} settings saved (${settingsText.length} chars)`);
                return json(res, 200, written);
            }
        }
        // Every scope the CLI merges, in one payload: the editor picks which to show and
        // works out from the rest which keys a higher-precedence file overrides.
        if (settingsPath && url.pathname === `${ROUTE_PREFIX}/settings/scopes`) {
            if (req.method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            // Project and local scope hang off the session's directory, which for a remote
            // workspace is its real path on its box; user scope stays with the named mount.
            const { box, cwd } = targetOf(url, await knownCwd(url.searchParams.get("cwd"), sessionPersistence));
            const userPath = (await userSettingsPathOf(box)) ?? settingsPath;
            const scopes = [];
            for (const scope of SETTINGS_SCOPES) {
                const path = await scopePathAt(box, scope, userPath, cwd);
                if (path === undefined)
                    continue;
                // An unreadable managed file (root-owned, or a directory) reads as absent
                // rather than failing the whole payload. Every other scope answers with the
                // failure: an editor shown "not created yet" for a file that is merely out of
                // reach saves an empty object over it the moment the box comes back.
                const file = await readSettings(box, path).catch((e) => {
                    if (scope !== "managed")
                        throw e;
                    return { path, exists: false, text: "{}\n", mtime: 0 };
                });
                scopes.push({ ...file, scope, readOnly: scope === "managed" });
            }
            return json(res, 200, { scopes });
        }
        // Sessions holding an open prompt. A session waiting on a permission dialog keeps
        // its stream open, so it still reads as running and the turn-end notice never fires;
        // the browser polls this to notice a prompt on a tab nobody is looking at.
        if (url.pathname === `${ROUTE_PREFIX}/awaiting`) {
            if (req.method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            return json(res, 200, { sessions: awaiting?.() ?? {} });
        }
        // Which plugins and marketplaces the session's settings load. Beside Instructions in
        // the panel: same question as the CLAUDE.md list, a different set of files.
        if (settingsPath && url.pathname === `${ROUTE_PREFIX}/plugins`) {
            if (req.method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            const { box, cwd } = targetOf(url, await knownCwd(url.searchParams.get("cwd"), sessionPersistence));
            const session = url.searchParams.get("session");
            return json(res, 200, {
                ok: true,
                ...pluginRoster(await settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, cwd)),
                pluginErrors: session ? (pluginErrors?.(session) ?? []) : [],
                pluginWarnings: session ? (pluginWarnings?.(session) ?? []) : [],
            });
        }
        // Turn the roster into a manager. The CLI owns the mutation end to end (it resolves
        // the marketplace, writes both the settings key and the install lock, and validates
        // the plugin), the same way the MCP tab shells out per session cwd with a scope. Each
        // write targets the scope the roster row named, then `applyReload` asks the session's
        // live process to re-read plugins so the change applies now instead of at next spawn.
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/toggle`) {
            const body = await readBody(req);
            if (!isPluginId(body.key))
                return json(res, 400, { error: "plugin id required" });
            const target = await pluginScopeCwd(body.scope, body.session);
            if ("error" in target)
                return json(res, 400, { error: target.error });
            const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
            if (remote)
                return json(res, 400, { error: remote });
            const verb = body.enable === false ? "disable" : "enable";
            const result = await run(command || "claude", ["plugin", verb, body.key, "--scope", String(body.scope)], cliEnvFor(configDir), target.cwd);
            if (result.error)
                return json(res, 400, { error: result.error });
            log("info", `plugin ${body.key} ${verb}d (${String(body.scope)})`);
            return json(res, 200, { ok: true, live: await applyReload(body.session) });
        }
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/uninstall`) {
            const body = await readBody(req);
            if (!isPluginId(body.key))
                return json(res, 400, { error: "plugin id required" });
            const target = await pluginScopeCwd(body.scope, body.session);
            if ("error" in target)
                return json(res, 400, { error: target.error });
            const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
            if (remote)
                return json(res, 400, { error: remote });
            // -y is required when stdout is not a TTY, which it never is here.
            const result = await run(command || "claude", ["plugin", "uninstall", body.key, "--scope", String(body.scope), "-y"], cliEnvFor(configDir), target.cwd);
            if (result.error)
                return json(res, 400, { error: result.error });
            log("info", `plugin ${body.key} uninstalled (${String(body.scope)})`);
            return json(res, 200, { ok: true, live: await applyReload(body.session) });
        }
        // Marketplace add resolves a URL, path or GitHub repo, which can clone over the
        // network, so it gets a longer timeout than the local settings writes.
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/add`) {
            const body = await readBody(req);
            if (!isMarketplaceSource(body.source))
                return json(res, 400, {
                    error: "a source is a URL, a path or a GitHub owner/repo",
                });
            const target = await pluginScopeCwd(body.scope, body.session);
            if ("error" in target)
                return json(res, 400, { error: target.error });
            const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
            if (remote)
                return json(res, 400, { error: remote });
            const result = await run(command || "claude", ["plugin", "marketplace", "add", body.source.trim(), "--scope", String(body.scope)], cliEnvFor(configDir), target.cwd, 60000);
            if (result.error)
                return json(res, 400, { error: result.error });
            log("info", `marketplace added (${String(body.scope)})`);
            return json(res, 200, { ok: true, live: await applyReload(body.session) });
        }
        if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/plugins/marketplace/remove`) {
            const body = await readBody(req);
            if (!isPluginId(body.name))
                return json(res, 400, { error: "marketplace name required" });
            const target = await pluginScopeCwd(body.scope, body.session);
            if ("error" in target)
                return json(res, 400, { error: target.error });
            const remote = notOnBox(url, "plugin changes", target.cwd ?? null);
            if (remote)
                return json(res, 400, { error: remote });
            const result = await run(command || "claude", ["plugin", "marketplace", "remove", body.name, "--scope", String(body.scope)], cliEnvFor(configDir), target.cwd);
            if (result.error)
                return json(res, 400, { error: result.error });
            log("info", `marketplace ${body.name} removed (${String(body.scope)})`);
            return json(res, 200, { ok: true, live: await applyReload(body.session) });
        }
        // The settings and environment that turn off something the panel offers. Its own
        // route rather than a field on diagnostics: the shield and Rewind ask for it on
        // every open, and diagnostics runs the binary.
        if (settingsPath && url.pathname === `${ROUTE_PREFIX}/feature-switches`) {
            if (req.method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            const { box, cwd } = targetOf(url, await knownCwd(url.searchParams.get("cwd"), sessionPersistence));
            const texts = await settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, cwd);
            // The child inherits dsh's environment, so dsh's is where the disable would be.
            // An absent option means an adapter that did not pass one, so read the config
            // default rather than reporting the feature off.
            return json(res, 200, {
                ok: true,
                ...featureSwitches(texts, process.env, continueAfterLimit ?? true),
            });
        }
        // What Claude Code loads for itself, for the one row on the context card that this
        // plugin does not control. Apart from `/feature-switches` because it walks the
        // instructions tree: the shield and Rewind ask for that route on every open, and an
        // ssh box would pay a tree walk each time for a number neither of them reads.
        if (settingsPath && url.pathname === `${ROUTE_PREFIX}/claude-md`) {
            if (req.method !== "GET")
                return json(res, 405, { error: "method not allowed" });
            const cwd = await knownCwd(url.searchParams.get("cwd"), sessionPersistence);
            if (cwd === null)
                return json(res, 400, {
                    error: "cwd must be a directory a dsh session is open in",
                });
            const { box, cwd: at } = targetOf(url, cwd);
            const [files, texts] = await Promise.all([
                listInstructions(at, await claudeHomeOf(box), box),
                settingsTexts(box, (await userSettingsPathOf(box)) ?? settingsPath, at),
            ]);
            const state = {
                files: files.length,
                chars: files.reduce((sum, f) => sum + f.size, 0),
            };
            // Only a local child inherits this process's environment; `box.sshHost` is the box
            // whose shell cannot be read from here, so that half is skipped for one.
            const by = claudeMdDisabledBy(texts, process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, !box.sshHost);
            if (by !== undefined)
                state.disabledBy = by;
            return json(res, 200, state);
        }
        return UNHANDLED;
    };
}
//# sourceMappingURL=settings.js.map