// The session control routes: hints, Claude updates, asides, steers, MCP servers, modes and the
// per-session switches. The blocks are the chain's own, in its order.
import type { IncomingMessage, ServerResponse } from "node:http";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { type RouteHandler, UNHANDLED } from "./context.js";
import type { RouteCtx } from "../sessions.js";
import { livingModelId } from "../model-ids.js";
import { cardFor } from "../claude-update.js";
import { buildAddServer, isMcpName, scopeNeedsCwd } from "../mcp-add-remove.js";
import { errorText } from "../process.js";
import {
  PERMISSION_MODES,
  STATE_DIR,
  isPermissionMode,
  loadContextSizes,
  loadWorkspaceModels,
  saveWorkspaceModel,
} from "../state.js";
import { typedPrompt } from "../transcript.js";
import type { AsideEntry, RewindPrompt } from "../adapter/types.js";

/** The controls group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function controlsRoutes(ctx: RouteCtx): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const {
      ROUTE_PREFIX,
      SELECTION_QUOTE_MAX,
      askAside,
      claudeIdOf,
      cliEnvFor,
      command,
      configDir,
      contextUsage,
      events,
      holdSteers,
      idle,
      json,
      log,
      loginNeeded,
      mcp,
      models,
      notOnBox,
      permissionAsks,
      permissionModes,
      permissionReadout,
      persistAsides,
      projectDirAt,
      readBody,
      readHints,
      readSshBoxes,
      recapIsRepeat,
      releaseHold,
      rewind,
      run,
      sendSteerNow,
      sessionCwd,
      sessionFallbacks,
      sessionPersistence,
      sessionTranscript,
      setStarter,
      sideQuestions,
      skillDoctor,
      sshBoxesPath,
      starters,
      steersFor,
      targetOf,
      terminalSync,
      thinking,
      toolMode,
      updateBoxOf,
      updateHints,
      updaterFor,
      updaters,
      updatesOff,
      validCwd,
      validId,
      workspaceDiff,
    } = ctx;
    // The starter card's store: a session's own opening prompt and the `default` one it
    // falls back to. A POST with blank text clears the key, which is how the card's
    // "forget" works.
    // One-time hints (the Restore pulse) and box-wide UI switches (`starterOff`): a flat
    // map of booleans and non-negative numbers under the plugin's state, so a hint shown
    // once or a switch flipped on this box holds for every browser and every update.
    // `false` or `null` drops the key; other types are ignored.
    if (sshBoxesPath && url.pathname === `${ROUTE_PREFIX}/hints`) {
      const hintsPath = join(dirname(sshBoxesPath), "hints.json");
      const current = await readHints(hintsPath);
      if (req.method === "GET") return json(res, 200, current);
      if (req.method === "POST") {
        const next = await updateHints(hintsPath, await readBody(req));
        // A hint written from any browser reaches every open tab.
        events?.hub.publish({ kind: "hints", session: null, data: next });
        return json(res, 200, next);
      }
    }
    // The Claude Code updater for the box a session runs on: its state for the Tune rows,
    // a refresh (`now=1`, never an install), the switch, a dismissal, and the button. The
    // button answers at once with `busy: true` and the card follows through this GET: this
    // dsh is reached through a reverse proxy from outside the box, and a request held open
    // for a 230 MB download would be cut by its idle timeout.
    if (url.pathname === `${ROUTE_PREFIX}/claude-update`) {
      // A session names its box; the Boxes rows in Settings name a host outright ("" for
      // this box), so a box no session is open on can still be updated from there.
      const hostParam = url.searchParams.get("host");
      const sid = url.searchParams.get("session");
      const saved =
        hostParam && sshBoxesPath
          ? (await readSshBoxes(sshBoxesPath)).find((b) => b.host === hostParam)
          : undefined;
      if (hostParam && !saved) return json(res, 404, { error: "no such box" });
      if (hostParam === null && !sid)
        return json(res, 400, { error: "session or host param required" });
      const box =
        hostParam !== null
          ? { host: hostParam, label: saved?.name ?? hostname() }
          : updateBoxOf(url, sid);
      if (!box) return json(res, 404, { error: "no updater" });
      const u = updaterFor(box.host, box.label);
      if (req.method === "GET") {
        // A Boxes row (`host=`) never probes inside the request: the tick keeps every
        // saved box fresh, and a remote probe here would hold Settings open for it.
        const { checkedAt } = u.state();
        const stale = (checkedAt ?? 0) < Date.now() - 30 * 60_000;
        // A Boxes row probes only a box the tick has never seen (the first minute after a
        // boot); after that the tick keeps it fresh.
        if (
          url.searchParams.get("now") === "1" ||
          (stale && (hostParam === null || checkedAt === undefined))
        )
          await u.check();
        return json(res, 200, { ...u.state(), switchedOff: await updatesOff() });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        let acted = false;
        if (typeof body.auto === "boolean") {
          await u.setAuto(body.auto);
          acted = true;
        }
        if (typeof body.skip === "string") {
          await u.skip(body.skip);
          acted = true;
        }
        if (typeof body.fold === "string" || body.fold === null) {
          await u.fold(body.fold);
          acted = true;
        }
        if (body.run === true) {
          void u
            .runUpdate("button")
            .catch((e) => log("warn", `claude update on ${box.label}: ${errorText(e)}`));
          acted = true;
        }
        if (!acted) return json(res, 400, { error: "auto, skip, fold or run required" });
        return json(res, 200, u.state());
      }
    }
    // The model a workspace last ran, written by the adapter at turn start and applied by
    // the client on a blank session; POST with a null or absent model forgets it.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/workspace-model`) {
      const cwd = url.searchParams.get("cwd");
      if (!cwd) return json(res, 400, { error: "cwd param required" });
      const saved = (await loadWorkspaceModels(STATE_DIR)).get(cwd);
      if (!saved) return json(res, 200, {});
      // The remembered id may be one the CLI has since renamed; answer the form the
      // lineup still has, or nothing, never an id the picker cannot name. Without the
      // catalog (a test harness) the saved id goes out as it is.
      const offered = models ? (await models()).map((m) => m.id) : undefined;
      const model = offered ? livingModelId(saved.model, offered) : saved.model;
      return json(res, 200, model ? { ...saved, model } : {});
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/workspace-model`) {
      const body = await readBody(req);
      const cwd = String(body.cwd ?? "");
      if (!cwd) return json(res, 400, { error: "cwd required" });
      await saveWorkspaceModel(
        STATE_DIR,
        cwd,
        typeof body.model === "string" ? body.model : undefined,
      );
      return json(res, 200, { ok: true });
    }
    // What dsh's context blocks cost on the last turn in this workspace, in characters,
    // written by the adapter at turn start and shown beside each row on the Settings
    // card. A workspace that has never run a turn answers `{}`, which the card renders
    // as no number rather than as a zero.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/context-sizes`) {
      const cwd = url.searchParams.get("cwd");
      if (!cwd) return json(res, 400, { error: "cwd param required" });
      return json(res, 200, (await loadContextSizes(STATE_DIR)).get(cwd) ?? {});
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/starter`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      return json(res, 200, {
        session: starters?.get(sid) ?? "",
        fallback: starters?.get("default") ?? "",
      });
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/starter`) {
      const body = await readBody(req);
      const sid = String(body.session ?? "");
      if (!sid) return json(res, 400, { error: "session required" });
      const text = String(body.text ?? "");
      setStarter?.(sid, text);
      // A saved opener is also the default for the next new session; that is what makes a
      // brand-new tab, which has no key of its own yet, show anything at all.
      if (body.asDefault !== false) setStarter?.("default", text);
      return json(res, 200, { ok: true });
    }
    // Ask one. `/btw` reaches the adapter through the prompt stream, so this is the only
    // HTTP way in: the Changes tab's Ask control and the return recap both post here.
    // `withDiff` seeds the question with the working-tree diff, whole or one path.
    if (askAside && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/side-questions`) {
      const body = await readBody(req);
      const { session: sid, question: raw } = body;
      // Typed, not coerced: `String({})` is `"[object Object]"`, which passes a non-empty
      // check and reaches the aside ring as a question nobody wrote.
      if (typeof sid !== "string" || typeof raw !== "string")
        return json(res, 400, { error: "session and question required" });
      const question = raw.trim();
      // The selection bar sends the passage as `quote` and may leave the question blank, which
      // the adapter asks as "explain this". Capped at the client's QUOTE_MAX (selection.ts).
      // A quote rides alone: with `withDiff` the diff is the context, and a blank question
      // would ask Claude to "explain the passage" over a diff.
      const quote =
        body.withDiff !== true && typeof body.quote === "string"
          ? body.quote.trim().slice(0, SELECTION_QUOTE_MAX)
          : "";
      if (sid === "" || (question === "" && quote === ""))
        return json(res, 400, { error: "session and question required" });
      // A recap says so, and only a recap is deduplicated: a question someone typed twice
      // was meant twice. `ok` either way. The caller wanted a recap for this return and
      // there is one; it simply belongs to whichever tab asked first.
      if (body.recap === true && recapIsRepeat(sid, Date.now()))
        return json(res, 200, { ok: true, duplicate: true });
      const reply = await askAside(sid, question, {
        withDiff: body.withDiff === true,
        path: typeof body.path === "string" ? body.path : "",
        quote,
      });
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/side-questions`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      const items: AsideEntry[] = sideQuestions?.get(sid) ?? [];
      const box = updateBoxOf(url, sid);
      // The hints file is read only while a card would show, not on every 3 s poll.
      const card = cardFor(updaters.get(box.host)?.state());
      // One build per poll: `steersFor` inside it re-arms every hold's idle timer.
      const asides = events?.replies.asides(sid);
      return json(res, 200, {
        items,
        loginNeeded: loginNeeded?.get(sid) ?? null,
        suggestion: asides?.suggestion ?? null,
        claudeUpdate: card && !(await updatesOff()) ? card : null,
        fallback: sessionFallbacks?.get(sid) ?? null,
        steers: asides ? asides.steers : (steersFor?.(sid) ?? { waiting: [], held: [] }),
      });
    }
    // The steer card. `hold` takes waiting steers back from Claude for an edit (several at
    // once for Edit all), `remove` takes them back for good, and a hold ends with `save`
    // (one message with the new text and every file or image the hold carried),
    // `restore` (as they were) or `drop`. 409 carries the
    // reason so the card can say "already sent" in the reader's language.
    if (
      holdSteers &&
      releaseHold &&
      req.method === "POST" &&
      url.pathname === `${ROUTE_PREFIX}/steer-edit`
    ) {
      const body = await readBody(req);
      const { session: sid, action, ids, holdId, text } = body;
      if (typeof sid !== "string" || sid === "")
        return json(res, 400, { error: "session required" });
      const idList =
        Array.isArray(ids) && ids.length > 0 && ids.every((i) => typeof i === "string")
          ? ids
          : undefined;
      if (action === "sendNow") {
        if (!idList) return json(res, 400, { error: "ids required" });
        if (!sendSteerNow) return json(res, 404, { error: "send now not available" });
        const reply = await sendSteerNow(sid, idList);
        return json(res, reply.ok ? 200 : 409, reply);
      }
      if (action === "hold" || action === "remove") {
        if (!idList) return json(res, 400, { error: "ids required" });
        const held = await holdSteers(sid, idList);
        if (!held.ok || action === "hold") return json(res, held.ok ? 200 : 409, held);
        const dropped = await releaseHold(sid, held.holdId, "drop");
        return json(res, dropped.ok ? 200 : 409, dropped);
      }
      if (typeof holdId !== "string" || holdId === "")
        return json(res, 400, { error: "holdId required" });
      if (action === "save") {
        // Blank words are `releaseHold`'s call: fine while the hold keeps a file or image,
        // refused (409, `error`) when nothing would be left to send.
        if (typeof text !== "string") return json(res, 400, { error: "text required" });
        const reply = await releaseHold(sid, holdId, { text });
        return json(res, reply.ok ? 200 : 409, reply);
      }
      if (action === "restore" || action === "drop") {
        const reply = await releaseHold(sid, holdId, action);
        return json(res, reply.ok ? 200 : 409, reply);
      }
      return json(res, 400, { error: "unknown action" });
    }
    // Dismiss is server-side so a closed card stays closed: a client-only hide is lost on the
    // next remount and the entry, still in the ring, would poll back into view. It marks
    // rather than deletes. The answer stays readable in the panel's Asides tab, which is
    // the point of persisting asides at all; the bubble is what the user closed, not the
    // record.
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/side-questions/dismiss`) {
      const body = await readBody(req);
      const sid = String(body.session ?? "");
      const id = String(body.id ?? "");
      if (!sid || !id) return json(res, 400, { error: "session and id required" });
      const entry = sideQuestions?.get(sid)?.find((e) => e.id === id);
      if (entry) {
        entry.dismissed = true;
        persistAsides?.(sid);
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/context`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (!contextUsage) return json(res, 404, { error: "context usage not available" });
      const reply = await contextUsage(sid);
      // 200 even when ok is false: the client reads ok, and a 409 here is by design (session
      // mid-turn or no live process), which Chrome would print in red on every session switch.
      return json(res, 200, reply);
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/skill-doctor`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (!skillDoctor) return json(res, 404, { error: "skill report not available" });
      // 200 even when ok is false: a decline (no skills, scan denied) is an expected
      // answer, not an HTTP error to print red. try/catch so a throw from the spawn path
      // returns { ok: false } rather than a 500.
      try {
        return json(res, 200, await skillDoctor(sid));
      } catch (error) {
        return json(res, 200, {
          ok: false,
          error: `skill report failed: ${errorText(error)}`,
        });
      }
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/diff`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (!workspaceDiff) return json(res, 404, { error: "workspace diff not available" });
      const reply = await workspaceDiff(sid);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/permissions`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (!permissionReadout) return json(res, 404, { error: "permission readout not available" });
      const reply = await permissionReadout(sid);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (mcp && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/mcp-servers`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      const reply = await mcp.status(sid);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (mcp && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/reconnect`) {
      const { session, name } = await readBody(req);
      if (typeof session !== "string" || typeof name !== "string")
        return json(res, 400, { error: "session and name required" });
      const reply = await mcp.reconnect(session, name);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (mcp && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/ask`) {
      const { session, name, ask } = await readBody(req);
      if (typeof session !== "string" || typeof name !== "string")
        return json(res, 400, { error: "session and name required" });
      const reply = await mcp.ask(session, name, ask === true);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    if (
      mcp &&
      req.method === "POST" &&
      url.pathname === `${ROUTE_PREFIX}/mcp-servers/authenticate`
    ) {
      const { session, name } = await readBody(req);
      if (typeof session !== "string" || typeof name !== "string")
        return json(res, 400, { error: "session and name required" });
      const reply = await mcp.authenticate(session, name);
      return json(res, reply.ok ? 200 : 409, reply);
    }
    // Add a server: `claude mcp add-json`, run in the session's own directory so a
    // `local` or `project` scope writes into the project on screen and nowhere else.
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/add`) {
      const body = await readBody(req);
      const built = buildAddServer(body);
      if ("error" in built) return json(res, 400, { error: built.error });
      const cwd = await sessionCwd(body.session, sessionPersistence);
      const remote = notOnBox(url, "MCP server changes", cwd);
      if (remote) return json(res, 400, { error: remote });
      if (scopeNeedsCwd(built.scope) && cwd === null)
        return json(res, 400, {
          error: `${built.scope} scope needs a session open in a directory`,
        });
      const result = await run(
        command || "claude",
        ["mcp", "add-json", built.name, JSON.stringify(built.json), "-s", built.scope],
        cliEnvFor(configDir),
        cwd ?? undefined,
      );
      if (result.error) return json(res, 400, { error: result.error });
      log("info", `mcp server ${built.name} added (${built.scope})`);
      return json(res, 200, { ok: true });
    }
    // Remove a server. Without `-s` the CLI takes it out of whichever scope has it, and
    // the session's directory is what decides which project that is.
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/mcp-servers/remove`) {
      const body = await readBody(req);
      if (!isMcpName(body.name)) return json(res, 400, { error: "name required" });
      const cwd = await sessionCwd(body.session, sessionPersistence);
      const remote = notOnBox(url, "MCP server changes", cwd);
      if (remote) return json(res, 400, { error: remote });
      if (cwd === null) return json(res, 400, { error: "no session open in a directory" });
      const result = await run(
        command || "claude",
        ["mcp", "remove", body.name],
        cliEnvFor(configDir),
        cwd,
      );
      if (result.error) return json(res, 400, { error: result.error });
      log("info", `mcp server ${body.name} removed`);
      return json(res, 200, { ok: true });
    }
    // Tool activity: inline text (the default) or dsh's native rows. The Tune tab reads
    // it on open; a PUT takes effect on the next turn, no restart. Rows stay refused while
    // the running dsh will not load a log holding them, and the reason rides along.
    if (toolMode && url.pathname === `${ROUTE_PREFIX}/tool-mode`) {
      if (req.method === "GET") return json(res, 200, await toolMode.info());
      if (req.method === "PUT") {
        const { mode } = await readBody(req);
        if (mode !== "inline" && mode !== "rows")
          return json(res, 400, { error: "mode must be inline or rows" });
        return json(res, 200, await toolMode.set(mode));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    // Terminal sync: whether terminal /resume exchanges mirror into the dsh session. The
    // Tune tab reads it on open; a PUT takes effect at once, no restart.
    if (terminalSync && url.pathname === `${ROUTE_PREFIX}/terminal-sync`) {
      if (req.method === "GET") return json(res, 200, terminalSync.info());
      if (req.method === "PUT") {
        const { enabled } = await readBody(req);
        if (typeof enabled !== "boolean")
          return json(res, 400, { error: "enabled must be a boolean" });
        return json(res, 200, await terminalSync.set(enabled));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/idle`) {
      const sid = url.searchParams.get("session");
      if (!sid) return json(res, 400, { error: "session param required" });
      if (!idle) return json(res, 404, { error: "idle tracking not available" });
      if (events) return json(res, 200, events.replies.idle(sid));
      return json(res, 200, {
        deadline: idle.deadlineFor(sid),
        timeoutMs: idle.timeoutMs,
      });
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/idle/extend`) {
      const { session } = await readBody(req);
      if (!session) return json(res, 400, { error: "session param required" });
      if (!idle) return json(res, 404, { error: "idle tracking not available" });
      const sid = typeof session === "string" ? session : "";
      const ok = sid ? idle.extend(sid) : false;
      return json(res, ok ? 200 : 404, ok ? { extended: true } : { error: "unknown session" });
    }
    // Rewind: the session's user prompts (from Claude's transcript), then the rewind itself.
    if (rewind && req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
      const sid = url.searchParams.get("session");
      const cwd = url.searchParams.get("cwd") ?? "";
      if (!sid || !validCwd(cwd))
        return json(res, 400, { error: "session and an absolute cwd required" });
      const { box, cwd: at } = targetOf(url, cwd);
      const folded = await sessionTranscript(box, await projectDirAt(box, at), sid, claudeIdOf);
      if (folded === undefined) return json(res, 200, { prompts: [] });
      const prompts: RewindPrompt[] = folded.turns
        .map((t) => ({
          id: t.id,
          time: t.time,
          text: typedPrompt(t.content.map((c) => c.text).join("\n")).slice(0, 200),
        }))
        .toReversed()
        .slice(0, 20);
      return json(res, 200, { prompts });
    }
    if (rewind && req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/rewind`) {
      const { session: sid, uuid, dryRun } = await readBody(req);
      if (typeof sid !== "string" || !sid || !validId(uuid))
        return json(res, 400, { error: "session and uuid required" });
      return json(res, 200, await rewind(sid, uuid, dryRun === true));
    }
    if (permissionModes && url.pathname === `${ROUTE_PREFIX}/permission-mode`) {
      if (req.method === "GET") {
        const sid = url.searchParams.get("session");
        if (!sid) return json(res, 400, { error: "session param required" });
        if (events) return json(res, 200, events.replies.permissionMode(sid));
        const info = permissionModes.info(sid);
        return json(res, 200, { ...info, modes: info.allowed });
      }
      if (req.method === "PUT") {
        const { session: sid, mode } = await readBody(req);
        if (typeof sid !== "string" || !sid) return json(res, 400, { error: "session required" });
        if (mode !== null && (typeof mode !== "string" || !isPermissionMode(mode)))
          return json(res, 400, {
            error: `mode must be one of ${PERMISSION_MODES.join(", ")} or null`,
          });
        return json(res, 200, await permissionModes.set(sid, mode));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (thinking && url.pathname === `${ROUTE_PREFIX}/thinking`) {
      if (req.method === "GET") {
        const sid = url.searchParams.get("session");
        if (!sid) return json(res, 400, { error: "session param required" });
        return json(res, 200, thinking.info(sid));
      }
      if (req.method === "PUT") {
        const { session: sid, tokens } = await readBody(req);
        if (typeof sid !== "string" || !sid) return json(res, 400, { error: "session required" });
        if (
          tokens !== null &&
          (typeof tokens !== "number" || !Number.isInteger(tokens) || tokens < 0)
        )
          return json(res, 400, {
            error: "tokens must be a non-negative integer or null",
          });
        return json(res, 200, await thinking.set(sid, tokens));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (url.pathname === `${ROUTE_PREFIX}/permission-asks`) {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      const session = url.searchParams.get("session");
      if (!session) return json(res, 400, { error: "session required" });
      return json(res, 200, { asks: permissionAsks?.get(session) ?? [] });
    }
    return UNHANDLED;
  };
}
