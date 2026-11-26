// The words the Changes tab's two controls and the second-opinion card send. One module because the
// server asks the question the client labels, and because each is a string a person reads before
// pressing send.
// Pure, no DOM, no React: src/client imports it the way tune.tsx imports ../permissions.js.
/** What the Ask control asks. `path` empty means the whole working tree. Short on purpose: this is
 *  what the aside ring stores, while the diff that goes with it is sent as context and dropped. */
export const diffQuestion = (path) => path === ""
    ? "What do my uncommitted changes do, and is anything in them risky?"
    : `What does the change to ${path} do, and is anything in it risky?`;
/** How many paths the review prompt names before it gives the count instead. Past a dozen the list
 *  stops telling a reader anything and Claude reads the tree itself anyway. */
const NAMED = 12;
/** The prompt Review my changes writes into the composer. Never sent by the plugin: the person
 *  reads it, edits it, sends it. */
export const reviewPrompt = (paths) => {
    const head = "Review my uncommitted changes. Start with correctness, then anything risky.";
    if (paths.length === 0)
        return head;
    return paths.length > NAMED
        ? `${head} ${paths.length} files changed.`
        : `${head} Files: ${paths.join(", ")}`;
};
/** What a second opinion's Send to Claude writes into the composer: the reviewing model named, then
 *  one line per finding. Never sent by the plugin: the person reads it, edits it, sends it. */
export const secondOpinionSteer = (model, findings) => `A second model (${model}) reviewed the changes from your last turn and raised the points below. Check each one against the code. Fix the ones that hold, and say briefly why the others do not.\n\n${findings
    .map((f) => `- [${f.kind}] ${f.where ? `${f.where} ` : ""}${f.text}`)
    .join("\n")}`;
//# sourceMappingURL=prompts.js.map