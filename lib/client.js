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
  formatCacheRead: () => formatCacheRead,
  inject: () => inject,
  isOwnedActive: () => isOwnedActive,
  mergeVerbs: () => mergeVerbs,
  name: () => name,
  pageSessions: () => pageSessions,
  pickVerb: () => pickVerb,
  summarize: () => summarize
});
module.exports = __toCommonJS(exports_client);
var import_react4 = require("react");

// src/client/shared.ts
var import_react = require("react");
var ROUTE = "/dsh-oh-my-claude";
var maskEmail = (email) => {
  const at = email.indexOf("@");
  if (at < 1)
    return email;
  return `${email[0]}${"*".repeat(Math.max(3, at - 1))}${email.slice(at)}`;
};
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
var isClaudeSession = (ctx, id) => {
  try {
    const provider = ctx.modelDirectories.directoryFor(id).store.getSnapshot().current?.provider;
    return provider !== undefined && provider.startsWith("claude-code");
  } catch {
    return false;
  }
};
var activeClaudeSession = (ctx) => {
  const id = ctx.sessions.list.getSnapshot()?.current;
  if (!id)
    return;
  return isClaudeSession(ctx, id) ? id : undefined;
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
var import_react3 = require("react");

// src/client/tune.tsx
var import_react2 = require("react");

// src/permissions.ts
var PERMISSION_KINDS = ["allow", "deny", "ask"];
var RULE = /^[A-Za-z][\dA-Za-z_]*(\(.*\))?$/;
var settingsObject = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed))
    return;
  return parsed;
};
var ruleList = (settings, kind) => {
  const permissions = settings?.permissions;
  if (!(permissions instanceof Object) || Array.isArray(permissions))
    return [];
  const list = permissions[kind];
  return Array.isArray(list) ? list.filter((rule) => typeof rule === "string") : [];
};
function readPermissionRules(text) {
  const settings = settingsObject(text);
  return {
    allow: ruleList(settings, "allow"),
    deny: ruleList(settings, "deny"),
    ask: ruleList(settings, "ask")
  };
}
function setPermissionRule(text, kind, rule, action) {
  if (action === "add" && !RULE.test(rule.trim()))
    return { error: `a rule is a tool name, optionally with a specifier: Bash(npm run:*)` };
  const settings = settingsObject(text);
  if (settings === undefined)
    return { error: "settings.json must be a JSON object" };
  const current = ruleList(settings, kind);
  const next = action === "add" ? [...new Set([...current, rule.trim()])] : current.filter((r) => r !== rule);
  const permissions = settings.permissions instanceof Object && !Array.isArray(settings.permissions) ? { ...settings.permissions } : {};
  if (next.length === 0)
    delete permissions[kind];
  else
    permissions[kind] = next;
  if (Object.keys(permissions).length === 0)
    delete settings.permissions;
  else
    settings.permissions = permissions;
  return { text: `${JSON.stringify(settings, null, 2)}
` };
}

// src/client/tune.tsx
var jsx_runtime = require("react/jsx-runtime");
var isFable = (value) => String(value ?? "").startsWith("claude-fable");
var cacheTtl = (value) => value === "5m" || value === "1h" ? value : undefined;
var isCacheTtlKey = (key) => key === "promptCacheTtl" || key === "subagentPromptCacheTtl";
var DEADLINES = ["60s", "5m", "10m", "never"];
var isDeadline = (value) => DEADLINES.some((d) => d === value);
var isDeadlineKey = (key) => key === "askUserQuestionTimeout" || key === "dialogExpiry";
var OUTPUT_MIN = 4000;
var OUTPUT_MAX = 128000;
var isOutputKey = (key) => key === "bashOutputMaxChars" || key === "taskOutputMaxChars";
function updateSettings(text, key, value) {
  if (key === "autoCompactWindow" && value !== undefined && !(Number.isInteger(value) && Number(value) > 0))
    return { error: "auto-compact must be a positive whole number of tokens" };
  if (isCacheTtlKey(key) && value !== undefined && cacheTtl(value) === undefined)
    return { error: "cache TTL must be 5m or 1h" };
  if (isDeadlineKey(key) && value !== undefined && !isDeadline(value))
    return { error: "deadline must be 60s, 5m, 10m or never" };
  if (isOutputKey(key) && value !== undefined && !(Number.isInteger(value) && Number(value) >= OUTPUT_MIN && Number(value) <= OUTPUT_MAX))
    return { error: `output limit must be a whole number between ${OUTPUT_MIN} and ${OUTPUT_MAX}` };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "settings.json is not valid JSON" };
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed))
    return { error: "settings.json must be a JSON object" };
  const obj = parsed;
  const [outer, inner] = key.split(".");
  if (inner === undefined) {
    if (value === undefined)
      delete obj[key];
    else
      obj[key] = value;
  } else {
    const held = obj[outer ?? ""];
    const nested = held instanceof Object && !Array.isArray(held) ? { ...held } : {};
    if (value === undefined)
      delete nested[inner];
    else
      nested[inner] = value;
    if (Object.keys(nested).length === 0)
      delete obj[outer ?? ""];
    else
      obj[outer ?? ""] = nested;
  }
  return { text: `${JSON.stringify(obj, null, 2)}
` };
}
function readTunables(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (!(parsed instanceof Object) || Array.isArray(parsed))
    return {};
  const obj = parsed;
  const out = {};
  const style = obj.outputStyle;
  if (style !== null && style !== undefined && style !== "")
    out.outputStyle = String(style);
  if (obj.alwaysThinkingEnabled === true)
    out.alwaysThinkingEnabled = true;
  if (obj.showThinkingSummaries === true)
    out.showThinkingSummaries = true;
  if (Number.isInteger(obj.autoCompactWindow))
    out.autoCompactWindow = Number(obj.autoCompactWindow);
  const ttl = cacheTtl(obj.promptCacheTtl);
  if (ttl !== undefined)
    out.promptCacheTtl = ttl;
  const subagentTtl = cacheTtl(obj.subagentPromptCacheTtl);
  if (subagentTtl !== undefined)
    out.subagentPromptCacheTtl = subagentTtl;
  const advisor = obj.advisorModel;
  if (advisor !== null && advisor !== undefined && advisor !== "" && advisor !== true && advisor !== false)
    out.advisorModel = String(advisor);
  const fallback = obj.fallbackModel;
  if (fallback !== null && fallback !== undefined && fallback !== "" && fallback !== true && fallback !== false)
    out.fallbackModel = String(fallback);
  if (isDeadline(obj.askUserQuestionTimeout))
    out.askUserQuestionTimeout = String(obj.askUserQuestionTimeout);
  if (isDeadline(obj.dialogExpiry))
    out.dialogExpiry = String(obj.dialogExpiry);
  if (Number.isInteger(obj.bashOutputMaxChars))
    out.bashOutputMaxChars = Number(obj.bashOutputMaxChars);
  if (Number.isInteger(obj.taskOutputMaxChars))
    out.taskOutputMaxChars = Number(obj.taskOutputMaxChars);
  const attribution = obj.attribution;
  if (attribution instanceof Object && !Array.isArray(attribution)) {
    const commit = attribution.commit;
    const pr = attribution.pr;
    if (String(commit) === commit)
      out["attribution.commit"] = commit;
    if (String(pr) === pr)
      out["attribution.pr"] = pr;
    if (attribution.sessionUrl === true || attribution.sessionUrl === false)
      out["attribution.sessionUrl"] = attribution.sessionUrl;
  }
  return out;
}
var noTrailers = (t) => t["attribution.commit"] === "" && t["attribution.pr"] === "" && t["attribution.sessionUrl"] === false;
var read = () => fetch(`${ROUTE}/settings`).then((r) => readJson(r));
var source = (set) => set ? "settings.json" : "Claude Code default";
var check = (on) => on ? "pointer" : "not-allowed";
var THINKING_PRESETS = [
  { label: "Session default", tokens: null },
  { label: "Off", tokens: 0 },
  { label: "Think · 4k", tokens: 4000 },
  { label: "Think hard · 10k", tokens: 1e4 },
  { label: "Ultrathink · 32k", tokens: 31999 }
];
function TuneBody({ sessionId }) {
  const narrow = useNarrow();
  const [file, setFile] = import_react2.useState(null);
  const [error, setError] = import_react2.useState("");
  const [busy, setBusy] = import_react2.useState(false);
  const [models, setModels] = import_react2.useState(null);
  const [modelsError, setModelsError] = import_react2.useState("");
  const [extraUsage, setExtraUsage] = import_react2.useState(null);
  const [creditsError, setCreditsError] = import_react2.useState("");
  const [showTrailers, setShowTrailers] = import_react2.useState(false);
  const [thinkBudget, setThinkBudget] = import_react2.useState(undefined);
  const [thinkBusy, setThinkBusy] = import_react2.useState(false);
  const [thinkErr, setThinkErr] = import_react2.useState("");
  import_react2.useEffect(() => {
    let live = true;
    read().then((f) => live && setFile(f), (e) => live && setError(e.message));
    fetch(`${ROUTE}/models`).then((r) => readJson(r)).then((b) => live && setModels(b.models ?? [])).catch((e) => live && setModelsError(e.message));
    fetch(`${ROUTE}/usage`).then((r) => readJson(r)).then((b) => live && setExtraUsage(b.extraUsage === true)).catch((e) => live && setCreditsError(e.message));
    fetch(`${ROUTE}/thinking?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((b) => live && setThinkBudget(b.tokens)).catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId]);
  if (!file)
    return error ? /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: { color: T.err, fontSize: 12 },
      children: error
    }) : /* @__PURE__ */ jsx_runtime.jsx("span", {
      style: { ...meta, padding: "2px 4px" },
      children: "Loading…"
    });
  const settings = readTunables(file.text);
  const apply = async (mutate) => {
    setBusy(true);
    setError("");
    try {
      const fresh = await read();
      if (fresh.mtime !== file.mtime) {
        setFile(fresh);
        return "settings.json changed on disk; the tab now shows the new values, try again";
      }
      const next = mutate(fresh.text);
      if (next.error !== undefined)
        return next.error;
      setFile(await readJson(await fetch(`${ROUTE}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: next.text })
      })));
      return;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    } finally {
      setBusy(false);
    }
  };
  const writeAll = async (edits) => {
    const failure = await apply((text) => {
      let out = { text };
      for (const [key, value] of edits) {
        if (out.error !== undefined)
          return out;
        out = updateSettings(out.text, key, value);
      }
      return out;
    });
    if (failure)
      setError(failure);
  };
  const write = async (key, value) => {
    if (key === "advisorModel" && isFable(value) && extraUsage !== true) {
      setError(creditsError ? `Cannot set a Fable advisor: the usage credit state could not be read (${creditsError}).` : "A Fable advisor bills to usage credits. Enable them from a terminal with /model fable first.");
      return;
    }
    const failure = await apply((text) => updateSettings(text, key, value));
    if (failure)
      setError(failure);
  };
  const setThinking = async (tokens) => {
    setThinkBusy(true);
    setThinkErr("");
    try {
      const reply = await readJson(await fetch(`${ROUTE}/thinking`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, tokens })
      }));
      if (reply.ok)
        setThinkBudget(reply.tokens);
      else
        setThinkErr(reply.error ?? "could not set the thinking budget");
    } catch (e) {
      setThinkErr(e instanceof Error ? e.message : String(e));
    } finally {
      setThinkBusy(false);
    }
  };
  const rowStyle = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "8px 6px",
    borderTop: `1px solid ${T.border}`,
    flexWrap: "wrap"
  };
  const labelStyle = {
    fontSize: 13,
    color: T.text,
    flex: "0 0 auto",
    minWidth: 100
  };
  const sourceStyle = { ...meta, marginLeft: "auto" };
  const controlStyle = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flex: narrow ? "1 1 auto" : "0 0 auto",
    minWidth: 0
  };
  const thinking = settings.alwaysThinkingEnabled === true;
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: bodyFlow,
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "2px 4px", whiteSpace: "normal" },
        children: "Saved to Claude Code's settings.json; each takes effect the next time Claude spawns."
      }),
      error ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { color: T.err, fontSize: 12, padding: "0 4px" },
        children: error
      }) : null,
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Output style"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.outputStyle ?? "",
              disabled: busy,
              "aria-label": "Output style",
              onChange: (e) => void write("outputStyle", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Default"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "Explanatory",
                  children: "Explanatory"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "Learning",
                  children: "Learning"
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.outputStyle !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Thinking"
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: controlStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsxs("label", {
                style: { display: "flex", alignItems: "center", gap: 6, cursor: check(!busy) },
                children: [
                  /* @__PURE__ */ jsx_runtime.jsx("input", {
                    type: "checkbox",
                    checked: thinking,
                    disabled: busy,
                    onChange: (e) => void write("alwaysThinkingEnabled", e.target.checked || undefined),
                    style: { cursor: check(!busy) }
                  }),
                  /* @__PURE__ */ jsx_runtime.jsx("span", {
                    style: { fontSize: 12 },
                    children: "Always on"
                  })
                ]
              }),
              /* @__PURE__ */ jsx_runtime.jsxs("label", {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: check(thinking && !busy),
                  opacity: thinking ? 1 : 0.5
                },
                children: [
                  /* @__PURE__ */ jsx_runtime.jsx("input", {
                    type: "checkbox",
                    checked: settings.showThinkingSummaries === true,
                    disabled: busy || !thinking,
                    onChange: (e) => void write("showThinkingSummaries", e.target.checked || undefined),
                    style: { cursor: check(thinking && !busy) }
                  }),
                  /* @__PURE__ */ jsx_runtime.jsx("span", {
                    style: { fontSize: 12 },
                    children: "Show summaries"
                  })
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(thinking || settings.showThinkingSummaries === true)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Thinking budget"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsx("select", {
              value: thinkBudget == null ? "" : String(thinkBudget),
              disabled: thinkBusy,
              "aria-label": "Thinking budget for this session",
              onChange: (e) => void setThinking(e.target.value === "" ? null : Number(e.target.value)),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: THINKING_PRESETS.map((p) => /* @__PURE__ */ jsx_runtime.jsx("option", {
                value: p.tokens == null ? "" : String(p.tokens),
                children: p.label
              }, p.label))
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: thinkErr ? /* @__PURE__ */ jsx_runtime.jsx("span", {
              style: { color: T.err },
              children: thinkErr
            }) : "live · this session"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Auto-compact"
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: controlStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("input", {
                type: "number",
                min: "1",
                step: "1000",
                defaultValue: settings.autoCompactWindow ?? "",
                disabled: busy,
                placeholder: "Claude Code default",
                "aria-label": "Auto-compact window in tokens",
                onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur(),
                onBlur: (e) => {
                  const typed = e.target.value.trim();
                  const next = typed === "" ? undefined : Number(typed);
                  if (next !== settings.autoCompactWindow)
                    write("autoCompactWindow", next);
                },
                style: { ...inputStyle, maxWidth: narrow ? "100%" : 140 }
              }, file.mtime),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: { ...meta },
                children: "tokens"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.autoCompactWindow !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Cache TTL"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.promptCacheTtl ?? "",
              disabled: busy,
              "aria-label": "Prompt cache TTL",
              onChange: (e) => void write("promptCacheTtl", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Default"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "5m",
                  children: "5 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "1h",
                  children: "1 hour"
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.promptCacheTtl !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Subagent cache TTL"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.subagentPromptCacheTtl ?? "",
              disabled: busy,
              "aria-label": "Subagent prompt cache TTL",
              onChange: (e) => void write("subagentPromptCacheTtl", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Default"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "5m",
                  children: "5 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "1h",
                  children: "1 hour"
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.subagentPromptCacheTtl !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: "An hour keeps the cache warm across longer breaks, and hour-long cache writes are billed at a higher rate."
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Advisor"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.advisorModel ?? "",
              disabled: busy || models === null,
              "aria-label": "Advisor model",
              onChange: (e) => void write("advisorModel", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Off"
                }),
                models?.map((m) => {
                  const blocked = isFable(m.id) && extraUsage !== true;
                  return /* @__PURE__ */ jsx_runtime.jsxs("option", {
                    value: m.id,
                    disabled: blocked,
                    children: [
                      m.name,
                      blocked ? " (needs usage credits)" : ""
                    ]
                  }, m.id);
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.advisorModel !== undefined)
          })
        ]
      }),
      modelsError && /* @__PURE__ */ jsx_runtime.jsxs("span", {
        style: { color: T.err, fontSize: 12, padding: "0 4px" },
        children: [
          "Could not read the model list: ",
          modelsError
        ]
      }),
      creditsError ? /* @__PURE__ */ jsx_runtime.jsxs("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: [
          "The usage credit state could not be read (",
          creditsError,
          "), so a Fable advisor stays off the list: with credits disabled the CLI refuses to start at all."
        ]
      }) : extraUsage === false ? /* @__PURE__ */ jsx_runtime.jsxs("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: [
          "A Fable advisor bills to usage credits, which have to be enabled first. Open a terminal and run ",
          /* @__PURE__ */ jsx_runtime.jsx("code", {
            style: { background: T.card, padding: "2px 4px" },
            children: "/model fable"
          }),
          " to review and enable them."
        ]
      }) : null,
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: "An advisor weaker than the main model is not used for the main conversation, though subagents may still use it."
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Fallback model"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.fallbackModel ?? "",
              disabled: busy || models === null,
              "aria-label": "Fallback model",
              onChange: (e) => void write("fallbackModel", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Off"
                }),
                models?.map((m) => /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: m.id,
                  children: m.name
                }, m.id))
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.fallbackModel !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: "Where the CLI goes when the main model is overloaded. With none set, an overload ends the turn; the swap itself is reported in the reasoning lane when it happens."
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Question deadline"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.askUserQuestionTimeout ?? "",
              disabled: busy,
              "aria-label": "Idle time before Claude's questions auto-continue",
              onChange: (e) => void write("askUserQuestionTimeout", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Default (never)"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "60s",
                  children: "1 minute"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "5m",
                  children: "5 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "10m",
                  children: "10 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "never",
                  children: "Never"
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.askUserQuestionTimeout !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Approval deadline"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: controlStyle,
            children: /* @__PURE__ */ jsx_runtime.jsxs("select", {
              value: settings.dialogExpiry ?? "",
              disabled: busy,
              "aria-label": "How long a parked permission prompt waits for an answer",
              onChange: (e) => void write("dialogExpiry", e.target.value || undefined),
              style: {
                ...select,
                flex: narrow ? "1 1 auto" : "0 0 auto",
                minWidth: narrow ? 0 : 160
              },
              children: [
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "",
                  children: "Default (5 minutes)"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "60s",
                  children: "1 minute"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "5m",
                  children: "5 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "10m",
                  children: "10 minutes"
                }),
                /* @__PURE__ */ jsx_runtime.jsx("option", {
                  value: "never",
                  children: "Never"
                })
              ]
            })
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.dialogExpiry !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: "A question left unanswered continues with whatever is selected so far; a permission prompt left unanswered is cancelled. At the question default, an unattended session waits forever."
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Bash output"
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: controlStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("input", {
                type: "number",
                min: OUTPUT_MIN,
                max: OUTPUT_MAX,
                step: "1000",
                defaultValue: settings.bashOutputMaxChars ?? "",
                disabled: busy,
                placeholder: "Claude Code default",
                "aria-label": "Characters of bash output Claude receives",
                onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur(),
                onBlur: (e) => {
                  const typed = e.target.value.trim();
                  const next = typed === "" ? undefined : Number(typed);
                  if (next !== settings.bashOutputMaxChars)
                    write("bashOutputMaxChars", next);
                },
                style: { ...inputStyle, maxWidth: narrow ? "100%" : 140 }
              }, file.mtime),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: { ...meta },
                children: "characters"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.bashOutputMaxChars !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Task output"
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: controlStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("input", {
                type: "number",
                min: OUTPUT_MIN,
                max: OUTPUT_MAX,
                step: "1000",
                defaultValue: settings.taskOutputMaxChars ?? "",
                disabled: busy,
                placeholder: "Claude Code default",
                "aria-label": "Characters of subagent output Claude receives",
                onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur(),
                onBlur: (e) => {
                  const typed = e.target.value.trim();
                  const next = typed === "" ? undefined : Number(typed);
                  if (next !== settings.taskOutputMaxChars)
                    write("taskOutputMaxChars", next);
                },
                style: { ...inputStyle, maxWidth: narrow ? "100%" : 140 }
              }, file.mtime),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: { ...meta },
                children: "characters"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings.taskOutputMaxChars !== undefined)
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("span", {
        style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
        children: [
          "These two size what Claude receives, between ",
          OUTPUT_MIN,
          " and ",
          OUTPUT_MAX,
          " characters. The plugin's own tool text limit sizes only what this panel draws."
        ]
      }),
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: rowStyle,
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: labelStyle,
            children: "Attribution"
          }),
          /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: controlStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsxs("label", {
                style: { display: "flex", alignItems: "center", gap: 6, cursor: check(!busy) },
                children: [
                  /* @__PURE__ */ jsx_runtime.jsx("input", {
                    type: "checkbox",
                    checked: noTrailers(settings),
                    disabled: busy,
                    onChange: (e) => void writeAll(e.target.checked ? [
                      ["attribution.commit", ""],
                      ["attribution.pr", ""],
                      ["attribution.sessionUrl", false]
                    ] : [
                      ["attribution.commit", undefined],
                      ["attribution.pr", undefined],
                      ["attribution.sessionUrl", undefined]
                    ]),
                    style: { cursor: check(!busy) }
                  }),
                  /* @__PURE__ */ jsx_runtime.jsx("span", {
                    style: { fontSize: 12 },
                    children: "No AI trailers"
                  })
                ]
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                onClick: () => setShowTrailers(!showTrailers),
                "aria-expanded": showTrailers,
                style: {
                  ...meta,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: "underline"
                },
                children: showTrailers ? "Hide custom text" : "Custom text"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: sourceStyle,
            children: source(settings["attribution.commit"] !== undefined || settings["attribution.pr"] !== undefined || settings["attribution.sessionUrl"] !== undefined)
          })
        ]
      }),
      showTrailers ? /* @__PURE__ */ jsx_runtime.jsxs(jsx_runtime.Fragment, {
        children: [
          [
            ["attribution.commit", "Commit trailer", "Text Claude adds to commits it writes"],
            ["attribution.pr", "PR text", "Text Claude adds to pull request descriptions"]
          ].map(([key, label, hint]) => /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: rowStyle,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: labelStyle,
                children: label
              }),
              /* @__PURE__ */ jsx_runtime.jsx("div", {
                style: { ...controlStyle, flex: "1 1 auto" },
                children: /* @__PURE__ */ jsx_runtime.jsx("input", {
                  type: "text",
                  defaultValue: settings[key] ?? "",
                  disabled: busy,
                  placeholder: "Claude Code default",
                  "aria-label": hint,
                  onKeyDown: (e) => e.key === "Enter" && e.currentTarget.blur(),
                  onBlur: (e) => {
                    const typed = e.target.value;
                    if (typed !== (settings[key] ?? ""))
                      write(key, typed);
                  },
                  style: { ...inputStyle, flex: "1 1 auto", minWidth: 0 }
                }, `${key}-${file.mtime}`)
              }),
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: sourceStyle,
                children: source(settings[key] !== undefined)
              })
            ]
          }, key)),
          /* @__PURE__ */ jsx_runtime.jsx("span", {
            style: { ...meta, padding: "0 6px 2px", whiteSpace: "normal" },
            children: "An empty box writes an empty string, which is how the CLI is told to add nothing. Clear the switch above to hand both back to Claude Code's own wording."
          })
        ]
      }) : null,
      /* @__PURE__ */ jsx_runtime.jsx(PermissionsBlock, {
        file,
        apply,
        sessionId,
        narrow,
        busy
      })
    ]
  });
}
function PermissionsBlock({
  file,
  apply,
  sessionId,
  narrow,
  busy
}) {
  const [kind, setKind] = import_react2.useState("allow");
  const [draft, setDraft] = import_react2.useState("");
  const [error, setError] = import_react2.useState("");
  const [asks, setAsks] = import_react2.useState([]);
  const rules = readPermissionRules(file.text);
  import_react2.useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/permission-asks?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((body) => {
      if (live)
        setAsks(body.asks ?? []);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId]);
  const change = async (action, ruleKind, rule) => {
    setError("");
    const failure = await apply((text) => setPermissionRule(text, ruleKind, rule, action));
    if (failure)
      setError(failure);
    else if (action === "add")
      setDraft("");
  };
  const known = new Set([...rules.allow, ...rules.deny, ...rules.ask]);
  const unused = asks.filter((rule) => !known.has(rule));
  const heading = { ...meta, marginBottom: 4, textTransform: "capitalize" };
  const ruleRow = {
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "4px 4px",
    fontSize: 13,
    color: T.text
  };
  const small = {
    padding: "2px 8px",
    fontSize: 12,
    background: "transparent",
    color: T.text,
    border: `1px solid ${T.border}`,
    borderRadius: 3,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.6 : 1
  };
  return /* @__PURE__ */ jsx_runtime.jsxs("div", {
    style: { borderTop: `1px solid ${T.border}`, marginTop: 16, paddingTop: 12 },
    children: [
      /* @__PURE__ */ jsx_runtime.jsx("div", {
        style: { fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 },
        children: "Permissions"
      }),
      /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { ...meta, padding: "0 4px 8px", whiteSpace: "normal" },
        children: "Rules Claude Code answers a tool request with instead of asking. They apply wherever this settings.json is read, in dsh or in a terminal."
      }),
      error ? /* @__PURE__ */ jsx_runtime.jsx("span", {
        style: { color: T.err, fontSize: 12, padding: "0 4px", display: "block" },
        children: error
      }) : null,
      PERMISSION_KINDS.filter((k) => rules[k].length > 0).map((k) => /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: { marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: heading,
            children: k
          }),
          rules[k].map((rule) => /* @__PURE__ */ jsx_runtime.jsxs("div", {
            style: ruleRow,
            children: [
              /* @__PURE__ */ jsx_runtime.jsx("span", {
                style: { flex: 1, wordBreak: "break-all", fontFamily: T.mono },
                children: rule
              }),
              /* @__PURE__ */ jsx_runtime.jsx("button", {
                type: "button",
                "aria-label": `Remove ${rule}`,
                onClick: () => void change("remove", k, rule),
                disabled: busy,
                style: small,
                children: "Remove"
              })
            ]
          }, rule))
        ]
      }, k)),
      unused.length > 0 ? /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: { marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: heading,
            children: "Asked about this session"
          }),
          /* @__PURE__ */ jsx_runtime.jsx("div", {
            style: { display: "flex", flexWrap: "wrap", gap: 6 },
            children: unused.map((rule) => /* @__PURE__ */ jsx_runtime.jsx("button", {
              type: "button",
              onClick: () => {
                setDraft(rule);
                setError("");
              },
              disabled: busy,
              style: { ...small, fontFamily: T.mono },
              title: rule,
              children: rule
            }, rule))
          })
        ]
      }) : null,
      /* @__PURE__ */ jsx_runtime.jsxs("div", {
        style: {
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 8,
          flexWrap: narrow ? "wrap" : "nowrap"
        },
        children: [
          /* @__PURE__ */ jsx_runtime.jsx("select", {
            value: kind,
            "aria-label": "Rule kind",
            onChange: (e) => {
              setKind(e.target.value);
            },
            disabled: busy,
            style: { ...select, flex: "0 0 auto", minWidth: 90, textTransform: "capitalize" },
            children: PERMISSION_KINDS.map((k) => /* @__PURE__ */ jsx_runtime.jsx("option", {
              value: k,
              children: k
            }, k))
          }),
          /* @__PURE__ */ jsx_runtime.jsx("input", {
            type: "text",
            value: draft,
            "aria-label": "Rule",
            onChange: (e) => setDraft(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter" && draft.trim())
                change("add", kind, draft);
            },
            placeholder: "Bash(npm run:*)",
            disabled: busy,
            style: { ...inputStyle, flex: 1, minWidth: narrow ? 0 : 200, fontFamily: T.mono }
          }),
          /* @__PURE__ */ jsx_runtime.jsx("button", {
            type: "button",
            onClick: () => void change("add", kind, draft),
            disabled: busy || draft.trim() === "",
            style: { ...small, padding: "6px 12px", opacity: busy || !draft.trim() ? 0.6 : 1 },
            children: "Add"
          })
        ]
      })
    ]
  });
}

// src/client/notices.ts
function newlyWaiting(prev, next) {
  if (prev === null)
    return [];
  const out = [];
  for (const id of Object.keys(next.byId)) {
    if (id === next.current)
      continue;
    const was = prev.byId[id];
    const now = next.byId[id];
    if (was === undefined || now === undefined)
      continue;
    const stopped = was.running === true && now.running !== true;
    const finished = now.completed === true && was.completed !== true;
    if (stopped || finished)
      out.push(id);
  }
  return out;
}
var MARK = "● ";
var markTitle = (title, waiting) => waiting > 0 ? MARK + stripMark(title) : stripMark(title);
var stripMark = (title) => title.startsWith(MARK) ? title.slice(MARK.length) : title;
var KEY = "omc.sessionNotices";
var noticesOn = () => {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};
var setNoticesOn = (on) => {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
};

// src/client/panel.tsx
var jsx_runtime2 = require("react/jsx-runtime");
var lastTab = "Memory";
var easeMs = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
function TranscriptRow({
  s,
  cwd,
  ctx,
  onClose
}) {
  const label = s.title ?? s.id;
  return /* @__PURE__ */ jsx_runtime2.jsxs("button", {
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
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: {
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        },
        children: label
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, flex: "none", marginLeft: 8 },
        children: ago(s.modifiedAt)
      })
    ]
  });
}
function useFeatureSwitches(cwd) {
  const [switches, setSwitches] = import_react3.useState(null);
  import_react3.useEffect(() => {
    if (!cwd)
      return;
    let live = true;
    fetch(`${ROUTE}/feature-switches?cwd=${encodeURIComponent(cwd)}`).then((r) => readJson(r)).then((b) => live && setSwitches(b)).catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);
  return switches;
}
var retentionNote = (s) => s === null ? "" : `Claude Code deletes transcripts older than ${s.retention.days} days` + `${s.retention.scope === null ? " (cleanupPeriodDays, its default)" : ` (cleanupPeriodDays in ${s.retention.scope} settings)`}.`;
function RestoreBody({
  sessionId,
  ctx,
  onClose
}) {
  const entry = ctx.sessions.list.getSnapshot()?.byId[sessionId];
  const cwd = entry?.cwd;
  const [transcripts, setTranscripts] = import_react3.useState([]);
  const switches = useFeatureSwitches(cwd);
  import_react3.useEffect(() => {
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
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: bodyFlow,
    children: [
      rest.map((s) => /* @__PURE__ */ jsx_runtime2.jsx(TranscriptRow, {
        s,
        cwd,
        ctx,
        onClose
      }, s.id)),
      owned.length > 0 && /* @__PURE__ */ jsx_runtime2.jsxs("span", {
        style: { fontSize: 11, color: T.faint, padding: "2px 4px" },
        children: [
          owned.length,
          " already open"
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px", whiteSpace: "normal" },
        children: retentionNote(switches)
      })
    ]
  });
}
function MemoryBody({ sessionId, ctx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = import_react3.useState([]);
  const [file, setFile] = import_react3.useState(null);
  const [text, setText] = import_react3.useState("");
  const [saved, setSaved] = import_react3.useState("");
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const q = cwd ? `cwd=${encodeURIComponent(cwd)}` : "";
  const refresh = () => {
    if (!cwd)
      return;
    fetch(`${ROUTE}/memory?${q}`).then((r) => readJson(r)).then((b) => setFiles(b.files ?? [])).catch((e) => setError(e.message));
  };
  import_react3.useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [cwd]);
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
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: bodyFlow,
    children: [
      file === null ? files.map((f) => /* @__PURE__ */ jsx_runtime2.jsxs("button", {
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
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { flex: "none", fontFamily: T.mono, fontSize: 12 },
            children: f.name
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
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
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: ago(f.mtime)
          })
        ]
      }, f.name)) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8 },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                onClick: () => setFile(null),
                disabled: busy,
                children: "‹ Back"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { flex: 1, fontFamily: T.mono, fontSize: 12 },
                children: file
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                onClick: remove,
                disabled: busy,
                children: "Delete"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: dirty ? btnPrimary : btn,
                onClick: save,
                disabled: busy || !dirty,
                children: "Save"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
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
      error && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: error
      })
    ]
  });
}
var shortPath = (path, cwd) => path.startsWith(`${cwd}/`) ? `./${path.slice(cwd.length + 1)}` : path.replace(/^\/home\/[^/]+\//, "~/");
var PLUGIN_SCOPE_OPTS = [
  { value: "user", label: "User" },
  { value: "project", label: "Project" },
  { value: "local", label: "Local" }
];
function MarketplaceAddForm({ act, busy }) {
  const [source, setSource] = import_react3.useState("");
  const [scope, setScope] = import_react3.useState("user");
  const submit = async () => {
    if (await act("/plugins/marketplace/add", { source, scope }, "mkt-add"))
      setSource("");
  };
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: { display: "flex", gap: 6, marginTop: 6 },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("input", {
        type: "text",
        placeholder: "marketplace: URL, path or owner/repo",
        value: source,
        onChange: (e) => setSource(e.currentTarget.value),
        disabled: busy !== "",
        style: { ...inputStyle, fontSize: 12 }
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("select", {
        value: scope,
        onChange: (e) => setScope(e.currentTarget.value),
        disabled: busy !== "",
        style: { ...select, fontSize: 12 },
        children: PLUGIN_SCOPE_OPTS.map((o) => /* @__PURE__ */ jsx_runtime2.jsx("option", {
          value: o.value,
          children: o.label
        }, o.value))
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        type: "button",
        style: btn,
        disabled: busy !== "" || source.trim() === "",
        onClick: submit,
        children: busy === "mkt-add" ? "…" : "Add"
      })
    ]
  });
}
function PluginManagerBlock({
  roster,
  sessionId,
  onChanged
}) {
  const [busy, setBusy] = import_react3.useState("");
  const [error, setError] = import_react3.useState("");
  const [applied, setApplied] = import_react3.useState("");
  const act = async (path, body, id) => {
    setBusy(id);
    setError("");
    try {
      const r = await readJson(await fetch(`${ROUTE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, ...body })
      }));
      if (!r.ok) {
        setError(r.error ?? "failed");
        return false;
      }
      setApplied(r.live === true ? "Applied to this session." : "Takes effect at the next spawn.");
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy("");
    }
  };
  if (roster === null)
    return null;
  const { plugins, marketplaces } = roster;
  const line = {
    flex: 1,
    minWidth: 0,
    fontFamily: T.mono,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap"
  };
  const small = { ...btn, flex: "none", padding: "0 6px", fontSize: 11 };
  return /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
        children: "Plugins and marketplaces"
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { padding: "2px 10px", fontSize: 12, lineHeight: "1.7" },
        children: [
          plugins.length === 0 && marketplaces.length === 0 && /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, fontSize: 12 },
            children: "No settings file names a plugin (enabledPlugins) or a marketplace."
          }),
          plugins.map((p) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", gap: 8, alignItems: "center" },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: { ...small, width: 34, color: p.enabled ? undefined : T.faint },
                disabled: busy !== "",
                onClick: () => act("/plugins/toggle", { key: p.key, scope: p.scope, enable: !p.enabled }, p.key),
                title: p.enabled ? "disable" : "enable",
                children: busy === p.key ? "…" : p.enabled ? "on" : "off"
              }),
              /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                style: line,
                children: [
                  p.key,
                  p.detail !== undefined && ` (${p.detail})`
                ]
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, flex: "none" },
                children: p.scope
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: small,
                disabled: busy !== "",
                onClick: () => act("/plugins/uninstall", { key: p.key, scope: p.scope }, p.key),
                children: "Remove"
              })
            ]
          }, p.key)),
          marketplaces.map((m) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", gap: 8, alignItems: "center" },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, flex: "none" },
                children: "market"
              }),
              /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                style: line,
                children: [
                  m.name,
                  " · ",
                  m.source,
                  m.alias === true && " (written as additionalMarketplaces)"
                ]
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, flex: "none" },
                children: m.scope
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: small,
                disabled: busy !== "",
                onClick: () => act("/plugins/marketplace/remove", { name: m.name, scope: m.scope }, m.name),
                children: "Remove"
              })
            ]
          }, m.name)),
          /* @__PURE__ */ jsx_runtime2.jsx(MarketplaceAddForm, {
            act,
            busy
          }),
          error !== "" && /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, display: "block", marginTop: 4 },
            children: error
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, display: "block", marginTop: 4 },
            children: applied || "A change applies to the running session now, or at the next spawn if none is up."
          })
        ]
      })
    ]
  });
}
function InstructionsBody({ sessionId, ctx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const [files, setFiles] = import_react3.useState([]);
  const [file, setFile] = import_react3.useState(null);
  const [text, setText] = import_react3.useState("");
  const [saved, setSaved] = import_react3.useState("");
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const [roster, setRoster] = import_react3.useState(null);
  const q = cwd ? `cwd=${encodeURIComponent(cwd)}` : "";
  const mounted = import_react3.useRef(true);
  import_react3.useEffect(() => () => void (mounted.current = false), []);
  const refresh = () => {
    if (!cwd)
      return;
    fetch(`${ROUTE}/instructions?${q}`).then((r) => readJson(r)).then((b) => mounted.current && setFiles(b.files ?? [])).catch((e) => mounted.current && setError(e.message));
  };
  import_react3.useEffect(() => {
    refresh();
  }, [cwd]);
  const refreshRoster = import_react3.useCallback(() => {
    if (!cwd)
      return;
    fetch(`${ROUTE}/plugins?${q}`).then((r) => readJson(r)).then((b) => mounted.current && setRoster(b)).catch(() => {});
  }, [cwd, q]);
  import_react3.useEffect(() => {
    refreshRoster();
  }, [refreshRoster]);
  const openFile = async (f) => {
    setError("");
    try {
      const body = await readJson(await fetch(`${ROUTE}/instructions/file?${q}&path=${encodeURIComponent(f.path)}`));
      setFile(f);
      setText(body.text);
      setSaved(body.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!file || file.kind === "Managed")
      return;
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch(`${ROUTE}/instructions/file`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, path: file.path, text })
      }));
      setSaved(text);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!cwd)
    return /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { ...meta, padding: "4px 10px", color: error ? T.err : undefined },
      children: error || "No instructions for this workspace."
    });
  const dirty = text !== saved;
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: bodyFlow,
    children: [
      file === null && files.length === 0 && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "4px 10px" },
        children: "No instructions for this workspace."
      }),
      file === null ? files.map((f) => /* @__PURE__ */ jsx_runtime2.jsxs("button", {
        type: "button",
        style: {
          ...btn,
          display: "flex",
          width: "100%",
          textAlign: "left",
          padding: "5px 10px"
        },
        onClick: () => openFile(f),
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, flex: "none", minWidth: 52 },
            children: f.kind
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: {
              flex: 1,
              minWidth: 0,
              marginLeft: 8,
              fontFamily: T.mono,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: shortPath(f.path, cwd)
          }),
          f.importedBy && /* @__PURE__ */ jsx_runtime2.jsxs("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: [
              "(from ",
              f.importedBy.split("/").pop(),
              ")"
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: ago(f.mtime)
          })
        ]
      }, f.path)) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8 },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                onClick: () => setFile(null),
                disabled: busy,
                children: "‹ Back"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { flex: 1, minWidth: 0, fontFamily: T.mono, fontSize: 12 },
                children: shortPath(file.path, cwd)
              }),
              file.kind === "Managed" && /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, flex: "none" },
                children: "read-only (managed)"
              }),
              file.kind !== "Managed" && /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: dirty ? btnPrimary : btn,
                onClick: save,
                disabled: busy || !dirty,
                children: "Save"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
            value: text,
            spellCheck: false,
            autoFocus: true,
            readOnly: file.kind === "Managed",
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
                save();
            },
            style: { ...code, minHeight: 300, resize: "vertical", whiteSpace: "pre-wrap" }
          })
        ]
      }),
      file === null && /* @__PURE__ */ jsx_runtime2.jsx(PluginManagerBlock, {
        roster,
        sessionId,
        onChanged: refreshRoster
      }),
      error && /* @__PURE__ */ jsx_runtime2.jsx("span", {
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
  const [prompts, setPrompts] = import_react3.useState([]);
  const [picked, setPicked] = import_react3.useState(null);
  const [preview, setPreview] = import_react3.useState(null);
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const switches = useFeatureSwitches(cwd);
  import_react3.useEffect(() => {
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
  const noFiles = switches?.checkpointingDisabled === true;
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: bodyFlow,
    children: [
      noFiles && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, color: T.err, padding: "2px 4px", whiteSpace: "normal" },
        children: "CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING is set in dsh's environment, so Claude keeps no file checkpoints: a rewind moves the conversation back and leaves your files as they are."
      }),
      picked === null ? prompts.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "No completed prompts yet"
      }) : prompts.map((p) => /* @__PURE__ */ jsx_runtime2.jsxs("button", {
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
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: {
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            children: p.text
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, flex: "none", marginLeft: 8 },
            children: ago(p.time)
          })
        ]
      }, p.id)) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("span", {
            style: { fontSize: 13, padding: "2px 4px" },
            children: [
              "Rewind to: ",
              picked.text
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, padding: "2px 4px" },
            children: busy && !preview ? "Checking…" : preview ? rewindSummary(preview) : ""
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            style: { ...meta, padding: "2px 4px" },
            children: "Files go back and Claude forgets everything after this prompt. This dsh transcript keeps showing what happened."
          }),
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", gap: 8, padding: "2px 4px" },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                disabled: busy,
                onClick: () => setPicked(null),
                children: "‹ Back"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
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
      picked === null && prompts.length > 0 && /* @__PURE__ */ jsx_runtime2.jsxs("span", {
        style: { ...meta, padding: "2px 4px", whiteSpace: "normal" },
        children: [
          retentionNote(switches),
          " A prompt older than that is no longer here to rewind to."
        ]
      }),
      error && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: error
      })
    ]
  });
}
function ChangesBody({ sessionId, ctx }) {
  const isClaude = activeClaudeSession(ctx) === sessionId;
  const [reply, setReply] = import_react3.useState(null);
  const [shown, setShown] = import_react3.useState(null);
  import_react3.useEffect(() => {
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
  return /* @__PURE__ */ jsx_runtime2.jsx("div", {
    style: bodyFlow,
    children: reply === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { ...meta, padding: "2px 4px" },
      children: "Loading…"
    }) : !reply.ok ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { color: T.err, fontSize: 12 },
      children: reply.error
    }) : current ? /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { display: "flex", gap: 8, alignItems: "center", padding: "2px 4px" },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: btn,
              onClick: () => setShown(null),
              children: "‹ Back"
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
              style: { fontSize: 13, fontFamily: "monospace" },
              children: current.path
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("span", {
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
        current.hunks.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px" },
          children: current.binary ? "Binary file" : current.untracked ? "Untracked file" : "No hunks"
        }) : current.hunks.map((h, i) => /* @__PURE__ */ jsx_runtime2.jsxs("pre", {
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
            /* @__PURE__ */ jsx_runtime2.jsxs("span", {
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
            h.lines.map((l, j) => /* @__PURE__ */ jsx_runtime2.jsxs("span", {
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
    }) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px" },
          children: reply.filesCount === 0 ? "Working tree clean" : `${reply.filesCount} files, +${reply.linesAdded} −${reply.linesRemoved}`
        }),
        files.map((f) => /* @__PURE__ */ jsx_runtime2.jsxs("button", {
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
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
              style: {
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              children: f.path
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
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
  const [reply, setReply] = import_react3.useState(null);
  const [busy, setBusy] = import_react3.useState(null);
  const [note, setNote] = import_react3.useState("");
  const [showAdd, setShowAdd] = import_react3.useState(false);
  const load = () => fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then(setReply).catch((e) => setReply({ ok: false, error: e.message }));
  import_react3.useEffect(() => {
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
  const remove = async (serverName) => {
    setBusy(serverName);
    setNote("");
    try {
      const r = await readJson(await fetch(`${ROUTE}/mcp-servers/remove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, name: serverName })
      }));
      setNote(r.ok ? `${serverName} removed. ${SPAWN_NOTE}` : `${serverName}: ${r.error ?? "failed"}`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const servers = reply?.ok ? reply.servers : [];
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: bodyFlow,
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        type: "button",
        style: { ...btn, marginBottom: 8 },
        onClick: () => setShowAdd(!showAdd),
        children: showAdd ? "Cancel" : "Add server"
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: {
          display: "grid",
          gridTemplateRows: showAdd ? "1fr" : "0fr",
          transition: `grid-template-rows ${easeMs()}ms ease`
        },
        children: /* @__PURE__ */ jsx_runtime2.jsx("div", {
          style: { overflow: "hidden", minHeight: 0 },
          children: /* @__PURE__ */ jsx_runtime2.jsx(McpAddForm, {
            sessionId,
            onAdded: () => setNote(SPAWN_NOTE)
          })
        })
      }),
      reply === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "Loading…"
      }) : !reply.ok ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { color: T.err, fontSize: 12 },
        children: reply.error
      }) : servers.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px" },
        children: "No MCP servers"
      }) : servers.map((s) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                "aria-hidden": "true",
                style: {
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  flex: "none",
                  background: s.status === "connected" ? T.ok : s.status === "pending" ? T.warn : T.err
                }
              }),
              /* @__PURE__ */ jsx_runtime2.jsxs("span", {
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
                  s.version ? /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                    style: meta,
                    children: [
                      " ",
                      s.version
                    ]
                  }) : null
                ]
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("span", {
                style: { ...meta, flex: "none" },
                children: s.status
              }),
              s.status !== "needs-auth" && /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                disabled: busy !== null,
                onClick: () => reconnect(s.name),
                children: busy === s.name ? "…" : "Reconnect"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("button", {
                type: "button",
                style: btn,
                disabled: busy !== null,
                onClick: () => remove(s.name),
                children: busy === s.name ? "…" : "Remove"
              })
            ]
          }),
          s.status !== "connected" && (s.error || s.status === "needs-auth") ? /* @__PURE__ */ jsx_runtime2.jsx("div", {
            style: { padding: "0 6px 4px 22px", color: T.muted, fontSize: 12 },
            children: s.error ?? "Needs authentication. Run /mcp in a Claude Code terminal on this box to authenticate this server."
          }) : null,
          s.tools && s.tools.length > 0 ? /* @__PURE__ */ jsx_runtime2.jsx("div", {
            style: { padding: "0 6px 4px 22px", color: T.muted, fontSize: 12 },
            children: s.tools.join(" · ")
          }) : null
        ]
      }, s.name)),
      note && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px", marginTop: 8 },
        children: note
      })
    ]
  });
}
var SPAWN_NOTE = "Saved. Claude picks it up the next time it starts.";
function SessionNotices() {
  const [on, setOn] = import_react3.useState(noticesOn);
  const supported = "Notification" in window;
  const [permission, setPermission] = import_react3.useState(supported ? Notification.permission : "denied");
  const write = (next) => {
    setNoticesOn(next);
    setOn(next);
  };
  const enable = () => {
    if (!supported)
      return;
    if (Notification.permission === "default")
      Notification.requestPermission().then((p) => {
        setPermission(p);
        write(p === "granted");
      });
    else
      write(true);
  };
  const state = !supported ? "This browser has no notification API; the tab title carries the mark instead." : permission === "denied" ? "Blocked in the browser's site settings; the tab title still carries the mark." : on ? "On for sessions this tab is not showing." : "Off. The tab title is marked while the page is hidden either way.";
  return /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
        children: "Session notices"
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          fontSize: 12,
          lineHeight: "1.5"
        },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("button", {
            type: "button",
            style: { ...btn, fontSize: 12, flex: "0 0 auto" },
            disabled: !supported || permission === "denied",
            onClick: () => on ? write(false) : enable(),
            children: on ? "Turn off" : "Turn on"
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("span", {
            children: state
          })
        ]
      })
    ]
  });
}
function DiagnosticsBody({ sessionId, ctx }) {
  const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
  const running = activeClaudeSession(ctx) === sessionId;
  const [data, setData] = import_react3.useState(null);
  const [mcp, setMcp] = import_react3.useState(null);
  const [reconnecting, setReconnecting] = import_react3.useState(null);
  const [audit, setAudit] = import_react3.useState(null);
  const [auditError, setAuditError] = import_react3.useState("");
  const [doctorOutput, setDoctorOutput] = import_react3.useState(null);
  const [doctorError, setDoctorError] = import_react3.useState("");
  const [doctorBusy, setDoctorBusy] = import_react3.useState(false);
  const switches = useFeatureSwitches(cwd);
  const loadMcp = import_react3.useCallback(() => fetch(`${ROUTE}/mcp-servers?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then(setMcp).catch((e) => setMcp({ ok: false, error: e.message })), [sessionId]);
  import_react3.useEffect(() => {
    if (!running)
      return;
    loadMcp();
  }, [running, loadMcp]);
  import_react3.useEffect(() => {
    let live = true;
    fetch(`${ROUTE}/turns?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((b) => {
      if (live)
        setAudit((b.turns ?? []).filter((t) => t.denials?.length).toReversed());
    }).catch((e) => live && setAuditError(e.message));
    return () => {
      live = false;
    };
  }, [sessionId]);
  const reconnect = async (serverName) => {
    setReconnecting(serverName);
    try {
      await fetch(`${ROUTE}/mcp-servers/reconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: sessionId, name: serverName })
      });
      await loadMcp();
    } finally {
      setReconnecting(null);
    }
  };
  import_react3.useEffect(() => {
    if (!cwd) {
      setData({ ok: false, error: "This session has no working directory to inspect." });
      return;
    }
    let live = true;
    fetch(`${ROUTE}/diagnostics?cwd=${encodeURIComponent(cwd)}`).then((r) => readJson(r)).then((b) => live && setData(b)).catch((e) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [cwd]);
  const runDoctor = async () => {
    setDoctorBusy(true);
    setDoctorError("");
    try {
      const r = await readJson(await fetch(`${ROUTE}/diagnostics/doctor`, { method: "POST" }));
      if (r.error) {
        setDoctorError(r.error);
      } else {
        setDoctorOutput(r.out ?? "");
      }
    } catch (e) {
      setDoctorError(e instanceof Error ? e.message : String(e));
    } finally {
      setDoctorBusy(false);
    }
  };
  if (!cwd)
    return null;
  return /* @__PURE__ */ jsx_runtime2.jsx("div", {
    style: bodyFlow,
    children: data === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { ...meta, padding: "2px 4px" },
      children: "Loading…"
    }) : !data.ok ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { color: T.err, fontSize: 12 },
      children: data.error || "Diagnostics could not be read."
    }) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block" },
          children: "Runtime"
        }),
        /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { padding: "4px 10px", fontSize: 12, lineHeight: "1.5" },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "Binary:",
                " ",
                /* @__PURE__ */ jsx_runtime2.jsx("span", {
                  style: { fontFamily: T.mono },
                  children: data.runtime.binary || "(not found)"
                })
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "Version: ",
                data.runtime.version || "(unknown)"
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "Login:",
                " ",
                data.runtime.loggedIn ? /* @__PURE__ */ jsx_runtime2.jsxs("span", {
                  style: { color: T.ok },
                  children: [
                    maskEmail(data.runtime.email || "logged in"),
                    " · ",
                    data.runtime.host
                  ]
                }) : /* @__PURE__ */ jsx_runtime2.jsx("span", {
                  style: { color: T.err },
                  children: "not logged in · run `claude auth login`"
                })
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "Config dir: ",
                /* @__PURE__ */ jsx_runtime2.jsx("span", {
                  style: { fontFamily: T.mono },
                  children: data.runtime.configDir
                })
              ]
            }),
            data.runtime.error && /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { color: T.err },
              children: data.runtime.error
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
          children: "Config files"
        }),
        data.configFiles.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "No config files"
        }) : data.configFiles.map((f) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: {
            padding: "4px 10px",
            fontSize: 12,
            borderLeft: f.parseError ? `2px solid ${T.err}` : "2px solid transparent",
            color: f.parseError ? T.err : undefined
          },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { ...meta, marginBottom: 2 },
              children: f.scope
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { fontFamily: T.mono, fontSize: 11, marginBottom: 2 },
              children: f.path
            }),
            !f.exists && /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { ...meta, fontSize: 11 },
              children: "not found"
            }),
            f.parseError && /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { fontSize: 11 },
              children: f.parseError
            })
          ]
        }, f.scope)),
        /* @__PURE__ */ jsx_runtime2.jsx(SessionNotices, {}),
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
          children: "Feature switches"
        }),
        switches === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "Loading…"
        }) : /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { padding: "4px 10px", fontSize: 12, lineHeight: "1.5" },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "Transcript retention: ",
                switches.retention.days,
                " days",
                switches.retention.scope === null ? " (cleanupPeriodDays unset, so the CLI's default)" : ` (cleanupPeriodDays in ${switches.retention.scope} settings)`,
                ". Empties Rewind, Restore and the session browser as it sweeps."
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              style: { color: switches.bypassDisabled ? T.err : undefined },
              children: [
                "Bypass permissions:",
                " ",
                switches.bypassDisabled ? `refused by permissions.disableBypassPermissionsMode in ${switches.bypassDisabled.scope} settings, so Full access does not take` : "allowed",
                "."
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              style: { color: switches.checkpointingDisabled ? T.err : undefined },
              children: [
                "File checkpoints:",
                " ",
                switches.checkpointingDisabled ? "off, CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING is set in dsh's environment, so a rewind cannot put files back" : "on, so Rewind can put files back",
                "."
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              children: [
                "At a usage limit:",
                " ",
                switches.usageLimit.plugin ? "this plugin waits for the reset and continues the turn" : "nothing continues the turn, its Continue after limit is off",
                ". Claude Code's own autoContinueAtUsageLimit is",
                " ",
                switches.usageLimit.cli === null ? "unset" : switches.usageLimit.cli ? "on" : "off",
                ", and does not act here: it drives the interactive limit dialog, which a headless run has no way to show."
              ]
            })
          ]
        }),
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
          children: "MCP servers"
        }),
        !running ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "Claude is not running for this session."
        }) : mcp === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "Loading…"
        }) : !mcp.ok ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { color: T.err, fontSize: 12, padding: "2px 4px" },
          children: mcp.error
        }) : mcp.servers.every((s) => s.status === "connected") ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: mcp.servers.length === 0 ? "No MCP servers" : "All connected"
        }) : mcp.servers.filter((s) => s.status !== "connected").map((s) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: {
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            padding: "4px 10px",
            fontSize: 12
          },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsxs("span", {
              style: { flex: "1 1 auto", minWidth: 0 },
              children: [
                /* @__PURE__ */ jsx_runtime2.jsx("span", {
                  style: { fontFamily: T.mono },
                  children: s.name
                }),
                /* @__PURE__ */ jsx_runtime2.jsx("span", {
                  style: { ...meta, marginLeft: 6 },
                  children: s.status
                }),
                s.error && /* @__PURE__ */ jsx_runtime2.jsx("div", {
                  style: { color: T.err, fontSize: 11, marginTop: 2 },
                  children: s.error
                })
              ]
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: { ...btn, fontSize: 12, flex: "none" },
              disabled: reconnecting === s.name,
              onClick: () => void reconnect(s.name),
              children: reconnecting === s.name ? "…" : "Reconnect"
            })
          ]
        }, s.name)),
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
          children: "Refused calls"
        }),
        auditError ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { color: T.err, fontSize: 12, padding: "2px 4px" },
          children: auditError
        }) : audit === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "Loading…"
        }) : audit.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", fontSize: 12 },
          children: "No calls were refused in the turns kept for this session."
        }) : audit.map((t) => /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { padding: "4px 10px", fontSize: 12 },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: meta,
              children: ago(t.at)
            }),
            t.denials?.map((label) => /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { fontFamily: T.mono, fontSize: 11 },
              children: label
            }, label))
          ]
        }, t.at)),
        /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { padding: "6px 10px", marginTop: 8, borderTop: `1px solid ${T.border}` },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("button", {
              type: "button",
              style: doctorOutput ? btn : btnPrimary,
              onClick: runDoctor,
              disabled: doctorBusy,
              children: doctorBusy ? "Running…" : "Run doctor"
            }),
            doctorError && /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { color: T.err, fontSize: 12, marginTop: 4 },
              children: doctorError
            }),
            doctorOutput && /* @__PURE__ */ jsx_runtime2.jsx("pre", {
              style: {
                marginTop: 6,
                padding: 8,
                fontSize: 11,
                lineHeight: "1.4",
                background: T.field,
                border: `1px solid ${T.border}`,
                borderRadius: 4,
                overflow: "auto",
                maxHeight: 200
              },
              children: doctorOutput
            })
          ]
        })
      ]
    })
  });
}
function TaskRow({ task }) {
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: { padding: "4px 10px", fontSize: 12, borderLeft: `2px solid ${T.border}` },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: { fontWeight: "bold" },
        children: task.name
      }),
      task.description ? /* @__PURE__ */ jsx_runtime2.jsx("div", {
        style: { ...meta, fontSize: 11 },
        children: task.description
      }) : null,
      task.schedule ? /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { ...meta, fontSize: 11 },
        children: [
          "Schedule: ",
          task.schedule
        ]
      }) : null,
      task.nextRunAt === undefined ? null : /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { ...meta, fontSize: 11 },
        children: [
          "Next run: ",
          new Date(task.nextRunAt).toLocaleString()
        ]
      })
    ]
  });
}
function TasksBody({ sessionId, ctx }) {
  const running = activeClaudeSession(ctx) === sessionId;
  const [data, setData] = import_react3.useState(null);
  import_react3.useEffect(() => {
    if (!running)
      return;
    let live = true;
    fetch(`${ROUTE}/scheduled-tasks?session=${encodeURIComponent(sessionId)}`).then((r) => readJson(r)).then((b) => live && setData(b)).catch((e) => live && setData({ ok: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [running, sessionId]);
  if (!running)
    return null;
  return /* @__PURE__ */ jsx_runtime2.jsx("div", {
    style: bodyFlow,
    children: data === null ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { ...meta, padding: "2px 4px" },
      children: "Loading…"
    }) : !data.ok ? /* @__PURE__ */ jsx_runtime2.jsx("span", {
      style: { color: T.err, fontSize: 12 },
      children: data.error
    }) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
      children: [
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block" },
          children: "Goal"
        }),
        data.goal ? /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { padding: "4px 10px", fontSize: 12, lineHeight: "1.5" },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { marginBottom: 4 },
              children: data.goal.text
            }),
            /* @__PURE__ */ jsx_runtime2.jsxs("div", {
              style: { ...meta, fontSize: 11 },
              children: [
                "Proposed ",
                ago(data.goal.at)
              ]
            })
          ]
        }) : /* @__PURE__ */ jsx_runtime2.jsx("div", {
          style: { ...meta, padding: "4px 10px", fontSize: 12 },
          children: "No CLI goal in this session."
        }),
        /* @__PURE__ */ jsx_runtime2.jsx("span", {
          style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
          children: "Durable tasks"
        }),
        data.durable.length === 0 ? /* @__PURE__ */ jsx_runtime2.jsxs("div", {
          style: { ...meta, padding: "4px 10px", fontSize: 12 },
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              children: "Nothing scheduled."
            }),
            /* @__PURE__ */ jsx_runtime2.jsx("div", {
              style: { fontSize: 11, marginTop: 4, fontFamily: T.mono },
              children: data.path
            })
          ]
        }) : data.durable.map((t) => /* @__PURE__ */ jsx_runtime2.jsx(TaskRow, {
          task: t
        }, t.name)),
        data.session.length > 0 ? /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
          children: [
            /* @__PURE__ */ jsx_runtime2.jsx("span", {
              style: { ...meta, padding: "2px 4px", display: "block", marginTop: 8 },
              children: "Session-only — reconstructed from this session's transcript; these die when Claude exits."
            }),
            data.session.map((t) => /* @__PURE__ */ jsx_runtime2.jsx(TaskRow, {
              task: t
            }, t.name))
          ]
        }) : null,
        /* @__PURE__ */ jsx_runtime2.jsx("div", {
          style: { ...meta, padding: "2px 4px", marginTop: 8, fontSize: 11 },
          children: "Read-only in this release. dsh keeps its own goal, which it does not expose to a plugin to read, so only the CLI's side is shown here."
        })
      ]
    })
  });
}
var CONNECTORS = [
  { label: "GitHub", name: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/" },
  { label: "Notion", name: "notion", transport: "http", url: "https://mcp.notion.com/mcp" },
  { label: "Sentry", name: "sentry", transport: "http", url: "https://mcp.sentry.dev/mcp" },
  { label: "Slack", name: "slack", transport: "http", url: "https://mcp.slack.com/mcp" },
  { label: "Stripe", name: "stripe", transport: "http", url: "https://mcp.stripe.com" },
  { label: "Asana", name: "asana", transport: "sse", url: "https://mcp.asana.com/sse" },
  {
    label: "HubSpot",
    name: "hubspot",
    transport: "http",
    url: "https://mcp.hubspot.com/anthropic"
  }
];
function McpAddForm({ sessionId, onAdded }) {
  const [name, setName] = import_react3.useState("");
  const [scope, setScope] = import_react3.useState("local");
  const [transport, setTransport] = import_react3.useState("stdio");
  const [command, setCommand] = import_react3.useState("");
  const [args, setArgs] = import_react3.useState("");
  const [env, setEnv] = import_react3.useState("");
  const [url, setUrl] = import_react3.useState("");
  const [headers, setHeaders] = import_react3.useState("");
  const [busy, setBusy] = import_react3.useState(false);
  const [error, setError] = import_react3.useState("");
  const [connector, setConnector] = import_react3.useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await readJson(await fetch(`${ROUTE}/mcp-servers/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session: sessionId,
          name,
          scope,
          transport,
          command,
          args,
          env,
          url,
          headers
        })
      }));
      if (!r.ok)
        return setError(r.error ?? "failed to add server");
      setName("");
      setCommand("");
      setArgs("");
      setEnv("");
      setUrl("");
      setHeaders("");
      setConnector("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const fillFromConnector = (picked) => {
    setConnector(picked);
    const c = CONNECTORS.find((x) => x.name === picked);
    if (!c)
      return;
    setName(c.name);
    setTransport(c.transport);
    setUrl(c.url);
  };
  return /* @__PURE__ */ jsx_runtime2.jsxs("div", {
    style: { padding: "6px", marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 4 },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsxs("select", {
        value: connector,
        onChange: (e) => fillFromConnector(e.currentTarget.value),
        disabled: busy,
        style: { width: "100%", padding: 4, fontSize: 12, marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("option", {
            value: "",
            children: "Common connector…"
          }),
          CONNECTORS.map((c) => /* @__PURE__ */ jsx_runtime2.jsx("option", {
            value: c.name,
            children: c.label
          }, c.name))
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            type: "text",
            placeholder: "server name",
            value: name,
            onChange: (e) => setName(e.currentTarget.value),
            disabled: busy,
            style: { flex: 1, minWidth: 120, padding: 4, fontSize: 12 }
          }),
          /* @__PURE__ */ jsx_runtime2.jsxs("select", {
            value: scope,
            onChange: (e) => setScope(e.currentTarget.value),
            disabled: busy,
            style: { padding: 4, fontSize: 12 },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "local",
                children: "Local"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "user",
                children: "User"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "project",
                children: "Project"
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsxs("select", {
            value: transport,
            onChange: (e) => setTransport(e.currentTarget.value),
            disabled: busy,
            style: { padding: 4, fontSize: 12 },
            children: [
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "stdio",
                children: "Stdio"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "sse",
                children: "SSE"
              }),
              /* @__PURE__ */ jsx_runtime2.jsx("option", {
                value: "http",
                children: "HTTP"
              })
            ]
          })
        ]
      }),
      transport === "stdio" ? /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            type: "text",
            placeholder: "command, e.g. npx",
            value: command,
            onChange: (e) => setCommand(e.currentTarget.value),
            disabled: busy,
            style: { width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
            placeholder: "args, one per line",
            value: args,
            onChange: (e) => setArgs(e.currentTarget.value),
            disabled: busy,
            style: { width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
            placeholder: "env vars: KEY=value, one per line",
            value: env,
            onChange: (e) => setEnv(e.currentTarget.value),
            disabled: busy,
            style: { width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }
          })
        ]
      }) : /* @__PURE__ */ jsx_runtime2.jsxs(jsx_runtime2.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime2.jsx("input", {
            type: "text",
            placeholder: "url, http:// or https://",
            value: url,
            onChange: (e) => setUrl(e.currentTarget.value),
            disabled: busy,
            style: { width: "100%", padding: 4, fontSize: 12, marginBottom: 4 }
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("textarea", {
            placeholder: "headers: Name: value, one per line",
            value: headers,
            onChange: (e) => setHeaders(e.currentTarget.value),
            disabled: busy,
            style: { width: "100%", height: 50, padding: 4, fontSize: 12, marginBottom: 4 }
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
        type: "button",
        style: btnPrimary,
        disabled: busy || !name,
        onClick: submit,
        children: busy ? "Adding…" : "Add"
      }),
      error && /* @__PURE__ */ jsx_runtime2.jsx("span", {
        style: { ...meta, display: "block", marginTop: 4 },
        children: error
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
  const anchorRef = import_react3.useRef(null);
  import_react3.useEffect(() => {
    const mine = () => activeClaudeSession(ctx) === sessionId;
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
      let bypassRefusedIn = "";
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
        const refused = bypassRefusedIn !== "" && currentMode === "bypassPermissions";
        const text = `${modeLabel(currentMode) ?? currentMode}${refused ? " ⚠" : ""}`;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = `Claude permission: ${text}${refused ? ", refused by settings" : ""}`;
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
      const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
      fetch(`${ROUTE}/feature-switches${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`).then((r) => readJson(r)).then((s) => {
        bypassRefusedIn = s.bypassDisabled?.scope ?? "";
        reapplyLabel();
      }).catch(() => {});
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
          if (bypassRefusedIn !== "") {
            const note = document.createElement("div");
            Object.assign(note.style, { ...meta, color: T.err, padding: "8px 10px" });
            note.textContent = `Full access is refused by permissions.disableBypassPermissionsMode in ${bypassRefusedIn} settings.`;
            viewport.appendChild(note);
          }
          if (!document.getElementById("omc-access-err-style")) {
            const st = document.createElement("style");
            st.id = "omc-access-err-style";
            st.textContent = ".omc-access-err{padding:8px 10px}.omc-access-err:empty{padding:0}";
            document.head.appendChild(st);
          }
          const errWrap = document.createElement("div");
          errWrap.setAttribute("data-err", "1");
          errWrap.className = "omc-access-err";
          Object.assign(errWrap.style, { ...meta, color: T.err });
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
    if (mine() && !attempt()) {
      let attempts = 0;
      timer = setInterval(() => {
        attempts++;
        if (!mine() || attempt() || attempts >= 40)
          clearInterval(timer);
      }, 500);
    }
    const watchdog = setInterval(() => {
      const claude = mine();
      if (stop && (!claude || !hidden?.isConnected)) {
        stop();
        stop = undefined;
      }
      if (!stop && claude)
        attempt();
    }, 1000);
    return () => {
      if (timer)
        clearInterval(timer);
      clearInterval(watchdog);
      stop?.();
    };
  }, [sessionId, ctx]);
  return /* @__PURE__ */ jsx_runtime2.jsx("span", {
    ref: anchorRef,
    hidden: true
  });
}
function OhMyClaudeControl({ sessionId, ctx }) {
  const isMine = activeClaudeSession(ctx) === sessionId;
  const [open, setOpen] = import_react3.useState(false);
  const [shown, setShown] = import_react3.useState(false);
  const closeTimer = import_react3.useRef(undefined);
  const rootRef = import_react3.useRef(null);
  const narrow = useNarrow();
  const [tab, setTab] = import_react3.useState(lastTab);
  const [above, setAbove] = import_react3.useState(0);
  import_react3.useEffect(() => {
    if (!open)
      return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const close = import_react3.useCallback(() => {
    setShown(false);
    closeTimer.current = setTimeout(() => setOpen(false), easeMs());
  }, []);
  const openPanel = import_react3.useCallback(() => {
    clearTimeout(closeTimer.current);
    setOpen(true);
    setShown(false);
  }, []);
  import_react3.useEffect(() => () => clearTimeout(closeTimer.current), []);
  useDismiss(open, close, rootRef);
  if (!isMine)
    return null;
  const blank = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.blank !== false;
  const panelStyle = {
    position: "fixed",
    left: 12,
    right: 12,
    marginInline: "auto",
    bottom: above,
    width: narrow ? "auto" : "fit-content",
    maxWidth: narrow ? undefined : "calc(100vw - 24px)",
    maxHeight: narrow ? "60dvh" : "min(400px, 80dvh)",
    zIndex: 200,
    display: "flex",
    flexDirection: "column",
    padding: 6,
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    overflow: "hidden",
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : "translateY(6px)",
    transition: `opacity ${easeMs()}ms ease, transform ${easeMs()}ms ease`
  };
  const tabs = [
    ...blank ? [{ key: "Restore", label: "Restore" }] : [],
    { key: "Memory", label: "Memory" },
    { key: "Instructions", label: "Instructions" },
    { key: "Rewind", label: "Rewind" },
    { key: "Changes", label: "Changes" },
    { key: "MCP", label: "MCP" },
    { key: "Diagnostics", label: "Diagnostics" },
    { key: "Tasks", label: "Tasks" },
    { key: "Tune", label: "Tune" }
  ];
  if (!tabs.map((t) => t.key).includes(lastTab))
    lastTab = "Memory";
  return /* @__PURE__ */ jsx_runtime2.jsxs("span", {
    ref: rootRef,
    style: { position: "relative", display: "inline-flex" },
    children: [
      /* @__PURE__ */ jsx_runtime2.jsx("button", {
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
          if (open) {
            close();
            return;
          }
          setTab(lastTab === "Restore" && !blank ? "Memory" : lastTab);
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect)
            setAbove(Math.max(12, window.innerHeight - rect.top + 8));
          openPanel();
        },
        children: CLAUDE_MARK
      }),
      open && /* @__PURE__ */ jsx_runtime2.jsxs("div", {
        role: "dialog",
        "aria-label": "Oh My Claude",
        style: panelStyle,
        children: [
          /* @__PURE__ */ jsx_runtime2.jsxs("div", {
            role: "tabpanel",
            style: {
              flex: "1 1 auto",
              minHeight: 0,
              overflow: "auto",
              padding: "4px 0",
              width: narrow ? undefined : 0,
              minWidth: narrow ? undefined : "100%"
            },
            children: [
              tab === "Restore" && /* @__PURE__ */ jsx_runtime2.jsx(RestoreBody, {
                sessionId,
                ctx,
                onClose: close
              }),
              tab === "Memory" && /* @__PURE__ */ jsx_runtime2.jsx(MemoryBody, {
                sessionId,
                ctx
              }),
              tab === "Instructions" && /* @__PURE__ */ jsx_runtime2.jsx(InstructionsBody, {
                sessionId,
                ctx
              }),
              tab === "Rewind" && /* @__PURE__ */ jsx_runtime2.jsx(RewindBody, {
                sessionId,
                ctx,
                onClose: close
              }),
              tab === "Changes" && /* @__PURE__ */ jsx_runtime2.jsx(ChangesBody, {
                sessionId,
                ctx
              }),
              tab === "MCP" && /* @__PURE__ */ jsx_runtime2.jsx(McpBody, {
                sessionId,
                ctx,
                onClose: close
              }),
              tab === "Diagnostics" && /* @__PURE__ */ jsx_runtime2.jsx(DiagnosticsBody, {
                sessionId,
                ctx
              }),
              tab === "Tasks" && /* @__PURE__ */ jsx_runtime2.jsx(TasksBody, {
                sessionId,
                ctx
              }),
              tab === "Tune" && /* @__PURE__ */ jsx_runtime2.jsx(TuneBody, {
                sessionId
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime2.jsx("div", {
            role: "tablist",
            style: {
              display: "flex",
              flex: "0 0 auto",
              borderTop: `1px solid ${T.border}`,
              paddingTop: 6,
              flexWrap: "wrap",
              rowGap: 4
            },
            children: tabs.map((t) => /* @__PURE__ */ jsx_runtime2.jsx("button", {
              role: "tab",
              "aria-selected": tab === t.key,
              style: {
                ...btn,
                fontSize: 12,
                borderBottom: tab === t.key ? `2px solid ${CLAUDE_ORANGE}` : "2px solid transparent",
                borderRadius: "0 0 8px 8px",
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
          })
        ]
      })
    ]
  });
}

// src/client/settings.ts
var SETTINGS_SCOPES = ["managed", "local", "project", "user"];
var SCOPE_LABELS = {
  managed: "the managed file",
  local: "settings.local.json",
  project: "the project's settings.json",
  user: "~/.claude/settings.json"
};
var topLevelKeys = (text) => {
  try {
    const value = JSON.parse(text);
    return value instanceof Object && !Array.isArray(value) ? Object.keys(value) : [];
  } catch {
    return [];
  }
};
var listed = (words) => words.length < 2 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
function overrideNote(scopes, scope) {
  const mine = scopes.find((s) => s.scope === scope);
  if (!mine)
    return "";
  const rank = SETTINGS_SCOPES.indexOf(scope);
  const keys = new Set(topLevelKeys(mine.text));
  const clauses = [];
  for (const higher of SETTINGS_SCOPES.slice(0, rank)) {
    const file = scopes.find((s) => s.scope === higher);
    if (!file)
      continue;
    const taken = topLevelKeys(file.text).filter((k) => keys.has(k));
    if (taken.length === 0)
      continue;
    for (const key of taken)
      keys.delete(key);
    clauses.push(`${listed(taken)} by ${SCOPE_LABELS[higher]}`);
  }
  return clauses.length === 0 ? "" : `Overridden here: ${clauses.join("; ")}.`;
}

// src/client/index.tsx
var jsx_runtime3 = require("react/jsx-runtime");
var HASH_KEY = "claude-session";
var size = (bytes) => bytes < 1e6 ? `${Math.round(bytes / 1000)} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
var shortPath2 = (p) => {
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
  return /* @__PURE__ */ jsx_runtime3.jsxs("section", {
    id,
    style: card,
    children: [
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        style: cardHead,
        children: [
          /* @__PURE__ */ jsx_runtime3.jsxs("button", {
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
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: { ...meta, width: 10, display: "inline-block" },
                children: open ? "▾" : "▸"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("h3", {
                style: h3,
                children: title
              }),
              summary && /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: { ...meta, whiteSpace: "normal", overflow: "hidden" },
                children: summary
              })
            ]
          }),
          actions && /* @__PURE__ */ jsx_runtime3.jsx("div", {
            style: { display: "flex", gap: 8 },
            children: actions
          })
        ]
      }),
      open && /* @__PURE__ */ jsx_runtime3.jsx("div", {
        style: { marginTop: 10 },
        children
      })
    ]
  });
}
function Origin({ s }) {
  if (!s.dsh)
    return /* @__PURE__ */ jsx_runtime3.jsx("span", {
      style: pill(T.faint),
      children: "terminal"
    });
  if (s.dsh.archived)
    return /* @__PURE__ */ jsx_runtime3.jsx("span", {
      style: pill(T.warn),
      children: "archived"
    });
  return /* @__PURE__ */ jsx_runtime3.jsx("span", {
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
  const [st, setSt] = import_react4.useState(null);
  const [error, setError] = import_react4.useState("");
  import_react4.useEffect(() => {
    fetch(`${ROUTE}/status`).then((r) => readJson(r)).then((status) => {
      setSt(status);
      onStatus?.(status);
    }).catch((e) => setError(e.message));
  }, []);
  if (error)
    return /* @__PURE__ */ jsx_runtime3.jsx("p", {
      id: "dsh-oh-my-claude-runtime",
      style: { color: T.err, fontSize: 13, margin: "0 0 4px" },
      children: error
    });
  if (!st)
    return /* @__PURE__ */ jsx_runtime3.jsx("p", {
      id: "dsh-oh-my-claude-runtime",
      style: { ...meta, margin: "0 0 4px" },
      children: "Checking claude…"
    });
  const who = st.loggedIn ? `logged in${st.email ? ` as ${maskEmail(st.email)}` : ""}${st.authMethod ? ` (${st.authMethod})` : ""}` : "not logged in";
  return /* @__PURE__ */ jsx_runtime3.jsxs("div", {
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
      /* @__PURE__ */ jsx_runtime3.jsx("span", {
        style: pill(st.binary ? T.ok : T.err),
        children: st.binary ? `claude ${st.version ?? ""}`.trim() : "claude not on PATH"
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("span", {
        style: pill(st.loggedIn ? T.ok : T.err),
        children: who
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("span", {
        style: pill(T.faint),
        children: st.host
      }),
      /* @__PURE__ */ jsx_runtime3.jsxs("span", {
        style: { fontFamily: T.mono, fontSize: 12, color: T.faint },
        children: [
          st.binary ?? "",
          " · ",
          st.configDir
        ]
      }),
      st.error && /* @__PURE__ */ jsx_runtime3.jsx("span", {
        style: { width: "100%", color: T.err, fontFamily: T.mono, fontSize: 12 },
        children: st.error
      }),
      !st.loggedIn && /* @__PURE__ */ jsx_runtime3.jsxs("span", {
        style: { width: "100%", color: T.err },
        children: [
          "Sign in on this machine first: run",
          " ",
          /* @__PURE__ */ jsx_runtime3.jsx("code", {
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
  const hidden = {};
  const matched = {};
  const keep = (s) => (cwd === "all" || s.cwd === cwd) && (origin === "all" || originOf(s) === origin);
  const cappedList = (pairs, key) => {
    const sorted = pairs.toSorted((a, b) => b.s.modifiedAt - a.s.modifiedAt);
    matched[key] = sorted.length;
    const cap = shown[key] ?? PAGE;
    if (sorted.length > cap)
      hidden[key] = sorted.length - cap;
    return sorted.slice(0, cap);
  };
  if (box !== "all") {
    const g = groups.find((x) => x.key === box);
    const pairs = g ? g.sessions.filter(keep).map((s) => ({ g, s })) : [];
    return { list: cappedList(pairs, box), hidden, matched };
  }
  const pairs = groups.flatMap((g) => g.sessions.filter(keep).map((s) => ({ g, s })));
  return { list: cappedList(pairs, "all"), hidden, matched };
}
function Sessions({ ctx, boxes }) {
  const [local, setLocal] = import_react4.useState(null);
  const [remote, setRemote] = import_react4.useState([]);
  const [loading, setLoading] = import_react4.useState(true);
  const [remoteLoading, setRemoteLoading] = import_react4.useState(false);
  const [error, setError] = import_react4.useState("");
  const [box, setBox] = import_react4.useState("all");
  const [cwd, setCwd] = import_react4.useState("all");
  const [origin, setOrigin] = import_react4.useState("all");
  const [busyId, setBusyId] = import_react4.useState("");
  const [shown, setShown] = import_react4.useState({});
  const load = () => {
    setLoading(true);
    setError("");
    fetch(`${ROUTE}/sessions?all=1`).then((r) => readJson(r)).then((body) => setLocal(body ?? null)).catch((e) => setError(e.message)).finally(() => setLoading(false));
    if (boxes.length === 0)
      return;
    setRemoteLoading(true);
    fetch(`${ROUTE}/boxes/sessions`).then((r) => readJson(r)).then((body) => setRemote(body?.boxes ?? [])).catch((e) => setError(e.message)).finally(() => setRemoteLoading(false));
  };
  import_react4.useEffect(load, [boxes.map((b) => b.url).join("|")]);
  const groups = import_react4.useMemo(() => {
    const out = [];
    if (local)
      out.push({
        key: "local",
        name: local.host ?? "This box",
        host: local.host,
        ok: true,
        sessions: local.sessions ?? []
      });
    for (const b of boxes) {
      const r = remote.find((x) => x.url === b.url);
      if (local?.host && r?.host && r.host === local.host)
        continue;
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
  const paged = import_react4.useMemo(() => pageSessions(groups, { box, cwd, origin, shown }), [groups, box, cwd, origin, shown]);
  const rows = paged.list;
  const cwds = import_react4.useMemo(() => {
    const set = new Set;
    for (const g of groups)
      if (box === "all" || g.key === box) {
        for (const s of g.sessions)
          if (s.cwd)
            set.add(s.cwd);
      }
    return [...set].toSorted();
  }, [groups, box]);
  import_react4.useEffect(() => {
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
  const multiBox = groups.length > 1;
  const moreKey = box === "all" ? "all" : box;
  const more = paged.hidden[moreKey] ?? 0;
  const grown = (shown[moreKey] ?? PAGE) > PAGE;
  return /* @__PURE__ */ jsx_runtime3.jsxs("section", {
    id: "dsh-oh-my-claude-sessions-card",
    style: card,
    children: [
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        style: cardHead,
        children: [
          /* @__PURE__ */ jsx_runtime3.jsxs("div", {
            children: [
              /* @__PURE__ */ jsx_runtime3.jsx("h3", {
                style: h3,
                children: "Sessions"
              }),
              /* @__PURE__ */ jsx_runtime3.jsxs("div", {
                style: { ...meta, marginTop: 2 },
                children: [
                  loading ? "Loading…" : `${rows.length} shown · ${total} total`,
                  remoteLoading ? " · checking boxes…" : ""
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsx_runtime3.jsx("button", {
            type: "button",
            style: btn,
            disabled: loading,
            onClick: load,
            children: "Refresh"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        id: "dsh-oh-my-claude-session-filters",
        style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 10 },
        children: [
          /* @__PURE__ */ jsx_runtime3.jsx("button", {
            type: "button",
            style: chip(box === "all", false),
            onClick: () => setBox("all"),
            children: "All boxes"
          }),
          groups.map((g) => /* @__PURE__ */ jsx_runtime3.jsxs("button", {
            type: "button",
            style: chip(box === g.key, !g.ok),
            disabled: !g.ok,
            title: g.ok ? g.host : g.error,
            onClick: () => setBox(g.key),
            children: [
              g.name,
              g.key === "local" ? " · here" : "",
              g.ok ? ` · ${g.sessions.length}` : " · offline"
            ]
          }, g.key)),
          /* @__PURE__ */ jsx_runtime3.jsx("span", {
            style: { flex: 1 }
          }),
          /* @__PURE__ */ jsx_runtime3.jsxs("select", {
            id: "dsh-oh-my-claude-cwd-filter",
            style: select,
            value: cwd,
            onChange: (e) => setCwd(e.target.value),
            title: "Workspace",
            children: [
              /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: "all",
                children: "All workspaces"
              }),
              cwds.map((c) => /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: c,
                title: c,
                children: shortPath2(c)
              }, c))
            ]
          }),
          /* @__PURE__ */ jsx_runtime3.jsxs("select", {
            id: "dsh-oh-my-claude-origin-filter",
            style: select,
            value: origin,
            onChange: (e) => setOrigin(e.target.value),
            title: "Origin",
            children: [
              /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: "all",
                children: "Any origin"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: "dsh",
                children: "In dsh"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: "archived",
                children: "Archived"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("option", {
                value: "terminal",
                children: "Terminal only"
              })
            ]
          })
        ]
      }),
      error && /* @__PURE__ */ jsx_runtime3.jsx("p", {
        id: "dsh-oh-my-claude-error",
        style: { color: T.err, fontSize: 13, margin: "8px 0 0" },
        children: error
      }),
      !loading && rows.length === 0 && /* @__PURE__ */ jsx_runtime3.jsx("p", {
        id: "dsh-oh-my-claude-empty",
        style: { ...meta, marginTop: 10 },
        children: "No Claude Code sessions match."
      }),
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        id: "dsh-oh-my-claude-sessions",
        style: { marginTop: 6 },
        children: [
          rows.map((r) => {
            const isLocal = r.g.key === "local";
            const opened = isLocal && Boolean(known[r.s.dsh?.id ?? r.s.id]) && !r.s.dsh?.archived;
            const busy = busyId === r.s.id;
            const label = busy ? "Opening…" : !isLocal ? `Open on ${r.g.name}` : opened ? "Show" : r.s.dsh?.archived ? "Restore" : "Open";
            return /* @__PURE__ */ jsx_runtime3.jsxs("div", {
              "data-testid": "dsh-oh-my-claude-session-row",
              style: row,
              children: [
                /* @__PURE__ */ jsx_runtime3.jsxs("div", {
                  style: { flex: 1, minWidth: 0 },
                  children: [
                    /* @__PURE__ */ jsx_runtime3.jsx("div", {
                      style: {
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: T.text
                      },
                      title: r.s.title || r.s.id,
                      children: r.s.title || r.s.id
                    }),
                    /* @__PURE__ */ jsx_runtime3.jsxs("div", {
                      style: { ...meta, marginTop: 3, display: "flex", gap: 8, alignItems: "center" },
                      children: [
                        multiBox && /* @__PURE__ */ jsx_runtime3.jsx("span", {
                          style: pill(T.faint),
                          title: r.g.host,
                          children: r.g.host ?? r.g.name
                        }),
                        /* @__PURE__ */ jsx_runtime3.jsx(Origin, {
                          s: r.s
                        }),
                        r.s.cwd && /* @__PURE__ */ jsx_runtime3.jsx("span", {
                          title: r.s.cwd,
                          style: { fontFamily: T.mono },
                          children: shortPath2(r.s.cwd)
                        }),
                        /* @__PURE__ */ jsx_runtime3.jsxs("span", {
                          children: [
                            ago(r.s.modifiedAt),
                            " · ",
                            r.s.turns,
                            r.s.turnsPartial ? "+" : "",
                            " prompts · ",
                            size(r.s.bytes),
                            " ·",
                            " ",
                            /* @__PURE__ */ jsx_runtime3.jsx("span", {
                              style: { fontFamily: T.mono },
                              children: r.s.id.slice(0, 8)
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                /* @__PURE__ */ jsx_runtime3.jsx("button", {
                  id: `dsh-oh-my-claude-session-${r.s.id}-button`,
                  type: "button",
                  style: opened ? btn : btnPrimary,
                  disabled: busy,
                  onClick: () => open(r),
                  children: label
                })
              ]
            }, `${r.g.key}-${r.s.id}`);
          }),
          more > 0 && /* @__PURE__ */ jsx_runtime3.jsxs("div", {
            "data-testid": "dsh-oh-my-claude-load-more",
            style: { display: "flex", gap: 8, padding: "6px 0 2px" },
            children: [
              /* @__PURE__ */ jsx_runtime3.jsxs("button", {
                type: "button",
                style: btn,
                onClick: () => setShown((m) => ({ ...m, [moreKey]: (m[moreKey] ?? PAGE) + PAGE })),
                children: [
                  "Load ",
                  Math.min(PAGE, more),
                  " more"
                ]
              }),
              grown && /* @__PURE__ */ jsx_runtime3.jsxs("button", {
                type: "button",
                style: btn,
                onClick: () => setShown((m) => ({ ...m, [moreKey]: paged.matched[moreKey] ?? PAGE })),
                children: [
                  "Load all ",
                  paged.matched[moreKey] ?? ""
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}
function SettingsEditor({ open, onToggle, box, ctx }) {
  const [scope, setScope] = import_react4.useState("user");
  const [cwd, setCwd] = import_react4.useState(null);
  const [scopes, setScopes] = import_react4.useState([]);
  const [file, setFile] = import_react4.useState(null);
  const [text, setText] = import_react4.useState("");
  const [editing, setEditing] = import_react4.useState(false);
  const [busy, setBusy] = import_react4.useState(false);
  const [error, setError] = import_react4.useState("");
  const [saved, setSaved] = import_react4.useState("");
  const byId = ctx?.sessions.list.getSnapshot()?.byId ?? {};
  const cwdOptions = [
    ...new Set(Object.values(byId).flatMap((s) => s.cwd ? [s.cwd] : []))
  ].toSorted();
  const projectCwd = cwd ?? cwdOptions[0] ?? null;
  const settingsUrl = box ? `${ROUTE}/boxes/settings?url=${encodeURIComponent(box.url)}` : `${ROUTE}/settings`;
  const scopesUrl = projectCwd ? `${ROUTE}/settings/scopes?cwd=${encodeURIComponent(projectCwd)}` : `${ROUTE}/settings/scopes`;
  const show = (loaded) => {
    setFile(loaded);
    setText(loaded.text);
    setEditing(false);
    setSaved("");
  };
  const load = () => {
    setBusy(true);
    setError("");
    const done = box ? fetch(settingsUrl).then((r) => readJson(r)).then(show) : fetch(scopesUrl).then((r) => readJson(r)).then((b) => {
      const all = b.scopes ?? [];
      setScopes(all);
      const wanted = all.find((s) => s.scope === scope) ?? all.find((s) => s.scope === "user");
      if (wanted)
        show(wanted);
    });
    done.catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  import_react4.useEffect(load, [settingsUrl, scopesUrl, scope]);
  const parsed = import_react4.useMemo(() => {
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
    const body = box ? { text } : { text, scope };
    if (!box && projectCwd !== null)
      body.cwd = projectCwd;
    fetch(settingsUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
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
  const override = box ? "" : overrideNote(scopes, scope);
  const readOnly = !box && scope === "managed";
  const facts = summarize(parsed.value);
  const summary = file ? facts.length ? facts.map(([k, v]) => `${k} ${v}`).join(" · ") : file.exists ? "empty" : "not created yet" : "";
  const actions = editing ? /* @__PURE__ */ jsx_runtime3.jsxs(jsx_runtime3.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime3.jsx("button", {
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
      /* @__PURE__ */ jsx_runtime3.jsx("button", {
        id: "dsh-oh-my-claude-settings-save",
        type: "button",
        style: { ...btnPrimary, opacity: canSave ? 1 : 0.5 },
        disabled: !canSave,
        onClick: save,
        children: busy ? "Saving…" : "Save"
      })
    ]
  }) : open ? /* @__PURE__ */ jsx_runtime3.jsxs(jsx_runtime3.Fragment, {
    children: [
      /* @__PURE__ */ jsx_runtime3.jsx("button", {
        type: "button",
        style: btn,
        disabled: busy,
        onClick: load,
        children: "Reload"
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("button", {
        id: "dsh-oh-my-claude-settings-edit",
        type: "button",
        style: btn,
        disabled: busy || file === null || readOnly,
        onClick: () => {
          setSaved("");
          setEditing(true);
        },
        children: "Edit"
      })
    ]
  }) : null;
  return /* @__PURE__ */ jsx_runtime3.jsxs(Card, {
    id: "dsh-oh-my-claude-settings",
    title: "settings.json",
    summary,
    actions,
    open,
    onToggle,
    children: [
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        style: { ...meta, fontFamily: T.mono, whiteSpace: "normal", marginBottom: 8 },
        children: [
          file?.path ?? "…",
          file && !file.exists ? " · not created yet" : ""
        ]
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("p", {
        style: { margin: "0 0 10px", color: T.muted, fontSize: 13 },
        children: "Claude Code's own settings: hooks, permissions, model, env. Read by every Claude Code process on this box, in dsh or in a terminal. dsh's own hooks and settings are separate."
      }),
      !box && /* @__PURE__ */ jsx_runtime3.jsxs(jsx_runtime3.Fragment, {
        children: [
          /* @__PURE__ */ jsx_runtime3.jsxs("div", {
            style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 },
            children: [
              /* @__PURE__ */ jsx_runtime3.jsx("label", {
                style: { fontSize: 13, fontWeight: 500 },
                htmlFor: "dsh-oh-my-claude-scope",
                children: "Scope"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("select", {
                id: "dsh-oh-my-claude-scope",
                value: scope,
                onChange: (e) => {
                  setScope(e.target.value);
                },
                disabled: busy || editing,
                style: {
                  ...inputStyle,
                  padding: "4px 6px",
                  fontSize: 12,
                  textTransform: "capitalize"
                },
                children: SETTINGS_SCOPES.toReversed().map((s) => /* @__PURE__ */ jsx_runtime3.jsx("option", {
                  value: s,
                  disabled: cwdOptions.length === 0 && (s === "project" || s === "local"),
                  children: s
                }, s))
              }),
              (scope === "project" || scope === "local") && (cwdOptions.length > 0 ? /* @__PURE__ */ jsx_runtime3.jsx("select", {
                value: projectCwd ?? "",
                onChange: (e) => setCwd(e.target.value),
                disabled: busy || editing,
                style: { ...inputStyle, padding: "4px 6px", fontSize: 12, flex: 1 },
                children: cwdOptions.map((c) => /* @__PURE__ */ jsx_runtime3.jsx("option", {
                  value: c,
                  children: c
                }, c))
              }) : /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: { fontSize: 12, color: T.muted },
                children: "no session open in a directory"
              }))
            ]
          }),
          (readOnly || override) && /* @__PURE__ */ jsx_runtime3.jsxs("div", {
            style: { fontSize: 12, color: T.muted, marginBottom: 12 },
            children: [
              readOnly ? `${SCOPE_LABELS.managed} is read-only. ` : "",
              override
            ]
          })
        ]
      }),
      editing ? /* @__PURE__ */ jsx_runtime3.jsx("textarea", {
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
      }) : /* @__PURE__ */ jsx_runtime3.jsx("pre", {
        id: "dsh-oh-my-claude-settings-view",
        style: { ...code, maxHeight: 320, overflow: "auto", margin: 0 },
        children: text
      }),
      /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        style: { display: "flex", justifyContent: "space-between", gap: 12, marginTop: 6 },
        children: [
          /* @__PURE__ */ jsx_runtime3.jsx("span", {
            style: { fontSize: 12, color: parsed.error ? T.err : T.ok },
            children: parsed.error ? `Invalid JSON: ${parsed.error}` : `Valid JSON · ${Object.keys(parsed.value ?? {}).length} keys${dirty ? " · unsaved changes" : ""}`
          }),
          /* @__PURE__ */ jsx_runtime3.jsx("span", {
            style: { ...meta, whiteSpace: "normal", textAlign: "right" },
            children: error ? /* @__PURE__ */ jsx_runtime3.jsx("span", {
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
  const [probe, setProbe] = import_react4.useState({});
  const [self, setSelf] = import_react4.useState(null);
  const [draft, setDraft] = import_react4.useState({ name: "", url: "", token: "" });
  const [busy, setBusy] = import_react4.useState(false);
  const [error, setError] = import_react4.useState("");
  const [openSettingsUrl, setOpenSettingsUrl] = import_react4.useState(null);
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
  import_react4.useEffect(refresh, [boxes.map((b) => b.url).join("|")]);
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
  return /* @__PURE__ */ jsx_runtime3.jsxs(Card, {
    id: "dsh-oh-my-claude-boxes",
    title: "Boxes",
    summary,
    actions: open ? /* @__PURE__ */ jsx_runtime3.jsx("button", {
      type: "button",
      style: btn,
      disabled: busy || boxes.length === 0,
      onClick: refresh,
      children: busy ? "Checking…" : "Refresh"
    }) : null,
    open,
    onToggle,
    children: [
      /* @__PURE__ */ jsx_runtime3.jsx("p", {
        style: { margin: "0 0 4px", color: T.muted, fontSize: 13 },
        children: "Other machines running dsh with this plugin. Their sessions show in the list above; Open jumps there. Each box keeps its own Claude Code login."
      }),
      error && /* @__PURE__ */ jsx_runtime3.jsx("p", {
        style: { color: T.err, fontSize: 13, margin: "4px 0" },
        children: error
      }),
      boxes.map((b) => {
        const st = probe[b.url];
        const ok = st?.ok;
        const skew = ok && self && st.status?.plugin && st.status.plugin !== self.plugin;
        return /* @__PURE__ */ jsx_runtime3.jsxs("div", {
          "data-testid": "dsh-oh-my-claude-box-row",
          style: row,
          children: [
            /* @__PURE__ */ jsx_runtime3.jsxs("div", {
              style: { flex: 1, minWidth: 0 },
              children: [
                /* @__PURE__ */ jsx_runtime3.jsx("div", {
                  style: { color: T.text, fontWeight: 600 },
                  children: b.name
                }),
                /* @__PURE__ */ jsx_runtime3.jsxs("div", {
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
                    /* @__PURE__ */ jsx_runtime3.jsx("span", {
                      style: { fontFamily: T.mono },
                      children: b.url
                    }),
                    !st && /* @__PURE__ */ jsx_runtime3.jsx("span", {
                      style: pill(T.faint),
                      children: busy ? "checking" : "unchecked"
                    }),
                    st && !ok && /* @__PURE__ */ jsx_runtime3.jsx("span", {
                      style: pill(T.err),
                      children: st.error
                    }),
                    ok && st.status && /* @__PURE__ */ jsx_runtime3.jsxs(jsx_runtime3.Fragment, {
                      children: [
                        /* @__PURE__ */ jsx_runtime3.jsx("span", {
                          style: pill(T.faint),
                          children: st.status.host
                        }),
                        /* @__PURE__ */ jsx_runtime3.jsx("span", {
                          style: pill(st.status.binary ? T.ok : T.err),
                          children: st.status.binary ? `claude ${st.status.version ?? ""}`.trim() : "no claude"
                        }),
                        /* @__PURE__ */ jsx_runtime3.jsx("span", {
                          style: pill(st.status.loggedIn ? T.ok : T.err),
                          children: st.status.loggedIn ? maskEmail(st.status.email ?? "logged in") : "not logged in"
                        }),
                        /* @__PURE__ */ jsx_runtime3.jsxs("span", {
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
            /* @__PURE__ */ jsx_runtime3.jsx("button", {
              type: "button",
              style: btn,
              disabled: busy || !ok,
              onClick: () => setOpenSettingsUrl(openSettingsUrl === b.url ? null : b.url),
              children: "Edit settings"
            }),
            /* @__PURE__ */ jsx_runtime3.jsx("button", {
              type: "button",
              style: btn,
              disabled: busy,
              onClick: () => remove(b.url),
              children: "Remove"
            }),
            /* @__PURE__ */ jsx_runtime3.jsx("button", {
              type: "button",
              style: btnPrimary,
              onClick: () => jump(b),
              children: "Open"
            })
          ]
        }, b.url);
      }),
      openSettingsUrl && /* @__PURE__ */ jsx_runtime3.jsx("div", {
        style: { padding: "0 0 4px" },
        children: /* @__PURE__ */ jsx_runtime3.jsx(SettingsEditor, {
          open: true,
          onToggle: () => setOpenSettingsUrl(null),
          box: boxes.find((b) => b.url === openSettingsUrl)
        })
      }),
      /* @__PURE__ */ jsx_runtime3.jsxs("form", {
        onSubmit: add,
        style: {
          ...row,
          borderTop: boxes.length ? `1px solid ${T.border}` : "none",
          paddingTop: boxes.length ? 12 : 4,
          flexWrap: "wrap"
        },
        children: [
          /* @__PURE__ */ jsx_runtime3.jsx("input", {
            style: { ...inputStyle, flex: "0 1 140px" },
            placeholder: "Name",
            value: draft.name,
            onChange: (e) => setDraft({ ...draft, name: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime3.jsx("input", {
            style: { ...inputStyle, flex: "1 1 260px" },
            placeholder: "https://dsh.other-box.lan",
            value: draft.url,
            onChange: (e) => setDraft({ ...draft, url: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime3.jsx("input", {
            style: { ...inputStyle, flex: "1 1 200px" },
            type: "password",
            autoComplete: "off",
            placeholder: "dsh token (optional)",
            value: draft.token,
            onChange: (e) => setDraft({ ...draft, token: e.target.value })
          }),
          /* @__PURE__ */ jsx_runtime3.jsx("button", {
            type: "submit",
            style: btn,
            disabled: busy || !draft.name.trim() || !draft.url.trim(),
            children: "Add"
          })
        ]
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("div", {
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
var extLink = (text, href) => {
  const a = document.createElement("a");
  a.textContent = text;
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer noopener";
  a.style.color = T.brand;
  return a;
};
var appendNote = (el, note) => {
  const m = /\[([^\]]+)\]\(([^)]+)\)/.exec(note);
  const [whole, text, href] = m ?? [];
  if (!m || !whole || !text || !href) {
    el.append(note);
    return;
  }
  el.append(note.slice(0, m.index));
  el.append(href.startsWith("https://") ? extLink(text, href) : text);
  el.append(note.slice(m.index + whole.length));
};
function creditsRow(c) {
  const creditsLine = document.createElement("div");
  creditsLine.style.cssText = "display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:12px;row-gap:3px;padding:3px 0";
  const label = document.createElement("span");
  label.textContent = "Extra usage";
  label.style.cssText = `color:${T.text};font-weight:500`;
  const capped = c.enabled && c.capped;
  const amount = c.used ? ` · ${c.used}${c.limit ? ` / ${c.limit}` : ""}` : "";
  const value = document.createElement("span");
  value.textContent = `${capped ? "Limit reached" : c.enabled ? "On" : "Off"}${amount}`;
  value.style.cssText = `font-variant-numeric:tabular-nums;font-weight:600;color:${capped ? T.err : T.text}`;
  creditsLine.append(label, value);
  if (c.note || c.canPurchase) {
    const caption = document.createElement("span");
    caption.style.cssText = `grid-column:1 / -1;color:${T.faint};font-size:11px;line-height:16px`;
    if (c.note)
      appendNote(caption, c.note);
    if (c.canPurchase) {
      if (c.note)
        caption.append(" ");
      caption.append(extLink("Buy credits", "https://claude.ai/settings/usage"));
    }
    creditsLine.append(caption);
  }
  return creditsLine;
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
  if (reply.credits)
    block.append(creditsRow(reply.credits));
}
var frameScans = new Set;
var bodyObserver;
var scanQueued = false;
var flushScans = () => {
  scanQueued = false;
  for (const scan of frameScans)
    scan();
};
var onBodyMutation = (scan) => {
  frameScans.add(scan);
  if (bodyObserver)
    return;
  bodyObserver = new MutationObserver(() => {
    if (scanQueued)
      return;
    scanQueued = true;
    requestAnimationFrame(flushScans);
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
};
function watchContextMeter(ctx) {
  const MARK = "data-dsh-oh-my-claude-usage";
  const missing = (host) => host.querySelector(`:scope > [${MARK}]`) === null;
  const attach = (panel) => {
    if (!missing(panel))
      return;
    if (!activeClaudeSession(ctx))
      return;
    const block = document.createElement("div");
    block.setAttribute(MARK, "1");
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
    if (!missing(tip))
      return;
    if (!activeClaudeSession(ctx))
      return;
    const line = document.createElement("div");
    line.setAttribute(MARK, "1");
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
    if (root instanceof Element) {
      const dialog = root.closest('[role="dialog"]');
      if (dialog && isRingRoot(dialog.parentElement))
        attach(dialog);
      const tip = root.closest('[role="tooltip"]');
      if (tip && isRingRoot(tip.parentElement))
        bubble(tip);
    }
  };
  onBodyMutation(() => scan(document.body));
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
  styleEl.textContent = `body[data-omc-claude] [role="status"][aria-live="polite"],[data-dsh-oh-my-claude-turn]{background-image:linear-gradient(90deg,${CLAUDE_ORANGE} 0%,${CLAUDE_ORANGE} 40%,${CLAUDE_SHIMMER} 50%,${CLAUDE_ORANGE} 60%,${CLAUDE_ORANGE} 100%)}[data-dsh-oh-my-claude-turn]>span[aria-hidden]{display:inline-block;width:1.3em;text-align:center;flex:none}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]{color:${CLAUDE_ORANGE}}body[data-omc-claude] [role="tablist"]>[role="tab"][aria-selected="true"]::after{background:${CLAUDE_ORANGE}}`;
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
  const interval = setInterval(() => {
    if (!el.isConnected) {
      clearInterval(interval);
      obs.disconnect();
      return;
    }
    tick();
  }, 120);
  tick();
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
};
function watchSessionNotices(ctx) {
  let prev = null;
  const waiting = new Set;
  const tick = () => {
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap)
      return;
    const byId = {};
    for (const [id, s] of Object.entries(snap.byId))
      byId[id] = { running: s.running, completed: s.completed, displayTitle: s.displayTitle };
    const next = { byId, current: snap.current };
    for (const id of newlyWaiting(prev, next)) {
      if (!isClaudeSession(ctx, id))
        continue;
      waiting.add(id);
      notifyWaiting(ctx, id, snap.byId[id]?.displayTitle ?? id);
    }
    prev = next;
    if (snap.current !== undefined)
      waiting.delete(snap.current);
    if (!document.hidden)
      waiting.clear();
    const wanted = markTitle(document.title, waiting.size);
    if (wanted !== document.title)
      document.title = wanted;
  };
  tick();
  setInterval(tick, 1000);
}
function notifyWaiting(ctx, id, title) {
  if (!noticesOn() || !("Notification" in window) || Notification.permission !== "granted")
    return;
  const note = new Notification(title, { body: "Claude is waiting.", tag: `omc-${id}` });
  note.addEventListener("click", () => {
    window.focus();
    ctx.sessions.open(id);
    note.close();
  });
}
function watchTurnStatus(ctx) {
  ensureTurnStatusStyle();
  const markBody = () => {
    const want = activeClaudeSession(ctx) ? "1" : null;
    if (document.body.getAttribute("data-omc-claude") === want)
      return;
    if (want === null)
      document.body.removeAttribute("data-omc-claude");
    else
      document.body.setAttribute("data-omc-claude", want);
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
    attach(root);
    for (const el of root.querySelectorAll('[role="status"][aria-live="polite"]'))
      attach(el);
  };
  onBodyMutation(() => {
    if (!activeClaudeSession(ctx))
      return;
    scan(document.body);
  });
  scan(document.body);
}
var spinnerRowTitle = (dot) => dot.closest("span")?.nextElementSibling?.textContent?.trim() ?? null;
var inComposer = (node) => {
  for (let p = node.parentElement;p && p !== document.body; p = p.parentElement)
    if (p.querySelector("[contenteditable]"))
      return true;
  return false;
};
function watchSessionSpinners(ctx) {
  const MARK = "data-omc-spinner";
  const SEND_MARK = "data-omc-send";
  const claudeRunningTitles = () => {
    const set = new Set;
    const snap = ctx.sessions.list.getSnapshot();
    if (!snap)
      return set;
    for (const [id, s] of Object.entries(snap.byId))
      if (s.running && s.displayTitle && isClaudeSession(ctx, id))
        set.add(s.displayTitle.trim());
    return set;
  };
  const scan = () => {
    const claude = claudeRunningTitles();
    const openIsClaude = activeClaudeSession(ctx) !== undefined;
    for (const dot of document.querySelectorAll('svg[data-state="ongoing"]')) {
      const inRow = dot.closest('[role="treeitem"]');
      let want;
      if (inRow) {
        const title = spinnerRowTitle(dot);
        want = title !== null && claude.has(title);
      } else {
        want = openIsClaude;
      }
      if (want) {
        dot.style.color = CLAUDE_ORANGE;
        dot.setAttribute(MARK, "1");
      } else if (dot.hasAttribute(MARK)) {
        dot.style.color = "";
        dot.removeAttribute(MARK);
      }
    }
    for (const sendBtn of document.querySelectorAll('button[class*="_primary"]')) {
      const sendWant = openIsClaude && inComposer(sendBtn);
      if (sendWant) {
        sendBtn.style.setProperty("--dsw-alias-button-info-fill", CLAUDE_ORANGE);
        sendBtn.style.setProperty("--dsw-alias-button-info-hover", CLAUDE_SHIMMER);
        sendBtn.setAttribute(SEND_MARK, "1");
      } else if (sendBtn.hasAttribute(SEND_MARK)) {
        sendBtn.style.removeProperty("--dsw-alias-button-info-fill");
        sendBtn.style.removeProperty("--dsw-alias-button-info-hover");
        sendBtn.removeAttribute(SEND_MARK);
      }
    }
  };
  scan();
  setInterval(scan, 1000);
}
var isStatsRow = (el) => el.isConnected && el.children.length > 1 && /\d+ turns · \d+ steps/.test(el.textContent ?? "");
function CostLine({ sessionId, ctx }) {
  const [turns, setTurns] = import_react4.useState([]);
  const turnsRef = import_react4.useRef([]);
  turnsRef.current = turns;
  const visibleRef = import_react4.useRef(true);
  import_react4.useEffect(() => {
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
        const next = body.turns ?? [];
        if (alive && (next.length > 0 || turnsRef.current.length === 0))
          setTurns(next);
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
  const mineRef = import_react4.useRef(false);
  if (activeClaudeSession(ctx) === sessionId)
    mineRef.current = true;
  else {
    const current = ctx.sessions.list.getSnapshot()?.current;
    if (current && current !== sessionId)
      mineRef.current = false;
  }
  const mine = mineRef.current;
  const total = turns.reduce((s, r) => s + r.costUsd, 0);
  const totalCacheRead = turns.reduce((s, r) => s + r.cacheRead, 0);
  const last = turns[turns.length - 1];
  const text = mine && total > 0 && last ? costText(total, last.costUsd, totalCacheRead) : "";
  const title = mine && total > 0 && last ? `Claude cost: ${fmtCost(total)} this session, ${fmtCost(last.costUsd)} last turn (${turns.length} turn${turns.length === 1 ? "" : "s"})${fmtTtft(last.ttftMs)}` : "";
  const anchorRef = import_react4.useRef(null);
  const [hooked, setHooked] = import_react4.useState(false);
  const textRef = import_react4.useRef(text);
  const titleRef = import_react4.useRef(title);
  textRef.current = text;
  titleRef.current = title;
  const syncRef = import_react4.useRef(() => {});
  import_react4.useEffect(() => syncRef.current(), [text, title]);
  import_react4.useEffect(() => {
    let inline;
    let body;
    let rowLead = "";
    let lastRow;
    const MARK = "data-dsh-oh-my-claude-cost";
    const debug = (...args) => {
      try {
        if (localStorage.getItem("omc-debug") === "1")
          console.debug("[oh-my-claude cost]", ...args);
      } catch {}
    };
    const tryHook = () => {
      if (!anchorRef.current?.isConnected)
        return;
      if (inline?.isConnected) {
        inline.title = titleRef.current;
        if (body)
          body.textContent = ` ${textRef.current}`;
        return;
      }
      if (inline)
        debug("row dropped our span; hooking again");
      const statsRow = lastRow && isStatsRow(lastRow) ? lastRow : [...document.querySelectorAll("div")].filter(isStatsRow).at(-1);
      lastRow = statsRow;
      if (!statsRow) {
        debug("no stats row on screen");
        return;
      }
      inline = document.createElement("span");
      inline.title = titleRef.current;
      inline.style.whiteSpace = "nowrap";
      const sep = document.createElement("span");
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "|";
      body = document.createElement("span");
      body.textContent = ` ${textRef.current}`;
      inline.append(" ", sep, body);
      rowLead = (statsRow.firstElementChild?.textContent ?? "").replace(/\s+/g, "");
      statsRow.append(inline);
      debug("hooked the stats row", { rowLead, text: textRef.current });
      setHooked(true);
    };
    const hookTips = () => {
      if (!rowLead)
        return;
      for (const tip of document.querySelectorAll('[role="tooltip"]')) {
        if (!(tip.textContent ?? "").replace(/\s+/g, "").startsWith(rowLead))
          continue;
        const part = tip.querySelector(`:scope > [${MARK}]`);
        if (part) {
          part.textContent = ` | ${textRef.current}`;
          continue;
        }
        const fresh = document.createElement("span");
        fresh.setAttribute(MARK, "1");
        fresh.textContent = ` | ${textRef.current}`;
        tip.append(fresh);
        debug("hooked a bubble");
      }
    };
    const drop = () => {
      inline?.remove();
      inline = undefined;
      body = undefined;
      lastRow = undefined;
      for (const part of document.querySelectorAll(`[${MARK}]`))
        part.remove();
      setHooked(false);
    };
    let queued = false;
    const sync = () => {
      queued = false;
      if (!textRef.current) {
        if (inline)
          debug("no cost to show; dropping the row");
        drop();
        return;
      }
      tryHook();
      hookTips();
    };
    syncRef.current = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    };
    const observer = new MutationObserver(syncRef.current);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    const timer = setInterval(sync, 1000);
    return () => {
      clearInterval(timer);
      observer.disconnect();
      syncRef.current = () => {};
      drop();
    };
  }, []);
  if (!text)
    return /* @__PURE__ */ jsx_runtime3.jsx("span", {
      ref: anchorRef,
      hidden: true
    });
  return /* @__PURE__ */ jsx_runtime3.jsx("span", {
    ref: anchorRef,
    style: hooked ? { display: "none" } : undefined,
    children: /* @__PURE__ */ jsx_runtime3.jsxs("span", {
      title,
      style: { display: "inline", fontSize: 14, color: T.faint, whiteSpace: "nowrap" },
      children: [
        /* @__PURE__ */ jsx_runtime3.jsx("span", {
          "aria-hidden": "true",
          children: "|"
        }),
        " ",
        text
      ]
    })
  });
}
function AsideBubble({ sessionId, ctx }) {
  const [items, setItems] = import_react4.useState([]);
  const [dismissed, setDismissed] = import_react4.useState(() => new Set);
  const [copied, setCopied] = import_react4.useState(null);
  const [collapsed, setCollapsed] = import_react4.useState(() => new Set);
  const visibleRef = import_react4.useRef(true);
  import_react4.useEffect(() => {
    if (activeClaudeSession(ctx) !== sessionId)
      return;
    let alive = true;
    const fetchItems = async () => {
      try {
        const r = await fetch(`${ROUTE}/side-questions?session=${encodeURIComponent(sessionId)}`);
        if (!r.ok)
          return;
        const body = await r.json();
        if ("error" in body)
          return;
        if (alive)
          setItems(body.items ?? []);
      } catch {}
    };
    fetchItems();
    const interval = setInterval(() => {
      if (visibleRef.current)
        fetchItems();
    }, 3000);
    const onVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
      if (visibleRef.current)
        fetchItems();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, sessionId]);
  const shown = items.filter((it) => !dismissed.has(it.id));
  if (activeClaudeSession(ctx) !== sessionId || shown.length === 0)
    return null;
  const dismissAside = (id) => {
    setDismissed((prev) => new Set(prev).add(id));
    fetch(`${ROUTE}/side-questions/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sessionId, id })
    }).catch(() => {});
  };
  const copy = (it) => {
    const text = it.answer ?? it.error ?? it.question;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(it.id);
      setTimeout(() => setCopied((cur) => cur === it.id ? null : cur), 1200);
    });
  };
  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id))
      next.delete(id);
    else
      next.add(id);
    return next;
  });
  const iconBtn = {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "0 2px",
    lineHeight: 1,
    flex: "0 0 auto"
  };
  return /* @__PURE__ */ jsx_runtime3.jsx("div", {
    style: {
      boxSizing: "border-box",
      width: "calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
      maxWidth: "calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset))",
      margin: "0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px)",
      padding: "0 var(--dsh-composer-dock-inset)",
      flex: "none",
      display: "flex",
      flexDirection: "column",
      gap: 6
    },
    children: shown.map((it) => {
      const open = !collapsed.has(it.id);
      return /* @__PURE__ */ jsx_runtime3.jsxs("div", {
        style: {
          boxSizing: "border-box",
          background: "var(--dsw-specific-tip, var(--dsw-alias-bg-base, transparent))",
          border: "0.5px solid var(--dsw-alias-border-l1, rgba(217,119,87,.4))",
          borderRadius: "12px 12px 0 0",
          overflow: "hidden"
        },
        children: [
          /* @__PURE__ */ jsx_runtime3.jsxs("div", {
            role: "button",
            tabIndex: 0,
            "aria-expanded": open,
            onClick: () => toggle(it.id),
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(it.id);
              }
            },
            style: {
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              cursor: "pointer"
            },
            children: [
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: { color: CLAUDE_ORANGE, fontSize: 13, flex: "0 0 auto" },
                "aria-hidden": "true",
                children: CLAUDE_MARK
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: {
                  color: CLAUDE_ORANGE,
                  fontWeight: 600,
                  fontSize: 12,
                  flex: "0 0 auto"
                },
                children: "Side question"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: {
                  color: T.muted,
                  fontSize: 12,
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                },
                children: it.question
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: { color: T.faint, fontSize: 11, flex: "0 0 auto" },
                children: ago(it.at)
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("button", {
                type: "button",
                onClick: (e) => {
                  e.stopPropagation();
                  copy(it);
                },
                "aria-label": "Copy side question",
                style: {
                  ...iconBtn,
                  color: copied === it.id ? CLAUDE_ORANGE : T.muted,
                  fontSize: 11
                },
                children: copied === it.id ? "Copied" : "Copy"
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("span", {
                style: {
                  width: 14,
                  height: 14,
                  color: "var(--dsw-alias-label-tertiary, " + T.faint + ")",
                  flex: "0 0 auto",
                  display: "grid",
                  placeItems: "center"
                },
                "aria-hidden": "true",
                children: /* @__PURE__ */ jsx_runtime3.jsx("svg", {
                  width: "14",
                  height: "14",
                  viewBox: "0 0 14 14",
                  fill: "none",
                  children: /* @__PURE__ */ jsx_runtime3.jsx("polyline", {
                    points: open ? "3.5,5.5 7,9 10.5,5.5" : "3.5,8.5 7,5 10.5,8.5",
                    stroke: "currentColor",
                    strokeWidth: "1.25",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  })
                })
              }),
              /* @__PURE__ */ jsx_runtime3.jsx("button", {
                type: "button",
                onClick: (e) => {
                  e.stopPropagation();
                  dismissAside(it.id);
                },
                "aria-label": "Dismiss side question",
                style: { ...iconBtn, color: T.muted, fontSize: 12 },
                children: "✕"
              })
            ]
          }),
          open ? /* @__PURE__ */ jsx_runtime3.jsx("div", {
            style: { padding: "0 10px 8px 24px" },
            children: it.pending ? /* @__PURE__ */ jsx_runtime3.jsx("div", {
              style: { color: CLAUDE_ORANGE, fontSize: 12, fontStyle: "italic" },
              children: "Claude is thinking…"
            }) : it.error ? /* @__PURE__ */ jsx_runtime3.jsx("div", {
              style: { color: T.err, fontSize: 12 },
              children: it.error
            }) : /* @__PURE__ */ jsx_runtime3.jsx("div", {
              style: { color: T.text, fontSize: 13, whiteSpace: "pre-wrap" },
              children: it.answer
            })
          }) : null
        ]
      }, it.id);
    })
  });
}
var formatCacheRead = (tokens) => {
  if (tokens <= 0)
    return "";
  if (tokens < 1000)
    return String(Math.round(tokens));
  const scaled = tokens < 1e6 ? tokens / 1000 : tokens / 1e6;
  const unit = tokens < 1e6 ? "K" : "M";
  return `${scaled.toFixed(1).replace(/\.0$/, "")}${unit}`;
};
var fmtTtft = (ms) => {
  if (ms === undefined || ms <= 0)
    return "";
  const shown = ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  return `, ${shown} to first token`;
};
var costText = (total, last, cacheRead = 0) => {
  let text = `${CLAUDE_MARK} ${fmtCost(total)} · ${fmtCost(last)} last`;
  const cached = formatCacheRead(cacheRead);
  if (cached)
    text += ` · ${cached} cached`;
  return text;
};
function IdleChip({ sessionId }) {
  const [deadline, setDeadline] = import_react4.useState(null);
  const visibleRef = import_react4.useRef(true);
  import_react4.useEffect(() => {
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
  return /* @__PURE__ */ jsx_runtime3.jsxs("span", {
    style: { display: "flex", alignItems: "center", gap: 6 },
    children: [
      /* @__PURE__ */ jsx_runtime3.jsxs("span", {
        style: { fontSize: 11, color: T.warn, fontFamily: T.mono },
        children: [
          "stopping in ",
          seconds,
          "s"
        ]
      }),
      /* @__PURE__ */ jsx_runtime3.jsx("button", {
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
  watchSessionNotices(ctx);
  watchSessionSpinners(ctx);
  function Section() {
    const [boxes, setBoxes] = import_react4.useState([]);
    const [openBoxes, setOpenBoxes] = import_react4.useState(false);
    const [error, setError] = import_react4.useState("");
    import_react4.useEffect(() => {
      fetch(`${ROUTE}/boxes`).then((r) => readJson(r)).then((b) => setBoxes(b.boxes ?? [])).catch((e) => {
        setError(e.message);
        setBoxes([]);
      });
    }, []);
    return /* @__PURE__ */ jsx_runtime3.jsxs("div", {
      children: [
        /* @__PURE__ */ jsx_runtime3.jsx("h2", {
          id: "dsh-oh-my-claude-heading",
          style: { marginTop: 0 },
          children: "Oh My Claude"
        }),
        /* @__PURE__ */ jsx_runtime3.jsx(Runtime, {
          onStatus: () => {}
        }),
        error && /* @__PURE__ */ jsx_runtime3.jsx("p", {
          style: { color: T.err, fontSize: 13 },
          children: error
        }),
        boxes !== null && /* @__PURE__ */ jsx_runtime3.jsx(Sessions, {
          ctx,
          boxes
        }),
        boxes !== null && /* @__PURE__ */ jsx_runtime3.jsx(Boxes, {
          boxes,
          setBoxes,
          open: openBoxes || boxes.length === 0,
          onToggle: () => setOpenBoxes((v) => !v)
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
    ctx.slots.register({ name: "conversation.composer.dock", id: "claude-cost", order: 10 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime3.jsx(CostLine, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    return null;
  });
  ctx.slots.inject("conversation.input.dock", () => {
    ctx.slots.register({ name: "conversation.input.dock", id: "claude-aside", order: 45 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime3.jsx(AsideBubble, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    return null;
  });
  ctx.slots.inject("conversation.session.header.actions", () => {
    ctx.slots.register({ name: "conversation.session.header.actions", id: "claude-idle-warn", order: 31 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime3.jsx(IdleChip, {
      sessionId: props.sessionId
    }) : null);
    return null;
  });
  ctx.slots.inject("conversation.input.left", () => {
    ctx.slots.register({ name: "conversation.input.left", id: "claude-access", order: 40 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime3.jsx(AccessShield, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    ctx.slots.register({ name: "conversation.input.left", id: "oh-my-claude", order: 50 }, (props) => props.sessionId ? /* @__PURE__ */ jsx_runtime3.jsx(OhMyClaudeControl, {
      sessionId: props.sessionId,
      ctx
    }) : null);
    return null;
  });
}

return module.exports; } });
