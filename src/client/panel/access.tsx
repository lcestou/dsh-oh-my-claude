// The access tab: the mode presets, the shield that shows the live one, and the trigger whose menu
// changes it. The panel entry re-exports the shield and the trigger for the composer slot.
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { subscribe } from "../events.js";
import type { PermissionModeState } from "../events.js";
import { meta, T, readJson, ROUTE, activeClaudeSession, type ClientCtx } from "../shared.js";
import { t, useLocale, type OmcKey } from "../i18n.js";
import { Menu } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  IconChevronDownOutlineRegular,
  IconSparkleMedium,
  PermissionIconFullAccessRegular,
  PermissionIconReadOnlyRegular,
  PermissionIconWorkspaceWriteRegular,
} from "../icons.js";
import type { FeatureSwitches } from "../../switches.js";
import type { PermissionRules, HooksListing } from "../../process.js";

/** The mode to show for a session: the process's own when one runs, else the one the next spawn gets. */
const shownMode = (snap: PermissionModeState): string => snap.liveMode ?? snap.mode;
/** The stored mode when it differs from the running process's, else empty: what the footer notes. */
const pendingMode = (snap: PermissionModeState): string =>
  snap.liveMode && snap.liveMode !== snap.mode ? snap.mode : "";
/** What `GET /permissions` reports: the rules and hooks the session's live process loaded. */
/** What `GET /permissions` returns on success. A failure answers 409, which `readJson` throws, so
 *  the failed arm never reaches state: the reason lands in `permissionsError` instead. */
export type PermissionsReply = { ok: true } & PermissionRules & HooksListing;

// The three dsh presets in strict id→label order (kept for text-fallback trigger lookup), each with
// every label dsh draws it under: English and dsh's own Chinese (ui-permission-presets). The menu
// is dsh's, so its rows read in dsh's language; matching the English alone left a Chinese dsh with
// its three presets and none of the six Claude rows.
const PRESETS = [
  { id: "read-only", labels: ["Read Only", "仅可查看"] },
  { id: "workspace-write", labels: ["Workspace Write", "工作区内修改"] },
  { id: "danger-full-access", labels: ["Full access", "完全权限"] },
] as const;

/** The preset a dsh menu row or trigger names, by its text in either language; undefined for any
 *  other text. */
const presetOfText = (text: string | null): (typeof PRESETS)[number] | undefined =>
  PRESETS.find((p) => p.labels.some((label) => label === text));

// Claude mode → dsh preset it needs.
const PRESET_FOR_MODE = {
  plan: "read-only",
  default: "workspace-write",
  acceptEdits: "workspace-write",
  auto: "danger-full-access",
  dontAsk: "danger-full-access",
  bypassPermissions: "danger-full-access",
} satisfies Record<string, string>;

// The six Claude mode rows and the trigger, in key order; their labels come from
// `panel.access.mode.<mode>` at build time so the menu reads in the active language.
const MODE_KEYS = [
  "plan",
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;

// Narrowed indexers so callers can use arbitrary strings without widening the object type.
/** The dsh permission preset that matches a Claude mode. */
const presetForMode = (m: string): string =>
  // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys; all paths below pass a known key.
  PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];
/** The glyph dsh draws for a preset in its own permission menu, keyed the way `PRESET_FOR_MODE`
 *  names them; a Claude mode shows the glyph of the preset it maps to, so the six rows read like
 *  dsh's three. Draws nothing for an unknown mode (the empty string before the first fetch). */
const ModeGlyph = ({ mode }: { mode: string }) => {
  // SAFETY: widening the readonly tuple to string[] only loosens `includes`; the membership check
  // is what makes `presetForMode` safe to call with an arbitrary string.
  const preset = (MODE_KEYS as readonly string[]).includes(mode) ? presetForMode(mode) : "";
  if (preset === "read-only") return <PermissionIconReadOnlyRegular aria-hidden />;
  if (preset === "workspace-write") return <PermissionIconWorkspaceWriteRegular aria-hidden />;
  if (preset === "danger-full-access") return <PermissionIconFullAccessRegular aria-hidden />;
  return null;
};
/** How a Claude mode is labelled in the menu, translated; a mode not in `MODE_KEYS` shows raw. */
const modeLabel = (m: string): string =>
  // SAFETY: the membership check guarantees `panel.access.mode.<m>` is a defined dictionary key.
  (MODE_KEYS as readonly string[]).includes(m) ? t(`panel.access.mode.${m}` as OmcKey) : m;

/**
 * Imperative rework: relabels dsh's own trigger and injects Claude-mode rows into its menu.
 * The component only mounts a hidden span; all DOM work happens inside useEffect.
 */
export function AccessShield({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Not a Claude session right now: stay dormant, but keep watching, since the model picker can
    // switch a session's provider without a remount (owner, 2026-09-06: the rows stayed after a
    // model change).
    const mine = () => activeClaudeSession(ctx) === sessionId;

    const build = () => {
      // The composer this shield belongs to, never the whole page. dsh 0.1.7 draws the same
      // permission control in Settings > General, and the text fallback below matched it: the
      // shield adopted that trigger and rewrote its label with the session's CLI mode, so the
      // Settings row read "Full access" whatever the menu had checked (owner, 2026-09-22).
      const anchor = anchorRef.current;
      const root =
        anchor?.closest("form") ??
        anchor?.closest('[data-composer-card], [class*="composer" i]') ??
        anchor?.parentElement;
      if (!root) return null;
      // SAFETY: querySelectorAll returns NodeList; we cast because the selector is exact.
      const found = Array.from(
        root.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Access mode"], button[aria-label^="访问模式"]',
        ),
      );
      const trigger =
        found[0] ??
        Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
          (b) => b.closest('[role="dialog"]') === null && presetOfText(b.textContent) !== undefined,
        );
      if (!trigger) return null;
      return trigger;
    };

    // Everything below hangs off dsh's trigger: hide it, mirror it, and hand back one cleanup.
    const start = (trigger: HTMLButtonElement): (() => void) => {
      let currentMode = "";
      // A settings file can refuse bypass mode while this trigger still reads "Full access". The
      // scope it is refused in, once known, marks the label and the menu row.
      let bypassRefusedIn = "";
      const labelSpan = (): HTMLElement | null => {
        for (const child of Array.from(trigger.children))
          if (child instanceof HTMLElement && child.className.includes("Label")) return child;
        return trigger.children[1] instanceof HTMLElement ? trigger.children[1] : null;
      };
      // dsh's own label and aria-label, kept for the cleanup; refreshed whenever dsh rewrites them.
      let lastDshLabelText = labelSpan()?.textContent ?? "";
      let lastDshAriaLabel = trigger.getAttribute("aria-label") ?? "";

      // Apply our Claude-mode label to the trigger's label span and aria-label. Compares against
      // the DOM, so our own write is a no-op and a rewrite by dsh is overwritten again.
      const reapplyLabel = () => {
        if (!trigger.isConnected || !currentMode) return;
        const refused = bypassRefusedIn !== "" && currentMode === "bypassPermissions";
        const text = `${modeLabel(currentMode)}${refused ? " ⚠" : ""}`;
        const target = labelSpan();
        if (target && target.textContent !== text) {
          lastDshLabelText = target.textContent ?? "";
          target.textContent = text;
        }
        const newAria = t("panel.access.ariaLabel", {
          text,
          refused: refused ? t("panel.access.ariaRefused") : "",
        });
        const aria = trigger.getAttribute("aria-label") ?? "";
        if (aria !== newAria) {
          lastDshAriaLabel = aria;
          trigger.setAttribute("aria-label", newAria);
        }
      };

      // Observe dsh rewriting the trigger so we re-apply our label whenever it does.
      const labelObserver = new MutationObserver(() => {
        if (trigger.isConnected) reapplyLabel();
      });
      // SAFETY: DOM MutationObserverInit.attributes accepts boolean; TS 7 lib narrows the
      // modern string[] variant to boolean only. We observe all attributes (true) rather than
      // filtering to aria-label alone because the narrower form is not expressible in this TS lib.
      labelObserver.observe(trigger, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      // Fetch the current mode on start so the trigger label is correct immediately.
      const fetchMode = (): Promise<PermissionModeState | null> =>
        fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
          .then((r) => readJson<PermissionModeState>(r))
          .catch(() => null);

      fetchMode().then((snap) => {
        if (snap) {
          currentMode = shownMode(snap);
          reapplyLabel();
        }
      });

      // Which settings file, if any, refuses bypass mode. A failed read leaves the label alone.
      const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
      fetch(`${ROUTE}/feature-switches${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
        .then((r) => readJson<FeatureSwitches>(r))
        .then((s) => {
          bypassRefusedIn = s.bypassDisabled?.scope ?? "";
          reapplyLabel();
        })
        .catch(() => {});

      const parent = trigger.parentElement;
      if (!parent)
        return () => {
          labelObserver.disconnect();
        };

      // Watch for dsh's menu to appear and inject our rows into its viewport.
      const menuObserver = new MutationObserver(() => {
        if (!parent.isConnected) return;
        // The open menu is the signal, not the trigger: dsh 0.1.5 stopped setting aria-expanded on
        // it, so gating on that attribute skipped every injection and left dsh's three presets in
        // place of our six Claude rows. `parent` is the small modes box, not the composer, so one
        // selector per mutation costs nothing.
        //
        // Both places dsh can put the open menu: inline under the trigger, or as a direct child
        // of the body from 0.1.6, which renders it through `createPortal(menu, document.body)`.
        // Looking in one place only left 0.1.6 showing dsh's three presets. Body is searched one
        // level deep, never by subtree: the portalled node is the menu itself, and a subtree scan
        // of the body per mutation is the whole transcript. Menus other plugins portal there are
        // dropped by the preset-label check below, which is what identifies ours either way.
        // Only the composer's own menu. dsh 0.1.7 draws the same permission control in Settings >
        // General and portals its menu to the body with the same three preset labels, so the
        // label check alone adopted that one too: the six Claude rows landed in the Settings
        // dropdown and its pick never showed (owner, 2026-09-22). A trigger that says it is
        // closed has no menu of its own open (0.1.5 sets no such attribute, and an absent one
        // says nothing), and a dsh modal dialog on screen means the composer is behind it.
        if (trigger.getAttribute("aria-expanded") === "false") return;
        if (
          document.querySelector(
            '[role="dialog"][aria-modal="true"]:not([aria-label="Oh My Claude"])',
          ) !== null
        )
          return;
        const menus = [
          // dsh 0.1.5: inline, hung off the trigger inside the modes box.
          ...parent.querySelectorAll<HTMLElement>('[role="menu"]'),
          // dsh 0.1.6 and later: portalled, a direct child of the body.
          ...document.body.querySelectorAll<HTMLElement>(':scope > [role="menu"]'),
        ];
        if (menus.length === 0) return;
        for (const dshMenu of menus) {
          // Our own rows, not the attribute, say whether this menu is done: dsh re-renders the menu
          // through the same element, which drops the six rows we appended and unhides its three
          // while leaving every attribute we set in place. Trusting the mark there left the menu
          // showing dsh's presets with no way back to ours until it was closed and reopened.
          if (dshMenu.querySelector("[data-mode]")) continue;
          const menuItems = Array.from(dshMenu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
          const hasPreset = menuItems.some((el) => presetOfText(el.textContent) !== undefined);
          if (!hasPreset) continue;

          dshMenu.setAttribute("data-dsh-oh-my-claude", "1");
          // dsh re-renders the open menu through the same element, which drops our rows. Inline
          // that lands in `parent`; portalled it lands in the body, where only direct children are
          // watched, so the menu itself is the target that sees it. Re-observing the same node is
          // a no-op, and the `[data-mode]` check above stops our own appends looping back.
          menuObserver.observe(dshMenu, { childList: true, subtree: true });

          // Take template from the first itemWrap (parent of the first menuitem).
          const firstItemWrap = menuItems[0]?.parentElement;
          if (!firstItemWrap) continue;

          // Find the token containing "selected" across all three original menuitems.
          let selectedToken = "";
          // dsh marks the selected row with a class token and a trailing check svg; both are copied
          // onto our selected clone only.
          let checkMark: Element | null = null;
          for (const el of menuItems) {
            const tokens = el.className.split(" ");
            const found = tokens.find((tok) => tok.includes("selected"));
            if (found) {
              selectedToken = found;
              checkMark = el.querySelector(":scope > svg");
              break;
            }
          }
          // SAFETY: firstItemWrap exists only when menuItems[0] exists; checked above.
          const baseClass = selectedToken
            ? menuItems[0]!.className
                .split(" ")
                .filter((tok) => tok !== selectedToken)
                .join(" ")
            : menuItems[0]!.className;

          // Record each original row's icon svg keyed by preset id via labels.
          const svgByPresetId: Record<string, string> = {};
          for (const el of menuItems) {
            const svgEl = el.querySelector<SVGSVGElement>("svg");
            if (!svgEl) continue;
            const presetId = presetOfText(el.textContent)?.id;
            if (presetId) svgByPresetId[presetId] = svgEl.outerHTML;
          }

          // Hide the three original wraps.
          for (const wrap of dshMenu.querySelectorAll<HTMLElement>("[class*='itemWrap']")) {
            wrap.style.display = "none";
          }

          // Find the viewport to append our rows into.
          const viewport = dshMenu.querySelector<HTMLElement>('[role="presentation"]') ?? dshMenu;

          // Capture stateSnapshot for click handlers.
          let stateSnapshot: PermissionModeState | null = null;
          fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
            .then((r) => readJson<PermissionModeState>(r))
            .then((snap) => {
              stateSnapshot = snap;
            })
            .catch(() => {
              /* ignore */
            });

          // Append six new wraps in MODE_KEYS order.
          for (const m of MODE_KEYS) {
            // SAFETY: cloneNode on a HTMLElement returns a Node tree rooted at that element.
            const wrap = firstItemWrap.cloneNode(true) as HTMLElement;
            wrap.style.display = ""; // the template was hidden before cloning
            const menuitem = wrap.querySelector<HTMLElement>("button[role='menuitem']");
            if (!menuitem) continue;

            menuitem.className =
              m === currentMode && selectedToken ? `${baseClass} ${selectedToken}` : baseClass;
            menuitem.setAttribute("aria-checked", m === currentMode ? "true" : "false");
            for (const inherited of menuitem.querySelectorAll(":scope > svg")) inherited.remove();
            if (m === currentMode && checkMark) menuitem.append(checkMark.cloneNode(true));

            // SAFETY: PRESET_FOR_MODE has exactly the six Claude modes as keys.
            const presetId = PRESET_FOR_MODE[m as keyof typeof PRESET_FOR_MODE];
            const iconSpan = menuitem.querySelector<HTMLElement>("span[class*='Icon']");
            if (iconSpan && svgByPresetId[presetId]) {
              iconSpan.innerHTML = svgByPresetId[presetId];
            }

            // Replace the label text node or span with MODE_LABELS[m].
            const labelChild = Array.from(menuitem.children).find(
              (c) => c instanceof HTMLElement && c.className.includes("Label"),
            );
            if (labelChild instanceof HTMLElement) {
              labelChild.textContent = modeLabel(m);
            } else {
              const textNode = Array.from(menuitem.childNodes).find(
                (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
              );
              if (textNode instanceof Text) textNode.textContent = modeLabel(m);
            }

            menuitem.setAttribute("data-mode", m);
            menuitem.addEventListener("click", () => {
              // The snapshot fetched at open may still be in flight on a fast click: fetch then.
              (stateSnapshot ? Promise.resolve(stateSnapshot) : fetchMode()).then((snap) => {
                if (!snap) return;
                stateSnapshot = snap;
                pick(snap);
              });
            });
            const pick = (snap: PermissionModeState) => {
              const need = presetForMode(m);
              const have = snap.accessMode;
              // The label takes the pick at once. What follows is a dsh command, a settle and two
              // more round trips, over a second in all, and the trigger used to sit on the old mode
              // for every bit of it, which reads as a click that did not land. A failure below puts
              // the real mode back.
              const wasMode = currentMode;
              currentMode = m;
              reapplyLabel();
              const revert = () => {
                currentMode = wasMode;
                reapplyLabel();
              };
              const doSet = () => {
                const clearDefault =
                  (need === "read-only" && m === "plan") ||
                  (need === "workspace-write" && m === "acceptEdits") ||
                  (need === "danger-full-access" && m === "bypassPermissions");
                fetch(`${ROUTE}/permission-mode`, {
                  method: "PUT",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ session: sessionId, mode: clearDefault ? null : m }),
                })
                  .then((r) => readJson<PermissionModeState>(r))
                  .then((reply) => {
                    if (reply.error) {
                      revert();
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl) errEl.textContent = reply.error;
                    } else {
                      fetchMode().then((next) => {
                        if (next) currentMode = shownMode(next);
                        reapplyLabel();
                      });
                    }
                  })
                  .catch((e) => {
                    revert();
                    const errEl = parent.querySelector<HTMLElement>("[data-err]");
                    if (errEl) errEl.textContent = e instanceof Error ? e.message : String(e);
                  });
              };
              if (need !== have) {
                const live = ctx.sessions.binding?.(sessionId)?.session;
                if (!live) {
                  revert();
                  const errEl = parent.querySelector<HTMLElement>("[data-err]");
                  if (errEl) errEl.textContent = t("panel.access.notMaterialized");
                  return;
                }
                live
                  .command(`/permission ${need}`)
                  .then((reply) => {
                    if (!reply || !reply.ok) {
                      revert();
                      const errEl = parent.querySelector<HTMLElement>("[data-err]");
                      if (errEl)
                        errEl.textContent =
                          reply?.error?.message ?? t("panel.access.commandFailed");
                    } else {
                      setTimeout(doSet, 700);
                    }
                  })
                  .catch((e) => {
                    revert();
                    const errEl = parent.querySelector<HTMLElement>("[data-err]");
                    if (errEl) errEl.textContent = e instanceof Error ? e.message : String(e);
                  });
              } else {
                doSet();
              }
              document.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              );
            };

            viewport.appendChild(wrap);
          }

          // Why the Full access row will not take, on the menu that offers it.
          if (bypassRefusedIn !== "") {
            const note = document.createElement("div");
            Object.assign(note.style, { ...meta, color: T.err, padding: "8px 10px" });
            note.textContent = t("panel.access.fullAccessRefused", { scope: bypassRefusedIn });
            viewport.appendChild(note);
          }

          // Error wrap at the bottom. Padding lives in a class so an empty slot collapses via
          // `:empty` (no leftover space under the last row) and returns the instant an error lands.
          if (!document.getElementById("omc-access-err-style")) {
            const st = document.createElement("style");
            st.id = "omc-access-err-style";
            st.textContent = ".omc-access-err{padding:8px 10px}.omc-access-err:empty{padding:0}";
            document.head.appendChild(st);
          }
          const errWrap = document.createElement("div");
          errWrap.setAttribute("data-err", "1");
          errWrap.className = "omc-access-err";
          Object.assign(errWrap.style, { ...meta, color: T.err });
          viewport.appendChild(errWrap);

          // A portalled menu is positioned from JavaScript: dsh measures its height once, on open,
          // and clamps `top` so the box sits inside a 12px margin. Six rows where it measured three
          // left the menu starting at the three-row position and running off the bottom of the
          // window, and its own max-height caps the height without moving a box that starts too
          // low. Scroll and resize are the two events that recompute it, so one resize hands the
          // job back to dsh's own maths instead of a second copy of it here. dsh 0.1.5 hangs the
          // menu inline off the trigger and positions it in CSS, where a taller menu already grows
          // the right way, so the event is only worth the other listeners it wakes when the menu
          // is the portalled kind.
          if (dshMenu.parentElement === document.body) {
            window.dispatchEvent(new Event("resize"));
          }
        }
      });
      menuObserver.observe(parent, { childList: true, subtree: true });
      menuObserver.observe(document.body, { childList: true });

      return () => {
        labelObserver.disconnect();
        menuObserver.disconnect();
        // Restore trigger's label text and aria-label to what dsh last rendered.
        // Give dsh back its own label and aria-label.
        const restoreTarget = labelSpan();
        if (restoreTarget && lastDshLabelText) restoreTarget.textContent = lastDshLabelText;
        if (lastDshAriaLabel) trigger.setAttribute("aria-label", lastDshAriaLabel);
        // If a marked menu is currently open, unhide original wraps and remove ours. Both places
        // are checked for the same reason the injection above checks both, and in the same order.
        const markedMenu =
          // dsh 0.1.5: inline.
          parent.querySelector<HTMLElement>('[role="menu"][data-dsh-oh-my-claude]') ??
          // dsh 0.1.6 and later: portalled to the body.
          document.body.querySelector<HTMLElement>(':scope > [role="menu"][data-dsh-oh-my-claude]');
        if (markedMenu) {
          const vp = markedMenu.querySelector<HTMLElement>('[role="presentation"]') ?? markedMenu;
          for (const wrap of vp.querySelectorAll<HTMLElement>("[class*='itemWrap']")) {
            if (wrap.hasAttribute("data-mode")) {
              wrap.remove();
            } else {
              wrap.style.display = "";
            }
          }
          const errEl = vp.querySelector<HTMLElement>("[data-err]");
          if (errEl) errEl.remove();
        }
      };
    };

    // The composer may render after us: try now, then every 500 ms for 20 s.
    let stop: (() => void) | undefined;
    let hidden: HTMLButtonElement | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const attempt = () => {
      const found = build();
      if (!found) return false;
      hidden = found;
      stop = start(found);
      return true;
    };
    if (mine() && !attempt()) {
      let attempts = 0;
      timer = setInterval(() => {
        attempts++;
        if (!mine() || attempt() || attempts >= 40) clearInterval(timer);
      }, 500);
    }
    // Every second: leave when the session stops being Claude's, come back when it is again, and
    // re-attach when dsh re-rendered its trigger (the node we hooked left the document).
    const watchdog = setInterval(() => {
      const claude = mine();
      if (stop && (!claude || !hidden?.isConnected)) {
        stop();
        stop = undefined;
      }
      if (!stop && claude) attempt();
    }, 1000);
    return () => {
      if (timer) clearInterval(timer);
      clearInterval(watchdog);
      stop?.();
    };
  }, [sessionId, ctx]);

  return <span ref={anchorRef} hidden />;
}

// dsh's own permission trigger, copied so the new control reads as dsh's in the composer: 28 px
// tall with dsh's small radius, transparent at rest, its hover shade under the pointer and a 2 px
// focus ring. The hashed class is a build rename, so the rule is injected once and keyed on our
// own hook.
const ACCESS_TRIGGER_CSS =
  "[data-omc-access-trigger]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
  "[data-omc-access-trigger]:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}" +
  // dsh's `.triggerIcon svg`: the capsule's glyph is 14 px, like the glyph cell in its menu rows.
  "[data-omc-access-trigger]>span:first-child svg{width:14px;height:14px}" +
  // dsh's rule for a narrow composer: at 460 px or less the label goes and the glyph and chevron
  // stay, so the action row keeps one line. An ellipsized label still pushed the model button
  // onto a second row at 390 px. The open menu is dsh's portal and keeps its own width.
  "[data-omc-access-trigger]{max-width:220px}" +
  "@container (width<=460px){[data-omc-access-trigger] [data-omc-access-label]{display:none}}";

/**
 * Read the session's permission mode, or null when the route is down or the session is not
 * materialized. The optimistic pick and the current-mode label both start here, and the pick's
 * success arm re-reads it to confirm the change.
 */
const fetchModeState = (sessionId: string): Promise<PermissionModeState | null> =>
  fetch(`${ROUTE}/permission-mode?session=${encodeURIComponent(sessionId)}`)
    .then((r) => readJson<PermissionModeState>(r))
    .catch(() => null);

/** Inject the trigger's hover/focus rule once, so a hot reload's stale copy never survives. */
const ensureAccessTriggerStyle = (): void => {
  const existing = document.getElementById("dsh-oh-my-claude-access-trigger");
  if (existing) return;
  const el = document.createElement("style");
  el.id = "dsh-oh-my-claude-access-trigger";
  el.textContent = ACCESS_TRIGGER_CSS;
  document.head.appendChild(el);
};

/** The capsule the composer's permission control wears at rest: dsh's trigger shape, our hook. */
const accessTriggerStyle: CSSProperties = {
  minWidth: 0,
  // The max width lives in ACCESS_TRIGGER_CSS, beside the narrow-composer rule.
  height: 28,
  color: "var(--dsw-alias-label-secondary)",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  borderRadius: "var(--dsw-radius-sm, 8px)",
  outline: "none",
  alignItems: "center",
  gap: 4,
  padding: "0 4px 0 8px",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: "20px",
  display: "inline-flex",
};

/**
 * The permission control that owns dsh's composer permission slot (`conversation.input.permission`)
 * in a Claude session: a capsule showing the current Claude mode, opening a menu of the six modes.
 * It replaces the DOM-mutating AccessShield by rendering the trigger and menu directly, so it reads
 * the same on every dsh and needs no selector. Registration is gated on the current session being
 * Claude (see index.tsx), because the slot is a single cell and would otherwise shadow dsh's control
 * in a non-Claude session too.
 */
export function AccessTrigger({ sessionId, ctx }: { sessionId: string; ctx: ClientCtx }) {
  useLocale();
  const [open, setOpen] = useState(false);
  // The mode the session's process runs in (or will spawn in), from GET /permission-mode; empty
  // until the first fetch lands.
  const [mode, setMode] = useState("");
  // The stored mode the next turn will spawn in when the running process could not take it live.
  const [pending, setPending] = useState("");
  // The scope whose permissions.disableBypassPermissionsMode refused bypass, empty when allowed;
  // marks the bypass row and the trigger, and drives the full-access note.
  const [bypassRefusedIn, setBypassRefusedIn] = useState("");
  // The last pick's failure text, shown in the menu body; cleared on the next success.
  const [error, setError] = useState<string | null>(null);
  ensureAccessTriggerStyle();

  // Read the current mode and the bypass ceiling once, so the capsule and menu show the truth before
  // any pick. The session is fixed while this mounts, so the cwd does not change.
  useEffect(() => {
    let live = true;
    fetchModeState(sessionId).then((snap) => {
      if (!live || !snap) return;
      setMode(shownMode(snap));
      setPending(pendingMode(snap));
    });
    const cwd = ctx.sessions.list.getSnapshot()?.byId[sessionId]?.cwd;
    fetch(`${ROUTE}/feature-switches${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`)
      .then((r) => readJson<FeatureSwitches>(r))
      .then((s) => {
        if (live) setBypassRefusedIn(s.bypassDisabled?.scope ?? "");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sessionId, ctx]);

  // A deferred pick lands when the next turn respawns the process, which this component cannot
  // see; the respawn's mode arrives as a permission-mode event, and so does every pick made from
  // another tab. One read when the note first shows covers a stream that is down.
  useEffect(() => {
    const off = subscribe("permission-mode", (session, data) => {
      if (session !== sessionId) return;
      setMode(shownMode(data));
      setPending(pendingMode(data));
    });
    return off;
  }, [sessionId]);
  useEffect(() => {
    if (!pending) return;
    let live = true;
    fetchModeState(sessionId).then((snap) => {
      if (!live || !snap) return;
      setMode(shownMode(snap));
      setPending(pendingMode(snap));
    });
    return () => {
      live = false;
    };
  }, [pending, sessionId]);

  // Whether the bypass row and the trigger carry the refused badge for the current mode.
  const bypassRefused = bypassRefusedIn !== "" && mode === "bypassPermissions";
  const label = `${modeLabel(mode)}${bypassRefused ? " ⚠" : ""}`;

  /**
   * Pick a mode, doing exactly what the shield's `pick` did: optimistically show it, send
   * `/permission <preset>` through the live session when dsh's preset must change, then PUT the mode
   * with the clearDefault rule, reverting and showing the error on any failure.
   */
  const pick = (m: string) => {
    setOpen(false);
    fetchModeState(sessionId).then((snap) => {
      if (!snap) return; // nothing to compare against; leave the current mode as is
      const wasMode = mode;
      setMode(m); // optimistic, like the shield's reapplyLabel
      const revert = () => setMode(wasMode);
      const need = presetForMode(m);
      const settle = () => {
        const clearDefault =
          (need === "read-only" && m === "plan") ||
          (need === "workspace-write" && m === "acceptEdits") ||
          (need === "danger-full-access" && m === "bypassPermissions");
        fetch(`${ROUTE}/permission-mode`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session: sessionId, mode: clearDefault ? null : m }),
        })
          .then((r) => readJson<PermissionModeState>(r))
          .then((reply) => {
            if (reply.error) {
              revert();
              setError(reply.error);
            } else {
              setError(null);
              // The reply is the read-back: the process's own mode, and the stored one when the CLI
              // could not take the pick live, so a deferred Bypass reads as the old mode plus a note.
              setMode(shownMode(reply));
              setPending(pendingMode(reply));
            }
          })
          .catch((e) => {
            revert();
            setError(e instanceof Error ? e.message : String(e));
          });
      };
      if (need !== snap.accessMode) {
        const live = ctx.sessions.binding?.(sessionId)?.session;
        if (!live) {
          revert();
          setError(t("panel.access.notMaterialized"));
          return;
        }
        live
          .command(`/permission ${need}`)
          .then((reply) => {
            if (!reply || !reply.ok) {
              revert();
              setError(reply?.error?.message ?? t("panel.access.commandFailed"));
            } else {
              setTimeout(settle, 700);
            }
          })
          .catch((e) => {
            revert();
            setError(e instanceof Error ? e.message : String(e));
          });
      } else {
        settle();
      }
    });
  };

  const chevronOpen = open ? { transform: "rotate(180deg)" } : undefined;
  // The six rows go to dsh's Menu as data, the way dsh's own permission control hands it its three:
  // dsh draws the glyph cell, the label and the trailing check with its own classes, so the rows
  // track dsh's menu styling on every line instead of a copy of its numbers. The refused note and
  // a pick error ride in the footer as heading rows, dsh's small grey text under a hairline.
  const items = MODE_KEYS.map((m) => ({
    id: m,
    icon: <ModeGlyph mode={m} />,
    label: bypassRefusedIn !== "" && m === "bypassPermissions" ? `${modeLabel(m)} ⚠` : modeLabel(m),
  }));
  const footer = [
    ...(bypassRefused
      ? [
          {
            type: "label" as const,
            id: "refused",
            text: t("panel.access.fullAccessRefused", { scope: bypassRefusedIn }),
          },
        ]
      : []),
    ...(pending
      ? [
          {
            type: "label" as const,
            id: "pending",
            text: t("panel.access.nextTurn", { mode: modeLabel(pending) }),
          },
        ]
      : []),
    ...(error ? [{ type: "label" as const, id: "error", text: error }] : []),
  ];
  const accessMenuProps = {
    open,
    onClose: () => setOpen(false),
    side: "top" as const,
    portal: true,
    items,
    selectedId: mode,
    onSelect: pick,
    // An empty footer would still draw dsh's hairline above nothing.
    footer: footer.length > 0 ? footer : undefined,
    anchor: (
      <button
        type="button"
        data-omc-access-trigger=""
        aria-label={t("panel.access.ariaLabel", {
          text: label,
          refused: bypassRefused ? t("panel.access.ariaRefused") : "",
        })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={accessTriggerStyle}
      >
        <span aria-hidden style={{ flex: "none", display: "inline-flex", alignItems: "center" }}>
          {mode === "" ? <IconSparkleMedium size={14} /> : <ModeGlyph mode={mode} />}
        </span>
        <span
          aria-hidden="true"
          data-omc-access-label=""
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {bypassRefused && (
          <span aria-hidden style={{ flex: "none", color: "var(--dsw-alias-label-tertiary)" }}>
            ⚠
          </span>
        )}
        <IconChevronDownOutlineRegular aria-hidden style={chevronOpen} />
      </button>
    ),
  };
  return <Menu {...accessMenuProps} />;
}
