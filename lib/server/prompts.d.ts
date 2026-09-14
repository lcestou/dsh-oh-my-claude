/** What the Ask control asks. `path` empty means the whole working tree. Short on purpose: this is
 *  what the aside ring stores, while the diff that goes with it is sent as context and dropped. */
export declare const diffQuestion: (path: string) => string;
/** The prompt Review my changes writes into the composer. Never sent by the plugin: the person
 *  reads it, edits it, sends it. */
export declare const reviewPrompt: (paths: readonly string[]) => string;
