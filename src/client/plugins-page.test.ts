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
import { fakeClientCtx } from "../test-context.js";

const opened: Array<string> = [];
let dispose: (() => void) | undefined;
let present = false;

// A stand-in carrying only the two cordis calls watchPluginsPage makes; its `inject` runs the
// callback at once, as cordis does while the service is present, and keeps the effect's cleanup so
// the test can take the service away again.
const ctx = fakeClientCtx({
  inject: (names, fn) => {
    assert.deepEqual(names, ["pluginNavigation"]);
    fn({
      effect: (f) => {
        dispose = f();
      },
    });
  },
  services: {
    // Read at each lookup, so flipping `present` adds or takes away the service.
    get pluginNavigation() {
      return present
        ? {
            openBundle: (pkg: string) => {
              opened.push(pkg);
            },
          }
        : undefined;
    },
  },
});

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
