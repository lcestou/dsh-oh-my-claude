import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { SOCKET_PATH_MAX, keeperSocketPath, privateSocketDir } from "./keeper-socket.js";
import { attachKeeper, spawnKeeper } from "./process.js";
import { tempDir } from "./test-tmp.js";

const root = tempDir("omc-ksock-");
const short = join(root, "s");

// A directory whose socket fits keeps it there, as every keeper before #328 did.
assert.equal(
  keeperSocketPath("/a/b", () => short),
  "/a/b/keeper.sock",
);

// #328: macOS allows 103 bytes, and `claude-code-work`'s keeper socket was 107. The same directory
// against the macOS limit moves to the short dir, under a name that depends only on the directory.
const mac =
  "/Users/taseenb/.local/state/dsh-oh-my-claude/claude-code-work/keepers/85788ad4e3b47891-mwp11zi6";
assert.equal(join(mac, "keeper.sock").length, 107);
const moved = keeperSocketPath(mac, () => short, 103);
assert.ok(moved.startsWith(`${short}/k-`) && moved.endsWith(".sock"), moved);
assert.equal(
  moved,
  keeperSocketPath(mac, () => short, 103),
  "same directory, same socket",
);
assert.notEqual(
  moved,
  keeperSocketPath(`${mac}x`, () => short, 103),
  "another directory, another socket",
);
assert.equal(
  keeperSocketPath(mac, () => short, 107),
  join(mac, "keeper.sock"),
  "fits on Linux",
);
// No short dir to be had: the long path comes back for the keeper to refuse with its reason.
assert.equal(
  keeperSocketPath(mac, () => undefined, 103),
  join(mac, "keeper.sock"),
);
assert.equal(SOCKET_PATH_MAX, process.platform === "linux" ? 107 : 103);

// The private dir is made owner-only, and one someone else could enter is refused.
const priv = privateSocketDir(undefined, root);
assert.ok(priv && existsSync(priv), "made in the temp dir when there is no runtime dir");
assert.equal(
  privateSocketDir(join(root, "rt"), "/nowhere"),
  join(root, "rt", `omc-${process.getuid?.()}`),
);
const open = join(root, "open", `omc-${process.getuid?.()}`);
mkdirSync(open, { recursive: true });
chmodSync(open, 0o755);
assert.equal(
  privateSocketDir(join(root, "open")),
  undefined,
  "a folder others can enter is not used",
);

// A real keeper in a directory too deep for a socket: before #328 it never listened and the attach
// failed with "keeper ... did not answer"; now it listens in the short dir and a fresh attach (what
// dsh does after a restart) finds it from spec.json.
const deep = join(root, "d".repeat(Math.max(1, 130 - root.length)));
assert.ok(join(deep, "keeper.sock").length > SOCKET_PATH_MAX);
const h = await spawnKeeper(
  deep,
  {
    command: "cat",
    args: [],
    cwd: root,
    env: { PATH: process.env.PATH ?? "" },
    sessionId: "s-deep",
  },
  (argv) => spawn(argv[0]!, argv.slice(1), { detached: true, stdio: "ignore" }).unref(),
);
const spec = JSON.parse(readFileSync(join(deep, "spec.json"), "utf8")) as { sock?: string };
assert.ok(spec.sock && spec.sock.length <= SOCKET_PATH_MAX, `recorded ${spec.sock}`);
const first = new Promise<string>((r) =>
  createInterface({ input: h.stdout }).once("line", (l) => r(l)),
);
h.stdin.write("hello\n");
assert.equal(await first, "hello", "Claude's stand-in answers through the moved socket");
const again = await attachKeeper(deep, 3000);
// The first handle never acknowledged "hello", so the keeper replays it ahead of the new line.
const second = new Promise<void>((r) =>
  createInterface({ input: again.stdout }).on("line", (l) => l === "again" && r()),
);
again.stdin.write("again\n");
await second; // a reattach finds the socket from spec.json
again.terminate();
await again.done;
console.log("keeper-socket tests passed");
process.exit(0);
