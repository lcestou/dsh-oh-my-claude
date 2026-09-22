// Chinese and English copy for everything the client draws. dsh ships a locale service
// (`@deepseek-ai/dsh-client-locale`): the language picked under Settings → General is stored on the
// box, a browser with no pick follows its own language, and plugins register one namespace of
// `{ zh, en }` strings that switches live. This module registers ours as `oh-my-claude` and hands
// every component a `t()` that reads it.
//
// Each area of the client keeps its strings in its own file under `./i18n/`, keys prefixed with the
// area so two files never collide. Text Claude or the CLI reads (prompts, commands, file names) is
// never translated here; only what a person reads on screen.
import { useSyncExternalStore } from "react";
import * as dshCommon from "./i18n/dsh-common.js";
import * as common from "./i18n/common.js";
import * as misc from "./i18n/misc.js";
import * as main from "./i18n/main.js";
import * as panel from "./i18n/panel.js";
import * as tune from "./i18n/tune.js";
import * as browser from "./i18n/browser.js";
import * as picker from "./i18n/picker.js";
import * as updates from "./i18n/updates.js";

/** The namespace this plugin registers under dsh's locale service. */
export const LOCALE_NS = "oh-my-claude";

/** The plugin's own English strings, merged from the area files; what gets registered. */
const OWN_EN = {
  ...common.en,
  ...misc.en,
  ...main.en,
  ...panel.en,
  ...tune.en,
  ...browser.en,
  ...picker.en,
  ...updates.en,
} as const;
/** Every English string `t()` can answer with: the plugin's own, plus the English fallback for the
 *  dsh `common` words it borrows (used only when dsh has no locale service). */
export const EN = { ...dshCommon.en, ...OWN_EN } as const;
/** Every key the client can ask for. */
export type OmcKey = keyof typeof EN;
/** The Chinese strings, one per key the plugin registers; the compiler refuses a missing or extra
 *  key. The borrowed dsh `common` words are dsh's to translate and are not here. */
export const ZH = {
  ...common.zh,
  ...misc.zh,
  ...main.zh,
  ...panel.zh,
  ...tune.zh,
  ...browser.zh,
  ...picker.zh,
  ...updates.zh,
} satisfies Record<keyof typeof OWN_EN, string>;

/** Values for `{name}` placeholders. */
export type Params = Record<string, string | number>;

/** The slice of dsh's `LocaleRuntime` this module uses, typed here so the plugin builds without
 *  the locale package's types and runs on a dsh that has no locale service at all. */
interface LocaleLike {
  register(
    ns: string,
    dict: { zh: Record<string, string>; en: Record<string, string> },
  ): (() => void) | undefined;
  bind(ns: string): (key: string, params?: Params) => string;
  subscribe(fn: () => void): () => void;
  getSnapshot(): { active: string; revision: number };
}

let runtime: LocaleLike | undefined;
let bound: ((key: string, params?: Params) => string) | undefined;

/** Fill `{name}` placeholders from `params`; a placeholder with no value is left as written, the
 *  way dsh's own lookup leaves it, so a missing parameter shows instead of vanishing. */
export function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Register the dictionaries with dsh's locale service when it is there. Returns a disposer for the
 * registration. Without the service (an older dsh, or a test) `t()` answers in English.
 */
export function installLocale(ctx: {
  get?: (name: "locale") => LocaleLike | undefined;
}): () => void {
  const svc = ctx.get?.("locale");
  if (!svc) return () => {};
  runtime = svc;
  const dispose = svc.register(LOCALE_NS, { zh: ZH, en: OWN_EN });
  bound = svc.bind(LOCALE_NS);
  return () => {
    dispose?.();
    runtime = undefined;
    bound = undefined;
  };
}

/** The string for `key` in the active language, with `{name}` placeholders filled. English when
 *  dsh has no locale service. Usable outside components; a component that shows the result also
 *  calls `useLocale()` so a language switch re-renders it. */
export function t(key: OmcKey, params?: Params): string {
  return bound ? bound(key, params) : fill(EN[key], params);
}

/** The subscribe used when dsh has no locale service: nothing ever changes, nothing to undo. */
const noSubscribe = () => () => {};

/** Subscribe the calling component to language switches and return the active locale id (`en`
 *  when dsh has no locale service). Call it at the top of every component root that renders
 *  `t()` text; children re-render with it. */
export function useLocale(): string {
  useSyncExternalStore(
    runtime ? (fn) => runtime!.subscribe(fn) : noSubscribe,
    () => runtime?.getSnapshot().revision ?? 0,
  );
  return runtime?.getSnapshot().active ?? "en";
}

/** The active locale id outside React (`en` when dsh has no locale service). A caller that draws
 *  with it does not follow a switch on its own; it reads again the next time it draws. */
export function activeLocale(): string {
  return runtime?.getSnapshot().active ?? "en";
}

/**
 * Call `fn` each time the active language changes, not on every dictionary registration (which
 * also bumps dsh's revision). For DOM this plugin builds by hand, which `useLocale()` cannot
 * re-render: the caller throws its nodes away and draws them again. Returns the unsubscribe; a
 * no-op without the locale service.
 */
export function onLocaleSwitch(fn: () => void): () => void {
  if (!runtime) return () => {};
  const svc = runtime;
  let last = svc.getSnapshot().active;
  return svc.subscribe(() => {
    const now = svc.getSnapshot().active;
    if (now === last) return;
    last = now;
    fn();
  });
}
