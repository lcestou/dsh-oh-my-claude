// The transcript routes: the event stream, the session list, open, reseed, search and the transcript readers.
// The blocks are the chain's own, in its order; the dispatch in sessions.ts calls this group first.
import type { IncomingMessage, ServerResponse } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { type RouteHandler, UNHANDLED } from "./context.js";
import type { Opened, RouteCtx, SearchHit } from "../sessions.js";
import { serverText } from "../locale.js";
import { errorText } from "../process.js";
import { readAt } from "../remote-fs.js";
import { queryWords, searchTranscript } from "../search.js";
import { listTranscripts, readTranscript, toMarkdown } from "../transcript.js";
import type { TranscriptListItem } from "../transcript.js";
import { moveAside, restoreBak } from "../session-repair.js";
import { STATE_DIR, loadSessionRepairs, recordRepair, trace } from "../state.js";

/** True while a scan is in flight. Two searches at once would put two full scans on the one event
 *  loop that serves every live turn, so the second is refused with 429 rather than run. */
let searching = false;

/** The transcripts group of the session routes, built once per registration. Returns `UNHANDLED` when no
 *  block matched, so the dispatch tries the next group; any other return means a block answered. */
export function transcriptsRoutes(c: RouteCtx): RouteHandler {
  return async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const {
      ROUTE_PREFIX,
      SEARCH_LIMIT,
      SEARCH_MAX_FILES,
      baseName,
      boxTranscripts,
      cacheBoxTranscript,
      claudeIdOf,
      dshSessionsFor,
      events,
      filesMentioning,
      firstTranscript,
      headerOf,
      heal,
      importedDir,
      json,
      listAllTranscripts,
      openTranscript,
      openTranscriptOnce,
      permissionModes,
      pickFor,
      projectDir,
      projectDirAt,
      projectsDir,
      readBody,
      routeHost,
      run,
      sessionPersistence,
      startedIds,
      targetOf,
      transcriptDirs,
      validCwd,
      validDshId,
      validId,
      withoutSubagents,
      workspaceAt,
      workspaceRegistry,
    } = c;
    // The event stream: one long GET per tab, see src/events.ts. `session` scopes the
    // per-session kinds; tab-wide kinds reach every stream. The response stays open.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/events`) {
      if (!events) return json(res, 404, { error: "events not available" });
      const session = url.searchParams.get("session");
      events.hub.attach(res, session, events.snapshot(session));
      return;
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/sessions`) {
      const cwd = url.searchParams.get("cwd") ?? "";
      const all = url.searchParams.get("all") === "1";
      if (!all && !validCwd(cwd)) return json(res, 400, { error: "cwd must be an absolute path" });
      if (all) {
        const owned = dshSessionsFor(
          await sessionPersistence.list(),
          null,
          claudeIdOf,
          new Set(workspaceRegistry()?.archivedSessionIds ?? []),
        );
        const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
        const found = [
          ...(await listAllTranscripts(projectsDir, hidden)),
          // Imported ones live outside `projects/`, and say so, so a row that came from
          // another box is not mistaken for one this CLI ran.
          ...(importedDir
            ? (await listTranscripts(importedDir, hidden)).map((s) => ({
                ...s,
                imported: true,
              }))
            : []),
        ];
        const items = withoutSubagents(
          found.map((s) => {
            const d = owned.get(s.id);
            return d ? { ...s, dsh: d } : s;
          }),
        );
        return json(res, 200, { host: hostname(), sessions: items });
      }
      // Transcripts of dsh sessions (started here or opened from here) are listed with
      // their dsh id so the panel opens the existing session. Ones the adapter started
      // for a dsh session that no longer exists are hidden.
      const owned = dshSessionsFor(
        await sessionPersistence.list(),
        cwd,
        claudeIdOf,
        new Set(workspaceRegistry()?.archivedSessionIds ?? []),
      );
      const hidden = new Set([...(await startedIds())].filter((id) => !owned.has(id)));
      // A remote workspace ran its turns on its box, so that is where its transcripts are;
      // the box lister answers for the whole box and the real remote path picks this
      // workspace's out. Locally there is only the empty placeholder dir.
      const ws = workspaceAt(cwd);
      const seen = ws
        ? [await boxTranscripts(ws, hidden)]
        : await Promise.all(
            projectDir(cwd).map((dir) => listTranscripts(dir, hidden).catch(() => [])),
          );
      const items = withoutSubagents(
        seen.flat().map((s) => {
          const d = owned.get(s.id);
          return d ? { ...s, dsh: d } : s;
        }),
      );
      return json(res, 200, { sessions: items });
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/open`) {
      const { cwd, id } = await readBody(req);
      if (!validCwd(cwd) || !validId(id)) return json(res, 400, { error: "cwd and id required" });
      const onBox = workspaceAt(cwd);
      if (onBox !== undefined) await cacheBoxTranscript(onBox, id);
      const opened = await openTranscript(
        routeHost,
        transcriptDirs(cwd),
        cwd,
        id,
        claudeIdOf,
        workspaceRegistry(),
        heal,
        pickFor(cwd),
      );
      // The CLI stamps every prompt row with the mode it ran under, so a session brought
      // in from a terminal keeps its mode instead of the workspace default. A session dsh
      // already knows keeps whatever was picked in dsh.
      if (!opened.existed && opened.permissionMode && permissionModes)
        await permissionModes.restore(opened.id, opened.permissionMode);
      return json(res, 200, opened);
    }
    if (req.method === "POST" && url.pathname === `${ROUTE_PREFIX}/reseed`) {
      // The person's click on the panel's refused line: move the log dsh cannot load out
      // of the way, keep it as .bak, and seed the session again from its transcript.
      // Never automatic: the old log's dsh-only rows live on in the .bak only.
      const { id } = await readBody(req);
      if (!validDshId(id)) return json(res, 400, { error: "id required" });
      const record = (await loadSessionRepairs(STATE_DIR)).logs[id];
      if (record === undefined || record.verdict !== "unknown")
        return json(res, 404, { error: "no refused log recorded for this session" });
      const header = (await sessionPersistence.list()).map(headerOf).find((h) => h.id === id);
      const cwd = header?.cwd;
      if (!cwd) return json(res, 404, { error: "dsh does not list this session" });
      const dirs = transcriptDirs(cwd);
      const folded = await firstTranscript(dirs, claudeIdOf(id));
      if (folded === undefined || folded.turns.length === 0)
        return json(res, 409, { error: serverText("noTranscriptToReseed") });
      const bak = moveAside(record.path);
      await trace(`reseed ${id}: log moved to ${bak}`);
      let opened: Opened;
      try {
        opened = await openTranscriptOnce(
          routeHost,
          dirs,
          cwd,
          id,
          claudeIdOf,
          workspaceRegistry(),
          heal,
          claudeIdOf(id),
          pickFor(cwd),
        );
      } catch (e) {
        // The seed did not land: put the log back where it was so the click can be tried
        // again, and answer the failure. The record stays `unknown`.
        restoreBak(record.path, bak);
        await trace(`reseed ${id}: seed failed, log restored: ${errorText(e)}`);
        throw e;
      }
      await recordRepair(STATE_DIR, id, {
        ...record,
        verdict: "reseeded",
        bak,
        at: Date.now(),
      });
      // The transcript id rides along: the tab's open helper posts that id to `/open` and
      // adopts the session under its dsh id, the way the Restore tab's rows do.
      return json(res, 200, { ...opened, transcriptId: claudeIdOf(id) });
    }
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/search`) {
      const q = url.searchParams.get("q") ?? "";
      const cwd = url.searchParams.get("cwd") ?? "";
      const scope = url.searchParams.get("scope") ?? "workspace";
      const trimmed = q.trim();
      if (trimmed.length < 2)
        return json(res, 400, { error: "query must be at least 2 characters" });
      if (scope === "workspace" && !validCwd(cwd))
        return json(res, 400, { error: "cwd must be an absolute path" });
      // A remote workspace ran its turns on its box, so its transcripts live there; this
      // route only reaches this box, so an empty list would read as "nothing found".
      // Only the workspace scope is refused: a box-wide scan walks this box's own
      // project directories and never reads `cwd`, so refusing it because the panel's
      // workspace filter happens to name a remote one blocks a search that would work.
      if (scope === "workspace" && workspaceAt(cwd) !== undefined)
        return json(res, 400, { error: "search runs on this box only" });
      if (searching) return json(res, 429, { error: "a search is already running" });
      searching = true;
      const start = Date.now();
      try {
        // scope=workspace walks this workspace's own project dir. scope=box walks every
        // project dir on the box, which means the CHILDREN of the projects roots and not
        // the roots themselves: `projectsDir` holds the roots, one per Claude home, and
        // `listTranscripts` lists one project dir, never a tree. Passing a root straight
        // through made grep recurse and find files while the listing came back empty, so
        // every hit was dropped for want of a title and a box-wide search always said
        // nothing. Caught live on 2026-09-20: 379 files scanned, 0 hits.
        const dirs =
          scope === "box"
            ? (
                await Promise.all(
                  projectsDir.map(async (root) =>
                    (await readdir(root, { withFileTypes: true }).catch(() => []))
                      .filter((entry) => entry.isDirectory())
                      .map((entry) => join(root, entry.name)),
                  ),
                )
              ).flat()
            : projectDir(cwd);
        // Join each hit to its listing row so id, title and modifiedAt come from the
        // directory's `listTranscripts`, not a re-parse of the file.
        // `withoutSubagents` is what the browser's own list applies, so a search cannot
        // return a row the list would never show and Open could not reach.
        const meta = new Map<string, TranscriptListItem>();
        const listed: string[] = [];
        for (const dir of dirs)
          for (const item of withoutSubagents(await listTranscripts(dir).catch(() => []))) {
            meta.set(`${item.id}.jsonl`, item);
            listed.push(join(dir, `${item.id}.jsonl`));
          }
        // grep narrows the file list with a literal word before any transcript is read:
        // `-F` keeps a regex-heavy query literal, `-i` case-insensitive, `-l` lists names.
        // The longest word is the most selective. A non-zero exit with empty output is
        // "nothing matched", a normal empty answer rather than an error.
        const words = queryWords(trimmed);
        const grepWord = words.reduce(
          (longest, w) => (w.length > longest.length ? w : longest),
          "",
        );
        // A box with no grep to run (a Windows host) narrows the listed transcripts here
        // instead; a file with no listing row is dropped below either way.
        const grep = await run("grep", ["-rilF", "--", grepWord, ...dirs]);
        const files = grep.error?.includes("spawn grep ENOENT")
          ? await filesMentioning(listed, grepWord)
          : grep.out.split("\n").filter((line) => line.length > 0);
        // One file is one session, so `searchTranscript` already yields one hit per
        // session; reading only grep's narrowed set is what keeps this fast.
        const filesToSearch = files.slice(0, SEARCH_MAX_FILES);
        const hits: SearchHit[] = [];
        let scanned = 0;
        for (const file of filesToSearch) {
          const text = await readFile(file, "utf8").catch(() => "");
          if (!text) continue;
          scanned += 1;
          const hit = searchTranscript(text, words);
          if (!hit) continue;
          // No listing row means the browser would not show this session either: a
          // subagent's own transcript, or a file outside the directories it lists.
          const listing = meta.get(baseName(file));
          if (listing === undefined) continue;
          const entry: SearchHit = {
            id: listing.id,
            title: listing.title,
            modifiedAt: listing.modifiedAt,
            count: hit.count,
            when: hit.when,
            role: hit.role,
            snippet: hit.snippet,
          };
          if (listing.cwd) entry.cwd = listing.cwd;
          hits.push(entry);
        }
        return json(res, 200, {
          hits: hits.slice(0, SEARCH_LIMIT),
          scanned,
          tookMs: Date.now() - start,
          truncated: files.length > SEARCH_MAX_FILES || hits.length > SEARCH_LIMIT,
        });
      } finally {
        searching = false;
      }
    }
    // Export: the transcript exactly as it sits on disk, so a re-import is byte-identical.
    // It follows the session's own box, which is how a row from an SSH box downloads.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/transcript`) {
      const id = url.searchParams.get("id");
      const cwd = url.searchParams.get("cwd") ?? "";
      if (!validId(id)) return json(res, 400, { error: "id required" });
      const { box, cwd: at } = targetOf(url, cwd);
      const dirs = box.sshHost
        ? [join(await projectDirAt(box, at), `${id}.jsonl`)]
        : transcriptDirs(at).map((d) => join(d, `${id}.jsonl`));
      for (const path of dirs) {
        const read = await readAt(box, path);
        if (read === null) continue;
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "content-disposition": `attachment; filename="${id}.jsonl"`,
          "cache-control": "no-store",
        });
        res.end(read.text);
        return;
      }
      return json(res, 404, { error: "transcript not found" });
    }
    // Same lookup as /transcript, answered as one Markdown document for reading or sharing
    // rather than the raw rows. readTranscript folds the file and attaches subagent
    // transcripts behind their Task calls, so the export reads as the session did.
    if (req.method === "GET" && url.pathname === `${ROUTE_PREFIX}/transcript.md`) {
      const id = url.searchParams.get("id");
      const cwd = url.searchParams.get("cwd") ?? "";
      if (!validId(id)) return json(res, 400, { error: "id required" });
      const { box, cwd: at } = targetOf(url, cwd);
      const dirs = box.sshHost
        ? [join(await projectDirAt(box, at), `${id}.jsonl`)]
        : transcriptDirs(at).map((d) => join(d, `${id}.jsonl`));
      try {
        for (const path of dirs) {
          const folded = await readTranscript(box, path);
          if (folded === undefined) continue;
          res.writeHead(200, {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="${id}.md"`,
            "cache-control": "no-store",
          });
          res.end(toMarkdown(folded));
          return;
        }
      } catch (e) {
        // A box that cannot be reached throws; that is not "no such transcript".
        return json(res, 502, { error: errorText(e) });
      }
      return json(res, 404, { error: "transcript not found" });
    }
    return UNHANDLED;
  };
}
