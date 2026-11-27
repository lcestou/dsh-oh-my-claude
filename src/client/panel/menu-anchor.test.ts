// Offline self-check: bun src/client/panel/menu-anchor.test.ts. The two DOM-free halves of the
// streaming-drift fix for the portalled permission menu. The drift itself is Chrome's layout of a
// fixed menu anchored to a sticky composer and shows only in a browser; this checks that the fix
// finds the right menu and resets its anchor without leaving it changed.
import assert from "node:assert/strict";
import { menuFor, reanchor } from "./menu-anchor.js";
import type { StyledBox } from "./menu-anchor.js";

/** A stand-in element with a role, an inline position-anchor, and a log of what touched it. */
const box = (role: string, anchor: string) => {
  const props = new Map<string, string>(anchor === "" ? [] : [["position-anchor", anchor]]);
  const log: Array<string> = [];

  const el: StyledBox & { log: Array<string> } = {
    log,
    getAttribute: (n) => (n === "role" ? role : null),
    style: {
      getPropertyValue: (n) => props.get(n) ?? "",
      setProperty: (n, v) => {
        props.set(n, v ?? "");
        log.push(`set ${v}`);
      },
    },
    getBoundingClientRect: () => {
      log.push(`layout at ${props.get("position-anchor")}`);

      return { top: 0 };
    },
  };

  return el;
};

// Finds the menu anchored to our trigger, never another control's menu or a non-menu.
const ours = box("menu", "--dsh-menu-trigger-r1r");
const theirs = box("menu", "--dsh-menu-trigger-r9");
const tip = box("tooltip", "--dsh-menu-trigger-r1r");

assert.equal(menuFor("--dsh-menu-trigger-r1r", [theirs, tip, ours]), ours);

assert.equal(menuFor("--dsh-menu-trigger-r2", [theirs, ours]), undefined);

assert.equal(menuFor("", [ours]), undefined);

assert.equal(menuFor("none", [box("menu", "none")]), undefined);

// Drops the anchor, lays out with it dropped, and writes the same anchor back.
reanchor(ours);

assert.deepEqual(ours.log, ["set none", "layout at none", "set --dsh-menu-trigger-r1r"]);

assert.equal(ours.style.getPropertyValue("position-anchor"), "--dsh-menu-trigger-r1r");

// An inline menu (dsh 0.1.5 shape, no inline anchor) is left alone.
const inline = box("menu", "");

reanchor(inline);

assert.deepEqual(inline.log, []);

console.log("menu-anchor: ok");
