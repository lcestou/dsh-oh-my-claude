/** Everything the report says, gathered by the route. Never an email, token or session text. */
export interface ReportInput {
    plugin: string;
    dsh: string | null;
    cli: string | null;
    binary: boolean;
    os: string;
    node: string;
    loggedIn: boolean;
    authMethod: string | null;
    configDir: string;
    stateDir: string;
    stateWritable: boolean;
    /** null when no session was named or no process is running for it. */
    mcp: {
        name: string;
        status: string;
    }[] | null;
    lastError: string | null;
    switches: Record<string, boolean | number>;
    running: number;
}
/** The values that must never appear in the text. */
export interface PrivateValues {
    home: string;
    user: string;
    hostname: string;
    email?: string | null;
}
/** The `version` of a parsed package.json, or null; lives here because adapter.ts may not typeof. */
export declare function versionOf(pkg: unknown): string | null;
/** Strips private values from report text, but only replaces a home path at a path boundary (so
 *  `/home/alice2` is not turned into `~2`) and only the username and hostname as whole words, to
 *  avoid false positives. */
export declare function redact(text: string, p: PrivateValues, keepHost: boolean): string;
/** Assembles the report lines and redacts them before returning, so one tested function owns what
 *  may leave the box. */
export declare function buildReport(input: ReportInput, p: PrivateValues, keepHost: boolean): string;
