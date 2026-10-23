// The memory tab: Claude's auto-memory files for the current workspace, as the route lists them, with the
// rows that show each file's front matter.
import { useEffect, useState } from "react";
import {
  btn,
  btnPrimary,
  rowBtn,
  errText,
  stateText,
  bodyFlow,
  meta,
  T,
  readJson,
  ROUTE,
  ago,
  claudeProviderOf,
  type ClientCtx,
  code,
} from "../shared.js";
import { t, useLocale } from "../i18n.js";
import { shortPath } from "./shared.js";

/** One of Claude's auto-memory files for the current workspace, as `GET /memory` lists it. */
interface MemoryFile {
  name: string;
  size: number;
  mtime: number;
  summary: string;
}

/**
 * "Memory" body rendered inside the Oh My Claude dialog: lists the workspace's Claude auto-memory
 * files (`<project dir>/memory/*.md`, MEMORY.md first) and edits or deletes one in place.
 *
 * An empty list names the directory the server read, so a list that is empty because the plugin
 * looked in the wrong place can be told from one that is empty because Claude has written nothing.
 * A list that could not be fetched shows the failure instead of reading as empty.
 */
export function MemoryBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The list's own failure, apart from `error`: the list is re-read every half minute, and a
  // re-read that works must not wipe what a failed save or delete said under the editor.
  const [listError, setListError] = useState("");

  // Every call names the session's own mount, so a session on a box lists and edits that box's
  // memories rather than this PC's.
  const provider = claudeProviderOf(ctx, sessionId);
  const q = [
    cwd ? `cwd=${encodeURIComponent(cwd)}` : "",
    provider === undefined ? "" : `provider=${encodeURIComponent(provider)}`,
  ]
    .filter((p) => p !== "")
    .join("&");
  const refresh = (signal?: AbortSignal) => {
    if (!cwd) return;
    fetch(`${ROUTE}/memory?${q}`, { signal })
      .then((r) => readJson<{ dir?: string; files?: MemoryFile[] }>(r))
      .then((b) => {
        setFiles(b.files ?? []);
        setDir(b.dir ?? "");
        setListError("");
      })
      // An in-flight list outlives the tab being closed, and its reply landed on a component that
      // is gone: React drops the state write and the error branch painted an error nobody asked
      // for. The abort is the teardown, and its own rejection is not a failure to report.
      .catch((e: Error) => {
        if (signal?.aborted !== true) setListError(e.message);
      });
  };
  // Re-list every half minute: Claude writes memories mid-turn.
  useEffect(() => {
    const stop = new AbortController();
    refresh(stop.signal);
    const timer = setInterval(() => refresh(stop.signal), 30_000);
    return () => {
      clearInterval(timer);
      stop.abort();
    };
  }, [q]);

  const openFile = async (n: string) => {
    setError("");
    try {
      const body = await readJson<{ text: string }>(
        await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(n)}`),
      );
      setFile(n);
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/memory?${q}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, name: file, text }),
        }),
      );
      setSaved(text);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!file || !window.confirm(t("panel.memory.deleteConfirm", { file }))) return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(file)}`, { method: "DELETE" }),
      );
      setFile(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!cwd) return <span style={stateText}>{t("panel.memory.noWorkspace")}</span>;
  if (files.length === 0)
    return (
      <div style={bodyFlow} data-omc-memory-empty="">
        {listError ? (
          <span style={errText}>{listError}</span>
        ) : (
          <>
            <span style={stateText}>{t("panel.memory.empty")}</span>
            {dir && (
              <span
                data-omc-memory-dir=""
                title={dir}
                // A path has no spaces to wrap at; `anywhere` breaks it at its hyphens and
                // slashes first and only then mid-word, so it never runs out of a phone's panel.
                style={{ ...stateText, overflowWrap: "anywhere" }}
              >
                {t("panel.memory.lookedIn", { dir: shortPath(dir, cwd) })}
              </span>
            )}
          </>
        )}
      </div>
    );
  const dirty = text !== saved;
  return (
    <div style={bodyFlow}>
      {file === null ? (
        files.map((f) => (
          <button
            key={f.name}
            type="button"
            style={{
              ...rowBtn,
            }}
            onClick={() => openFile(f.name)}
          >
            <span
              // Shrinks before the summary does (auto basis against the summary's zero), so a
              // long name on a phone ellipsizes and the age on the right stays in the row.
              style={{
                flex: "0 1 auto",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: T.mono,
                fontSize: 12,
              }}
            >
              {f.name}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 10,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: T.muted,
              }}
            >
              {f.summary}
            </span>
            <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(f.mtime)}</span>
          </button>
        ))
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setFile(null)} disabled={busy}>
              ‹ {t("panel.back")}
            </button>
            <span style={{ flex: 1, fontFamily: T.mono, fontSize: 12 }}>{file}</span>
            <button type="button" style={btn} onClick={remove} disabled={busy}>
              {t("panel.delete")}
            </button>
            <button
              type="button"
              style={dirty ? btnPrimary : btn}
              onClick={save}
              disabled={busy || !dirty}
            >
              {t("save")}
            </button>
          </div>
          <textarea
            data-omc-memory-editor=""
            aria-label={t("panel.memory.editorLabel")}
            value={text}
            spellCheck={false}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            }}
            style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
          />
        </>
      )}
      {(error || listError) && <span style={errText}>{error || listError}</span>}
    </div>
  );
}
