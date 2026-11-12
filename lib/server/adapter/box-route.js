// Where an ssh box's own Claude Code sends its traffic. The box's settings files, its shell and its
// loopback are not this one's, so both halves of the question are asked there over ssh: which
// routing variables are in force, and whether the address they name reaches Anthropic.
import { execFile } from "node:child_process";
import { messagesUrl, PROBE_TTL_MS, ProbeBody, readsAsAnthropic, } from "../first-party.js";
import { managedDir } from "../instructions.js";
import { shq, sshArgs } from "../process.js";
import { settingsEnvIn } from "../sessions.js";
import { proxyBaseUrl } from "./catalog.js";
import { routeEnvIn, routeOf, routeSignature } from "./routing.js";
/** The plugin's ssh, with its options and host check (`sshArgs`). Never throws. */
const sshRun = (host, script) => new Promise((resolve) => {
    try {
        execFile("ssh", sshArgs(host, script), { timeout: 12_000, windowsHide: true }, (e, out) => resolve(e ? undefined : String(out)));
    }
    catch {
        // `sshArgs` refuses a host ssh would read as an option
        resolve(undefined);
    }
});
const MARK = "<<omc-box-route>>";
/** The variables read out of the far shell's environment: the ones that route the CLI or size its
 *  window. By name, so a key exported there never crosses the wire. */
const SHELL_VARS = "^(ANTHROPIC_BASE_URL|ANTHROPIC_DEFAULT_[A-Z0-9_]+|CLAUDE_CODE_USE_[A-Z]+|CLAUDE_CODE_AUTO_COMPACT_WINDOW|CLAUDE_CODE_MAX_CONTEXT_TOKENS)=";
/**
 * The script that prints the three layers the far CLI merges, lowest first: the shell's own
 * variables, the user's settings.json, the managed file. Each part ends with a mark, so a
 * missing file is an empty part and a cut-off answer has too few marks to be read.
 */
export const boxEnvScript = (host) => `env | grep -E ${shq(SHELL_VARS)}; printf '\\n%s\\n' ${shq(MARK)}; ` +
    `cat "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" 2>/dev/null; printf '\\n%s\\n' ${shq(MARK)}; ` +
    `cat ${shq(`${managedDir({ sshHost: host })}/managed-settings.json`)} 2>/dev/null; printf '\\n%s\\n' ${shq(MARK)}`;
/** The script that asks `baseUrl` the first-party question from the box: no key, headers kept. */
export const boxProbeScript = (baseUrl) => `curl -s -m 4 -D - -X POST -H 'content-type: application/json' -d '{}' ${shq(messagesUrl(baseUrl))}`;
/**
 * Read `boxEnvScript`'s output. `undefined` when it is not whole (the ssh died halfway), so a
 * half answer is never taken for "no router". A settings file that does not parse counts as
 * silent, as it does for the CLI.
 */
export function parseBoxEnv(out) {
    const parts = out.split(`\n${MARK}\n`);
    if (parts.length < 4)
        return undefined;
    const env = {};
    for (const line of (parts[0] ?? "").split("\n")) {
        const at = line.indexOf("=");
        if (at > 0)
            env[line.slice(0, at)] = line.slice(at + 1);
    }
    // The managed file outranks the user's, and both outrank the shell.
    const files = settingsEnvIn([
        { scope: "managed", text: parts[2] ?? "" },
        { scope: "user", text: parts[1] ?? "" },
    ]);
    Object.assign(env, files.env);
    const ownWindow = files.autoCompactWindow !== undefined ||
        env.CLAUDE_CODE_AUTO_COMPACT_WINDOW !== undefined ||
        env.CLAUDE_CODE_MAX_CONTEXT_TOKENS !== undefined;
    // Only the routing variables are kept: the settings file also holds the router's key.
    return { env: routeEnvIn(env), ownWindow };
}
/**
 * Read `boxProbeScript`'s output: header blocks, then the body. `undefined` for an empty answer
 * (no `curl`, a refused connection, a timeout), which is "not asked" rather than "not Anthropic".
 */
export function parseBoxProbe(out) {
    if (!out?.startsWith("HTTP/"))
        return undefined;
    let rest = out.replaceAll("\r\n", "\n");
    let requestId = "";
    // More than one block when the endpoint sent an interim status first.
    while (rest.startsWith("HTTP/")) {
        const end = rest.indexOf("\n\n");
        const head = end === -1 ? rest : rest.slice(0, end);
        requestId = /^request-id:\s*(.*)$/im.exec(head)?.[1]?.trim() ?? requestId;
        rest = end === -1 ? "" : rest.slice(end + 2);
    }
    return readsAsAnthropic(probeBody(rest), requestId);
}
/** The probe's body, blank when it is not JSON in a shape `ProbeBody` reads: the request id in
 *  the header still counts then. */
function probeBody(text) {
    try {
        return ProbeBody(JSON.parse(text));
    }
    catch {
        return ProbeBody({});
    }
}
/** Ask `host` both questions now. `undefined` when the box could not be read at all. */
export async function askBoxRoute(host, run = sshRun) {
    const read = parseBoxEnv((await run(host, boxEnvScript(host))) ?? "");
    if (!read)
        return undefined;
    const baseUrl = read.env.cloud ? undefined : proxyBaseUrl(read.env.baseUrl);
    const answer = baseUrl ? parseBoxProbe(await run(host, boxProbeScript(baseUrl))) : undefined;
    return { ...read, answer };
}
/** The state of a box that answered, by the same rules as this box's own (`routeOf`). The
 *  "proxy reaches Anthropic" switch is not applied: it vouches for this box's proxy. */
export const boxRouteState = (box) => routeOf(box.env, { forwards: false }, () => box.answer);
/** One text for "what this box last said", compared to tell a change from a repeat. */
const signatureOf = (box) => box ? JSON.stringify([routeSignature(box.env), box.ownWindow, box.answer ?? null]) : "";
/** Kept answers by host, with the request in flight for each. A box that could not be read is
 *  kept too, as `undefined`, so an unreachable box is asked once per `PROBE_TTL_MS` and not on
 *  every listing. */
const kept = new Map();
const asking = new Map();
/** Ask `host` and keep the answer; callers arriving while it is asked share the one request. */
function refreshBoxRoute(host, run) {
    const live = asking.get(host);
    if (live)
        return live;
    const asked = askBoxRoute(host, run)
        .catch(() => undefined)
        .then((box) => {
        kept.set(host, { at: Date.now(), box });
        return box;
    })
        .finally(() => asking.delete(host));
    asking.set(host, asked);
    return asked;
}
/**
 * A box's answer for a caller that can wait: a turn about to start there. A kept answer is
 * returned at once, however old, and refreshed behind the caller once it is past
 * `PROBE_TTL_MS`, so only the first turn after a boot waits on the ssh. A router switched on
 * there is therefore seen by the turn after the next one at the latest.
 */
export async function boxRouteOf(host, run = sshRun, now = Date.now()) {
    const hit = kept.get(host);
    if (!hit)
        return refreshBoxRoute(host, run);
    if (now - hit.at >= PROBE_TTL_MS)
        void refreshBoxRoute(host, run);
    return hit.box;
}
/**
 * The same for a caller that must not wait: a model listing. Answers what is kept, `undefined`
 * when nothing is, and asks behind the caller when that is missing or old; `changed` is called
 * when the box then says something else, so the caller can list again.
 */
export function boxRouteKnown(host, changed, run = sshRun, now = Date.now()) {
    const hit = kept.get(host);
    if (hit && now - hit.at < PROBE_TTL_MS)
        return hit.box;
    void refreshBoxRoute(host, run).then((box) => {
        if (signatureOf(box) !== signatureOf(hit?.box))
            changed();
    });
    return hit?.box;
}
/** Forget every kept answer; tests start from an empty store. */
export const forgetBoxRoutes = () => {
    kept.clear();
};
//# sourceMappingURL=box-route.js.map