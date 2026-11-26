/** What the Ask control asks. `path` empty means the whole working tree. Short on purpose: this is
 *  what the aside ring stores, while the diff that goes with it is sent as context and dropped. */
export declare const diffQuestion: (path: string) => string;
/** The prompt Review my changes writes into the composer. Never sent by the plugin: the person
 *  reads it, edits it, sends it. */
export declare const reviewPrompt: (paths: readonly string[]) => string;
/** One second-opinion finding as the card carries it (`Finding` in src/adapter/second-opinion.ts). */
export interface OpinionFinding {
    kind: "bug" | "risk" | "note";
    where: string;
    text: string;
}
/** What a second opinion's Send to Claude writes into the composer: the reviewing model named, then
 *  one line per finding. Never sent by the plugin: the person reads it, edits it, sends it. */
export declare const secondOpinionSteer: (model: string, findings: readonly OpinionFinding[]) => string;
