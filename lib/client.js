window.__ModuleLoader__.load({ id: "dsh-llm-claude", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// src/client/index.jsx
var exports_client = {};
__export(exports_client, {
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  summarize: () => summarize
});
module.exports = __toCommonJS(exports_client);
var import_react = require("react");
var jsx_runtime = require("react/jsx-runtime");
var name = "dsh-llm-claude-client";
var inject = ["slots", "sessions", "workspaces"];
var ROUTE = "/dsh-llm-claude";
var ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600)
    return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400)
    return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
};
var size = (bytes) => bytes < 1e6 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
var T = {
  text: "var(--dsw-alias-label-primary, inherit)",
  muted: "var(--dsw-alias-label-secondary, rgba(128,128,128,.9))",
  faint: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.7))",
  border: "var(--dsw-alias-border-l2, rgba(128,128,128,.22))",
  card: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.06))",
  field: "var(--dsw-alias-bg-base, transparent)",
  brand: "var(--dsw-alias-brand-primary, #3b82f6)",
  ok: "var(--dsw-alias-state-success-primary, #22a06b)",
  warn: "var(--dsw-alias-state-warn-primary, #d9822b)",
  err: "var(--dsw-alias-state-error-primary, #d33)",
  mono: "var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  onBrand: "var(--dsw-alias-label-primary-inverted, #fff)"
};
var card = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: "16px 18px",
  marginTop: 16
};
var cardHead = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 10
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
  fontSize: 13
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
var select = {
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.field,
  color: T.text,
  fontSize: 13
};
var readJson = async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
};
function Origin({ s }) {
  if (!s.dsh)
    return /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: pill(T.faint),
      children: "terminal"
    });
  if (s.dsh.archived)
    return /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: pill(T.warn),
      children: "dsh · archived"
    });
  return /* @__PURE__ */ jsx_runtime.jsx("span", {
    style: pill(T.brand),
    children: "dsh"
  });
}
function summarize(settings) {
  if (!settings || typeof settings !== "object")
    return [];
  const out = [];
  const count = (v) => Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0;
  if (settings.model)
    out.push(["model", String(settings.model)]);
  if (settings.hooks && typeof settings.hooks === "object") {
    const events = Object.keys(settings.hooks);
    const hooks = events.reduce((n, e) => n + (Array.isArray(settings.hooks[e]) ? settings.hooks[e].reduce((m, g) => m + (Array.isArray(g?.hooks) ? g.hooks.length : 1), 0) : 0), 0);
    out.push(["hooks", `${hooks} on ${events.length} event${events.length === 1 ? "" : "s"}`]);
  }
  const p = settings.permissions;
  if (p && typeof p === "object") {
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
function SettingsEditor() {
  const [file, setFile] = import_react.useState(null);
  const [text, setText] = import_react.useState("");
  const [editing, setEditing] = import_react.useState(false);
  const [busy, setBusy] = import_react.useState(false);
  const [error, setError] = import_react.useState("");
  const [saved, setSaved] = import_react.useState("");
  const load = () => {
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/settings`).then(readJson).then((body) => {
      setFile(body);
      setText(body.text);
      setEditing(false);
      setSaved("");
    }).catch((e) => setError(String(e.message ?? e))).finally(() => setBusy(false));
  };
  import_react.useEffect(load, []);
  const parsed = import_react.useMemo(() => {
    try {
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        return { error: "settings.json must be a JSON object" };
      return { value };
    } catch (e) {
      return { error: String(e.message ?? e) };
    }
  }, [text]);
  const dirty = file !== null && text !== file.text;
  const canSave = dirty && !parsed.error && !busy;
  const save = () => {
    if (!canSave)
      return;
    setBusy(true);
    setError("");
    fetch(`${ROUTE}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    }).then(readJson).then((body) => {
      setFile((f) => ({ ...f, text, exists: true, mtime: body.mtime }));
      setEditing(false);
      setSaved(`Saved ${new Date(body.mtime).toLocaleTimeString()} · previous copy in ${body.backup}`);
    }).catch((e) => setError(String(e.message ?? e))).finally(() => setBusy(false));
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
  };
  const facts = summarize(parsed.value);
  return /* @__PURE__ */ jsx_runtime.jsxs("section", {
    id: "dsh-llm-claude-settings",
    style: card,
    children: [
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: cardHead,
        children: [
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("h3", {
                style: h3,
                children: "settings.json"
              }),
              /* @__PURE__ */ jsx_runtime.jsxs("div", {
                style: { ...meta, fontFamily: T.mono, marginTop: 2, whiteSpace: "normal" },
                children: [
                  file?.path ?? "…",
                  file && !file.exists ? " · not created yet" : ""
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: { display: "flex", gap: 8 },
            children: editing ? /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  id: "dsh-llm-claude-settings-cancel",
                  type: "button",
                  style: btn,
                  disabled: busy,
                  onClick: () => {
                    setText(file?.text ?? "");
                    setEditing(false);
                  },
                  children: "Cancel"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  id: "dsh-llm-claude-settings-save",
                  type: "button",
                  style: { ...btnPrimary, opacity: canSave ? 1 : 0.5 },
                  disabled: !canSave,
                  onClick: save,
                  children: busy ? "Saving…" : "Save"
                })
              ]
            }) : /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  type: "button",
                  style: btn,
                  disabled: busy,
                  onClick: load,
                  children: "Reload"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  id: "dsh-llm-claude-settings-edit",
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
            })
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("p", {
        style: { margin: "0 0 10px", color: T.muted, fontSize: 13 },
        children: "Claude Code's own settings: hooks, permissions, model, env. Edited here, read by every Claude Code process, in dsh or in a terminal. dsh's hooks and settings are separate."
      }),
      facts.length > 0 && /* @__PURE__ */ jsx_runtime.jsx("div", {
        style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 },
        children: facts.map(([k, v]) => /* @__PURE__ */ jsx_runtime.jsxs("span", {
          style: { ...pill(T.muted), fontWeight: 500, textTransform: "none", letterSpacing: 0 },
          children: [
            /* @__PURE__ */ jsx_runtime.jsx("b", {
              style: { fontWeight: 600 },
              children: k
            }),
            " ",
            v
          ]
        }, k))
      }),
      editing ? /* @__PURE__ */ jsx_runtime.jsx("textarea", {
        id: "dsh-llm-claude-settings-text",
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
      }) : /* @__PURE__ */ jsx_runtime.jsx("pre", {
        id: "dsh-llm-claude-settings-view",
        style: { ...code, maxHeight: 320, overflow: "auto", margin: 0 },
        children: text
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: { display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 },
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { fontSize: 12, color: parsed.error ? T.err : T.ok },
            children: parsed.error ? `Invalid JSON: ${parsed.error}` : `Valid JSON · ${Object.keys(parsed.value).length} keys${dirty ? " · unsaved changes" : ""}`
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, whiteSpace: "normal", textAlign: "right" },
            children: error ? /* @__PURE__ */ jsx_runtime.jsx("span", {
              style: { color: T.err },
              children: error
            }) : saved || (editing ? "Ctrl+S saves · Cancel discards" : "Read-only until Edit")
          })
        ]
      })
    ]
  });
}
function apply(ctx) {
  const workspaceItems = () => ctx.workspaces.list.getSnapshot()?.items ?? [];
  const knownSessions = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  function Sessions() {
    const [workspaces, setWorkspaces] = import_react.useState(workspaceItems);
    const [workspaceId, setWorkspaceId] = import_react.useState(() => workspaces[0]?.workspaceId ?? "");
    const [sessions, setSessions] = import_react.useState([]);
    const [state, setState] = import_react.useState("idle");
    const [error, setError] = import_react.useState("");
    const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
    import_react.useEffect(() => {
      const items = workspaceItems();
      setWorkspaces(items);
      if (!workspaceId && items[0])
        setWorkspaceId(items[0].workspaceId);
    }, []);
    import_react.useEffect(() => {
      if (!workspace)
        return;
      let live = true;
      setState("loading");
      setError("");
      fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(workspace.path)}`).then(readJson).then((body) => {
        if (!live)
          return;
        setSessions(body.sessions ?? []);
        setState("idle");
      }).catch((e) => {
        if (!live)
          return;
        setError(String(e.message ?? e));
        setState("idle");
      });
      return () => {
        live = false;
      };
    }, [workspace?.path]);
    const open = async (s) => {
      setState(`opening:${s.id}`);
      setError("");
      try {
        const id = s.dsh?.id ?? s.id;
        if (s.dsh?.archived || !s.dsh && !knownSessions()[id]) {
          await readJson(await fetch(`${ROUTE}/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: workspace.path, id: s.id })
          }));
          if (!s.dsh)
            await ctx.sessions.create({ workspaceId: workspace.workspaceId, sessionId: id });
        }
        ctx.sessions.open(id);
        if (s.dsh?.archived)
          setSessions((list) => list.map((x) => x.id === s.id ? { ...x, dsh: { ...x.dsh, archived: false } } : x));
      } catch (e) {
        setError(String(e.message ?? e));
      } finally {
        setState("idle");
      }
    };
    const known = knownSessions();
    const counts = sessions.reduce((c, s) => {
      c[!s.dsh ? "terminal" : s.dsh.archived ? "archived" : "dsh"]++;
      return c;
    }, { terminal: 0, dsh: 0, archived: 0 });
    return /* @__PURE__ */ jsx_runtime.jsxs("section", {
      id: "dsh-llm-claude-sessions-card",
      style: card,
      children: [
        /* @__PURE__ */ jsx_runtime.jsxs("div", {
          style: cardHead,
          children: [
            /* @__PURE__ */ jsx_runtime.jsxs("div", {
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("h3", {
                  style: h3,
                  children: "Sessions"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("div", {
                  style: { ...meta, marginTop: 2 },
                  children: state === "loading" ? "Loading…" : `${sessions.length} total · ${counts.dsh} in dsh · ${counts.archived} archived · ${counts.terminal} terminal only`
                })
              ]
            }),
            /* @__PURE__ */ jsx_runtime.jsxs("label", {
              id: "dsh-llm-claude-workspace-label",
              style: { fontSize: 13, color: T.muted },
              children: [
                "Workspace",
                " ",
                /* @__PURE__ */ jsx_runtime.jsx("select", {
                  id: "dsh-llm-claude-workspace-select",
                  style: select,
                  value: workspaceId,
                  onChange: (e) => setWorkspaceId(e.target.value),
                  children: workspaces.map((w) => /* @__PURE__ */ jsx_runtime.jsx("option", {
                    value: w.workspaceId,
                    children: w.title || w.path
                  }, w.workspaceId))
                })
              ]
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsx("p", {
          style: { margin: "0 0 4px", color: T.muted, fontSize: 13 },
          children: "Every Claude Code session of this workspace. Ones started here open their dsh session, archived ones are restored first; a terminal transcript is read, never written."
        }),
        error && /* @__PURE__ */ jsx_runtime.jsx("p", {
          id: "dsh-llm-claude-error",
          style: { color: T.err, fontSize: 13 },
          children: error
        }),
        state !== "loading" && workspace && sessions.length === 0 && /* @__PURE__ */ jsx_runtime.jsxs("p", {
          id: "dsh-llm-claude-empty",
          style: meta,
          children: [
            "No Claude Code sessions for ",
            workspace.path,
            "."
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsx("div", {
          id: "dsh-llm-claude-sessions",
          children: sessions.map((s) => {
            const opened = Boolean(known[s.dsh?.id ?? s.id]) && !s.dsh?.archived;
            const busy = state === `opening:${s.id}`;
            return /* @__PURE__ */ jsx_runtime.jsxs("div", {
              "data-testid": "dsh-llm-claude-session-row",
              style: row,
              children: [
                /* @__PURE__ */ jsx_runtime.jsxs("div", {
                  style: { flex: 1, minWidth: 0 },
                  children: [
                    /* @__PURE__ */ jsx_runtime.jsx("div", {
                      id: `dsh-llm-claude-session-${s.id}-title`,
                      style: {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: T.text
                      },
                      children: s.title || s.id
                    }),
                    /* @__PURE__ */ jsx_runtime.jsxs("div", {
                      style: { ...meta, marginTop: 2, display: "flex", gap: 8, alignItems: "center" },
                      children: [
                        /* @__PURE__ */ jsx_runtime.jsx(Origin, {
                          s
                        }),
                        /* @__PURE__ */ jsx_runtime.jsxs("span", {
                          children: [
                            ago(s.modifiedAt),
                            " · ",
                            s.turns,
                            s.turnsPartial ? "+" : "",
                            " prompts · ",
                            size(s.bytes),
                            " ·",
                            " ",
                            /* @__PURE__ */ jsx_runtime.jsx("span", {
                              style: { fontFamily: T.mono },
                              children: s.id.slice(0, 8)
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  id: `dsh-llm-claude-session-${s.id}-button`,
                  type: "button",
                  style: opened ? btn : btnPrimary,
                  disabled: busy,
                  onClick: () => open(s),
                  children: busy ? "Opening…" : opened ? "Show" : s.dsh?.archived ? "Restore" : "Open"
                })
              ]
            }, s.id);
          })
        })
      ]
    });
  }
  function Section() {
    return /* @__PURE__ */ jsx_runtime.jsxs("div", {
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("h2", {
          id: "dsh-llm-claude-heading",
          style: { marginTop: 0 },
          children: "Claude Code"
        }),
        /* @__PURE__ */ jsx_runtime.jsx(Sessions, {}),
        /* @__PURE__ */ jsx_runtime.jsx(SettingsEditor, {})
      ]
    });
  }
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "claude-code-sessions",
    order: 19,
    label: "Claude Code",
    inject: () => ({})
  }, Section));
}

return module.exports; } });
