// Add workspace, on this PC or on a connected box.
//
// dsh's sidebar "+" opens its own Select Workspace Directory dialog, which can only ever show this
// PC: its listing seam takes a path and no host. So when at least one SSH box is saved, this takes
// that button over and shows the same dialog (`browser.tsx`, ported from dsh's) with one extra
// control first in the footer bar, a box dropdown whose default is the local box. Picking the local box is the three clicks it always was
// and goes through dsh's own `uiWorkspace.listDirectory` plus `workspaces.create`; picking a box
// lists that box's directories over ssh (`/box-dirs`) and adds the workspace through the plugin's
// own remote-workspaces route, which pins a dsh workspace to a remote path.
//
// With no box saved the takeover never engages and dsh's dialog is left alone.
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import { IconChevronDownOutlineRegular } from "./icons.js";
import {
  ROUTE,
  T,
  readJson,
  type ClientCtx,
  type DirEntry,
  type DirectoryFlowOwnerProps,
  type LocaleFace,
  type UiWorkspaceFace,
} from "./shared.js";
import { DirectoryBrowser, type Listing, type Translate } from "./browser.js";
import { t as omcT, useLocale } from "./i18n.js";

/** dsh's directory UI service, absent on a dsh that mounts no workspace UI. */
const uiWorkspaceOf = (ctx: ClientCtx): UiWorkspaceFace | undefined =>
  ctx.get?.<UiWorkspaceFace>("uiWorkspace");

/** dsh's locale registry, absent on a dsh that mounts no locale service. */
const localeOf = (ctx: ClientCtx): LocaleFace | undefined => ctx.get?.<LocaleFace>("locale");

/** Whether this dsh can browse directories at all, which is what the takeover needs to be worth it. */
export const canBrowseDirs = (ctx: ClientCtx): boolean => uiWorkspaceOf(ctx) !== undefined;

/** dsh's selector trigger (its permission-default dropdown): a 36 px capsule on the platform fill. */
const selectorStyle: CSSProperties = {
  background: "var(--dsw-alias-bg-module-platform, rgba(128,128,128,.1))",
  height: 36,
  font: "inherit",
  fontSize: 14,
  lineHeight: "22px",
  color: T.text,
  cursor: "pointer",
  border: "none",
  borderRadius: 18,
  alignItems: "center",
  gap: 12,
  padding: "0 14px",
  display: "inline-flex",
  whiteSpace: "nowrap",
};

/** A box the dropdown offers; `host` is empty for this PC. */
interface BoxRow {
  name: string;
  host: string;
}

/** Splits a path on `/` and drops the empty pieces, so a leading or doubled slash does not feed a
 *  blank segment to the ancestry chain. */
const segments = (p: string): string[] => p.split("/").filter(Boolean);

/**
 * The ancestor chain of a remote path, root first, in the shape dsh's host stamps on a listing:
 * the root crumb named by its own path, every crumb a jump target. `/box-dirs` answers a level
 * without one, and the dialog's breadcrumb (and its Home collapse) reads it from here.
 */
export const ancestry = (path: string): DirEntry[] => {
  const crumbs: DirEntry[] = [{ name: "/", path: "/", hidden: false }];
  let at = "";
  for (const name of segments(path)) {
    at = `${at}/${name}`;
    crumbs.push({ name, path: at, hidden: false });
  }
  return crumbs;
};

/** The last segment of a path, which is the name a remote workspace takes. */
export const baseName = (path: string): string => segments(path).at(-1) ?? "";

/** A create failure in the click fallback: the dialog stays open and re-enables Open, so no surface
 *  needs the message; kept module-scoped so the no-op is not rebuilt per render. */
const noop = (): void => {};

/** What Settings dispatches to open this dialog; see the takeover effect below. */
export const OPEN_EVENT = "omc-add-workspace";
/** What this dialog dispatches once a remote workspace is saved, so the Settings card lists it. */
export const RW_EVENT = "omc-remote-workspaces";
/** What the Boxes card dispatches after saving the ssh box list, so this dialog's takeover engages
 *  for a first box, or lets go after the last, without a reload. */
export const BOXES_EVENT = "omc-ssh-boxes";

/** dsh's own dialog copy, and its English fallback when the locale service is not mounted. */
const DIALOG_EN = {
  "browser.title": "Select Workspace Directory",
  "browser.home": "Home",
  "browser.newFolder": "New folder",
  "browser.folderName": "Folder name",
  "browser.createIn": 'New folder in "{name}"',
  "browser.untitledFolder": "Untitled folder",
  "browser.create": "Create",
  "browser.cancel": "Cancel",
  "browser.open": "Open",
  "browser.editPath": "Edit path",
  "browser.loading": "Loading…",
  "browser.truncated": "Too many folders to list; only the beginning is shown.",
  "browser.showHidden": "Show hidden files",
} satisfies Record<string, string>;

/**
 * Read the Add workspace dialog's copy from dsh's own dictionaries, so the takeover speaks the
 * language the dialog it replaces spoke. `directory-browser` is the namespace
 * dsh-client-ui-directory-picker-browse registers. `{name}` is filled here, whichever side the
 * string came from.
 */
const copyOf = (ctx: ClientCtx): Translate => {
  const t = localeOf(ctx)?.bind("directory-browser");
  return (key, params) => {
    // SAFETY: every key this dialog reads is a DIALOG_EN key; an unknown one reads as itself.
    const raw = (t ? t(key) : undefined) || DIALOG_EN[key as keyof typeof DIALOG_EN] || key;
    return params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m) : raw;
  };
};

/** One directory level from whichever box is picked; a remote level gets its ancestry here. */
const level = async (
  ctx: ClientCtx,
  host: string,
  path: string | undefined,
  signal?: AbortSignal,
): Promise<Listing> => {
  if (host === "") {
    const l = await uiWorkspaceOf(ctx)?.listDirectory(path, signal);
    if (!l) throw new Error(omcT("picker.noListing"));
    return l;
  }
  const r = await fetch(
    `${ROUTE}/box-dirs?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path ?? "")}`,
    { signal },
  );
  const l = await readJson<{ path: string; home: string; entries: DirEntry[] }>(r);
  return { ...l, crumbs: ancestry(l.path) };
};

/** Create one folder on whichever box is picked; answers the created path. */
const mkdir = async (ctx: ClientCtx, host: string, path: string, name: string): Promise<string> => {
  if (host === "") {
    const made = uiWorkspaceOf(ctx)?.createDirectory(path, name);
    if (!made) throw new Error(omcT("picker.noListing"));
    return made;
  }
  const r = await fetch(`${ROUTE}/box-dirs?host=${encodeURIComponent(host)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
  return (await readJson<{ path: string }>(r)).path;
};

/**
 * The Select Workspace Directory dialog with its box dropdown, in the shape dsh draws it. Owns the
 * ssh list, the current box and the create-in-flight guard, and routes a pick through this PC
 * (`workspaces.create`) or a remote box (`/remote-workspaces`), calling back with the outcome. Both
 * the slot occupant and the click fallback render this, so the dialog is identical whichever opened
 * it. `busy` is the owner's adoption state; `submitting` is this dialog's own create, and either
 * disables the commit and the box dropdown.
 */
function WorkspaceDialog({
  open,
  busy,
  ctx,
  onPicked,
  onError,
  onClosed,
  adoptsLocal,
}: {
  open: boolean;
  busy: boolean;
  ctx: ClientCtx;
  /** A local pick: with `adoptsLocal` the path is handed over as is and the caller creates the
   *  workspace (dsh's directory-flow owner); without it the dialog creates it first. */
  onPicked: (path: string) => void;
  onError: (message: string) => void;
  /** The dialog is done: a dismiss, or a remote workspace saved (which dsh's owner must not adopt as
   *  a local path). */
  onClosed: () => void;
  adoptsLocal: boolean;
}) {
  useLocale();
  const [ssh, setSsh] = useState<BoxRow[]>([]);
  // Empty host means this PC, which is what the dropdown opens on.
  const [host, setHost] = useState("");
  // Bumped with the host so the dialog relists from that box's home on a switch.
  const [generation, setGeneration] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // A pick is in flight: disables Open so a double click cannot start two creates.
  const [submitting, setSubmitting] = useState(false);
  const t = copyOf(ctx);

  // The list was read once at mount, so a box added in Settings left the takeover off until a
  // reload. It now rereads when the Boxes card saves, and when the tab comes back into view, which
  // covers a box added from another tab or device.
  useEffect(() => {
    const load = () =>
      fetch(`${ROUTE}/ssh-boxes`)
        .then((r) => readJson<{ boxes?: BoxRow[] }>(r))
        .then((b) => setSsh(b.boxes ?? []))
        .catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener(BOXES_EVENT, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(BOXES_EVENT, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Stable per host: the dialog relists when these change, which is what a box switch wants.
  const listDirectory = useCallback(
    (path?: string, signal?: AbortSignal) => level(ctx, host, path, signal),
    [ctx, host],
  );
  const createDirectory = useCallback(
    (path: string, name: string) => mkdir(ctx, host, path, name),
    [ctx, host],
  );

  // A pick on whichever box is picked: optimistically guard, then create locally or remotely. The
  // remote route names the workspace after the directory and appends the host itself, and the row
  // is committed before the Settings card rereads, so the new remote workspace lists.
  const add = (target: string) => {
    if (submitting || busy) return;
    setSubmitting(true);
    const done = () => {
      setSubmitting(false);
      onPicked(target);
    };
    const failed = (message: string) => {
      setSubmitting(false);
      onError(message);
    };
    if (host === "") {
      // dsh's owner creates the workspace from the path it is handed; creating it here as well
      // would register the same directory twice.
      if (adoptsLocal) {
        setSubmitting(false);
        onPicked(target);
        return;
      }
      ctx.workspaces.create({ path: target }).then(done).catch(failed);
      return;
    }
    // A remote path is never handed to dsh's owner: it would adopt it as a directory on this PC.
    // The route pins the workspace to the box, then the dialog just closes.
    fetch(`${ROUTE}/remote-workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: baseName(target) || host, host, remoteCwd: target }),
    })
      .then((r) => readJson<{ workspace?: unknown }>(r))
      .then(() => window.dispatchEvent(new Event(RW_EVENT)))
      .then(() => {
        setSubmitting(false);
        onClosed();
      })
      .catch(failed);
  };

  const boxes: BoxRow[] = [{ name: omcT("picker.thisBox"), host: "" }, ...ssh];
  const current = boxes.find((b) => b.host === host) ?? boxes[0];
  return (
    <DirectoryBrowser
      // Remount on a box switch: the dialog lists its home on open, and a new box is a new open.
      key={generation}
      open={open}
      busy={busy || submitting}
      listDirectory={listDirectory}
      createDirectory={createDirectory}
      onOpen={add}
      onClose={onClosed}
      t={t}
      footerLead={
        // dsh's Menu on a selector-shaped trigger, the way its own settings dropdowns are built
        // (a 36 px capsule, label and chevron), so the box list drops down as dsh's lists do.
        <Menu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          items={boxes.map((b) => ({ id: b.host, label: b.name }))}
          selectedId={host}
          onSelect={(id) => {
            setMenuOpen(false);
            if (id === host) return;
            setHost(id);
            setGeneration((n) => n + 1);
          }}
          side="top"
          portal
          anchor={
            <button
              type="button"
              style={selectorStyle}
              aria-label={omcT("picker.box")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy || submitting}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {current?.name}
              <IconChevronDownOutlineRegular />
            </button>
          }
        />
      }
    />
  );
}

/**
 * The directory picker as dsh's slot occupant: the dialog runs off the owner's `open` flag, and the
 * owner adopts a pick via `onPicked`, closes it via `onCancel`, and shows a failure via `onError`.
 * The Settings card opens it by event (OPEN_EVENT) since it has no React parent with the sidebar, so
 * a local `forcedOpen` covers that path. Registration into the slot is what makes the dialog dsh's
 * on every version; this component is the slot path, and AddWorkspaceFlow is the click fallback.
 */
export function AddWorkflow({
  open,
  busy,
  onPicked,
  onCancel,
  onError,
  ctx,
}: DirectoryFlowOwnerProps & { ctx: ClientCtx }) {
  const [forcedOpen, setForcedOpen] = useState(false);

  // The Settings card lists remote workspaces but has no shared React tree with the sidebar, so it
  // opens this dialog by event rather than through the owner's `open`.
  useEffect(() => {
    const start = () => setForcedOpen(true);
    document.addEventListener(OPEN_EVENT, start);
    return () => {
      document.removeEventListener(OPEN_EVENT, start);
    };
  }, []);

  // A pick from a dialog dsh opened is handed to the owner, which creates the workspace. A pick
  // from a Settings-forced open has already been created by the dialog itself (`adoptsLocal` is
  // off there), so it only closes: handing the path on as well made dsh create the same workspace
  // a second time (pr-review, #98).
  const adopt = (path: string) => {
    if (forcedOpen) {
      setForcedOpen(false);
      return;
    }
    onPicked(path);
  };

  // Dismiss withdraws the flow: the forced-open dialog closes on its own, the owner's closes via
  // onCancel.
  const dismiss = () => {
    if (forcedOpen) setForcedOpen(false);
    else onCancel();
  };

  return (
    <WorkspaceDialog
      open={open || forcedOpen}
      busy={busy}
      ctx={ctx}
      onPicked={adopt}
      onError={onError}
      onClosed={dismiss}
      // A dialog dsh opened hands the path back for dsh to adopt; one Settings forced open has no
      // owner request behind it, so it creates the workspace itself.
      adoptsLocal={!forcedOpen}
    />
  );
}

/**
 * Renderless fallback for an older dsh that refuses the slot occupant: it takes dsh's Add workspace
 * button over by capture-click, so the dialog it opens is this plugin's and the click never reaches
 * dsh's own flow. Only engages when at least one SSH box is saved, which is what makes the box
 * dropdown worth the takeover; without one dsh's own local-only dialog is left alone. Mounted at the
 * sidebar footer, where a root-scoped entry stays mounted whether the sidebar is wide or collapsed.
 */
export function AddWorkspaceFlow({ ctx }: { ctx: ClientCtx }) {
  const [ssh, setSsh] = useState<BoxRow[]>([]);
  // The dialog is open only from the capture-click or the Settings event; the owner drives it in the
  // slot path, so this fallback owns its own open flag.
  const [open, setOpen] = useState(false);

  // The list was read once at mount, so a box added in Settings left the takeover off until a
  // reload. It now rereads when the Boxes card saves, and when the tab comes back into view, which
  // covers a box added from another tab or device.
  useEffect(() => {
    const load = () =>
      fetch(`${ROUTE}/ssh-boxes`)
        .then((r) => readJson<{ boxes?: BoxRow[] }>(r))
        .then((b) => setSsh(b.boxes ?? []))
        .catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener(BOXES_EVENT, load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(BOXES_EVENT, load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Take dsh's button over. A capture listener on the document runs before React's own root
  // listener, so one handler covers both the sidebar header button and its collapsed twin, and it
  // keeps working when dsh re-renders them through the same elements. The label is dsh's own
  // translation of `workspace.add`, so the selector follows the reader's language.
  useEffect(() => {
    if (ssh.length === 0 || !uiWorkspaceOf(ctx)) return;
    const label = localeOf(ctx)?.bind("workspace")("workspace.add") || "Add workspace";
    const start = () => setOpen(true);
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

  // A pick just closes the dialog; the create already ran inside the dialog. A failure leaves it
  // open (the dialog re-enables Open), matching the pre-slot behavior, so the operator can retry.
  const adopt = () => setOpen(false);
  const fail = noop;

  return (
    <WorkspaceDialog
      open={open}
      busy={false}
      ctx={ctx}
      onPicked={adopt}
      onError={fail}
      onClosed={() => setOpen(false)}
      adoptsLocal={false}
    />
  );
}
