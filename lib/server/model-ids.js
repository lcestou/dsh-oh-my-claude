// Model id forms, shared by the server routes and the client: no Node import may land here, since
// the client bundle takes this file as it is.
/**
 * A remembered model id as one the lineup still offers, or undefined when none of its forms is
 * there. The CLI renames its rows between releases: 2.1.273 listed Fable as `claude-fable-5-1[1m]`
 * and 2.1.274 lists it as `claude-fable-5-1`, so a workspace that remembered the first would put a
 * session on an id no menu has, and dsh's picker then shows the raw `provider/model` text (owner,
 * 2026-09-17). Tried in order: the id as it is, without its `[1m]` suffix, without a date stamp,
 * without both. A model retired outright falls back to its family (the word after `claude-`, or
 * the alias itself): the family alias with the same `[1m]` choice, the plain alias, then the first
 * offered id of that family, which is the newest while the lineup lists newest first.
 */
export function livingModelId(id, offered) {
    const bare = id.endsWith("[1m]") ? id.slice(0, -4) : id;
    const forms = [id, bare, id.replace(/-\d{8}(?=$|\[)/, ""), bare.replace(/-\d{8}$/, "")];
    const same = forms.find((form) => offered.includes(form));
    if (same !== undefined)
        return same;
    const family = bare.replace(/^claude-/, "").split("-")[0] ?? "";
    if (!/^[a-z]+$/.test(family) || family === "default")
        return undefined;
    const aliases = id === bare ? [family] : [`${family}[1m]`, family];
    return (aliases.find((alias) => offered.includes(alias)) ??
        offered.find((m) => m.startsWith(`claude-${family}-`)));
}
//# sourceMappingURL=model-ids.js.map