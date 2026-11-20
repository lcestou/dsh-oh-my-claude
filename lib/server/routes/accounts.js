// The accounts routes: the list Settings → Boxes shows under This box, adding and removing an
// account, its login status, and its Log in and Log out. An account is a local mount with its own
// config dir; the routes save `accounts.json` and hand the list to the adapter, which mounts or
// withdraws the instance live (src/adapter/accounts.ts). Hand-written mounts with a dir of their
// own are listed too, read-only, so a login set up in cordis.patch.yml is visible and can log in.
import { readFile } from "node:fs/promises";
import z from "@deepseek-ai/schemastery";
import { boxProviderId, validateAccounts } from "../accounts.js";
import { serverText } from "../locale.js";
import { cancelSshLogin, pollSshLogin, startSshLogin, submitSshLoginCode, THIS_BOX, } from "../ssh-login.js";
import { writeJson } from "../state.js";
import { UNHANDLED } from "./context.js";
/** The file's shape, checked at run time before any rule sees it. */
const AccountList = z.array(z.object({ name: z.string().required(), configDir: z.string().required() }));
/** The saved accounts: [] when the file does not exist, undefined when it exists but does not
 *  parse or validate. The write routes refuse on undefined, so an unreadable file is never replaced
 *  by a list holding only the new row. Checked for shape only: which ids are free depends on what
 *  else is mounted, which only the add route knows. */
export async function loadAccounts(path, home, defaultHome) {
    let text;
    try {
        text = await readFile(path, "utf8");
    }
    catch (e) {
        return e instanceof Error && "code" in e && e.code === "ENOENT" ? [] : undefined;
    }
    try {
        const v = validateAccounts(AccountList(JSON.parse(text)), {
            home,
            defaultHome,
            takenIds: new Map(),
            takenHomes: new Map(),
        });
        return "accounts" in v ? v.accounts : undefined;
    }
    catch {
        return undefined;
    }
}
/** The saved accounts for a read: an unreadable file reads as none, so it never stops the plugin
 *  from loading or the list from answering. */
export async function readAccounts(path, home, defaultHome) {
    return (await loadAccounts(path, home, defaultHome)) ?? [];
}
/** The login map key an account's login is held under, apart from This box's (THIS_BOX). */
const loginKeyFor = (provider) => `account:${provider}`;
/** The accounts group of the session routes. Returns `UNHANDLED` for any path it does not own. */
export function accountsRoutes(c) {
    const base = `${c.ROUTE_PREFIX}/accounts`;
    /** Writes are serialised: two adds in two tabs would otherwise each save the list without the
     *  other's row. */
    let chain = Promise.resolve();
    /** Run `fn` after every write before it, whatever they returned. */
    const serial = (fn) => {
        const next = chain.then(fn, fn);
        chain = next.catch(() => { });
        return next;
    };
    /** A refusal in the person's language. */
    const refuse = (res, status, key, params) => c.json(res, status, { error: serverText(key, params) });
    /** Every account row, plugin rows first, in saved order. A hand-written mount on the default
     *  dir is This box's own login and is not a row. */
    const rows = async () => {
        const saved = await readAccounts(c.path, c.home, c.defaultHome);
        const mounted = c.mounted();
        const own = saved.map((a) => ({
            name: a.name,
            configDir: a.configDir,
            provider: boxProviderId(a.name),
            source: "plugin",
            mounted: mounted.has(boxProviderId(a.name)),
        }));
        const ownIds = new Set(own.map((r) => r.provider));
        const profile = c
            .localMounts()
            .filter((m) => m.loginKey !== "" && !mounted.has(m.provider) && !ownIds.has(m.provider))
            .map((m) => ({
            name: m.name,
            configDir: m.home,
            provider: m.provider,
            source: "profile",
            mounted: true,
        }));
        return [...own, ...profile];
    };
    /** Save `next`, mount it, tell every tab. A mount failure is reported as `live: false`, the
     *  file already saved, so a restart picks the account up. */
    const save = async (next) => {
        await writeJson(c.path, next, { pretty: true });
        let live = true;
        try {
            await c.onChange(next);
        }
        catch (e) {
            live = false;
            c.log("warn", `accounts reconcile: ${String(e)}`);
        }
        c.publish();
        return { accounts: await rows(), live };
    };
    /** The local mount a login route names: a plugin account or a hand-written one. */
    const target = (provider) => c.localMounts().find((m) => m.provider === provider && m.loginKey !== "");
    /** Whether the mount's CLI under its config dir says logged in now: a login's proof once it
     *  exits. */
    const verify = (m) => async () => c.loggedIn((await c.run(m.command || c.command, ["auth", "status"], c.cliEnvFor(m.home))).out);
    /** The group itself: the list and add, remove, the status read, then the four login steps.
     *  Answers `UNHANDLED` for any other path, so the next group is tried. */
    return async (req, res, url) => {
        if (url.pathname === base && req.method === "GET")
            return c.json(res, 200, { accounts: await rows() });
        if (url.pathname === base && req.method === "POST") {
            const body = await c.readBody(req);
            return serial(async () => {
                const saved = await loadAccounts(c.path, c.home, c.defaultHome);
                if (saved === undefined)
                    return refuse(res, 500, "accountsUnreadable", { path: c.path });
                const mine = new Set(saved.map((a) => boxProviderId(a.name)));
                const others = c.localMounts().filter((m) => !mine.has(m.provider));
                const wanted = boxProviderId(String(body.name ?? "").trim());
                const profile = others.find((m) => m.provider === wanted);
                if (profile)
                    return refuse(res, 409, "accountProfile", { provider: wanted });
                const takenIds = new Map((await c.sshIds()).map((id) => [id, id]));
                const draft = { name: String(body.name ?? ""), configDir: String(body.configDir ?? "") };
                const v = validateAccounts([...saved, draft], {
                    home: c.home,
                    defaultHome: c.defaultHome,
                    takenIds,
                    takenHomes: new Map(others.map((m) => [m.home, m.name])),
                });
                if ("refusal" in v)
                    return refuse(res, 400, v.refusal.key, v.refusal.params);
                return c.json(res, 200, await save(v.accounts));
            });
        }
        if (url.pathname === `${base}/remove` && req.method === "POST") {
            const provider = String((await c.readBody(req)).provider ?? "");
            return serial(async () => {
                const saved = await loadAccounts(c.path, c.home, c.defaultHome);
                if (saved === undefined)
                    return refuse(res, 500, "accountsUnreadable", { path: c.path });
                const next = saved.filter((a) => boxProviderId(a.name) !== provider);
                if (next.length === saved.length)
                    return refuse(res, 404, "accountUnknown", { provider });
                // A login started on this account and not finished would still write into its dir.
                cancelSshLogin(loginKeyFor(provider));
                return c.json(res, 200, await save(next));
            });
        }
        if (url.pathname === `${base}/status` && req.method === "GET") {
            const list = await rows();
            const mounts = new Map(c.localMounts().map((m) => [m.provider, m]));
            const out = await Promise.all(list.map(async (r) => {
                const m = mounts.get(r.provider);
                if (!m)
                    return { provider: r.provider, status: null };
                const status = await c.status(m.home, m.command || c.command);
                status.running = c.liveCount(m.loginKey);
                c.onLoginStatus(r.provider, status.loggedIn);
                return { provider: r.provider, status };
            }));
            return c.json(res, 200, { accounts: out });
        }
        const login = url.pathname.startsWith(`${base}/login/`) && req.method === "POST";
        if (!login)
            return UNHANDLED;
        const body = await c.readBody(req);
        const provider = String(body.provider ?? "");
        const m = target(provider);
        if (!m)
            return refuse(res, 400, "accountUnknown", { provider });
        const key = loginKeyFor(provider);
        const step = url.pathname.slice(`${base}/login/`.length);
        /** A finished login: forget the cached identity, name the mount logged in, tell every tab. */
        const finish = (out) => {
            if (!out.done)
                return { done: false, error: out.error };
            c.forgetIdentity();
            c.onLoginStatus(provider, true);
            c.loginDone(m.loginKey);
            c.publish();
            return { done: true, loggedIn: true };
        };
        if (step === "start")
            return c.json(res, 200, await startSshLogin(THIS_BOX, undefined, undefined, m.command || c.command, undefined, {
                key,
                env: c.cliEnvFor(m.home),
            }));
        if (step === "code")
            return c.json(res, 200, finish(await submitSshLoginCode(key, String(body.code ?? ""), verify(m))));
        if (step === "poll") {
            const poll = await pollSshLogin(key, verify(m));
            return c.json(res, 200, poll.pending ? { pending: true } : finish(poll));
        }
        if (step === "logout") {
            // `claude auth logout` under the account's dir: its credentials file, or on macOS its own
            // Keychain entry, goes; This box's login is not touched. Its running sessions stop.
            await c.run(m.command || c.command, ["auth", "logout"], c.cliEnvFor(m.home));
            c.forgetIdentity();
            c.logoutDone(m.loginKey);
            c.onLoginStatus(provider, false);
            c.publish();
            return c.json(res, 200, { loggedIn: false });
        }
        return UNHANDLED;
    };
}
//# sourceMappingURL=accounts.js.map