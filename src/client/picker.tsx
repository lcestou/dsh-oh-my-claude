// Add workspace, on this PC or on a connected box.
//
// dsh's sidebar "+" opens its own Select Workspace Directory dialog, which can only ever show this
// PC: its listing seam takes a path and no host. So when at least one SSH box is saved, this takes
// that button over and shows the same dialog with one extra control in the footer row, a box
// dropdown whose default is the local box. Picking the local box is the three clicks it always was
// and goes through dsh's own `uiWorkspace.listDirectory` plus `workspaces.create`; picking a box
// lists that box's directories over ssh (`/box-dirs`) and adds the workspace through the plugin's
// own remote-workspaces route, which pins a dsh workspace to a remote path.
//
// With no box saved the takeover never engages and dsh's dialog is left alone.
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import {
  Button,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconFolderClose16,
  IconPlusOutline16,
  Modal,
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  ROUTE,
  T,
  btn,
  errText,
  inputStyle,
  readJson,
  select as selectStyle,
  stateText,
  type ClientCtx,
  type DirEntry,
  type LocaleFace,
  type UiWorkspaceFace,
} from "./shared.js";

/** dsh's directory UI service, absent on a dsh that mounts no workspace UI. */
const uiWorkspaceOf = (ctx: ClientCtx): UiWorkspaceFace | undefined =>
  ctx.get?.<UiWorkspaceFace>("uiWorkspace");

/** dsh's locale registry, absent on a dsh that mounts no locale service. */
const localeOf = (ctx: ClientCtx): LocaleFace | undefined => ctx.get?.<LocaleFace>("locale");

/** Whether this dsh can browse directories at all, which is what the takeover needs to be worth it. */
export const canBrowseDirs = (ctx: ClientCtx): boolean => uiWorkspaceOf(ctx) !== undefined;

/** A box the dropdown offers; `host` is empty for this PC. */
interface BoxRow {
  name: string;
  host: string;
}

/** One directory level, the shape both dsh's listing and `/box-dirs` answer in. */
interface Listing {
  path: string;
  home: string;
  entries: DirEntry[];
}

/** A crumb in the breadcrumb bar: what it reads as, and the level it jumps to. */
export interface Crumb {
  label: string;
  path: string;
}

const segments = (p: string): string[] => p.split("/").filter(Boolean);

/**
 * The breadcrumb trail for `path`: the box's home as the first crumb when the level sits under it,
 * the filesystem root otherwise. Built from the path rather than taken from dsh's listing, so a
 * level that came over ssh reads the same as a local one.
 */
export function crumbsOf(path: string, home: string, homeLabel: string): Crumb[] {
  const under = home !== "" && (path === home || path.startsWith(`${home}/`));
  const root: Crumb = under ? { label: homeLabel, path: home } : { label: "/", path: "/" };
  const rest = segments(under ? path.slice(home.length) : path);
  const crumbs = [root];
  let at = under ? home : "";
  for (const name of rest) {
    at = `${at}/${name}`;
    crumbs.push({ label: name, path: at });
  }
  return crumbs;
}

/** The last segment of a path, which is the name a remote workspace takes. */
export const baseName = (path: string): string => segments(path).at(-1) ?? "";

/**
 * dsh's Modal card is sized for a short form, and a directory list wants the width dsh's own
 * browser dialog has. The card takes a class and no style, so the width arrives as one rule.
 */
/** What Settings dispatches to open this dialog; see the takeover effect below. */
export const OPEN_EVENT = "omc-add-workspace";

const DIALOG_CLASS = "omc-add-workspace";
const DIALOG_CSS = `.${DIALOG_CLASS}{width:min(620px,92vw);max-width:none}`;

const rowStyle = (on: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid transparent",
  background: on ? T.hover : "transparent",
  color: T.text,
  fontSize: 13,
  textAlign: "left",
  cursor: "pointer",
});

/** dsh's own dialog copy, and its English fallback when the locale service is not mounted. */
const DIALOG_EN = {
  "browser.title": "Select Workspace Directory",
  "browser.home": "Home",
  "browser.newFolder": "New folder",
  "browser.folderName": "Folder name",
  "browser.create": "Create",
  "browser.loading": "Loading…",
  "browser.showHidden": "Show hidden files",
  cancel: "Cancel",
  close: "Close",
  "browser.open": "Open",
} satisfies Record<string, string>;

/**
 * Read the Add workspace dialog's copy from dsh's own dictionaries, so the takeover speaks the
 * language the dialog it replaces spoke. `directory-browser` is the namespace
 * dsh-client-ui-directory-picker-browse registers, and a key it misses falls through to `common`.
 */
const copyOf = (ctx: ClientCtx): ((key: string) => string) => {
  const t = localeOf(ctx)?.bind("directory-browser");
  // SAFETY: every key this dialog reads is a DIALOG_EN key; an unknown one reads as itself.
  return (key) => (t ? t(key) : undefined) || DIALOG_EN[key as keyof typeof DIALOG_EN] || key;
};

/** One directory level from whichever box is picked. */
const level = async (
  ctx: ClientCtx,
  host: string,
  path: string,
  signal: AbortSignal,
): Promise<Listing> => {
  if (host === "") {
    const l = await uiWorkspaceOf(ctx)?.listDirectory(path === "" ? undefined : path, signal);
    if (!l) throw new Error("dsh's directory listing is not available");
    return { path: l.path, home: l.home, entries: l.entries };
  }
  const r = await fetch(
    `${ROUTE}/box-dirs?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`,
    { signal },
  );
  return await readJson<Listing>(r);
};

/**
 * Renderless until dsh's Add workspace button is clicked: the dialog it then opens is this plugin's,
 * and the click never reaches dsh's own flow. Mounted once at the sidebar footer, which is where a
 * root-scoped entry stays mounted whether the sidebar is wide or collapsed.
 */
export function AddWorkspaceFlow({ ctx }: { ctx: ClientCtx }) {
  const [ssh, setSsh] = useState<BoxRow[]>([]);
  const [open, setOpen] = useState(false);
  // Empty host means this PC, which is what the dropdown opens on.
  const [host, setHost] = useState("");
  // Empty path means the box's own home; the listing answers which directory that was.
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [picked, setPicked] = useState("");
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The New folder draft; null while the row is closed.
  const [folder, setFolder] = useState<string | null>(null);
  // Bumped to re-list the level in place, which a path that did not change cannot do on its own.
  const [tick, setTick] = useState(0);
  const t = copyOf(ctx);

  useEffect(() => {
    fetch(`${ROUTE}/ssh-boxes`)
      .then((r) => readJson<{ boxes?: BoxRow[] }>(r))
      .then((b) => setSsh(b.boxes ?? []))
      .catch(() => {});
  }, []);

  // Take dsh's button over. A capture listener on the document runs before React's own root
  // listener, so one handler covers both the sidebar header button and its collapsed twin, and it
  // keeps working when dsh re-renders them through the same elements. The label is dsh's own
  // translation of `workspace.add`, so the selector follows the reader's language.
  useEffect(() => {
    if (ssh.length === 0 || !uiWorkspaceOf(ctx)) return;
    const label = localeOf(ctx)?.bind("workspace")("workspace.add") || "Add workspace";
    const start = () => {
      setError("");
      setPicked("");
      setFolder(null);
      setOpen(true);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest(`button[aria-label="${CSS.escape(label)}"]`)) return;
      e.preventDefault();
      e.stopPropagation();
      start();
    };
    document.addEventListener("click", onClick, true);
    // The Settings card lists the remote workspaces but no longer takes a typed path; its button
    // asks for this dialog by event, the two trees having no shared React parent.
    document.addEventListener(OPEN_EVENT, start);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener(OPEN_EVENT, start);
    };
  }, [ssh.length, ctx]);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    setError("");
    setListing(null);
    level(ctx, host, path, ac.signal)
      .then((l) => {
        setListing(l);
        setPicked("");
      })
      .catch((e: Error) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => ac.abort();
  }, [open, host, path, tick, ctx]);

  // The level the dialog is showing, or the folder picked inside it: what Open adds.
  const target = picked || listing?.path || "";
  const rows = (listing?.entries ?? []).filter((e) => hidden || !e.hidden);

  const add = () => {
    if (target === "") return;
    setBusy(true);
    setError("");
    const done = () => {
      setBusy(false);
      setOpen(false);
    };
    const failed = (e: Error) => {
      setBusy(false);
      setError(e.message);
    };
    if (host === "") {
      ctx.workspaces.create({ path: target }).then(done).catch(failed);
      return;
    }
    // A remote workspace is a dsh workspace pinned to a path on the box; the route names it after
    // the directory and appends the host itself.
    fetch(`${ROUTE}/remote-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: baseName(target) || host, host, remoteCwd: target }),
    })
      .then((r) => readJson<{ workspace?: unknown }>(r))
      .then(done)
      .catch(failed);
  };

  const create = () => {
    const name = (folder ?? "").trim();
    if (name === "" || !listing) return;
    setBusy(true);
    setError("");
    const made =
      host === ""
        ? (uiWorkspaceOf(ctx)?.createDirectory(listing.path, name) ??
          Promise.reject(new Error("dsh's directory listing is not available")))
        : fetch(`${ROUTE}/box-dirs?host=${encodeURIComponent(host)}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: listing.path, name }),
          })
            .then((r) => readJson<{ path: string }>(r))
            .then((b) => b.path);
    made
      .then((created) => {
        setFolder(null);
        setBusy(false);
        setTick((n) => n + 1);
        setPicked(created);
      })
      .catch((e: Error) => {
        setBusy(false);
        setError(e.message);
      });
  };

  const crumbs = listing ? crumbsOf(listing.path, listing.home, t("browser.home")) : [];
  const boxes: BoxRow[] = [{ name: "This PC", host: "" }, ...ssh];

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      className={DIALOG_CLASS}
      title={t("browser.title")}
      closeLabel={t("close")}
      footer={
        // dsh's own footer bar, with the box select first: New folder and Show hidden on the
        // left, a gap, Cancel and Open on the right at 72 px minimum. Full width, else the Modal's
        // flex-end footer shrinks the row to its content and the gap has nothing to split.
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", width: "100%" }}
        >
          <select
            style={{ ...selectStyle, maxWidth: 180, height: 36, borderRadius: 18 }}
            value={host}
            disabled={busy}
            aria-label="Box"
            onChange={(e) => {
              setHost(e.target.value);
              setPath("");
            }}
          >
            {boxes.map((b) => (
              <option key={b.host} value={b.host}>
                {b.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            icon={<IconPlusOutline16 size={14} />}
            disabled={busy || !listing}
            onClick={() => setFolder(folder === null ? "" : null)}
          >
            {t("browser.newFolder")}
          </Button>
          <button
            type="button"
            aria-pressed={hidden}
            style={{
              ...btn,
              border: "none",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: "20px",
              whiteSpace: "nowrap",
              color: hidden ? T.text : T.muted,
            }}
            onClick={() => setHidden((v) => !v)}
          >
            {t("browser.showHidden")}
            {hidden && <IconCheckOutline16 size={14} />}
          </button>
          <span style={{ flex: "1 1 0" }} />
          <Button
            variant="outline"
            style={{ minWidth: 72 }}
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            style={{ minWidth: 72 }}
            disabled={busy || target === ""}
            onClick={add}
          >
            {t("browser.open")}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <style>{DIALOG_CSS}</style>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {i > 0 && <IconChevronRightOutline14 size={14} />}
              <button
                type="button"
                style={{
                  ...btn,
                  border: "1px solid transparent",
                  padding: "2px 6px",
                  color: i === crumbs.length - 1 ? T.text : T.muted,
                }}
                onClick={() => setPath(c.path)}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
        {folder !== null && (
          <form
            style={{ display: "flex", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={folder}
              autoFocus
              placeholder={t("browser.folderName")}
              onChange={(e) => setFolder(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={busy || folder.trim() === ""}>
              {t("browser.create")}
            </Button>
          </form>
        )}
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: 4,
          }}
        >
          {listing === null && error === "" && <p style={stateText}>{t("browser.loading")}</p>}
          {listing !== null && rows.length === 0 && <p style={stateText}>No folders here.</p>}
          {rows.map((e) => (
            <button
              key={e.path}
              type="button"
              style={rowStyle(e.path === picked)}
              onClick={() => setPicked(e.path)}
              onDoubleClick={() => setPath(e.path)}
            >
              <IconFolderClose16 size={16} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.name}
              </span>
              {/* The chevron walks into the folder; the row itself only picks it, the way dsh's does. */}
              <span
                role="presentation"
                style={{ display: "flex", color: T.faint }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPath(e.path);
                }}
              >
                <IconChevronRightOutline14 size={14} />
              </span>
            </button>
          ))}
        </div>
        <p style={{ ...stateText, fontFamily: T.mono, fontSize: 11 }}>{target}</p>
        {error !== "" && <p style={errText}>{error}</p>}
      </div>
    </Modal>
  );
}
