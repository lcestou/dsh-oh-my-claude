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
  name: () => name
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
var row = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid rgba(128,128,128,.2)"
};
var meta = { opacity: 0.65, fontSize: 12, whiteSpace: "nowrap" };
var btn = { padding: "4px 10px", cursor: "pointer" };
function apply(ctx) {
  const workspaceItems = () => ctx.workspaces.list.getSnapshot()?.items ?? [];
  const knownSessions = () => ctx.sessions.list.getSnapshot()?.byId ?? {};
  function Section() {
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
      fetch(`${ROUTE}/sessions?cwd=${encodeURIComponent(workspace.path)}`).then(async (r) => {
        if (!r.ok)
          throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      }).then((body) => {
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
        if (!knownSessions()[s.id]) {
          const r = await fetch(`${ROUTE}/open`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cwd: workspace.path, id: s.id })
          });
          if (!r.ok)
            throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
          await ctx.sessions.create({ workspaceId: workspace.workspaceId, sessionId: s.id });
        }
        ctx.sessions.open(s.id);
      } catch (e) {
        setError(String(e.message ?? e));
      } finally {
        setState("idle");
      }
    };
    const known = knownSessions();
    return /* @__PURE__ */ jsx_runtime.jsxs("div", {
      children: [
        /* @__PURE__ */ jsx_runtime.jsx("h2", {
          id: "dsh-llm-claude-heading",
          style: { marginTop: 0 },
          children: "Claude Code sessions"
        }),
        /* @__PURE__ */ jsx_runtime.jsx("p", {
          id: "dsh-llm-claude-description",
          style: { opacity: 0.75 },
          children: "Sessions Claude Code ran in this workspace, including ones started in the terminal. Open one to continue it here; the terminal transcript is read, never written."
        }),
        /* @__PURE__ */ jsx_runtime.jsxs("label", {
          id: "dsh-llm-claude-workspace-label",
          children: [
            "Workspace",
            " ",
            /* @__PURE__ */ jsx_runtime.jsx("select", {
              id: "dsh-llm-claude-workspace-select",
              value: workspaceId,
              onChange: (e) => setWorkspaceId(e.target.value),
              children: workspaces.map((w) => /* @__PURE__ */ jsx_runtime.jsx("option", {
                value: w.workspaceId,
                children: w.title || w.path
              }, w.workspaceId))
            })
          ]
        }),
        error && /* @__PURE__ */ jsx_runtime.jsx("p", {
          id: "dsh-llm-claude-error",
          style: { color: "#d33" },
          children: error
        }),
        state === "loading" && /* @__PURE__ */ jsx_runtime.jsx("p", {
          id: "dsh-llm-claude-loading",
          style: meta,
          children: "Loading…"
        }),
        state !== "loading" && workspace && sessions.length === 0 && /* @__PURE__ */ jsx_runtime.jsxs("p", {
          id: "dsh-llm-claude-empty",
          style: meta,
          children: [
            "No transcripts for ",
            workspace.path,
            "."
          ]
        }),
        /* @__PURE__ */ jsx_runtime.jsx("div", {
          id: "dsh-llm-claude-sessions",
          children: sessions.map((s) => {
            const opened = Boolean(known[s.id]);
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
                        whiteSpace: "nowrap"
                      },
                      children: s.title || s.id
                    }),
                    /* @__PURE__ */ jsx_runtime.jsxs("div", {
                      style: meta,
                      children: [
                        ago(s.modifiedAt),
                        " · ",
                        s.turns,
                        s.turnsPartial ? "+" : "",
                        " prompts · ",
                        size(s.bytes),
                        " · ",
                        s.id.slice(0, 8)
                      ]
                    })
                  ]
                }),
                /* @__PURE__ */ jsx_runtime.jsx("button", {
                  id: `dsh-llm-claude-session-${s.id}-button`,
                  type: "button",
                  style: btn,
                  disabled: busy,
                  onClick: () => open(s),
                  children: busy ? "Opening…" : opened ? "Show" : "Open"
                })
              ]
            }, s.id);
          })
        })
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
