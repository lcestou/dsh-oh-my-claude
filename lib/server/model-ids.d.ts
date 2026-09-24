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
export declare function livingModelId(id: string, offered: readonly string[]): string | undefined;
