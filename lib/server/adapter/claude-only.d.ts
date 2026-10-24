/**
 * The answer a command this plugin owns gives in a session that does not run on Claude Code, or
 * undefined when it may run. dsh's command registry is host-wide, so every session lists these
 * commands; the check happens when one is typed. An unknown provider (a session dsh could not
 * read) is let through: refusing there would refuse in the plugin's own sessions too.
 */
export declare function claudeOnlyRefusal(provider: string | undefined, command: string): {
    kind: "error";
    text: string;
} | undefined;
