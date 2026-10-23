// The instructions tab: the CLAUDE.md hierarchy the route lists, each file with the scope it came from. The
// plugin manager block it draws is the skills tab's.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  btn,
  btnPrimary,
  rowBtn,
  errText,
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
import type { PluginRoster, PluginLoadError } from "../../plugins.js";
import { shortPath } from "./shared.js";
import { PluginManagerBlock } from "./skills.js";

/** One instruction file from the CLAUDE.md hierarchy: `GET /instructions` lists them. */
interface InstructionFile {
  path: string;
  kind: "Managed" | "User" | "Project" | "Local";
  size: number;
  mtime: number;
  importedBy?: string;
}

/**
 * "Instructions" body rendered inside the Oh My Claude dialog: lists the CLAUDE.md hierarchy
 * the session loaded (managed, user, project, local files plus @imports), and opens each in
 * an editor. Managed files open read-only. Same save/delete routes as Memory, path-checked.
 */
export function InstructionsBody({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [file, setFile] = useState<InstructionFile | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [roster, setRoster] = useState<PluginRoster | null>(null);
  const [pluginErrors, setPluginErrors] = useState<PluginLoadError[]>([]);
  const [pluginWarnings, setPluginWarnings] = useState<PluginLoadError[]>([]);

  // Every call names the session's own mount, so a session on a box lists and edits that box's
  // CLAUDE.md files rather than this PC's.
  const provider = claudeProviderOf(ctx, sessionId);
  const onBox = provider === undefined ? "" : `provider=${encodeURIComponent(provider)}`;
  const q = [
    cwd ? `cwd=${encodeURIComponent(cwd)}` : "",
    `session=${encodeURIComponent(sessionId)}`,
    onBox,
  ]
    .filter((p) => p !== "")
    .join("&");
  // A fetch in flight when the tab closes must not set state on the unmounted component (React
  // warns, and the stale result would flash if the tab reopened). Both loaders check this first.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  const refresh = () => {
    if (!cwd) return;
    fetch(`${ROUTE}/instructions?${q}`)
      .then((r) => readJson<{ files?: InstructionFile[] }>(r))
      .then((b) => mounted.current && setFiles(b.files ?? []))
      .catch((e: Error) => mounted.current && setError(e.message));
  };
  useEffect(() => {
    refresh();
  }, [cwd]);
  const refreshRoster = useCallback(() => {
    if (!cwd) return;
    fetch(`${ROUTE}/plugins?${q}`)
      .then((r) =>
        readJson<
          PluginRoster & { pluginErrors?: PluginLoadError[]; pluginWarnings?: PluginLoadError[] }
        >(r),
      )
      // A roster that will not load is not an instructions error: the file list is still good.
      .then((b) => {
        if (!mounted.current) return;
        setRoster(b);
        setPluginErrors(b.pluginErrors ?? []);
        setPluginWarnings(b.pluginWarnings ?? []);
      })
      .catch(() => {});
  }, [cwd, q]);
  useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);
  const openFile = async (f: InstructionFile) => {
    setError("");
    try {
      const body = await readJson<{ text: string; mtime?: number }>(
        await fetch(`${ROUTE}/instructions/file?${q}&path=${encodeURIComponent(f.path)}`),
      );
      // The read's own mtime, not the list's: the list can be minutes old by the time a row opens,
      // and the save sends this back for the server to check the file has not moved since.
      setFile({ ...f, mtime: body.mtime ?? f.mtime });
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file || file.kind === "Managed") return;
    setBusy(true);
    setError("");
    try {
      await readJson(
        await fetch(`${ROUTE}/instructions/file${onBox === "" ? "" : `?${onBox}`}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd, path: file.path, text, mtime: file.mtime }),
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

  // A session dsh reports no directory for has neither instructions nor settings to read.
  if (!cwd)
    return (
      <span style={{ ...meta, padding: "4px 0", color: error ? T.err : undefined }}>
        {error || t("panel.instructions.none")}
      </span>
    );
  const dirty = text !== saved;

  return (
    <div style={bodyFlow}>
      {file === null && files.length === 0 && (
        <span style={{ ...meta, padding: "4px 0" }}>{t("panel.instructions.none")}</span>
      )}
      {file === null ? (
        files.map((f) => (
          <button
            key={f.path}
            type="button"
            style={{
              ...rowBtn,
            }}
            onClick={() => openFile(f)}
          >
            <span style={{ ...meta, flex: "none", minWidth: 52 }}>
              {t(`panel.instructions.kind.${f.kind}`)}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                marginLeft: 8,
                fontFamily: T.mono,
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortPath(f.path, cwd)}
            </span>
            {f.importedBy && (
              <span style={{ ...meta, flex: "none", marginLeft: 8 }}>
                {t("panel.instructions.importedFrom", {
                  name: f.importedBy.split(/[\\/]/).pop() ?? "",
                })}
              </span>
            )}
            <span style={{ ...meta, flex: "none", marginLeft: 8 }}>{ago(f.mtime)}</span>
          </button>
        ))
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setFile(null)} disabled={busy}>
              ‹ {t("panel.back")}
            </button>
            <span style={{ flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 12 }}>
              {shortPath(file.path, cwd)}
            </span>
            {file.kind === "Managed" && (
              <span style={{ ...meta, flex: "none" }}>{t("panel.instructions.readOnly")}</span>
            )}
            {file.kind !== "Managed" && (
              <button
                type="button"
                style={dirty ? btnPrimary : btn}
                onClick={save}
                disabled={busy || !dirty}
              >
                {t("save")}
              </button>
            )}
          </div>
          <textarea
            data-omc-instructions-editor=""
            aria-label={t("panel.instructions.editorLabel")}
            value={text}
            spellCheck={false}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
            autoFocus
            readOnly={file.kind === "Managed"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save();
            }}
            style={{ ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }}
          />
        </>
      )}
      {file === null && (
        <PluginManagerBlock
          roster={roster}
          pluginErrors={pluginErrors}
          pluginWarnings={pluginWarnings}
          sessionId={sessionId}
          ctx={ctx}
          onChanged={refreshRoster}
        />
      )}
      {error && <span style={errText}>{error}</span>}
    </div>
  );
}
