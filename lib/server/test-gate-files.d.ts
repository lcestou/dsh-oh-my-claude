import type { TestGateConfig, TestGateFile, TestGateRun } from "./test-gate.js";
/** A parsed JSON value: what `JSON.parse` can hand back. */
type Json = string | number | boolean | null | Array<Json> | {
    [key: string]: Json;
};
/** A failure's text for the hook's stderr; the hook cannot load `process.ts`'s `errorText`. */
export declare const failureText: (cause: unknown) => string;
/** The gate file under a state dir. */
export declare const gatePathIn: (stateDir: string) => string;
/** The run directory under a state dir: one `<session>.json` per gated session. */
export declare const runDirIn: (stateDir: string) => string;
/** A gate from JSON this plugin did not write (a request body, a hand-edited file), clamped; or
 *  undefined when `enabled` is not a boolean or `command` not a string. Missing numbers take the
 *  defaults. */
export declare function gateEntryOf(v: Json | undefined): TestGateConfig | undefined;
/** A save request: the workspace and its gate, or null to clear it; undefined when the body is
 *  neither. A body with no `config` at all is refused, not read as a clear. */
export declare function gatePutOf(body: {
    [key: string]: Json;
}): {
    cwd: string;
    config: TestGateConfig | null;
} | undefined;
/** The whole gate file; a missing or unreadable one is an empty map (every gate off), and an
 *  entry that does not parse is dropped on its own. */
export declare function readGateFile(path: string): Promise<TestGateFile>;
/** Record the close of the run that started at `startedAt`; a later run is not affected. */
export declare function writeDismiss(path: string, startedAt: number): Promise<void>;
/** A run file from disk, with `dismissed` set when its close was recorded, or null when it is
 *  missing, half written or not a run. */
export declare function readRunFile(path: string): Promise<TestGateRun | null>;
/** What the gate reads of the hook's stdin. */
export interface HookInput {
    stopHookActive: boolean;
    permissionMode: string;
}
/** The two hook input fields the gate reads: whether this stop follows a block, and the
 *  session's permission mode (probed on 2.1.332: `default`, `acceptEdits`, `bypassPermissions`,
 *  `plan`). Input it cannot read gives false and an empty mode, which the gate does not run in. */
export declare function hookInputOf(text: string): HookInput;
/** package.json's `test` script, or undefined when there is none or the file does not parse. */
export declare function testScriptIn(packageJson: string | undefined): string | undefined;
/** Write `data` as JSON through a temp file and a rename, so a reader never sees half a file. */
export declare function writeJsonAtomic(path: string, data: TestGateFile | TestGateRun): Promise<void>;
export {};
