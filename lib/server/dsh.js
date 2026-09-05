// Hand-written slices of @deepseek-ai/dsh service types, copied from the .d.ts files on this box.
// The dsh packages are NOT dependencies of this repo; we mirror only what this plugin touches.
/** Map of providerId → adapter on globalThis (hot-reload cross-plugin process adoption; per-instance). */
export const ADAPTER_CURRENT = Symbol.for("dsh-oh-my-claude.adapter");
/** Map of providerId → timer on globalThis (scoped outside cordis to survive plugin re-instantiation). */
export const RESUME_TIMER = Symbol.for("dsh-oh-my-claude.resume-timer");
/** Symbol for the Claude process registry on globalThis (adopted processes across hot reloads). */
export const PROCESS_REGISTRY = Symbol.for("dsh-oh-my-claude.processes");
/** Per-session turn accounting on globalThis: the route registered at boot must read the buffer a hot-reloaded adapter fills. */
export const TURN_RECORDS = Symbol.for("dsh-oh-my-claude.turns");
/** The CLI's last slash-command catalog, so a hot-reloaded adapter re-registers the bridge without a new init frame. */
export const COMMAND_CATALOG = Symbol.for("dsh-oh-my-claude.commands");
/** dsh session ids are plain strings on the wire; this is the one place they get their brand. */
export const asSessionId = (id) => 
// SAFETY: the brand only marks provenance; every id reaching the adapter came from dsh itself
id;
//# sourceMappingURL=dsh.js.map