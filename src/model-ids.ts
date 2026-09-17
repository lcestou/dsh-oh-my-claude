// Model id forms, shared by the server routes and the client: no Node import may land here, since
// the client bundle takes this file as it is.

/**
 * A remembered model id as one the lineup still offers, or undefined when none of its forms is
 * there. The CLI renames its rows between releases: 2.1.273 listed Fable as `claude-fable-5-1[1m]`
 * and 2.1.274 lists it as `claude-fable-5-1`, so a workspace that remembered the first would put a
 * session on an id no menu has, and dsh's picker then shows the raw `provider/model` text (owner,
 * 2026-09-17). Tried in order: the id as it is, without its `[1m]` suffix, without a date stamp,
 * without both.
 */
export function livingModelId(id: string, offered: readonly string[]): string | undefined {
  const bare = id.endsWith("[1m]") ? id.slice(0, -4) : id;
  const forms = [id, bare, id.replace(/-\d{8}(?=$|\[)/, ""), bare.replace(/-\d{8}$/, "")];
  return forms.find((form) => offered.includes(form));
}
