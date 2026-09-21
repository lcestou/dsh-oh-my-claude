// The Select Workspace Directory dialog, as dsh draws it, with one seat added.
//
// dsh's own dialog lives in dsh-client-ui-directory-picker-browse and is not exported: the package
// hands its Loader only `apply` and `inject`. Its listing seam takes a path and no host, so a box
// dropdown has to sit inside a dialog this plugin owns. This is that dialog, ported from dsh's
// 0.1.5 DirectoryBrowser so the two are the same to the eye and the hand: the header carries the
// title, the selection-path breadcrumb and a click-to-edit path zone; below it a Miller view, one
// full-width level until a row is selected, then two columns around a hairline divider; New folder
// opens a nested create dialog; the footer bar is New folder and Show hidden on the left, Cancel
// and Open on the right. The one addition is `footerLead`, a node the owner puts first in the
// footer bar, which is where the box select goes. Behaviour ported with the code: navigations land
// selection-anchored and quiet (the previous view keeps rendering while a scan is in flight, then
// the target and its parent land as one two-pane frame), the path editor prefix-filters the last
// pane and walks the panes after a short debounce, and hidden entries obey the footer toggle.
//
// Classes are this plugin's own (`omc-db-*`); dsh's are hashed per build. Every colour is a dsw
// token, so the dialog follows the theme the way dsh's does.
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  Modal,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { DirEntry } from "./shared.js";

/** One directory level plus its ancestry, the shape dsh's host listing answers in. */
export interface Listing {
  path: string;
  home: string;
  /** Ancestor chain from the filesystem root to the level inclusive; every crumb is a jump target. */
  crumbs: DirEntry[];
  entries: DirEntry[];
  /** The backend cut `entries` at its bound; the missing rows are the name-sorted tail. */
  truncated?: boolean;
}

/** Localized copy; `{name}` in a string is filled from `params`. */
export type Translate = (key: string, params?: Record<string, string>) => string;

/** Owner-supplied props, dsh's plus the footer seat. */
export interface DirectoryBrowserProps {
  open: boolean;
  /** List one level (absent path = the home directory); the signal aborts a superseded scan. */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<Listing>;
  /** Create one child directory under an existing parent; answers the created path. */
  createDirectory: (path: string, name: string) => Promise<string>;
  /** The operator confirmed a directory (the selection, else the listed level). */
  onOpen: (path: string) => void;
  /** Close without picking (mask, Escape, Cancel). */
  onClose: () => void;
  /** The owner's confirm is in flight: Open disables, the view freezes. */
  busy: boolean;
  t: Translate;
  /** Rendered first in the footer bar, before New folder. */
  footerLead?: ReactNode;
}

/** What a directory operation rejects with: an Error, or dsh's host business message riding along. */
export type OperationFailure = Error | { rpcError: { message: string } };

/** Failure text from a directory operation, the host business message first when one rides along. */
export const failureText = (error: OperationFailure): string =>
  error instanceof Error ? error.message : error.rpcError.message;

/** How long a scan may stay silent before the floating "Loading…" pill appears. */
const SLOW_SCAN_DELAY_MS = 300;
/** How long a navigation landing waits for its parent leg before committing the target alone. */
const PARENT_LEG_WAIT_MS = 200;
/** How long a typed draft rests before the panes follow it to a directory no pane lists. */
const DRAFT_PREVIEW_DEBOUNCE_MS = 250;

/**
 * Breadcrumb rows for display: inside the home subtree the chain starts at a localized Home
 * crumb; outside it the full ancestry shows, the root labelled by its own path.
 */
export function displayCrumbs(listing: Listing, homeLabel: string): DirEntry[] {
  const homeIndex = listing.crumbs.findIndex((crumb) => crumb.path === listing.home);
  if (homeIndex === -1) return listing.crumbs;
  return [
    { name: homeLabel, path: listing.home, hidden: false },
    ...listing.crumbs.slice(homeIndex + 1),
  ];
}

/** The listing's platform separator, inferred from the home path the host stamped. */
export const separatorOf = (listing: Listing): string => (listing.home.includes("\\") ? "\\" : "/");

/** The listed level as a directory part: its own path, separator-terminated (the root already is). */
const levelDirectory = (listing: Listing): string => {
  const sep = separatorOf(listing);
  return listing.path.endsWith(sep) ? listing.path : `${listing.path}${sep}`;
};

/** The draft's directory part, everything through its last separator, or null before one is typed. */
const draftDirectory = (listing: Listing, draft: string): string | null => {
  const cut =
    separatorOf(listing) === "\\"
      ? Math.max(draft.lastIndexOf("\\"), draft.lastIndexOf("/"))
      : draft.lastIndexOf("/");
  return cut === -1 ? null : draft.slice(0, cut + 1);
};

/** The last draft-following scan: the directory part typed and the level it landed on. */
export interface Scanned {
  directory: string;
  landed: string;
}

/**
 * How the draft reads against one level: the directory part it names, and, when `listing` is the
 * level that part addresses (its own path, or the level that text just produced), the final
 * segment that prefix-filters it.
 */
export interface DraftReading {
  /** The directory part the draft names, null before a separator is typed. */
  directory: string | null;
  /** The final segment that prefix-filters `listing`, null when it does not answer that directory. */
  tail: string | null;
}
/** A draft path split into its directory and the tail that prefix-filters the listing; the tail
 *  null unless the directory is the current level or one the scan just landed in. */
export function readDraft(listing: Listing, draft: string, scanned: Scanned | null): DraftReading {
  const directory = draftDirectory(listing, draft);
  if (directory === null) return { directory: null, tail: null };
  const answers =
    directory === levelDirectory(listing) ||
    (scanned !== null && scanned.directory === directory && scanned.landed === listing.path);
  return { directory, tail: answers ? draft.slice(directory.length) : null };
}

/**
 * The rows one column renders. The selection is exempt from every filter. A prefix narrows the
 * level only while some row it would show matches; a dot-led prefix reveals the hidden rows it
 * names.
 */
export function visibleEntries(
  entries: DirEntry[],
  selectedPath: string | null,
  showHidden: boolean,
  filterPrefix: string | null,
): DirEntry[] {
  const needle = filterPrefix === null ? "" : filterPrefix.toLowerCase();
  const displayable = (entry: DirEntry) => showHidden || !entry.hidden || needle.startsWith(".");
  const matches = (entry: DirEntry) =>
    displayable(entry) && entry.name.toLowerCase().startsWith(needle);
  const narrowing = needle !== "" && entries.some(matches);
  return entries.filter((entry) => {
    if (entry.path === selectedPath) return true;
    if (narrowing) return matches(entry);
    return showHidden || !entry.hidden;
  });
}

const P = "omc-db";
/** Joins the class names, dropping every falsy entry, so a call with only false, null or undefined
 *  returns an empty string rather than a stray space. */
const cls = (...names: (string | false | null | undefined)[]): string =>
  names.filter(Boolean).join(" ");

// dsh's DirectoryBrowser.module.css, on this plugin's class names. The doubled dialog selector
// outranks the Modal card's own padding and gap, as dsh's does.
const CSS = `
.${P}-dialog.${P}-dialog{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);gap:0;width:min(680px,100%);height:min(500px,100dvh - 32px);padding:0}
.${P}-scope{display:contents}
.${P}-header{border-bottom:.5px solid var(--dsw-alias-border-l3);flex-direction:column;flex:none;gap:8px;padding:16px 14px 8px 24px;display:flex}
.${P}-title{min-height:28px;color:var(--dsw-alias-label-primary);align-items:flex-end;margin:0;font-size:16px;font-weight:510;line-height:24px;display:flex}
.${P}-crumbBar{box-sizing:border-box;border:1px solid #0000;border-radius:8px;align-items:center;gap:4px;min-height:24px;margin-left:-9px;padding:0 8px;display:flex}
.${P}-crumbBar:has(.${P}-editZone:enabled:hover),.${P}-crumbBar:has(.${P}-editZone:focus-visible),.${P}-crumbBar:has(.${P}-pathInput){border-color:var(--dsw-alias-border-l2)}
.${P}-miller{scrollbar-width:none;flex:1 1 0;align-items:stretch;gap:12px;min-height:0;display:flex;overflow-x:auto}
.${P}-trail{scrollbar-width:none;flex:0 auto;align-items:center;gap:4px;min-width:0;display:flex;overflow-x:auto}
.${P}-crumbSeat{flex:none;align-items:center;gap:4px;min-width:0;display:inline-flex}
.${P}-crumb{text-overflow:ellipsis;white-space:nowrap;max-width:160px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;padding:0;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}
.${P}-crumb:hover{color:var(--dsw-alias-label-primary)}
.${P}-crumbChevron{color:var(--dsw-alias-label-tertiary);flex:none}
.${P}-editZone{cursor:text;background:0 0;border:none;outline:none;flex:1 0 34px;justify-content:flex-end;align-items:center;min-width:34px;height:22px;padding:0;display:flex}
.${P}-editGlyph{color:var(--dsw-alias-label-tertiary);flex:none}
.${P}-editZone:enabled:hover .${P}-editGlyph,.${P}-editZone:focus-visible .${P}-editGlyph{color:var(--dsw-alias-label-primary)}
.${P}-editZone:disabled{cursor:default}
.${P}-editZone:disabled .${P}-editGlyph{color:var(--dsw-alias-label-caption)}
.${P}-pathInput{box-sizing:border-box;min-width:0;height:22px;color:var(--dsw-alias-label-primary);background:0 0;border:none;outline:none;flex:1 1 0;padding:0;font-size:13px;line-height:20px;font:inherit;font-size:13px}
.${P}-content{flex-direction:column;flex:1 1 0;min-height:0;padding:16px 16px 16px 24px;display:flex;position:relative}
.${P}-column{flex-direction:column;flex:1 1 0;gap:2px;min-width:256px;margin:0;padding:0 8px 0 0;list-style:none;display:flex;overflow-y:auto}
.${P}-divider{background:var(--dsw-alias-border-l3);flex:none;width:.5px}
.${P}-rowSeat{flex:none;display:flex}
.${P}-row{text-align:left;cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;align-items:center;gap:4px;width:100%;height:28px;padding:4px;display:flex;color:inherit;font:inherit}
.${P}-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${P}-rowSelected,.${P}-rowSelected:hover{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover))}
.${P}-rowIcon{color:var(--dsw-alias-label-secondary);flex:none}
.${P}-rowIconSelected{color:var(--dsw-alias-button-info-fill);flex:none}
.${P}-rowName{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-primary);flex:1 1 0;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}
.${P}-rowChevron{color:var(--dsw-alias-label-tertiary);flex:none}
.${P}-status,.${P}-error{padding:4px 120px 4px 4px;font-size:12px;line-height:18px}
.${P}-status{color:var(--dsw-alias-label-secondary)}
.${P}-error{color:var(--dsw-alias-state-error-primary)}
.${P}-loadingFloat{background:var(--dsw-alias-bg-layer-2);padding:2px 8px;position:absolute;bottom:8px;right:16px}
.${P}-footerBar{border-top:.5px solid var(--dsw-alias-border-l3);flex-wrap:wrap;flex:none;align-items:center;gap:8px;padding:16px 24px;display:flex}
.${P}-hidden{color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;align-items:center;gap:4px;padding:0;font-size:13px;font-weight:500;line-height:20px;display:inline-flex;font-family:inherit}
.${P}-hidden:hover{color:var(--dsw-alias-label-primary)}
.${P}-hidden:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.${P}-hiddenOn{color:var(--dsw-alias-label-primary)}
.${P}-gap{flex:1 1 0}
.${P}-action{min-width:72px}
.${P}-create.${P}-create{gap:0;width:min(380px,100%);padding:0}
.${P}-createBody{flex-direction:column;gap:12px;padding:22px 24px 20px;display:flex}
.${P}-createTitle{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:510;line-height:24px}
.${P}-createIn{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;line-height:22px}
.${P}-createInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;line-height:22px;font-family:inherit}
.${P}-createInput::placeholder{color:var(--dsw-alias-label-caption)}
.${P}-createActions{justify-content:flex-end;align-items:center;gap:8px;margin-top:8px;display:flex}
`;

/** One column of folder rows; the Miller view renders one or two. */
function LevelColumn({
  entries,
  selectedPath,
  busy,
  onPick,
  showHidden,
  filterPrefix,
  pathEditing,
}: {
  entries: DirEntry[];
  selectedPath: string | null;
  busy: boolean;
  onPick: (entry: DirEntry) => void;
  showHidden: boolean;
  filterPrefix: string | null;
  /** The path editor is open: a row's mousedown must not steal its focus. */
  pathEditing: boolean;
}) {
  const visible = visibleEntries(entries, selectedPath, showHidden, filterPrefix);
  return (
    <ul className={`${P}-column`}>
      {visible.map((entry) => {
        const selected = entry.path === selectedPath;
        return (
          <li className={`${P}-rowSeat`} key={entry.path}>
            <button
              type="button"
              aria-current={selected || undefined}
              className={cls(`${P}-row`, selected && `${P}-rowSelected`)}
              disabled={busy}
              onMouseDown={pathEditing ? (e) => e.preventDefault() : undefined}
              onClick={() => onPick(entry)}
            >
              {selected ? (
                <IconFolderOpen16 size={16} className={`${P}-rowIconSelected`} />
              ) : (
                <IconFolderClose16 size={16} className={`${P}-rowIcon`} />
              )}
              <span className={`${P}-rowName`}>{entry.name}</span>
              <IconChevronRightOutline14 size={12} className={`${P}-rowChevron`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type Landing = { closeEditor: boolean; announce: boolean };

/** Render the directory-browser dialog; null while closed, via Modal. */
export function DirectoryBrowser({
  open,
  listDirectory,
  createDirectory,
  onOpen,
  onClose,
  busy,
  t,
  footerLead,
}: DirectoryBrowserProps) {
  const [parent, setParent] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<DirEntry | null>(null);
  const [child, setChild] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [slowScan, setSlowScan] = useState(false);
  const [scanWindow, setScanWindow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const scanController = useRef<AbortController | null>(null);
  const openGeneration = useRef(0);
  const crumbTrailRef = useRef<HTMLElement>(null);
  const composingRef = useRef(false);
  useEffect(
    () => () => {
      requestSeq.current += 1;
      openGeneration.current += 1;
      scanController.current?.abort();
    },
    [],
  );
  const compositionGuard = {
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };
  /** Newer intent wins: invalidate the pending listing's settlement and abort its request. */
  const supersede = useCallback(() => {
    scanController.current?.abort();
    scanController.current = null;
    return ++requestSeq.current;
  }, []);
  /** Hide any prior indicator and start a fresh silence window for one listing call. */
  const restartSlowScanWindow = useCallback(() => {
    setSlowScan(false);
    setScanWindow((value) => value + 1);
  }, []);
  /** Launch one listing under a fresh controller so a later supersession can abort it. */
  const launchListing = useCallback(
    (path?: string) => {
      const seq = supersede();
      const controller = new AbortController();
      scanController.current = controller;
      restartSlowScanWindow();
      return { seq, scan: listDirectory(path, controller.signal) };
    },
    [supersede, restartSlowScanWindow, listDirectory],
  );
  /** A follow-up listing under the current seq: a newer intent aborts it like the leg it continues. */
  const continueScan = useCallback(
    (path: string) => {
      const controller = new AbortController();
      scanController.current = controller;
      restartSlowScanWindow();
      return listDirectory(path, controller.signal);
    },
    [restartSlowScanWindow, listDirectory],
  );
  // Enter owns the view from submission until its navigation lands, so the debounce timer the
  // same keystrokes armed must not supersede it. Cleared by the next edit.
  const previewSuspended = useRef(false);
  const viewRef = useRef<{ parent: Listing | null; child: Listing | null }>({
    parent: null,
    child: null,
  });
  useEffect(() => {
    viewRef.current = { parent, child };
  }, [parent, child]);
  const scanned = useRef<Scanned | null>(null);
  // A landed preview replaced the pane a keyboard operator may have Tabbed onto, so the focus it
  // drops is re-parked on the still-open editor (the Modal has no focus trap).
  const refocusPathInput = useRef(false);
  /**
   * Replace the whole view with a freshly scanned level. Away from the display root the landing
   * is two-pane: the target's parent level with the target re-selected, so a crumb jump reads as
   * stepping back one pane. Both legs land as one frame when the parent leg settles within
   * PARENT_LEG_WAIT_MS; past it (a submitted path only) the target commits alone and a late parent
   * leg upgrades the landing in place. Until a commit, the previous view keeps rendering.
   */
  const land = useCallback(
    (path: string | undefined, options: Landing) => {
      const { seq, scan } = launchListing(path);
      setLoading(true);
      if (options.announce) setError(null);
      const settle = () => {
        setLoading(false);
        if (options.closeEditor) {
          setPathDraft(null);
          return;
        }
        setError(null);
        refocusPathInput.current = true;
      };
      scan.then(
        (target) => {
          if (seq !== requestSeq.current) return;
          if (!options.closeEditor && path !== undefined)
            scanned.current = { directory: path, landed: target.path };
          let landed = false;
          const landSingle = () => {
            if (landed || seq !== requestSeq.current) return;
            landed = true;
            setParent(target);
            setSelected(null);
            setChild(null);
            settle();
          };
          if (displayCrumbs(target, "").length < 2) {
            landSingle();
            return;
          }
          const parentCrumb = target.crumbs.at(-2);
          if (parentCrumb === undefined) {
            landSingle();
            return;
          }
          continueScan(parentCrumb.path).then(
            (parentLevel) => {
              if (seq !== requestSeq.current) return;
              const fold = (value: string) =>
                separatorOf(parentLevel) === "\\" ? value.toLowerCase() : value;
              const match = parentLevel.entries.find((e) => fold(e.path) === fold(target.path));
              if (match === undefined) {
                landSingle();
                return;
              }
              landed = true;
              setParent(parentLevel);
              setSelected(match);
              setChild(target);
              settle();
            },
            () => landSingle(),
          );
          if (options.closeEditor) window.setTimeout(landSingle, PARENT_LEG_WAIT_MS);
        },
        (reason: OperationFailure) => {
          if (seq !== requestSeq.current) return;
          setLoading(false);
          if (options.announce) setError(failureText(reason));
        },
      );
    },
    [launchListing, continueScan],
  );
  /** Commit a submitted path (Enter, a crumb, the initial home listing): the editor closes, failures surface. */
  const navigate = useCallback(
    (path?: string) => land(path, { closeEditor: true, announce: true }),
    [land],
  );
  const refocusPick = useRef(false);
  const refocusEditZone = useRef(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const editZoneRef = useRef<HTMLButtonElement>(null);
  /** Select a row of the listed level and preview its children on the right. */
  const select = useCallback(
    (entry: DirEntry) => {
      const { seq, scan } = launchListing(entry.path);
      if (pathDraft !== null) refocusPick.current = true;
      setPathDraft(null);
      setSelected(entry);
      setChild(null);
      setLoading(true);
      setError(null);
      scan.then(
        (next) => {
          if (seq !== requestSeq.current) return;
          setChild(next);
          setLoading(false);
        },
        (reason: OperationFailure) => {
          if (seq !== requestSeq.current) return;
          setLoading(false);
          setError(failureText(reason));
          setSelected(null);
          refocusEditZone.current = true;
        },
      );
    },
    [launchListing, pathDraft],
  );
  /** Walk the panes to the directory the draft addresses, without closing the editor. */
  const previewDraftLevel = useCallback(
    (directory: string) => land(directory, { closeEditor: false, announce: false }),
    [land],
  );
  /** Abandon path editing (Escape or clicking away) and restore the crumb view. */
  const cancelPathEdit = useCallback(() => {
    supersede();
    setLoading(false);
    setPathDraft(null);
    setError(null);
    if (child === null) setSelected(null);
    if (parent === null) navigate();
  }, [supersede, child, parent, navigate]);
  /** A right-column pick advances the view one level: child becomes the level. */
  const advance = useCallback(
    (entry: DirEntry) => {
      if (child === null) return;
      setParent(child);
      select(entry);
    },
    [child, select],
  );
  useEffect(() => {
    openGeneration.current += 1;
    if (open) {
      setParent(null);
      setSelected(null);
      setChild(null);
      setCreatingFolder(false);
      setShowHidden(false);
      navigate();
      return;
    }
    supersede();
    setLoading(false);
    setError(null);
    setPathDraft(null);
    setFolderDraft(null);
    setCreateError(null);
    refocusPick.current = false;
    refocusEditZone.current = false;
  }, [open, navigate, supersede]);
  /** The folder a create or Open acts on: the selection, else the listed level. */
  const targetPath = selected?.path ?? parent?.path ?? null;
  const targetName =
    selected?.name ??
    (parent === null ? "" : (displayCrumbs(parent, t("browser.home")).at(-1)?.name ?? parent.path));
  const confirmCreate = () => {
    if (targetPath === null || folderDraft === null || creatingFolder) return;
    const name = folderDraft;
    if (name.trim() === "") return;
    setCreatingFolder(true);
    setCreateError(null);
    const generation = openGeneration.current;
    createDirectory(targetPath, name).then(
      (createdPath) => {
        if (generation !== openGeneration.current) return;
        setCreatingFolder(false);
        setFolderDraft(null);
        const { seq, scan } = launchListing(targetPath);
        setLoading(true);
        setError(null);
        scan.then(
          (level) => {
            if (seq !== requestSeq.current) return;
            setParent(level);
            setLoading(false);
            select({ name, path: createdPath, hidden: false });
          },
          (reason: OperationFailure) => {
            if (seq !== requestSeq.current) return;
            setLoading(false);
            setError(failureText(reason));
          },
        );
      },
      (reason: OperationFailure) => {
        if (generation !== openGeneration.current) return;
        setCreatingFolder(false);
        setCreateError(failureText(reason));
      },
    );
  };
  useEffect(() => {
    if (!loading) {
      setSlowScan(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowScan(true), SLOW_SCAN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading, scanWindow]);
  useEffect(() => {
    if (pathDraft === null) return;
    const timer = window.setTimeout(() => {
      if (previewSuspended.current) return;
      const current = viewRef.current.child ?? viewRef.current.parent;
      if (current === null) return;
      const { directory, tail } = readDraft(current, pathDraft, scanned.current);
      if (directory === null || tail !== null) return;
      previewDraftLevel(directory);
    }, DRAFT_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [pathDraft, previewDraftLevel]);
  const crumbSource = child ?? parent;
  const typedPrefix =
    crumbSource === null || pathDraft === null
      ? null
      : readDraft(crumbSource, pathDraft, scanned.current).tail;
  const crumbs = crumbSource === null ? [] : displayCrumbs(crumbSource, t("browser.home"));
  const crumbTail = crumbs.at(-1)?.path;
  useEffect(() => {
    const trail = crumbTrailRef.current;
    if (trail !== null) trail.scrollLeft = trail.scrollWidth;
  }, [crumbTail]);
  const millerRowRef = useRef<HTMLDivElement>(null);
  const childPath = child?.path;
  useEffect(() => {
    const row = millerRowRef.current;
    if (row !== null && childPath !== undefined) row.scrollLeft = row.scrollWidth;
  }, [childPath]);
  useEffect(() => {
    if (refocusPathInput.current) {
      refocusPathInput.current = false;
      if (document.activeElement === document.body) pathInputRef.current?.focus();
    }
    if (pathDraft !== null) return;
    if (refocusPick.current) {
      refocusPick.current = false;
      refocusEditZone.current = false;
      const row = millerRowRef.current?.querySelector<HTMLElement>('button[aria-current="true"]');
      row?.focus();
      return;
    }
    if (refocusEditZone.current) {
      refocusEditZone.current = false;
      if (document.activeElement !== document.body) return;
      editZoneRef.current?.focus();
    }
  });
  if (!open) return null;
  const twoPane = selected !== null;
  const parentInert = busy || folderDraft !== null;
  const draftPending = pathDraft !== null;
  const onEnter = (e: ReactKeyboardEvent<HTMLInputElement>, run: () => void) => {
    if (e.key === "Enter" && !composingRef.current) {
      e.preventDefault();
      run();
    }
  };
  const editZoneStyle: CSSProperties = { font: "inherit" };
  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          if (folderDraft === null && !busy) onClose();
        }}
        title={t("browser.title")}
        className={`${P}-dialog`}
        headless
      >
        <style>{CSS}</style>
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- catches Escape bubbling up from the path field inside, not a control of its own */}
        <div
          className={`${P}-scope`}
          data-omc-browser=""
          onKeyDown={(e) => {
            if (e.key !== "Escape" || pathDraft === null) return;
            e.stopPropagation();
            refocusEditZone.current = document.activeElement === pathInputRef.current;
            cancelPathEdit();
          }}
          onBlur={(e) => {
            if (pathDraft === null) return;
            if (!document.hasFocus()) return;
            const card = e.currentTarget.closest('[role="dialog"]');
            if (card === null) return;
            if (e.relatedTarget instanceof Node && card.contains(e.relatedTarget)) return;
            refocusEditZone.current = false;
            cancelPathEdit();
          }}
        >
          <div className={`${P}-header`}>
            <h2 className={`${P}-title`}>{t("browser.title")}</h2>
            <div className={`${P}-crumbBar`}>
              {pathDraft === null ? (
                <>
                  {/* English on purpose: dsh's dictionary has no key for this, and its lookup may
                      answer an unknown key with the key itself rather than falling back. */}
                  <nav className={`${P}-trail`} aria-label="Folder path" ref={crumbTrailRef}>
                    {crumbs.map((crumb, index) => (
                      <span className={`${P}-crumbSeat`} key={crumb.path}>
                        {index > 0 && (
                          <IconChevronRightOutline14 size={12} className={`${P}-crumbChevron`} />
                        )}
                        <button
                          type="button"
                          className={`${P}-crumb`}
                          style={editZoneStyle}
                          disabled={parentInert}
                          onClick={() => navigate(crumb.path)}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))}
                  </nav>
                  <button
                    type="button"
                    className={`${P}-editZone`}
                    aria-label={t("browser.editPath")}
                    title={t("browser.editPath")}
                    disabled={parentInert}
                    ref={editZoneRef}
                    onClick={() => {
                      supersede();
                      setLoading(false);
                      previewSuspended.current = false;
                      if (parent === null) {
                        setPathDraft("");
                        return;
                      }
                      const base = selected?.path ?? parent.path;
                      const sep = separatorOf(parent);
                      setPathDraft(base.endsWith(sep) ? base : `${base}${sep}`);
                    }}
                  >
                    <IconEditOutline16 size={14} className={`${P}-editGlyph`} />
                  </button>
                </>
              ) : (
                <input
                  className={`${P}-pathInput`}
                  value={pathDraft}
                  aria-label={t("browser.editPath")}
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click on the path, so focus goes where they asked
                  autoFocus
                  ref={pathInputRef}
                  disabled={parentInert}
                  onChange={(e) => {
                    supersede();
                    setLoading(false);
                    previewSuspended.current = false;
                    setPathDraft(e.target.value);
                  }}
                  {...compositionGuard}
                  onKeyDown={(e) =>
                    onEnter(e, () => {
                      if (pathDraft.trim() !== "") {
                        refocusEditZone.current = true;
                        previewSuspended.current = true;
                        navigate(pathDraft);
                      }
                    })
                  }
                />
              )}
            </div>
          </div>
          <div className={`${P}-content`}>
            <div className={`${P}-miller`} ref={millerRowRef}>
              {parent !== null && (
                <LevelColumn
                  entries={parent.entries}
                  selectedPath={selected?.path ?? null}
                  busy={parentInert}
                  onPick={select}
                  showHidden={showHidden}
                  filterPrefix={child === null ? typedPrefix : null}
                  pathEditing={draftPending}
                />
              )}
              {twoPane && <span className={`${P}-divider`} />}
              {twoPane && child !== null && (
                <LevelColumn
                  entries={child.entries}
                  selectedPath={null}
                  busy={parentInert}
                  onPick={advance}
                  showHidden={showHidden}
                  filterPrefix={typedPrefix}
                  pathEditing={draftPending}
                />
              )}
            </div>
            {loading &&
              slowScan && (
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
                <div className={cls(`${P}-status`, `${P}-loadingFloat`)} role="status">
                  {t("browser.loading")}
                </div>
              )}
            {(parent?.truncated === true || child?.truncated === true) && (
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a live notice, not a form result, which is what <output> is for
              <div className={`${P}-status`} role="status">
                {t("browser.truncated")}
              </div>
            )}
            {error !== null && (
              <div className={`${P}-error`} role="alert">
                {error}
              </div>
            )}
          </div>
          <div className={`${P}-footerBar`}>
            {footerLead}
            <Button
              variant="outline"
              icon={<IconPlusOutline16 size={14} />}
              disabled={parent === null || loading || parentInert || draftPending}
              onClick={() => {
                setFolderDraft("");
                setCreateError(null);
              }}
            >
              {t("browser.newFolder")}
            </Button>
            <button
              type="button"
              className={cls(`${P}-hidden`, showHidden && `${P}-hiddenOn`)}
              aria-pressed={showHidden}
              disabled={parentInert}
              onMouseDown={draftPending ? (e) => e.preventDefault() : undefined}
              onClick={() => setShowHidden((prev) => !prev)}
            >
              {t("browser.showHidden")}
              {showHidden && <IconCheckOutline16 size={14} />}
            </button>
            <span className={`${P}-gap`} />
            <Button
              variant="outline"
              className={`${P}-action`}
              disabled={parentInert}
              onClick={onClose}
            >
              {t("browser.cancel")}
            </Button>
            <Button
              variant="primary"
              className={`${P}-action`}
              disabled={targetPath === null || loading || parentInert || draftPending}
              onClick={() => {
                if (targetPath !== null) onOpen(targetPath);
              }}
            >
              {t("browser.open")}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={folderDraft !== null}
        onClose={() => {
          if (!creatingFolder) setFolderDraft(null);
        }}
        title={t("browser.newFolder")}
        className={`${P}-create`}
        headless
      >
        <div className={`${P}-createBody`}>
          <h3 className={`${P}-createTitle`}>{t("browser.newFolder")}</h3>
          <p className={`${P}-createIn`}>{t("browser.createIn", { name: targetName })}</p>
          <input
            className={`${P}-createInput`}
            value={folderDraft ?? ""}
            aria-label={t("browser.folderName")}
            placeholder={t("browser.untitledFolder")}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened by the person's own click, so focus goes where they asked
            autoFocus
            disabled={creatingFolder}
            onChange={(e) => setFolderDraft(e.target.value)}
            {...compositionGuard}
            onKeyDown={(e) => {
              onEnter(e, confirmCreate);
              if (e.key === "Escape") {
                e.stopPropagation();
                if (!creatingFolder) setFolderDraft(null);
              }
            }}
          />
          {createError !== null && (
            <div className={`${P}-error`} role="alert">
              {createError}
            </div>
          )}
          <div className={`${P}-createActions`}>
            <Button
              variant="outline"
              disabled={creatingFolder}
              onClick={() => setFolderDraft(null)}
            >
              {t("browser.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={creatingFolder || folderDraft === null || folderDraft.trim() === ""}
              onClick={confirmCreate}
            >
              {t("browser.create")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
