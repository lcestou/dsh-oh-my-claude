window.__ModuleLoader__.load({ id: "dsh-oh-my-claude", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/client/index.tsx
var exports_client = {};
__export(exports_client, {
  apply: () => apply,
  cacheShare: () => cacheShare,
  fmtCost: () => fmtCost,
  fmtDuration: () => fmtDuration,
  inject: () => inject,
  isOwnedActive: () => isOwnedActive,
  mergeVerbs: () => mergeVerbs,
  name: () => name,
  pageSessions: () => pageSessions,
  pickVerb: () => pickVerb,
  summarize: () => summarize
});
module.exports = __toCommonJS(exports_client);
var import_react3 = require("react");

// src/client/shared.ts
var import_react = require("react");
var ROUTE = "/dsh-oh-my-claude";
var fmtCost = (usd) => `$${usd.toFixed(2)}`;
var fmtDuration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0)
    return `${sec}s`;
  if (sec === 0)
    return `${m}m`;
  return `${m}m ${sec}s`;
};
var cacheShare = ({
  input,
  cacheRead,
  cacheWrite
}) => {
  const denom = input + cacheRead + cacheWrite;
  if (denom === 0)
    return 0;
  return Math.max(0, Math.min(1, cacheRead / denom));
};
var ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600)
    return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400)
    return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};
var T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1))",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)"
};
var CLAUDE_ORANGE = "#D97757";
var CLAUDE_SHIMMER = "#F59575";
var CLAUDE_MARK = "✻";
var card = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14
};
var cardHead = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap"
};
var h3 = { margin: 0, fontSize: 15, fontWeight: 600, color: T.text };
var meta = { color: T.faint, fontSize: 12, whiteSpace: "nowrap" };
var row = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "9px 0",
  borderTop: `1px solid ${T.border}`
};
var btn = {
  padding: "5px 12px",
  cursor: "pointer",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.text,
  fontSize: 13,
  whiteSpace: "nowrap"
};
var btnPrimary = {
  ...btn,
  background: T.brand,
  color: T.onBrand,
  border: "1px solid transparent"
};
var pill = (color) => ({
  display: "inline-block",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.2,
  color,
  border: `1px solid ${color}`,
  opacity: 0.9,
  whiteSpace: "nowrap"
});
var chip = (active, disabled) => ({
  ...btn,
  padding: "3px 10px",
  fontSize: 12,
  borderRadius: 999,
  background: active ? T.brand : "transparent",
  color: active ? T.onBrand : disabled ? T.faint : T.text,
  border: `1px solid ${active ? "transparent" : T.border}`,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1
});
var select = {
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontSize: 13,
  maxWidth: 260
};
var inputStyle = { ...select, minWidth: 0, flex: 1 };
var code = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontFamily: T.mono,
  fontSize: 13,
  lineHeight: 1.5,
  tabSize: 2,
  whiteSpace: "pre"
};
var readJson = async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};
var isOwnedActive = (s) => !!s.dsh?.id && !s.dsh.archived;
async function openHere(ctx, s, cwd) {
  const known = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  const id = s.dsh?.id ?? s.id;
  if (s.dsh?.archived || !s.dsh && !known()[id]) {
    await readJson(await fetch(`${ROUTE}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, id: s.id })
    }));
    if (!s.dsh) {
      const ws = (ctx.workspaces.list.getSnapshot()?.items ?? []).find((w) => w.path === cwd);
      await ctx.sessions.create(ws ? { sessionId: id, workspaceId: ws.workspaceId } : { sessionId: id });
    }
  }
  ctx.sessions.open(id);
}
var isRingRoot = (el) => !!el?.querySelector(':scope > button[aria-haspopup="dialog"] circle + circle');
var activeClaudeSession = (ctx) => {
  const id = ctx.sessions.list.getSnapshot()?.current;
  if (!id)
    return;
  try {
    const provider = ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider;
    return provider && provider.startsWith("claude-code") ? id : undefined;
  } catch {
    return;
  }
};
var activeClaudeProvider = (ctx) => {
  const id = ctx.sessions.list.getSnapshot()?.current;
  if (!id)
    return;
  try {
    const provider = ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider;
    return provider && provider.startsWith("claude-code") ? provider : undefined;
  } catch {
    return;
  }
};
var popover = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: 0,
  width: 440,
  zIndex: 40,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 280,
  overflowY: "auto",
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: 6,
  boxShadow: "0 8px 24px rgba(0,0,0,.18)"
};
var bodyFlow = { display: "flex", flexDirection: "column", gap: 4 };
function useDismiss(open, close, root) {
  import_react.useEffect(() => {
    if (!open)
      return;
    const onDown = (e) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        close();
    };
    const onKey = (e) => {
      if (e.key === "Escape")
        close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, root]);
}
function useNarrow() {
  const [narrow, setNarrow] = import_react.useState(() => window.matchMedia("(max-width: 640px)").matches);
  import_react.useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const onChange = (e) => setNarrow(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

// src/client/panel.tsx
var import_react2 = require("react");
var jsx_runtime = require("react/jsx-runtime");
var lastTab = "Memory";
function TranscriptRow({
  s,
  cwd,
  ctx,
  onClose
}) {
  const label = s.title ?? s.id;
  return /* @__PURE__ */ jsx_runtime.jsxs("button", {
    type: "button",
    style: {
      ...btn,
      display: "flex",
      alignItems: "center",
      width: "100%",
      textAlign: "left",
      padding: "5px 10px",
      overflow: "hidden"
    },
    onClick: async () => {
      await openHere(ctx, s, cwd);
      onClose();
    },
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: {
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        },
        children: label
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, flex: "none", marginLeft: 8 },
        children: ago(s.modifiedAt)
      })
    ]
  });
}
function RestoreBody({
  sessionId,
  ctx,
  onClose
}) {
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const cwd = entry?.cwd;
  const [transcripts, setTranscripts] = import_react2.useState([]);
  import_react2.useEffect(() => {
    if (!cwd)
      return;
    let live = true;
    fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(cwd)}`).then((r) => readJson(r)).then((body) => live && setTranscripts(body.sessions ?? [])).catch(() => live && setTranscripts([]));
    return () => {
      live = false;
    };
  }, [cwd]);
  if (!cwd || entry?.blank === false)
    return null;
  const owned = transcripts.filter(isOwnedActive);
  const rest = transcripts.filter((s) => !isOwnedActive(s)).slice(0, 8);
  if (rest.length === 0)
    return null;
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: bodyFlow,
    children: [
      rest.map((s) => /* @__PURE__ */ jsx_runtime.jsx(TranscriptRow, {
        s,
        cwd,
        ctx,
        onClose
      }, s.id)),
      owned.length > 0 && /* @__PURE__ */ jsx_runtime.jsxs("span", {
        style: { fontSize: 11, color: T.faint, padding: "2px 4px" },
        children: [
          owned.length,
          " already open"
        ]
      })
    ]
  });
}
function MemoryBody({
  sessionId,
  ctx,
  onCount
}) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = import_react2.useState([]);
  const [file, setFile] = import_react2.useState(null);
  const [text, setText] = import_react2.useState("");
  const [saved, setSaved] = import_react2.useState("");
  const [busy, setBusy] = import_react2.useState(false);
  const [error, setError] = import_react2.useState("");
  const q = cwd ? `cwd=${encodeURIComponent(cwd)}` : "";
  const refresh = () => {
    if (!cwd)
      return;
    fetch(`${ROUTE}/memory?${q}`).then((r) => readJson(r)).then((b) => {
      setFiles(b.files ?? []);
      onCount?.(b.files?.length ?? 0);
    }).catch((e) => setError(e.message));
  };
  import_react2.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [cwd, onCount]);
  const openFile = async (n) => {
    setError("");
    try {
      const body = await readJson(await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(n)}`));
      setFile(n);
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file)
      return;
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch(`${ROUTE}/memory`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, name: file, text })
      }));
      setSaved(text);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!file || !window.confirm(`Delete ${file}? MEMORY.md drops its line too.`))
      return;
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch(`${ROUTE}/memory?${q}&name=${encodeURIComponent(file)}`, { method: "DELETE" }));
      setFile(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!cwd || files.length === 0)
    return null;
  const dirty = text !== saved;
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: bodyFlow,
    children: [
      file === null ? files.map((f) => /* @__PURE__ */ jsx_runtime.jsxs("button", {
        type: "button",
        style: {
          ...btn,
          display: "flex",
          width: "100%",
          textAlign: "left",
          padding: "5px 10px"
        },
        onClick: () => openFile(f.name),
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { flex: "none", fontFamily: T.mono, fontSize: 12 },
            children: f.name
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: {
              flex: 1,
              minWidth: 0,
              marginLeft: 10,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: T.muted
            },
            children: f.summary
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: ago(f.mtime)
          })
        ]
      }, f.name)) : /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8 },
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                style: btn,
                onClick: () => setFile(null),
                disabled: busy,
                children: "‹ Back"
              }),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: { flex: 1, fontFamily: T.mono, fontSize: 12 },
                children: file
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                style: btn,
                onClick: remove,
                disabled: busy,
                children: "Delete"
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                style: dirty ? btnPrimary : btn,
                onClick: save,
                disabled: busy || !dirty,
                children: "Save"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("textarea", {
            value: text,
            spellCheck: false,
            autoFocus: true,
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                save();
            },
            style: { ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }
          })
        ]
      }),
      error && /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: error
      })
    ]
  });
}
var rewindSummary = (r) => r.error ? r.error : `${r.filesChanged?.length ?? 0} files, +${r.insertions ?? 0} −${r.deletions ?? 0}`;
function RewindBody({
  sessionId,
  ctx,
  onClose
}) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [prompts, setPrompts] = import_react2.useState([]);
  const [picked, setPicked] = import_react2.useState(null);
  const [preview, setPreview] = import_react2.useState(null);
  const [busy, setBusy] = import_react2.useState(false);
  const [error, setError] = import_react2.useState("");
  import_react2.useEffect(() => {
    if (!cwd)
      return;
    let live = true;
    setPicked(null);
    setPreview(null);
    setError("");
    fetch(`${ROUTE}/rewind?session=${encodeURIComponent(sessionId)}&cwd=${encodeURIComponent(cwd)}`).then((r) => readJson(r)).then((b) => live && setPrompts(b.prompts ?? [])).catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [cwd, sessionId]);
  if (!isClaude || !cwd)
    return null;
  const run = async (uuid, dryRun) => {
    setBusy(true);
    setError("");
    try {
      const reply = await readJson(await fetch(`${ROUTE}/rewind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, uuid, dryRun })
      }));
      setPreview(reply);
      if (!dryRun && reply.ok)
        onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = (p) => {
    setPicked(p);
    setPreview(null);
    run(p.id, true);
  };
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: bodyFlow,
    children: [
      picked === null ? prompts.length === 0 ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "No completed prompts yet"
      }) : prompts.map((p) => /* @__PURE__ */ jsx_runtime.jsxs("button", {
        type: "button",
        style: {
          ...btn,
          display: "flex",
          width: "100%",
          textAlign: "left",
          padding: "5px 10px"
        },
        onClick: () => pick(p),
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: {
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: p.text
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: ago(p.time)
          })
        ]
      }, p.id)) : /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime.jsxs("span", {
            style: { fontSize: 13, padding: "2px 4px" },
            children: [
              "Rewind to: ",
              picked.text
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, padding: "2px 4px" },
            children: busy && !preview ? "Checking…" : preview ? rewindSummary(preview) : ""
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, padding: "2px 4px" },
            children: "Files go back and Claude forgets everything after this prompt. This dsh transcript keeps showing what happened."
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: { display: "flex", gap: 8, padding: "2px 4px" },
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                style: btn,
                disabled: busy,
                onClick: () => setPicked(null),
                children: "‹ Back"
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                style: btnPrimary,
                disabled: busy || !preview?.ok,
                onClick: () => run(picked.id, false),
                children: "Rewind"
              })
            ]
          })
        ]
      }),
      error && /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: error
      })
    ]
  });
}
function ChangesBody({ sessionId, ctx }) {
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = import_react2.useState(null);
  const [shown, setShown] = import_react2.useState(null);
  import_react2.useEffect(() => {
    let live = true;
    setReply(null);
    setShown(null);
    fetch(`${ROUTE}/diff?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((b) => live && setReply(b)).catch((e) => live && setReply({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionId]);
  if (!isClaude)
    return null;
  const files = reply?.ok ? reply.files : [];
  const current = files.find((f) => f.path === shown);
  return /* @__PURE__ */ jsx_runtime.jsx("div", {
    style: bodyFlow,
    children: reply === null ? /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: { ...meta, padding: "2px 4px" },
      children: "Loading…"
    }) : !reply.ok ? /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: { color: T.err, fontSize: 12 },
      children: reply.error
    }) : current ? /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime.jsxs("div", {
          style: { display: "flex", gap: 8, alignItems: "center", padding: "2px 4px" },
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("button", {
              type: "button",
              style: btn,
              onClick: () => setShown(null),
              children: "‹ Back"
            }),
            /* @__PURE__ */ jsx_runtime.jsx("span", {
              style: { fontSize: 13, fontFamily: "monospace" },
              children: current.path
            }),
            /* @__PURE__ */ jsx_runtime.jsxs("span", {
              style: { ...meta, marginLeft: "auto" },
              children: [
                "+",
                current.added,
                " −",
                current.removed
              ]
            })
          ]
        }),
        current.hunks.length === 0 ? /* @__PURE__ */ jsx_runtime.jsx("span", {
          style: { ...meta, padding: "2px 4px" },
          children: current.binary ? "Binary file" : current.untracked ? "Untracked file" : "No hunks"
        }) : current.hunks.map((h, i) => /* @__PURE__ */ jsx_runtime.jsxs("pre", {
          style: {
            margin: "2px 4px",
            padding: 6,
            fontSize: 12,
            lineHeight: "16px",
            overflow: "auto",
            background: T.field,
            border: `1px solid ${T.border}`,
            borderRadius: 4
          },
          children: [
            /* @__PURE__ */ jsx_runtime.jsxs("span", {
              style: { color: T.faint },
              children: [
                "@@ -",
                h.oldStart,
                " +",
                h.newStart,
                " @@",
                `
`
              ]
            }),
            h.lines.map((l, j) => /* @__PURE__ */ jsx_runtime.jsxs("span", {
              style: {
                color: l.startsWith("+") ? T.ok : l.startsWith("-") ? T.err : T.text
              },
              children: [
                l,
                `
`
              ]
            }, j))
          ]
        }, i))
      ]
    }) : /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("span", {
          style: { ...meta, padding: "2px 4px" },
          children: reply.filesCount === 0 ? "Working tree clean" : `${reply.filesCount} files, +${reply.linesAdded} −${reply.linesRemoved}`
        }),
        files.map((f) => /* @__PURE__ */ jsx_runtime.jsxs("button", {
          type: "button",
          style: {
            ...btn,
            display: "flex",
            width: "100%",
            textAlign: "left",
            padding: "5px 10px",
            fontFamily: "monospace"
          },
          onClick: () => setShown(f.path),
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("span", {
              style: {
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: f.path
            }),
            /* @__PURE__ */ jsx_runtime.jsx("span", {
              style: { ...meta, flex: "none", marginLeft: 8 },
              children: f.untracked ? "new" : f.binary ? "binary" : `+${f.added} −${f.removed}`
            })
          ]
        }, f.path))
      ]
    })
  });
}
function McpBody({ sessionId, ctx }) {
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = import_react2.useState(null);
  const [busy, setBusy] = import_react2.useState(null);
  const [note, setNote] = import_react2.useState("");
  const load = () => fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then(setReply).catch((e) => setReply({ ok: false, error: e.message }));
  import_react2.useEffect(() => {
    setReply(null);
    setNote("");
    load();
  }, [sessionId]);
  if (!isClaude)
    return null;
  const reconnect = async (serverName) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson(await fetch(`${ROUTE}/mcp-servers/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, name: serverName })
      }));
      setNote(r.ok ? `${serverName}: reconnected` : `${serverName}: ${r.error ?? "failed"}`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const servers = reply?.ok ? reply.servers : [];
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: bodyFlow,
    children: [
      reply === null ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "Loading…"
      }) : !reply.ok ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: reply.error
      }) : servers.length === 0 ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "No MCP servers"
      }) : servers.map((s) => /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" },
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            "aria-hidden": "true",
            style: {
              width: 8,
              height: 8,
              borderRadius: 4,
              flex: "none",
              background: s.status === "connected" ? T.ok : s.status === "pending" ? T.warn : T.err
            }
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("span", {
            style: {
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 13
            },
            title: s.name,
            children: [
              s.name,
              s.version ? /* @__PURE__ */ jsx_runtime.jsxs("span", {
                style: meta,
                children: [
                  " ",
                  s.version
                ]
              }) : null
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, flex: "none" },
            children: s.status
          }),
          /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "button",
            style: btn,
            disabled: busy !== null,
            onClick: () => reconnect(s.name),
            children: busy === s.name ? "…" : "Reconnect"
          })
        ]
      }, s.name)),
      note && /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: note
      })
    ]
  });
}
var PRESETS = [
  { id: "read-only", label: "Read Only" },
  { id: "workspace-write", label: "Workspace Write" },
  { id: "danger-full-access", label: "Full access" }
];
var PRESET_FOR_MODE = {
  plan: "read-only",
  default: "workspace-write",
  acceptEdits: "workspace-write",
  auto: "danger-full-access",
  dontAsk: "danger-full-access",
  bypassPermissions: "danger-full-access"
};
var MODE_LABELS = {
  plan: "Plan · read-only",
  default: "Ask · workspace",
  acceptEdits: "Accept edits · workspace",
  auto: "Auto · full access",
  dontAsk: "Don't ask · full access",
  bypassPermissions: "Bypass · full access"
};
var presetForMode = (m) => PRESET_FOR_MODE[m];
var modeLabel = (m) => MODE_LABELS[m];
function AccessShield({ sessionId, ctx }) {
  const anchorRef = import_react2.useRef(null);
  import_react2.useEffect(() => {
    if (activeClaudeSession(ctx) !== sessionId)
      return;
    const build = () => {
      const form = anchorRef.current?.closest("form");
      const found = Array.from((form ?? document).querySelectorAll('button[aria-label^="Access mode"]'));
      const trigger = found[0] ?? Array.from((form ?? document).querySelectorAll("button")).find((b) => PRESETS.some((p) => b.textContent === p.label));
      if (!trigger)
        return null;
      return trigger;
    };
    const start = (trigger) => {
      let currentMode = "";
      const labelSpan = () => {
        for (const child of Array.from(trigger.children))
          if (child instanceof HTMLElement && child.className.includes("Label"))
            return child;
        return trigger.children[1] instanceof HTMLElement ? trigger.children[1] : null;
      };
      let lastDshLabelText = labelSpan()?.textContent ?? "";
      let lastDshAriaLabel = trigger.getAttribute("aria-label") ?? "";
      const reapplyLabel = () => {
        if (!trigger.isConnected || !currentMode)
          return;
        const text = modeLabel(currentMode) ?? currentMode;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = `Claude permission: ${text}`;
        const aria = trigger.getAttribute("aria-label") ?? "";
        if (aria !== newAria) {
          lastDshAriaLabel = aria;
          trigger.setAttribute("aria-label", newAria);
        }
      };
      const labelObserver = new MutationObserver(() => {
        if (trigger.isConnected)
          reapplyLabel();
      });
      labelObserver.observe(trigger, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
      const fetchMode = () => fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).catch(() => null);
      fetchMode().then((snap) => {
        if (snap) {
          currentMode = snap.mode;
          reapplyLabel();
        }
      });
      const parent = trigger.parentElement;
      if (!parent)
        return () => {
          labelObserver.disconnect();
        };
      const menuObserver = new MutationObserver(() => {
        if (!parent.isConnected)
          return;
        const menus = Array.from(parent.querySelectorAll('[role="menu"]'));
        for (const dshMenu of menus) {
          if (dshMenu.getAttribute("data-dsh-oh-my-claude"))
            continue;
          const menuItems = Array.from(dshMenu.querySelectorAll('[role="menuitem"]'));
          const hasPreset = menuItems.some((el) => PRESETS.some((p) => el.textContent === p.label));
          if (!hasPreset)
            continue;
          dshMenu.setAttribute("data-dsh-oh-my-claude", "1");
          const firstItemWrap = menuItems[0]?.parentElement;
          if (!firstItemWrap)
            continue;
          let selectedToken = "";
          let checkMark = null;
          for (const el of menuItems) {
            const tokens = el.className.split(" ");
            const found = tokens.find((t) => t.includes("selected"));
            if (found) {
              selectedToken = found;
              checkMark = el.querySelector(":scope > svg");
              break;
            }
          }
          const baseClass = selectedToken ? menuItems[0].className.split(" ").filter((t) => t !== selectedToken).join(" ") : menuItems[0].className;
          const svgByPresetId = {};
          for (const el of menuItems) {
            const svgEl = el.querySelector("svg");
            if (!svgEl)
              continue;
            const presetId = PRESETS.find((p) => p.label === el.textContent)?.id;
            if (presetId)
              svgByPresetId[presetId] = svgEl.outerHTML;
          }
          for (const wrap of dshMenu.querySelectorAll("[class*='itemWrap']")) {
            wrap.style.display = "none";
          }
          const viewport = dshMenu.querySelector('[role="presentation"]') ?? dshMenu;
          let stateSnapshot = null;
          fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((snap) => {
            stateSnapshot = snap;
          }).catch(() => {});
          const modeKeys = Object.keys(MODE_LABELS);
          for (const m of modeKeys) {
            const wrap = firstItemWrap.cloneNode(true);
            wrap.style.display = "";
            const menuitem = wrap.querySelector("button[role='menuitem']");
            if (!menuitem)
              continue;
            menuitem.className = m === currentMode && selectedToken ? `${baseClass} ${selectedToken}` : baseClass;
            menuitem.setAttribute("aria-checked", m === currentMode ? "true" : "false");
            for (const inherited of menuitem.querySelectorAll(":scope > svg"))
              inherited.remove();
            if (m === currentMode && checkMark)
              menuitem.append(checkMark.cloneNode(true));
            const presetId = PRESET_FOR_MODE[m];
            const iconSpan = menuitem.querySelector("span[class*='Icon']");
            if (iconSpan && svgByPresetId[presetId]) {
              iconSpan.innerHTML = svgByPresetId[presetId];
            }
            const labelChild = Array.from(menuitem.children).find((c) => c instanceof HTMLElement && c.className.includes("Label"));
            if (labelChild instanceof HTMLElement) {
              labelChild.textContent = modeLabel(m);
            } else {
              const textNode = Array.from(menuitem.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
              if (textNode instanceof Text)
                textNode.textContent = modeLabel(m);
            }
            menuitem.setAttribute("data-mode", m);
            menuitem.addEventListener("click", () => {
              (stateSnapshot ? Promise.resolve(stateSnapshot) : fetchMode()).then((snap) => {
                if (!snap)
                  return;
                stateSnapshot = snap;
                pick(snap);
              });
            });
            const pick = (snap) => {
              const need = presetForMode(m);
              const have = snap.accessMode;
              const doSet = () => {
                const clearDefault = need === "read-only" && m === "plan" || need === "workspace-write" && m === "acceptEdits" || need === "danger-full-access" && m === "bypassPermissions";
                fetch(`${ROUTE}/permission-mode`, {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ session: sessionId, mode: clearDefault ? null : m })
                }).then((r) => readJson(r)).then((reply) => {
                  if (reply.error) {
                    const errEl = parent.querySelector("[data-err]");
                    if (errEl)
                      errEl.textContent = reply.error;
                  } else {
                    fetchMode().then((next) => {
                      if (next)
                        currentMode = next.mode;
                      reapplyLabel();
                    });
                  }
                }).catch((e) => {
                  const errEl = parent.querySelector("[data-err]");
                  if (errEl)
                    errEl.textContent = e instanceof Error ? e.message : String(e);
                });
              };
              if (need !== have) {
                const live = ctx.sessions.binding?.(sessionId)?.session;
                if (!live) {
                  const errEl = parent.querySelector("[data-err]");
                  if (errEl)
                    errEl.textContent = "this session is not materialized yet";
                  return;
                }
                live.command(`/permission ${need}`).then((reply) => {
                  if (!reply || !reply.ok) {
                    const errEl = parent.querySelector("[data-err]");
                    if (errEl)
                      errEl.textContent = reply?.error?.message ?? "command failed";
                  } else {
                    setTimeout(doSet, 700);
                  }
                }).catch((e) => {
                  const errEl = parent.querySelector("[data-err]");
                  if (errEl)
                    errEl.textContent = e instanceof Error ? e.message : String(e);
                });
              } else {
                doSet();
              }
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            };
            viewport.appendChild(wrap);
          }
          const errWrap = document.createElement("div");
          errWrap.setAttribute("data-err", "1");
          Object.assign(errWrap.style, { ...meta, color: T.err, padding: "8px 10px" });
          viewport.appendChild(errWrap);
        }
      });
      menuObserver.observe(parent, { childList: true, subtree: true });
      return () => {
        labelObserver.disconnect();
        menuObserver.disconnect();
        const restoreTarget = labelSpan();
        if (restoreTarget && lastDshLabelText)
          restoreTarget.textContent = lastDshLabelText;
        if (lastDshAriaLabel)
          trigger.setAttribute("aria-label", lastDshAriaLabel);
        const markedMenu = parent.querySelector('[role="menu"][data-dsh-oh-my-claude]');
        if (markedMenu) {
          const vp = markedMenu.querySelector('[role="presentation"]') ?? markedMenu;
          for (const wrap of vp.querySelectorAll("[class*='itemWrap']")) {
            if (wrap.hasAttribute("data-mode")) {
              wrap.remove();
            } else {
              wrap.style.display = "";
            }
          }
          const errEl = vp.querySelector("[data-err]");
          if (errEl)
            errEl.remove();
        }
      };
    };
    let stop;
    let hidden;
    let timer;
    const attempt = () => {
      const found = build();
      if (!found)
        return false;
      hidden = found;
      stop = start(found);
      return true;
    };
    if (!attempt()) {
      let attempts = 0;
      timer = setInterval(() => {
        attempts++;
        if (attempt() || attempts >= 40)
          clearInterval(timer);
      }, 500);
    }
    const watchdog = setInterval(() => {
      if (!stop || hidden?.isConnected)
        return;
      stop();
      stop = undefined;
      attempt();
    }, 1000);
    return () => {
      if (timer)
        clearInterval(timer);
      clearInterval(watchdog);
      stop?.();
    };
  }, [sessionId, ctx]);
  return /* @__PURE__ */ jsx_runtime.jsx("span", {
    ref: anchorRef,
    hidden: true
  });
}
function OhMyClaudeControl({ sessionId, ctx }) {
  const isMine = activeClaudeSession(ctx) === sessionId;
  const [open, setOpen] = import_react2.useState(false);
  const rootRef = import_react2.useRef(null);
  const narrow = useNarrow();
  const [tab, setTab] = import_react2.useState(lastTab);
  const [memoryCount, setMemoryCount] = import_react2.useState(null);
  const onCount = import_react2.useCallback((n) => setMemoryCount(n), []);
  const [above, setAbove] = import_react2.useState(0);
  useDismiss(open, () => setOpen(false), rootRef);
  if (!isMine)
    return null;
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;
  const panelStyle = narrow ? {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: above,
    width: "auto",
    maxHeight: "60vh",
    zIndex: 60,
    display: "flex",
    flexDirection: "column",
    padding: 6,
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    overflow: "hidden"
  } : { ...popover, width: "min(560px, calc(100vw - 24px))", maxHeight: 400 };
  const tabs = [
    ...blank ? [{ key: "Restore", label: "Restore" }] : [],
    { key: "Memory", label: `Memory${memoryCount !== null ? ` · ${memoryCount}` : ""}` },
    { key: "Rewind", label: "Rewind" },
    { key: "Changes", label: "Changes" },
    { key: "MCP", label: "MCP" }
  ];
  if (!tabs.map((t) => t.key).includes(lastTab))
    lastTab = "Memory";
  return /* @__PURE__ */ jsx_runtime.jsxs("span", {
    ref: rootRef,
    style: { position: "relative", display: "inline-flex" },
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("button", {
        type: "button",
        style: {
          width: 22,
          height: 22,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: open ? T.hover : "transparent",
          color: CLAUDE_ORANGE,
          fontSize: 18,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer"
        },
        "aria-label": "Oh My Claude",
        title: "Oh My Claude: memory, rewind, changes, MCP",
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        onClick: () => {
          setTab(lastTab === "Restore" && !blank ? "Memory" : lastTab);
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect)
            setAbove(Math.max(12, window.innerHeight - rect.top + 8));
          setOpen((v) => !v);
        },
        children: CLAUDE_MARK
      }),
      open && /* @__PURE__ */ jsx_runtime.jsxs("div", {
        role: "dialog",
        "aria-label": "Oh My Claude",
        style: panelStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            role: "tablist",
            style: {
              display: "flex",
              borderBottom: `1px solid ${T.border}`,
              paddingBottom: 6,
              overflowX: "auto",
              whiteSpace: "nowrap"
            },
            children: tabs.map((t) => /* @__PURE__ */ jsx_runtime.jsx("button", {
              role: "tab",
              "aria-selected": tab === t.key,
              style: {
                ...btn,
                fontSize: 12,
                borderBottom: tab === t.key ? `2px solid ${CLAUDE_ORANGE}` : "2px solid transparent",
                color: tab === t.key ? T.text : T.faint,
                marginBottom: -1,
                paddingBottom: 4
              },
              onClick: () => {
                lastTab = t.key;
                setTab(t.key);
              },
              children: t.label
            }, t.key))
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            role: "tabpanel",
            style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "4px 0" },
            children: [
              tab === "Restore" && /* @__PURE__ */ jsx_runtime.jsx(RestoreBody, {
                sessionId,
                ctx,
                onClose: () => setOpen(false)
              }),
              tab === "Memory" && /* @__PURE__ */ jsx_runtime.jsx(MemoryBody, {
                sessionId,
                ctx,
                onCount
              }),
              tab === "Rewind" && /* @__PURE__ */ jsx_runtime.jsx(RewindBody, {
                sessionId,
                ctx,
                onClose: () => setOpen(false)
              }),
              tab === "Changes" && /* @__PURE__ */ jsx_runtime.jsx(ChangesBody, {
                sessionId,
                ctx
              }),
              tab === "MCP" && /* @__PURE__ */ jsx_runtime.jsx(McpBody, {
                sessionId,
                ctx,
                onClose: () => setOpen(false)
              })
            ]
          })
        ]
      })
    ]
  });
}

// src/client/index.tsx
var jsx_runtime2 = require("react/jsx-runtime");
var HASH_KEY = "claude-session";
var size = (bytes) => bytes < 1e6 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
var shortPath = (p) => {
  if (!p)
    return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join("/") : p;
};
var name = "dsh-oh-my-claude-client";
var inject = ["slots", "sessions", "workspaces", "modelDirectories"];
var isObj = (v) => v instanceof Object && !Array.isArray(v);
var count = (v) => Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
var DEFAULT_VERBS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Beaming",
  "Beboppin'",
  "Befuddling",
  "Billowing",
  "Blanching",
  "Bloviating",
  "Boogieing",
  "Boondoggling",
  "Booping",
  "Bootstrapping",
  "Brewing",
  "Bunning",
  "Burrowing",
  "Calculating",
  "Canoodling",
  "Caramelizing",
  "Cascading",
  "Catapulting",
  "Cerebrating",
  "Channeling",
  "Channelling",
  "Choreographing",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Composing",
  "Computing",
  "Concocting",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Cultivating",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Dilly-dallying",
  "Discombobulating",
  "Doing",
  "Doodling",
  "Drizzling",
  "Ebbing",
  "Effecting",
  "Elucidating",
  "Embellishing",
  "Enchanting",
  "Envisioning",
  "Fermenting",
  "Fiddle-faddling",
  "Finagling",
  "Flambéing",
  "Flibbertigibbeting",
  "Flowing",
  "Flummoxing",
  "Fluttering",
  "Forging",
  "Forming",
  "Frolicking",
  "Frosting",
  "Gallivanting",
  "Galloping",
  "Garnishing",
  "Generating",
  "Gesticulating",
  "Germinating",
  "Gitifying",
  "Grooving",
  "Gusting",
  "Harmonizing",
  "Hashing",
  "Hatching",
  "Herding",
  "Honking",
  "Hullaballooing",
  "Hyperspacing",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Infusing",
  "Ionizing",
  "Jitterbugging",
  "Julienning",
  "Kneading",
  "Leavening",
  "Levitating",
  "Lollygagging",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Metamorphosing",
  "Misting",
  "Moonwalking",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Nebulizing",
  "Nesting",
  "Newspapering",
  "Noodling",
  "Nucleating",
  "Orbiting",
  "Orchestrating",
  "Osmosing",
  "Perambulating",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Photosynthesizing",
  "Pollinating",
  "Pondering",
  "Pontificating",
  "Pouncing",
  "Precipitating",
  "Prestidigitating",
  "Processing",
  "Proofing",
  "Propagating",
  "Puttering",
  "Puzzling",
  "Quantumizing",
  "Razzle-dazzling",
  "Razzmatazzing",
  "Recombobulating",
  "Reticulating",
  "Roosting",
  "Ruminating",
  "Sautéing",
  "Scampering",
  "Schlepping",
  "Scurrying",
  "Seasoning",
  "Shenaniganing",
  "Shimmying",
  "Simmering",
  "Skedaddling",
  "Sketching",
  "Slithering",
  "Smooshing",
  "Sock-hopping",
  "Spelunking",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Sublimating",
  "Swirling",
  "Swooping",
  "Symbioting",
  "Synthesizing",
  "Tempering",
  "Thinking",
  "Thundering",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Transfiguring",
  "Transmuting",
  "Twisting",
  "Undulating",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Waddling",
  "Wandering",
  "Warping",
  "Whatchamacalliting",
  "Whirlpooling",
  "Whirring",
  "Whisking",
  "Wibbling",
  "Working",
  "Wrangling",
  "Zesting",
  "Zigzagging"
];
var DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✻"];
function pickVerb(list, random) {
  return list[Math.floor(random() * list.length)];
}
function mergeVerbs(defaults, setting) {
  if (!setting)
    return [...defaults];
  if (setting.mode === "replace")
    return [...setting.verbs];
  return [...defaults, ...setting.verbs];
}
function Card({ id, title, summary, actions, open, onToggle, children }) {
  return /* @__PURE__ */ jsx_runtime2.jsxs("section", {
    id,
    style: card,
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: cardHead,
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("button", {
            type: "button",
            onClick: onToggle,
            "aria-expanded": open,
            style: {
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              flex: 1
            },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, width: 10, display: "inline-block" },
                children: open ? "▾" : "▸"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("h3", {
                style: h3,
                children: title
              }),
              summary && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, whiteSpace: "normal", overflow: "hidden" },
                children: summary
              })
            ]
          }),
          actions && /* @__PURE__ */ jsx_runtime2.jsx("div", {
            style: { display: "flex", gap: 8 },
            children: actions
          })
        ]
      }),
      open && /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: { marginTop: 10 },
        children
      })
    ]
  });
}
function Origin({ s }) {
  if (!s.dsh)
    return /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: pill(T.faint),
      children: "terminal"
    });
  if (s.dsh.archived)
    return /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: pill(T.warn),
      children: "archived"
    });
  return /* @__PURE__ */ jsx_runtime2.jsx("span", {
    style: pill(T.brand),
    children: "dsh"
  });
}
var originOf = (s) => !s.dsh ? "terminal" : s.dsh.archived ? "archived" : "dsh";
function summarize(settings) {
  if (!settings)
    return [];
  const out = [];
  if (settings.model)
    out.push(["model", String(settings.model)]);
  const hooksObj = settings.hooks;
  if (isObj(hooksObj)) {
    const events = Object.keys(hooksObj);
    const hooks = events.reduce((n, e) => {
      const groups = hooksObj[e];
      return n + (Array.isArray(groups) ? groups.reduce((m, g) => m + (isObj(g) && Array.isArray(g.hooks) ? g.hooks.length : 1), 0) : 0);
    }, 0);
    out.push(["hooks", `${hooks} on ${events.length} event${events.length === 1 ? "" : "s"}`]);
  }
  const p = settings.permissions;
  if (isObj(p)) {
    const parts = ["allow", "ask", "deny"].filter((k) => count(p[k]) > 0).map((k) => `${count(p[k])} ${k}`);
    if (p.defaultMode)
      parts.unshift(String(p.defaultMode));
    if (parts.length)
      out.push(["permissions", parts.join(" · ")]);
  }
  if (count(settings.env) > 0)
    out.push(["env", `${count(settings.env)} var${count(settings.env) === 1 ? "" : "s"}`]);
  if (count(settings.enabledPlugins) > 0)
    out.push(["plugins", `${count(settings.enabledPlugins)} enabled`]);
  if (settings.statusLine)
    out.push(["statusLine", "set"]);
  return out;
}
var jump = (b) => window.location.assign(b.token ? `${b.url}/?token=${encodeURIComponent(b.token)}` : b.url);
var jumpUrl = (box, s) => `${box.url}/${box.token ? `?token=${encodeURIComponent(box.token)}` : ""}#${HASH_KEY}=${encodeURIComponent(s.id)}&cwd=${encodeURIComponent(s.cwd ?? "")}`;
function Runtime({ onStatus }) {
  const [st, setSt] = import_react3.useState(null);
  const [error, setError] = import_react3.useState("");
  import_react3.useEffect(() => {
    fetch(`${ROUTE}/status`).then((r) => readJson(r)).then((status) => {
      setSt(status);
      onStatus?.(status);
    }).catch((e) => setError(e.message));
  }, []);
  if (error)
    return /* @__PURE__ */ jsx_runtime2.jsx("p", {
      id: "dsh-oh-my-claude-runtime",
      style: { color: T.err, fontSize: 13, margin: "0 0 4px" },
      children: error
    });
  if (!st)
    return /* @__PURE__ */ jsx_runtime2.jsx("p", {
      id: "dsh-oh-my-claude-runtime",
      style: { ...meta, margin: "0 0 4px" },
      children: "Checking claude…"
    });
  const who = st.loggedIn ? `logged in${st.email ? ` as ${maskEmail(st.email)}` : ""}${st.authMethod ? ` (${st.authMethod})` : ""}` : "not logged in";
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    id: "dsh-oh-my-claude-runtime",
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6,
      alignItems: "center",
      margin: "0 0 4px",
      fontSize: 13,
      color: T.muted
    },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: pill(st.binary ? T.ok : T.err),
        children: st.binary ? `claude ${st.version ?? ""}`.trim() : "claude not on PATH"
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: pill(st.loggedIn ? T.ok : T.err),
        children: who
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: pill(T.faint),
        children: st.host
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("span", {
        style: { fontFamily: T.mono, fontSize: 12, color: T.faint },
        children: [
          st.binary ?? "",
          " · ",
          st.configDir
        ]
      }),
      st.error && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { width: "100%", color: T.err, fontFamily: T.mono, fontSize: 12 },
        children: st.error
      }),
      !st.loggedIn && /* @__PURE__ */ jsx_runtime2.jsxs("span", {
        style: { width: "100%", color: T.err },
        children: [
          "Sign in on this machine first: run",
          " ",
          /* @__PURE__ */ jsx_runtime2.jsx("code", {
            style: { fontFamily: T.mono },
            children: "claude auth login"
          }),
          " in a terminal, then reload this page."
        ]
      })
    ]
  });
}
var PAGE = 10;
function pageSessions(groups, filters) {
  const { box, cwd, origin, shown } = filters;
  const list = [];
  const hidden = {};
  const matched = {};
  for (const g of groups) {
    if (box !== "all" && g.key !== box)
      continue;
    const gs = g.sessions.filter((s) => (cwd === "all" || s.cwd === cwd) && (origin === "all" || originOf(s) === origin)).toSorted((a, b) => b.modifiedAt - a.modifiedAt);
    matched[g.key] = gs.length;
    const cap = shown[g.key] ?? PAGE;
    if (gs.length > cap)
      hidden[g.key] = gs.length - cap;
    for (const s of gs.slice(0, cap))
      list.push({ g, s });
  }
  return { list, hidden, matched };
}
function Sessions({ ctx, boxes }) {
  const [local, setLocal] = import_react3.useState(null);
  const [remote, setRemote] = import_react3.useState([]);
  const [loading, setLoading] = import_react3.useState(true);
  const [remoteLoading, setRemoteLoading] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const [box, setBox] = import_react3.useState("all");
  const [cwd, setCwd] = import_react3.useState("all");
  const [origin, setOrigin] = import_react3.useState("all");
  const [busyId, setBusyId] = import_react3.useState("");
  const [shown, setShown] = import_react3.useState({});
  const load = () => {
    setLoading(true);
    setError("");
    fetch(`${ROUTE}/sessions?all=1`).then((r) => readJson(r)).then((body) => setLocal(body ?? null)).catch((e) => setError(e.message)).finally(() => setLoading(false));
    if (boxes.length === 0)
      return;
    setRemoteLoading(true);
    fetch(`${ROUTE}/boxes/sessions`).then((r) => readJson(r)).then((body) => setRemote(body?.boxes ?? [])).catch((e) => setError(e.message)).finally(() => setRemoteLoading(false));
  };
  import_react3.useEffect(load, [boxes.map((b) => b.url).join("|")]);
  const groups = import_react3.useMemo(() => {
    const out = [];
    if (local)
      out.push({
        key: "local",
        name: "This box",
        host: local.host,
        ok: true,
        sessions: local.sessions ?? []
      });
    for (const b of boxes) {
      const r = remote.find((x) => x.url === b.url);
      out.push({
        key: b.url,
        name: b.name,
        host: r?.host,
        ok: r?.ok === true,
        error: r ? r.error : remoteLoading ? "checking…" : "unchecked",
        sessions: r?.sessions ?? [],
        box: b
      });
    }
    return out;
  }, [local, remote, boxes, remoteLoading]);
  const paged = import_react3.useMemo(() => pageSessions(groups, { box, cwd, origin, shown }), [groups, box, cwd, origin, shown]);
  const rows = paged.list;
  const cwds = import_react3.useMemo(() => {
    const set = new Set;
    for (const g of groups)
      if (box === "all" || g.key === box) {
        for (const s of g.sessions)
          if (s.cwd)
            set.add(s.cwd);
      }
    return [...set].toSorted();
  }, [groups, box]);
  import_react3.useEffect(() => {
    if (cwd !== "all" && !cwds.includes(cwd))
      setCwd("all");
  }, [cwds.join("|")]);
  const open = async (r) => {
    if (r.g.key !== "local") {
      if (!r.g.box)
        return;
      window.location.assign(jumpUrl(r.g.box, r.s));
      return;
    }
    setBusyId(r.s.id);
    setError("");
    try {
      await openHere(ctx, r.s, r.s.cwd ?? "");
      if (r.s.dsh?.archived)
        setLocal((l) => {
          if (!l?.sessions)
            return l;
          return {
            ...l,
            sessions: l.sessions.map((x) => x.id === r.s.id ? { ...x, dsh: { ...x.dsh, archived: false } } : x)
          };
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  };
  const known = ctx.sessions.list.getSnapshot()?.byId ?? {};
  const total = groups.reduce((n, g) => n + g.sessions.length, 0);
  let lastGroup = null;
  return /* @__PURE__ */ jsx_runtime2.jsxs("section", {
    id: "dsh-oh-my-claude-sessions-card",
    style: card,
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: cardHead,
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("h3", {
                style: h3,
                children: "Sessions"
              }),
              /* @__PURE__ */ jsx_runtime2.jsxs("div", {
                style: { ...meta, marginTop: 2 },
                children: [
                  loading ? "Loading…" : `${rows.length} shown · ${total} total`,
                  remoteLoading ? " · checking boxes…" : ""
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("button", {
            type: "button",
            style: btn,
            disabled: loading,
            onClick: load,
            children: "Refresh"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        id: "dsh-oh-my-claude-session-filters",
        style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("button", {
            type: "button",
            style: chip(box === "all", false),
            onClick: () => setBox("all"),
            children: "All boxes"
          }),
          groups.map((g) => /* @__PURE__ */ jsx_runtime2.jsxs("button", {
            type: "button",
            style: chip(box === g.key, !g.ok),
            disabled: !g.ok,
            title: g.ok ? g.host : g.error,
            onClick: () => setBox(g.key),
            children: [
              g.name,
              g.ok ? ` · ${g.sessions.length}` : " · offline"
            ]
          }, g.key)),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { flex: 1 }
          }),
          /* @__PURE__ */ jsx_runtime2.jsxs("select", {
            id: "dsh-oh-my-claude-cwd-filter",
            style: select,
            value: cwd,
            onChange: (e) => setCwd(e.target.value),
            title: "Workspace",
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "all",
                children: "All workspaces"
              }),
              cwds.map((c) => /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: c,
                title: c,
                children: shortPath(c)
              }, c))
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsxs("select", {
            id: "dsh-oh-my-claude-origin-filter",
            style: select,
            value: origin,
            onChange: (e) => setOrigin(e.target.value),
            title: "Origin",
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "all",
                children: "Any origin"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "dsh",
                children: "In dsh"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "archived",
                children: "Archived"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "terminal",
                children: "Terminal only"
              })
            ]
          })
        ]
      }),
      error && /* @__PURE__ */ jsx_runtime2.jsx("p", {
        id: "dsh-oh-my-claude-error",
        style: { color: T.err, fontSize: 13, margin: "8px 0 0" },
        children: error
      }),
      !loading && rows.length === 0 && /* @__PURE__ */ jsx_runtime2.jsx("p", {
        id: "dsh-oh-my-claude-empty",
        style: { ...meta, marginTop: 10 },
        children: "No Claude Code sessions match."
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("div", {
        id: "dsh-oh-my-claude-sessions",
        style: { marginTop: 6 },
        children: rows.map((r, i) => {
          const header = box === "all" && r.g !== lastGroup ? /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: {
              ...meta,
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: "10px 0 4px",
              fontWeight: 600,
              color: T.muted
            },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                children: r.g.name
              }),
              r.g.host && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: pill(T.faint),
                children: r.g.host
              })
            ]
          }, `h-${r.g.key}`) : null;
          lastGroup = r.g;
          const lastOfGroup = i === rows.length - 1 || rows[i + 1]?.g.key !== r.g.key;
          const more = paged.hidden[r.g.key] ?? 0;
          const grown = (shown[r.g.key] ?? PAGE) > PAGE;
          const isLocal = r.g.key === "local";
          const opened = isLocal && Boolean(known[r.s.dsh?.id ?? r.s.id]) && !r.s.dsh?.archived;
          const busy = busyId === r.s.id;
          const label = busy ? "Opening…" : !isLocal ? `Open on ${r.g.name}` : opened ? "Show" : r.s.dsh?.archived ? "Restore" : "Open";
          return [
            header,
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              "data-testid": "dsh-oh-my-claude-session-row",
              style: row,
              children: [
                /* @__PURE__ */ jsx_runtime2.jsxs("div", {
                  style: { flex: 1, minWidth: 0 },
                  children: [
                    /* @__PURE__ */ jsx_runtime2.jsx("div", {
                      style: {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: T.text
                      },
                      title: r.s.title || r.s.id,
                      children: r.s.title || r.s.id
                    }),
                    /* @__PURE__ */ jsx_runtime2.jsxs("div", {
                      style: { ...meta, marginTop: 3, display: "flex", gap: 8, alignItems: "center" },
                      children: [
                        /* @__PURE__ */ jsx_runtime2.jsx(Origin, {
                          s: r.s
                        }),
                        r.s.cwd && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                          title: r.s.cwd,
                          style: { fontFamily: T.mono },
                          children: shortPath(r.s.cwd)
                        }),
                        /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                          children: [
                            ago(r.s.modifiedAt),
                            " · ",
                            r.s.turns,
                            r.s.turnsPartial ? "+" : "",
                            " prompts · ",
                            size(r.s.bytes),
                            " ·",
                            " ",
                            /* @__PURE__ */ jsx_runtime2.jsx("span", {
                              style: { fontFamily: T.mono },
                              children: r.s.id.slice(0, 8)
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                /* @__PURE__ */ jsx_runtime2.jsx("button", {
                  id: `dsh-oh-my-claude-session-${r.s.id}-button`,
                  type: "button",
                  style: opened ? btn : btnPrimary,
                  disabled: busy,
                  onClick: () => open(r),
                  children: label
                })
              ]
            }, `${r.g.key}-${r.s.id}`),
            lastOfGroup && more > 0 ? /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              "data-testid": "dsh-oh-my-claude-load-more",
              style: { display: "flex", gap: 8, padding: "6px 0 2px" },
              children: [
                /* @__PURE__ */ jsx_runtime2.jsxs("button", {
                  type: "button",
                  style: btn,
                  onClick: () => setShown((m) => ({ ...m, [r.g.key]: (m[r.g.key] ?? PAGE) + PAGE })),
                  children: [
                    "Load ",
                    Math.min(PAGE, more),
                    " more"
                  ]
                }),
                grown && /* @__PURE__ */ jsx_runtime2.jsxs("button", {
                  type: "button",
                  style: btn,
                  onClick: () => setShown((m) => ({ ...m, [r.g.key]: paged.matched[r.g.key] ?? PAGE })),
                  children: [
                    "Load all ",
                    paged.matched[r.g.key] ?? ""
                  ]
                })
              ]
            }, `more-${r.g.key}`) : null
          ];
        })
      })
    ]
  });
}
function SettingsEditor({ open, onToggle, box }) {
  const [file, setFile] = import_react3.useState(null);
  const [text, setText] = import_react3.useState("");
  const [editing, setEditing] = import_react3.useState(false);
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const [saved, setSaved] = import_react3.useState("");
  const settingsUrl = box ? `${ROUTE}/boxes/settings?url=${encodeURIComponent(box.url)}` : `${ROUTE}/settings`;
  const load = () => {
    setBusy(true);
    setError("");
    fetch(settingsUrl).then((r) => readJson(r)).then((b) => {
      setFile(b);
      setText(b.text);
      setEditing(false);
      setSaved("");
    }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  import_react3.useEffect(load, [settingsUrl]);
  const parsed = import_react3.useMemo(() => {
    try {
      const value = JSON.parse(text);
      if (!isObj(value))
        return { error: "settings.json must be a JSON object" };
      return { value };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);
  const dirty = file !== null && text !== file.text;
  const canSave = dirty && !parsed.error && !busy;
  const save = () => {
    if (!canSave)
      return;
    setBusy(true);
    setError("");
    fetch(settingsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    }).then((r) => readJson(r)).then((b) => {
      setFile((f) => ({ ...f, text, exists: true, mtime: b.mtime }));
      setEditing(false);
      setSaved(`Saved ${new Date(b.mtime ?? 0).toLocaleTimeString()} · previous copy in ${b.backup ?? "?"}`);
    }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };
  const facts = summarize(parsed.value);
  const summary = file ? facts.length ? facts.map(([k, v]) => `${k} ${v}`).join(" · ") : file.exists ? "empty" : "not created yet" : "";
  const actions = editing ? /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        id: "dsh-oh-my-claude-settings-cancel",
        type: "button",
        style: btn,
        disabled: busy,
        onClick: () => {
          setText(file?.text ?? "");
          setEditing(false);
        },
        children: "Cancel"
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        id: "dsh-oh-my-claude-settings-save",
        type: "button",
        style: { ...btnPrimary, opacity: canSave ? 1 : 0.5 },
        disabled: !canSave,
        onClick: save,
        children: busy ? "Saving…" : "Save"
      })
    ]
  }) : open ? /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        type: "button",
        style: btn,
        disabled: busy,
        onClick: load,
        children: "Reload"
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        id: "dsh-oh-my-claude-settings-edit",
        type: "button",
        style: btn,
        disabled: busy || file === null,
        onClick: () => {
          setSaved("");
          setEditing(true);
        },
        children: "Edit"
      })
    ]
  }) : null;
  return /* @__PURE__ */ jsx_runtime2.jsxs(Card, {
    id: "dsh-oh-my-claude-settings",
    title: "settings.json",
    summary,
    actions,
    open,
    onToggle,
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { ...meta, fontFamily: T.mono, whiteSpace: "normal", marginBottom: 8 },
        children: [
          file?.path ?? "…",
          file && !file.exists ? " · not created yet" : ""
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("p", {
        style: { margin: "0 0 10px", color: T.muted, fontSize: 13 },
        children: "Claude Code's own settings: hooks, permissions, model, env. Read by every Claude Code process on this box, in dsh or in a terminal. dsh's own hooks and settings are separate."
      }),
      editing ? /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
        id: "dsh-oh-my-claude-settings-text",
        value: text,
        spellCheck: false,
        autoFocus: true,
        onChange: (e) => setText(e.target.value),
        onKeyDown,
        style: {
          ...code,
          minHeight: 320,
          resize: "vertical",
          border: `1px solid ${parsed.error ? T.err : T.brand}`
        }
      }) : /* @__PURE__ */ jsx_runtime2.jsx("pre", {
        id: "dsh-oh-my-claude-settings-view",
        style: { ...code, maxHeight: 320, overflow: "auto", margin: 0 },
        children: text
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { fontSize: 12, color: parsed.error ? T.err : T.ok },
            children: parsed.error ? `Invalid JSON: ${parsed.error}` : `Valid JSON · ${Object.keys(parsed.value ?? {}).length} keys${dirty ? " · unsaved changes" : ""}`
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, whiteSpace: "normal", textAlign: "right" },
            children: error ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
              style: { color: T.err },
              children: error
            }) : saved || (editing ? "Ctrl+S saves · Cancel discards" : "Read-only until Edit")
          })
        ]
      })
    ]
  });
}
function Boxes({ boxes, setBoxes, open, onToggle }) {
  const [probe, setProbe] = import_react3.useState({});
  const [self, setSelf] = import_react3.useState(null);
  const [draft, setDraft] = import_react3.useState({ name: "", url: "", token: "" });
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const [openSettingsUrl, setOpenSettingsUrl] = import_react3.useState(null);
  const refresh = () => {
    if (boxes.length === 0)
      return;
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/boxes/status`).then((r) => readJson(r)).then((b) => {
      setSelf(b.self ?? null);
      setProbe(Object.fromEntries((b.boxes ?? []).map((entry) => [entry.url, entry])));
    }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  import_react3.useEffect(refresh, [boxes.map((b) => b.url).join("|")]);
  const save = (next) => {
    setBusy(true);
    setError("");
    return fetch(`${ROUTE}/boxes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ boxes: next })
    }).then((r) => readJson(r)).then((b) => setBoxes(b.boxes ?? [])).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  const add = (e) => {
    e.preventDefault();
    if (!draft.name.trim() || !draft.url.trim())
      return;
    save([...boxes, draft]).then(() => setDraft({ name: "", url: "", token: "" }));
  };
  const remove = (url) => save(boxes.filter((b) => b.url !== url));
  const reachable = boxes.filter((b) => probe[b.url]?.ok).length;
  const summary = boxes.length === 0 ? "none saved" : `${boxes.length} saved · ${busy ? "checking…" : `${reachable} reachable`}`;
  return /* @__PURE__ */ jsx_runtime2.jsxs(Card, {
    id: "dsh-oh-my-claude-boxes",
    title: "Boxes",
    summary,
    actions: open ? /* @__PURE__ */ jsx_runtime2.jsx("button", {
      type: "button",
      style: btn,
      disabled: busy || boxes.length === 0,
      onClick: refresh,
      children: busy ? "Checking…" : "Refresh"
    }) : null,
    open,
    onToggle,
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("p", {
        style: { margin: "0 0 4px", color: T.muted, fontSize: 13 },
        children: "Other machines running dsh with this plugin. Their sessions show in the list above; Open jumps there. Each box keeps its own Claude Code login."
      }),
      error && /* @__PURE__ */ jsx_runtime2.jsx("p", {
        style: { color: T.err, fontSize: 13, margin: "4px 0" },
        children: error
      }),
      boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const skew = ok && self && st.status?.plugin && st.status.plugin !== self.plugin;
        return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          "data-testid": "dsh-oh-my-claude-box-row",
          style: row,
          children: [
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              style: { flex: 1, minWidth: 0 },
              children: [
                /* @__PURE__ */ jsx_runtime2.jsx("div", {
                  style: { color: T.text, fontWeight: 600 },
                  children: b.name
                }),
                /* @__PURE__ */ jsx_runtime2.jsxs("div", {
                  style: {
                    ...meta,
                    marginTop: 3,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    alignItems: "center",
                    whiteSpace: "normal"
                  },
                  children: [
                    /* @__PURE__ */ jsx_runtime2.jsx("span", {
                      style: { fontFamily: T.mono },
                      children: b.url
                    }),
                    !st && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                      style: pill(T.faint),
                      children: busy ? "checking" : "unchecked"
                    }),
                    st && !ok && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                      style: pill(T.err),
                      children: st.error
                    }),
                    ok && st.status && /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
                      children: [
                        /* @__PURE__ */ jsx_runtime2.jsx("span", {
                          style: pill(T.faint),
                          children: st.status.host
                        }),
                        /* @__PURE__ */ jsx_runtime2.jsx("span", {
                          style: pill(st.status.binary ? T.ok : T.err),
                          children: st.status.binary ? `claude ${st.status.version ?? ""}`.trim() : "no claude"
                        }),
                        /* @__PURE__ */ jsx_runtime2.jsx("span", {
                          style: pill(st.status.loggedIn ? T.ok : T.err),
                          children: st.status.loggedIn ? st.status.email ?? "logged in" : "not logged in"
                        }),
                        /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                          style: pill(skew ? T.warn : T.faint),
                          children: [
                            "plugin ",
                            st.status.plugin ?? "?",
                            skew ? ` ≠ ${self.plugin} here` : ""
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: btn,
              disabled: busy || !ok,
              onClick: () => setOpenSettingsUrl(openSettingsUrl === b.url ? null : b.url),
              children: "Edit settings"
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: btn,
              disabled: busy,
              onClick: () => remove(b.url),
              children: "Remove"
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: btnPrimary,
              onClick: () => jump(b),
              children: "Open"
            })
          ]
        }, b.url);
      }),
      openSettingsUrl && /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: { padding: "0 0 4px" },
        children: /* @__PURE__ */ jsx_runtime2.jsx(SettingsEditor, {
          open: true,
          onToggle: () => setOpenSettingsUrl(null),
          box: boxes.find((b) => b.url === openSettingsUrl)
        })
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("form", {
        onSubmit: add,
        style: {
          ...row,
          borderTop: boxes.length ? `1px solid ${T.border}` : "none",
          paddingTop: boxes.length ? 12 : 4,
          flexWrap: "wrap"
        },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            style: { ...inputStyle, flex: "0 1 140px" },
            placeholder: "Name",
            value: draft.name,
            onChange: (e) => setDraft({ ...draft, name: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            style: { ...inputStyle, flex: "1 1 260px" },
            placeholder: "https://dsh.other-box.lan",
            value: draft.url,
            onChange: (e) => setDraft({ ...draft, url: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            style: { ...inputStyle, flex: "1 1 200px" },
            type: "password",
            autoComplete: "off",
            placeholder: "dsh token (optional)",
            value: draft.token,
            onChange: (e) => setDraft({ ...draft, token: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("button", {
            type: "submit",
            style: btn,
            disabled: busy || !draft.name.trim() || !draft.url.trim(),
            children: "Add"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: { ...meta, whiteSpace: "normal", marginTop: 4 },
        children: "Token: the box's dsh launch token (printed when dsh web starts, or already in its URL behind a proxy). Needed only when this browser has never logged into that box."
      })
    ]
  });
}
function followDeepLink(ctx) {
  const m = /[#&]claude-session=([^&]+)(?:&cwd=([^&]*))?/.exec(window.location.hash ?? "");
  if (!m)
    return;
  const id = decodeURIComponent(m[1] ?? "");
  const cwd = decodeURIComponent(m[2] ?? "");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  const started = Date.now();
  const tick = async () => {
    const ready = ctx.sessions.list.getSnapshot()?.phase === "ready";
    if (!ready && Date.now() - started < 15000)
      return void setTimeout(tick, 250);
    try {
      const body = await readJson(await fetch(`${ROUTE}/sessions?all=1`));
      const sessions = body?.sessions ?? [];
      const s = sessions.find((x) => x.id === id) ?? { id, cwd };
      await openHere(ctx, s, s.cwd ?? cwd);
    } catch (e) {
      console.warn(`[dsh-oh-my-claude] deep link failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  tick();
}
var maskEmail = (email) => {
  const at = email.indexOf("@");
  if (at < 1)
    return email;
  return `${email[0]}${"*".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
};
var whose = (r) => [r.email ? maskEmail(r.email) : null, r.host].filter((x) => !!x).join(" on ");
var resetText = (at) => {
  if (at === null)
    return "";
  const ms = at - Date.now();
  if (ms <= 0)
    return "resets now";
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round(ms % 3600000 / 60000);
    return `resets in ${h ? `${h} h ` : ""}${m} min`;
  }
  return `resets ${new Date(at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
};
var usageCache = new Map;
var loadUsage = async (provider) => {
  const key = provider ?? "";
  const hit = usageCache.get(key);
  if (hit && Date.now() - hit.at < 60000)
    return hit.reply;
  const url = provider ? `${ROUTE}/usage?force=1&provider=${encodeURIComponent(provider)}` : `${ROUTE}/usage?force=1`;
  const reply = await readJson(await fetch(url));
  usageCache.set(key, { at: Date.now(), reply });
  return reply;
};
var loadContext = async (sessionId) => {
  try {
    const r = await fetch(`${ROUTE}/context?session=${encodeURIComponent(sessionId)}`);
    return await r.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};
var kTokens = (n) => n >= 1000 ? `${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
function renderContext(el, reply) {
  el.replaceChildren();
  if (!reply.ok) {
    el.textContent = `Context breakdown: ${reply.error}`;
    return;
  }
  const head = document.createElement("div");
  head.style.cssText = `display:flex;justify-content:space-between;color:${T.text};font-weight:500`;
  const headLabel = document.createElement("span");
  headLabel.textContent = "Context breakdown (Claude's count)";
  const headValue = document.createElement("span");
  headValue.style.cssText = "font-variant-numeric:tabular-nums";
  headValue.textContent = `${kTokens(reply.totalTokens)} / ${kTokens(reply.maxTokens)} · ${Math.round(reply.percentage)}%`;
  head.append(headLabel, headValue);
  el.append(head);
  for (const c of reply.categories) {
    if (c.deferred || c.tokens <= 0 || c.name === "Free space")
      continue;
    const line = document.createElement("div");
    line.style.cssText = "display:flex;justify-content:space-between;gap:12px";
    const label = document.createElement("span");
    label.textContent = c.name;
    const val = document.createElement("span");
    val.style.cssText = "font-variant-numeric:tabular-nums";
    val.textContent = kTokens(c.tokens);
    line.append(label, val);
    el.append(line);
  }
}
function renderUsage(block, reply) {
  block.replaceChildren();
  if (!reply.ok) {
    const p = document.createElement("div");
    p.textContent = `Claude usage: ${reply.error}`;
    p.style.color = T.faint;
    block.append(p);
    return;
  }
  for (const w of reply.windows) {
    const pct = Math.max(0, Math.min(100, w.usedPercent));
    const tone = pct >= 90 ? T.err : pct >= 70 ? T.warn : CLAUDE_ORANGE;
    const usageRow = document.createElement("div");
    usageRow.style.cssText = "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
    const label = document.createElement("span");
    label.textContent = w.label;
    label.style.cssText = `color:${T.text};font-weight:500`;
    const value = document.createElement("span");
    value.textContent = `${Math.round(pct)}%`;
    value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${tone}`;
    const bar = document.createElement("div");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(Math.round(pct)));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-label", `${w.label} ${Math.round(pct)}% used`);
    bar.style.cssText = `grid-column:1 / -1;height:4px;border-radius:2px;background:${T.border};overflow:hidden`;
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${pct}%;border-radius:2px;background:linear-gradient(90deg,${tone},${pct >= 70 ? tone : CLAUDE_SHIMMER})`;
    bar.append(fill);
    const when = document.createElement("span");
    when.textContent = resetText(w.resetsAt);
    when.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    usageRow.append(label, value, bar, when);
    block.append(usageRow);
  }
  if (reply.windows.length === 0) {
    const p = document.createElement("div");
    p.textContent = "Claude usage: no limits reported";
    p.style.color = T.faint;
    block.append(p);
  }
}
function watchContextMeter(ctx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  const attach = (panel) => {
    if (panel.hasAttribute(MARK))
      return;
    if (!activeClaudeSession(ctx))
      return;
    panel.setAttribute(MARK, "1");
    const block = document.createElement("div");
    block.style.cssText = `border-bottom:1px solid ${T.border};margin-bottom:10px;padding-bottom:8px;font-size:13px;line-height:20px`;
    const title = document.createElement("div");
    title.style.cssText = `display:flex;align-items:center;gap:6px;color:${T.text};font-weight:600`;
    const mark = document.createElement("span");
    mark.textContent = CLAUDE_MARK;
    mark.setAttribute("aria-hidden", "true");
    mark.style.cssText = `color:${CLAUDE_ORANGE};font-size:14px;line-height:1`;
    const titleText = document.createElement("span");
    titleText.textContent = "Claude usage";
    title.append(mark, titleText);
    const caption = document.createElement("div");
    caption.style.cssText = `color:${T.faint};font-size:11px;line-height:16px;margin:-2px 0 4px 20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    const rows = document.createElement("div");
    rows.textContent = "Loading…";
    rows.style.color = T.faint;
    const breakdown = document.createElement("div");
    breakdown.style.cssText = `margin-top:6px;padding-top:6px;border-top:1px solid ${T.border};color:${T.faint};font-size:12px;line-height:18px`;
    breakdown.textContent = "Context breakdown…";
    block.append(title, caption, rows, breakdown);
    panel.prepend(block);
    const sid = activeClaudeSession(ctx);
    const provider = activeClaudeProvider(ctx);
    if (sid)
      loadContext(sid).then((reply) => renderContext(breakdown, reply));
    loadUsage(provider).then((reply) => {
      const who = whose(reply);
      if (who) {
        caption.textContent = who;
        caption.title = who;
      } else
        caption.remove();
      renderUsage(rows, reply);
    }, (e) => renderUsage(rows, { ok: false, error: e.message }));
  };
  const bubble = (tip) => {
    if (tip.hasAttribute(MARK))
      return;
    if (!activeClaudeSession(ctx))
      return;
    tip.setAttribute(MARK, "1");
    const line = document.createElement("div");
    line.style.cssText = "border-bottom:1px solid rgba(255,255,255,.25);margin-bottom:4px;padding-bottom:4px;display:flex;gap:6px;align-items:baseline";
    const mark = document.createElement("span");
    mark.textContent = CLAUDE_MARK;
    mark.setAttribute("aria-hidden", "true");
    mark.style.color = CLAUDE_SHIMMER;
    const text = document.createElement("span");
    text.textContent = "Claude usage…";
    line.append(mark, text);
    tip.prepend(line);
    loadUsage(activeClaudeProvider(ctx)).then((reply) => {
      const who = reply.host ? ` (${reply.host})` : "";
      text.textContent = reply.ok ? `Claude ${reply.windows.map((w) => `${w.label.toLowerCase()} ${Math.round(w.usedPercent)}%`).join(" · ") || "usage: no limits"}${who}` : `Claude usage: ${reply.error}`;
    }, (e) => {
      text.textContent = `Claude usage: ${e.message}`;
    });
  };
  const scan = (root) => {
    for (const el of root.querySelectorAll('[role="dialog"]'))
      if (isRingRoot(el.parentElement))
        attach(el);
    for (const el of root.querySelectorAll('[role="tooltip"]'))
      if (isRingRoot(el.parentElement))
        bubble(el);
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes)
        if (n instanceof HTMLElement)
          scan(n.parentElement ?? n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}
var spinnerSettings;
var loadSpinnerSettings = async () => {
  try {
    const body = await readJson(await fetch(`${ROUTE}/settings`));
    const parsed = JSON.parse(body.text);
    if (!isObj(parsed))
      return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    const sv = parsed.spinnerVerbs;
    if (!isObj(sv) || !Array.isArray(sv.verbs))
      return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    const mode = sv.mode;
    if (mode !== "append" && mode !== "replace")
      return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
    return {
      verbs: mergeVerbs(DEFAULT_VERBS, sv),
      frameSet: [...DEFAULT_FRAMES]
    };
  } catch {
    return { verbs: [...DEFAULT_VERBS], frameSet: [...DEFAULT_FRAMES] };
  }
};
var ensureTurnStatusStyle = () => {
  let styleEl = document.getElementById("dsh-oh-my-claude-turn-status");
  if (styleEl)
    return;
  styleEl = document.createElement("style");
  styleEl.id = "dsh-oh-my-claude-turn-status";
  styleEl.textContent = `body[data-omc-claude] [role="status"][aria-live="polite"],[data-dsh-oh-my-claude-turn]{background-image:linear-gradient(90deg,${CLAUDE_ORANGE} 0%,${CLAUDE_ORANGE} 40%,${CLAUDE_SHIMMER} 50%,${CLAUDE_ORANGE} 60%,${CLAUDE_ORANGE} 100%)}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:center;flex:none}`;
  document.head.appendChild(styleEl);
};
var turnVerbs = new Map;
var VERB_MEMORY_MS = 4000;
var verbFor = (sessionId, verbs) => {
  const now = Date.now();
  const kept = turnVerbs.get(sessionId);
  const verb = kept && now - kept.seen < VERB_MEMORY_MS ? kept.verb : pickVerb(verbs, Math.random);
  turnVerbs.set(sessionId, { verb, seen: now });
  return verb;
};
var wireTurnStatus = (el, sessionId, verbs, frames) => {
  ensureTurnStatusStyle();
  if (el.hasAttribute("data-dsh-oh-my-claude-turn"))
    return;
  el.setAttribute("data-dsh-oh-my-claude-turn", "1");
  const spinner = document.createElement("span");
  spinner.setAttribute("aria-hidden", "true");
  el.prepend(spinner);
  const textNode = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim().length);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frameIndex = 0;
  let direction = 1;
  const tick = () => {
    const kept = turnVerbs.get(sessionId);
    if (kept)
      kept.seen = Date.now();
    if (reduced) {
      spinner.textContent = "✻";
      return;
    }
    spinner.textContent = frames[frameIndex];
    frameIndex += direction;
    if (frameIndex >= frames.length) {
      frameIndex = frames.length - 2;
      direction = -1;
    } else if (frameIndex < 0) {
      frameIndex = 1;
      direction = 1;
    }
  };
  tick();
  const interval = setInterval(tick, 120);
  const verb = verbFor(sessionId, verbs);
  if (textNode)
    textNode.nodeValue = `${verb}…`;
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData" && textNode && r.target === textNode) {
        if (textNode.nodeValue !== `${verb}…`)
          textNode.nodeValue = `${verb}…`;
      }
    }
  });
  obs.observe(el, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: false
  });
  const remObs = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.removedNodes)
        if (n === el) {
          clearInterval(interval);
          obs.disconnect();
          remObs.disconnect();
          return;
        }
  });
  remObs.observe(document.body, { childList: true, subtree: true });
};
function watchTurnStatus(ctx) {
  ensureTurnStatusStyle();
  const markBody = () => {
    if (activeClaudeSession(ctx))
      document.body.setAttribute("data-omc-claude", "1");
    else
      document.body.removeAttribute("data-omc-claude");
  };
  markBody();
  setInterval(markBody, 1000);
  const attach = async (el) => {
    if (el.getAttribute("role") !== "status" || el.getAttribute("aria-live") !== "polite")
      return;
    const activeId = activeClaudeSession(ctx);
    if (!activeId)
      return;
    spinnerSettings ??= loadSpinnerSettings();
    const settings = await spinnerSettings;
    if (el.isConnected)
      wireTurnStatus(el, activeId, settings.verbs, settings.frameSet);
  };
  const scan = (root) => {
    for (const el of root.querySelectorAll('[role="status"][aria-live="polite"]'))
      attach(el);
  };
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes)
        if (n instanceof HTMLElement)
          scan(n.parentElement ?? n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}
function CostLine({ sessionId, ctx }) {
  const [turns, setTurns] = import_react3.useState([]);
  const visibleRef = import_react3.useRef(true);
  import_react3.useEffect(() => {
    if (activeClaudeSession(ctx) !== sessionId)
      return;
    let alive = true;
    const fetchTurns = async () => {
      try {
        const r = await fetch(`${ROUTE}/turns?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok)
          return;
        const body = await r.json();
        if ("error" in body)
          return;
        if (alive)
          setTurns(body.turns ?? []);
      } catch {}
    };
    fetchTurns();
    const interval = setInterval(() => {
      if (visibleRef.current)
        fetchTurns();
    }, 1e4);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current)
        fetchTurns();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);
  const mine = activeClaudeSession(ctx) === sessionId;
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const last = turns[turns.length - 1];
  const text = mine && total > 0 && last ? costText(total, last.costUsd) : "";
  const title = mine && total > 0 && last ? `Claude cost: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})` : "";
  const anchorRef = import_react3.useRef(null);
  const [hooked, setHooked] = import_react3.useState(false);
  import_react3.useEffect(() => {
    if (!text) {
      setHooked(false);
      return;
    }
    let inline;
    let rowLead = "";
    const tryHook = () => {
      if (inline || !anchorRef.current?.isConnected)
        return;
      const statsRow = [...document.querySelectorAll("div")].filter((el) => el.children.length > 1 && /\d+ turns · \d+ steps/.test(el.textContent ?? "")).at(-1);
      if (!statsRow)
        return;
      inline = document.createElement("span");
      inline.title = title;
      inline.style.whiteSpace = "nowrap";
      const sep = document.createElement("span");
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "|";
      const body = document.createElement("span");
      body.textContent = ` ${text}`;
      inline.append(" ", sep, body);
      rowLead = (statsRow.firstElementChild?.textContent ?? "").replace(/\s+/g, "");
      statsRow.append(inline);
      setHooked(true);
    };
    tryHook();
    const timer = setInterval(tryHook, 1000);
    const MARK = "data-dsh-oh-my-claude-cost";
    const tipObserver = new MutationObserver((records) => {
      for (const rec of records)
        for (const node of rec.addedNodes) {
          if (!(node instanceof HTMLElement))
            continue;
          const tip = node.matches('[role="tooltip"]') ? node : node.querySelector('[role="tooltip"]');
          if (!tip || tip.hasAttribute(MARK) || !rowLead)
            continue;
          if (!(tip.textContent ?? "").replace(/\s+/g, "").startsWith(rowLead))
            continue;
          tip.setAttribute(MARK, "1");
          tip.append(` | ${text}`);
        }
    });
    tipObserver.observe(document.body, { childList: true, subtree: true });
    return () => {
      clearInterval(timer);
      tipObserver.disconnect();
      inline?.remove();
      setHooked(false);
    };
  }, [text, title]);
  if (!text)
    return /* @__PURE__ */ jsx_runtime2.jsx("span", {
      ref: anchorRef,
      hidden: true
    });
  return /* @__PURE__ */ jsx_runtime2.jsx("span", {
    ref: anchorRef,
    style: hooked ? { display: "none" } : undefined,
    children: /* @__PURE__ */ jsx_runtime2.jsxs("span", {
      title,
      style: { display: "inline", fontSize: 14, color: T.faint, whiteSpace: "nowrap" },
      children: [
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          "aria-hidden": "true",
          children: "|"
        }),
        " ",
        text
      ]
    })
  });
}
var costText = (total, last) => `${CLAUDE_MARK} ${fmtCost(total)} · ${fmtCost(last)} last`;
function IdleChip({ sessionId }) {
  const [deadline, setDeadline] = import_react3.useState(null);
  const visibleRef = import_react3.useRef(true);
  import_react3.useEffect(() => {
    let alive = true;
    const fetchIdle = async () => {
      try {
        const r = await fetch(`${ROUTE}/idle?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok)
          return;
        const body = await r.json();
        if ("error" in body)
          return;
        if (alive)
          setDeadline(body.deadline ?? null);
      } catch {}
    };
    fetchIdle();
    const interval = setInterval(() => {
      if (visibleRef.current)
        fetchIdle();
    }, 5000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current)
        fetchIdle();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);
  const remainingMs = deadline ? deadline - Date.now() : 0;
  if (!deadline || remainingMs > 60000)
    return null;
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  const extend = async () => {
    try {
      await fetch(`${ROUTE}/idle/extend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId })
      });
    } catch {}
  };
  return /* @__PURE__ */ jsx_runtime2.jsxs("span", {
    style: { display: "flex", alignItems: "center", gap: 6 },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("span", {
        style: { fontSize: 11, color: T.warn, fontFamily: T.mono },
        children: [
          "stopping in ",
          seconds,
          "s"
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        type: "button",
        style: btn,
        onClick: extend,
        children: "Extend"
      })
    ]
  });
}
function apply(ctx) {
  followDeepLink(ctx);
  watchContextMeter(ctx);
  watchTurnStatus(ctx);
  function Section() {
    const [boxes, setBoxes] = import_react3.useState([]);
    const [openBoxes, setOpenBoxes] = import_react3.useState(false);
    const [openSettings, setOpenSettings] = import_react3.useState(false);
    const [error, setError] = import_react3.useState("");
    import_react3.useEffect(() => {
      fetch(`${ROUTE}/boxes`).then((r) => readJson(r)).then((b) => setBoxes(b.boxes ?? [])).catch((e) => {
        setError(e.message);
        setBoxes([]);
      });
    }, []);
    return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
      children: [
        /* @__PURE__ */ jsx_runtime2.jsx("h2", {
          id: "dsh-oh-my-claude-heading",
          style: { marginTop: 0 },
          children: "Oh My Claude"
        }),
        /* @__PURE__ */ jsx_runtime2.jsx(Runtime, {
          onStatus: () => {}
        }),
        error && /* @__PURE__ */ jsx_runtime2.jsx("p", {
          style: { color: T.err, fontSize: 13 },
          children: error
        }),
        boxes !== null && /* @__PURE__ */ jsx_runtime2.jsx(Sessions, {
          ctx,
          boxes
        }),
        boxes !== null && /* @__PURE__ */ jsx_runtime2.jsx(Boxes, {
          boxes,
          setBoxes,
          open: openBoxes || boxes.length === 0,
          onToggle: () => setOpenBoxes((v) => !v)
        }),
        /* @__PURE__ */ jsx_runtime2.jsx(SettingsEditor, {
          open: openSettings,
          onToggle: () => setOpenSettings((v) => !v)
        })
      ]
    });
  }
  ctx.slots.inject("settings.section", () => {
    ctx.slots.register({
      name: "settings.section",
      id: "claude-code-sessions",
      order: 19,
      label: "Oh My Claude",
      inject: () => ({})
    }, Section);
    return null;
  });
  ctx.slots.inject("conversation.composer.dock", () => {
    ctx.slots.register({ name: "conversation.composer.dock", id: "claude-cost", order: 10 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime2.jsx(CostLine, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    return null;
  });
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register({ name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime2.jsx(IdleChip, {
      sessionId: props.sessionId
    }) : null);
    return null;
  });
  ctx.slots.inject("conversation.input.left", () => {
    ctx.slots.register({ name: "conversation.input.left", id: "claude-access", order: 40 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime2.jsx(AccessShield, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    ctx.slots.register({ name: "conversation.input.left", id: "oh-my-claude", order: 50 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime2.jsx(OhMyClaudeControl, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    return null;
  });
}

return module.exports; } });
