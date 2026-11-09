// Offline self-check: bun src/client/plugins-page.test.ts. No DOM, no dsh.
// The update pill opens dsh's Plugins page only while dsh provides `pluginNavigation`; the opener
// must appear and vanish with the service, and open this plugin's page by its npm name.
import assert from "node:assert/strict";
import {
  onPluginsPageChange,
  PACKAGE_NAME,
  pluginsPageOpener,
  watchPluginsPage,
} from "./plugins-page.js";
import type { ClientCtx } from "./shared.js";

const opened: string[] = [];
let dispose: (() => void) | undefined;
let present = false;
// SAFETY: a stand-in carrying only the two cordis calls watchPluginsPage makes; its `inject` runs
// the callback at once, as cordis does while the service is present, and keeps the effect's cleanup
// so the test can take the service away again.
const ctx = {
  inject: (names: string[], fn: (scope: { effect: (f: () => () => void) => void }) => void) => {
    assert.deepEqual(names, ["pluginNavigation"]);
    fn({ effect: (f) => void (dispose = f()) });
  },
  get: (name: string) =>
    present && name === "pluginNavigation"
      ? { openBundle: (pkg: string) => void opened.push(pkg) }
      : undefined,
} as unknown as ClientCtx;

let changes = 0;
const off = onPluginsPageChange(() => changes++);
assert.equal(pluginsPageOpener(), undefined, "no opener before dsh offers navigation");
present = true;
watchPluginsPage(ctx);
assert.equal(changes, 1, "a mounted pill hears the service arrive");
pluginsPageOpener()?.();
assert.deepEqual(opened, [PACKAGE_NAME], "opens this plugin's own page");
assert.equal(PACKAGE_NAME, "dsh-oh-my-claude");
dispose?.();
present = false;
assert.equal(pluginsPageOpener(), undefined, "the opener goes with the service");
assert.equal(changes, 2, "and the pill hears that too");
off();
console.log("plugins-page ok");
