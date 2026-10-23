// The status routes: the box status the panel shows, with the boxStatus helper they share, and the
// turn records. The blocks are the chain's own, in its order.
import type { IncomingMessage, ServerResponse } from "node:http";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, hostname, release, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { type RouteHandler, UNHANDLED } from "./context.js";
import type { DiagnosticFile, MountBox, RouteCtx } from "../sessions.js";
import { parseChangelog } from "../changelog.js";
import { errorText, shq, sshArgs } from "../process.js";
import { buildReport, type PrivateValues, type ReportInput } from "../report.js";
import { repairsSummary } from "../session-heal.js";
import { readSshToken, THIS_BOX } from "../ssh-login.js";
import { STATE_DIR, loadSessionRepairs } from "../state.js";

/** The status group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function statusRoutes(c: RouteCtx): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const {
      CHANGELOG_RELEASES,
      DEFAULT_PROVIDER,
      DSH_FLOOR,
      ISSUES_URL,
      PANEL_TOKEN,
      PLUGIN_VERSION,
      ROUTE_PREFIX,
      SETTINGS_SCOPES,
      boxOf,
      claudeIdOf,
      cliEnvFor,
      dshVersion,
      events,
      json,
      knownCwd,
      liveCount,
      liveTurn,
      mcp,
      models,
      onLoginStatus,
      parseSettingsText,
      pluginStars,
      pluginUpdate,
      readHints,
      readPluginFile,
      readSettings,
      run,
      runtimeStatus,
      scopePathAt,
      sessionPersistence,
      sshBoxesPath,
      targetOf,
      transcriptDirs,
      turnRecords,
      userSettingsPathOf,
    } = c;
    /** A box's status as the panel shows it: the CLI probes, the npm read beside them
     *  (this box only; a remote box reports its own plugin from its own copy), and a
     *  panel token counted as a login, since the CLI's own `auth status` cannot see the
     *  token the default instance injects at spawn. */
    const boxStatus = async (box: MountBox, provider: string | null) => {
      const hintsPath = sshBoxesPath ? join(dirname(sshBoxesPath), "hints.json") : "";
      const [status, upd, starCount] = await Promise.all([
        runtimeStatus(box.configDir, box.command, box.sshHost),
        box.sshHost || !sshBoxesPath ? undefined : pluginUpdate(hintsPath, dshVersion),
        box.sshHost || !sshBoxesPath ? undefined : pluginStars(hintsPath),
      ]);
      if (upd) Object.assign(status, upd);
      if (starCount !== undefined) status.stars = starCount;
      if (!box.sshHost) {
        status.dsh = dshVersion ?? null;
        status.dshFloor = DSH_FLOOR ?? null;
      }
      status.running = liveCount?.(box.sshHost ?? "") ?? 0;
      if (!box.sshHost) {
        // Healed, unknown and rolled-back logs since the last dismissal, a box fact.
        const seen = hintsPath ? (await readHints(hintsPath)).sessionRepairsSeen : 0;
        status.sessionRepairs = repairsSummary(
          await loadSessionRepairs(STATE_DIR),
          typeof seen === "number" ? seen : 0,
        );
      }
      if (
        !box.sshHost &&
        (provider === null || provider === DEFAULT_PROVIDER) &&
        sshBoxesPath &&
        readSshToken(dirname(sshBoxesPath), THIS_BOX)
      ) {
        status.loggedIn = true;
        status.authMethod = PANEL_TOKEN;
      }
      return status;
    };
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/status`) {
      const box = boxOf(url);
      const provider = url.searchParams.get("provider");
      const status = await boxStatus(box, provider);
      onLoginStatus?.(provider, status.loggedIn);
      return json(res, 200, status);
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/models`) {
      if (!models) return json(res, 404, { error: "models not available" });
      try {
        const modelList = await models();
        return json(res, 200, { models: modelList });
      } catch (e) {
        return json(res, 500, { error: errorText(e) });
      }
    }
    // Diagnostics: how this instance is running, and which of the files the CLI merges
    // it would refuse to start on. The MCP servers and the denied calls are read from
    // the routes that already serve them, so nothing is answered twice.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diagnostics`) {
      const { box, cwd } = targetOf(
        url,
        await knownCwd(url.searchParams.get("cwd"), sessionPersistence),
      );
      const runtime = await boxStatus(box, url.searchParams.get("provider"));
      const configFiles: DiagnosticFile[] = [];
      const userPath = await userSettingsPathOf(box);
      for (const scope of SETTINGS_SCOPES) {
        const path = userPath ? await scopePathAt(box, scope, userPath, cwd) : undefined;
        if (path === undefined) continue;
        // A file that cannot be read at all reads as absent, the way the scopes route
        // treats a root-owned managed file: the payload is a report, not a failure.
        const file = await readSettings(box, path).catch(() => null);
        const entry: DiagnosticFile = { scope, path, exists: file?.exists ?? false };
        const parsed = file?.exists === true ? parseSettingsText(file.text) : undefined;
        if (parsed?.error !== undefined) entry.parseError = parsed.error;
        configFiles.push(entry);
      }
      const sid = url.searchParams.get("session");
      let session: { claudeId: string; cwd: string } | undefined;
      if (sid && cwd) {
        // A session opened from a transcript keeps that transcript's id; one this plugin
        // started keeps its transcript under the hash of the dsh id.
        // Only this box's disk is checked; a box session's id is the hash either way.
        let own = false;
        if (!box.sshHost)
          for (const d of transcriptDirs(cwd)) {
            own = await access(join(d, `${sid}.jsonl`)).then(
              () => true,
              () => false,
            );
            if (own) break;
          }
        session = { claudeId: own ? sid : claudeIdOf(sid), cwd };
      }
      // `ok` is what the tab keys its render on; without it the reply reads as the
      // failure shape and the tab draws an empty error line instead of the report.
      return json(res, 200, { ok: true, runtime, configFiles, session });
    }
    // Read on every open and never cached: a dev checkout shows an edit at once, and an
    // install shows the notes for the version it runs. A missing file (an install from
    // before the file shipped in the package) is an empty list, which the card names.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/changelog`) {
      const text = await readPluginFile("CHANGELOG.md").catch(() => "");
      return json(res, 200, {
        ok: true,
        version: PLUGIN_VERSION,
        releases: parseChangelog(text).slice(0, CHANGELOG_RELEASES),
      });
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/report`) {
      const box = boxOf(url);
      const runtime = await boxStatus(box, url.searchParams.get("provider"));
      const sid = url.searchParams.get("session");
      let mcpRows: { name: string; status: string }[] | null = null;
      if (sid && mcp) {
        const reply = await mcp.status(sid);
        if (reply.ok) mcpRows = reply.servers.map((s) => ({ name: s.name, status: s.status }));
      }
      const stateDirPath = sshBoxesPath ? dirname(sshBoxesPath) : "";
      const switches = sshBoxesPath ? await readHints(join(stateDirPath, "hints.json")) : {};
      const stateWritable = stateDirPath
        ? await access(stateDirPath, constants.W_OK).then(
            () => true,
            () => false,
          )
        : false;
      const input: ReportInput = {
        plugin: PLUGIN_VERSION,
        dsh: dshVersion ?? null,
        cli: runtime.version,
        binary: runtime.binary !== null,
        os: `${process.platform} ${release()}`,
        node: process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.version}`,
        loggedIn: runtime.loggedIn,
        authMethod: runtime.authMethod,
        configDir: runtime.configDir,
        stateDir: stateDirPath,
        stateWritable,
        mcp: mcpRows,
        lastError: runtime.error ?? runtime.reach?.detail ?? null,
        switches,
        running: runtime.running ?? 0,
      };
      const priv: PrivateValues = {
        home: homedir(),
        user: userInfo().username,
        hostname: hostname(),
        email: runtime.email ?? null,
      };
      return json(res, 200, {
        ok: true,
        text: buildReport(input, priv, url.searchParams.get("host") === "1"),
        issues: ISSUES_URL,
      });
    }
    // `claude doctor` runs a process and takes a second, so it is its own route and
    // nothing runs it until the button is pressed.
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/diagnostics/doctor`) {
      const box = boxOf(url);
      const bin = box.command || "claude";
      // The doctor belongs to the box the session runs on, the same as the status probe:
      // this PC's answer says nothing about a remote box's install.
      return json(
        res,
        200,
        box.sshHost
          ? await run("ssh", sshArgs(box.sshHost, `${shq(bin)} doctor`))
          : await run(bin, ["doctor"], cliEnvFor(box.configDir)),
      );
    }
    // The running turn's figures for the status row; `{}` when no turn is running.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/live-turn`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (events) return json(res, 200, events.replies.liveTurn(sid));
      // `tokens` is one climbing figure for the turn: finished messages plus the estimate for
      // the thinking block in progress, which the next usage frame folds in for real.
      const live = liveTurn?.get(sid);
      if (!live) return json(res, 200, {});
      // `thinkingMs` is how long the open thinking burst has run, absent when none is open;
      // `idleMs` is the time since the last frame of model output; `tool` says a call is
      // in flight. The client turns these into the CLI's own colour ramps.
      const now = Date.now();
      const open = live.thinkingOpen === true && live.thinkingAt !== undefined;
      return json(res, 200, {
        tokens: (live.output ?? 0) + (live.thinking ?? 0),
        // How long the turn has been running. dsh drew its own clock beside the status
        // row up to 0.1.6; 0.1.7 folded it into one sentence inside the turn-process
        // button ("Deep diving for 12s"), which the status line replaces, so the figure
        // comes from the turn record instead of off the page.
        elapsedMs: now - live.at,
        thinkingMs: open ? now - live.thinkingAt! : undefined,
        idleMs: live.frameAt !== undefined ? now - live.frameAt : undefined,
        tool: live.tool === true,
        thoughtMs: live.thoughtMs,
        thoughtAgoMs: live.thoughtAt !== undefined ? now - live.thoughtAt : undefined,
        effort: live.effort,
        // The dsh tool a parked turn is waiting on and for how long; absent otherwise.
        relayName: live.relay?.name,
        relayMs: live.relay ? now - live.relay.at : undefined,
      });
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/turns`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (events) return json(res, 200, events.replies.turns(sid));
      const turns = turnRecords?.get(sid) ?? [];
      const total = {
        costUsd: 0,
        durationMs: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        count: 0,
      };
      for (const t of turns) {
        total.costUsd += t.costUsd;
        total.durationMs += t.durationMs;
        total.input += t.input;
        total.output += t.output;
        total.cacheRead += t.cacheRead;
        total.cacheWrite += t.cacheWrite;
        total.count += 1;
      }
      return json(res, 200, { turns, total });
    }
    return UNHANDLED;
  };
}
