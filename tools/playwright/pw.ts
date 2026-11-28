// The Playwright the checks in this directory borrow, plus the slice of its API they touch.
//
// Nothing in the plugin needs a browser, so Playwright is not a dependency here and its types are
// not either: PLAYWRIGHT_ROOT names any project that has one, and the module is resolved at run
// time. Declaring the surface beats reaching for `any` for one reason above all — `boundingBox()`
// answers null for anything unrendered, and every crop in `tour.ts` reads `.x` off one. Partial on
// purpose: extend it when a check needs a method, do not mirror the API.
import type z from "@deepseek-ai/schemastery";
import { fits } from "../../src/schema-fits.js";

export type Box = { x: number; y: number; width: number; height: number };

export type Size = { width: number; height: number };

type Find = { hasText?: string | RegExp };

export type Locator = {
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  all(): Promise<Array<Locator>>;
  filter(where: Find): Locator;
  locator(selector: string, where?: Find): Locator;
  count(): Promise<number>;
  click(how?: { force?: boolean; timeout?: number }): Promise<void>;
  hover(): Promise<void>;
  fill(value: string): Promise<void>;
  innerText(): Promise<string>;
  innerHTML(): Promise<string>;
  textContent(): Promise<string | null>;
  allTextContents(): Promise<Array<string>>;
  allInnerTexts(): Promise<Array<string>>;
  getAttribute(name: string): Promise<string | null>;
  boundingBox(): Promise<Box | null>;
  evaluate<R>(fn: (el: HTMLElement) => R): Promise<R>;
  evaluateAll<R>(fn: (els: Array<HTMLElement>) => R): Promise<R>;
  screenshot(how: { path: string }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  setInputFiles(files: string | Array<string>): Promise<void>;
  selectOption(value: string): Promise<Array<string>>;
  inputValue(): Promise<string>;
  isChecked(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  isVisible(): Promise<boolean>;
};

export type Page = {
  goto(url: string, how?: { waitUntil?: "networkidle" | "load" }): Promise<void>;
  /** Load the page again, as after a setting changed on disk that the page read once. */
  reload(how?: { waitUntil?: "networkidle" | "load" }): Promise<void>;
  addStyleTag(tag: { content: string }): Promise<void>;
  /** Inject a script file into the page, as the accessibility scan does with axe-core. */
  addScriptTag(tag: { path: string }): Promise<void>;
  /** Run in the page, which carries dsh's session cookie: the plugin's own routes answer 401 to a
   *  token passed as a query parameter, so a check that has to call one goes through here. */
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  /** The closure is serialised to the page, so it captures nothing from here: anything it needs
   *  travels as the second argument. */
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
  locator(selector: string, where?: Find): Locator;
  getByRole(role: string, where: { name: string | RegExp }): Locator;
  getByText(text: string | RegExp): Locator;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(how: { path: string; clip?: Box; fullPage?: boolean }): Promise<void>;
  setViewportSize(size: Size): Promise<void>;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  /** A finger tap at page coordinates; only in a context opened with `hasTouch`. */
  touchscreen: { tap(x: number, y: number): Promise<void> };
  on(event: "console", handler: (message: { text(): string }) => void): void;
  /** Every request the page makes; a counter check reads `url()` and `method()` off each one. */
  on(event: "request", handler: (request: { url(): string; method(): string }) => void): void;
  video(): { path(): Promise<string> };
  url(): string;
  /** Answer one of the page's requests from the check: the handler may fetch the real reply and
   *  fulfil an edited copy, which is how a check shows a state the box is not in. */
  route(url: string | RegExp, handler: (route: Route) => Promise<void>): Promise<void>;
  /** Drop every route handler before the context closes, so a reply in flight does not throw. */
  unrouteAll(how: { behavior: "ignoreErrors" }): Promise<void>;
};

/** Any JSON document, as a plugin route answers with. */
export type JsonValue = string | number | boolean | null | Array<JsonValue> | JsonDoc;

export type JsonDoc = { [key: string]: JsonValue };

/** One intercepted request; the slice a check needs to rewrite a JSON reply. */
export type Route = {
  fetch(): Promise<Reply>;
  /** `status` defaults to 200; a check that shows a failed route passes its own. */
  fulfill(how: { response?: Reply; status?: number; json: JsonDoc }): Promise<void>;
  /** The request being answered; a check on one URL for GET and POST reads the method and body. */
  request(): { method(): string; postData(): string | null };
  /** Let the request through to the box unchanged, as when a check only watches it. */
  continue(): Promise<void>;
};

export type Reply = { json(): Promise<JsonDoc> };

/** What a context is opened with: a phone shot needs the touch flags, a clip needs the recorder. */
export type ContextOptions = {
  viewport: Size;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  /** Emulated prefers-color-scheme; the owner runs dsh dark, so the tour shoots dark. */
  colorScheme?: "dark" | "light";
  recordVideo?: { dir: string; size: Size };
  /** Emulated prefers-reduced-motion. */
  reducedMotion?: "reduce" | "no-preference";
  /** The browser language; dsh follows it until a language is chosen in Settings. */
  locale?: string;
  /** Browser permissions granted up front; a check that reads the clipboard needs both. */
  permissions?: Array<"clipboard-read" | "clipboard-write">;
};

export type Context = {
  newPage(): Promise<Page>;
  close(): Promise<void>;
};

export type Browser = {
  newContext(options: ContextOptions): Promise<Context>;
  newPage(options?: ContextOptions): Promise<Page>;
  close(): Promise<void>;
};

/** A headless Chromium from the borrowed install. Every check here wants the same one. */
export async function launch(): Promise<Browser> {
  const root = process.env.PLAYWRIGHT_ROOT ?? process.cwd();
  const entry = `${root}/node_modules/playwright/index.mjs`;

  // Named rather than left to the module loader: "Cannot find module undefined/node_modules/..."
  // is what an unset PLAYWRIGHT_ROOT used to print, which reads as a bug in the check.
  const mod: unknown = await import(entry).catch(() => {
    throw new Error(`no Playwright at ${entry}; point PLAYWRIGHT_ROOT at a project that has it`);
  });

  if (!hasChromium(mod)) {
    throw new TypeError(`${entry} exports no chromium.launch`);
  }

  return mod.chromium.launch({ headless: true });
}

/** The one entry point of Playwright's module the checks call. */
type PlaywrightModule = { chromium: { launch(options: { headless: boolean }): Promise<Browser> } };

/**
 * Whether a module loaded by path exposes `chromium.launch` as a function. `Browser` is the
 * hand-written slice of Playwright's API these checks use, and the rest of it is trusted: the
 * import is dynamic and untyped by design (Playwright is not a dependency here), and a method that
 * moved fails the check that calls it, which is the failure a dev-only check should have.
 */
function hasChromium(mod: unknown): mod is PlaywrightModule {
  if (typeof mod !== "object" || mod === null || !("chromium" in mod)) {
    return false;
  }

  const { chromium } = mod;

  return (
    typeof chromium === "object" &&
    chromium !== null &&
    "launch" in chromium &&
    typeof chromium.launch === "function"
  );
}

/** GET `path` from inside the page, which carries dsh's login, or POST `post` to it as JSON, and
 *  decode the answer with `schema`. Rejects when the body is not JSON or does not fit, naming the
 *  path and the start of the body. */
export async function fetchJson<S, T>(
  p: Page,
  path: string,
  schema: z<S, T>,
  post?: JsonDoc,
): Promise<T> {
  const text = await p.evaluate(
    async ({ url, json }) => {
      const init =
        json === ""
          ? undefined
          : { method: "POST", headers: { "content-type": "application/json" }, body: json };

      return (await fetch(url, init)).text();
    },
    { url: path, json: post === undefined ? "" : JSON.stringify(post) },
  );

  const raw: unknown = JSON.parse(text);

  if (!fits(schema, raw)) {
    throw new TypeError(`${path} answered a body this check cannot read: ${text.slice(0, 200)}`);
  }

  return schema(raw);
}

/** The dsh tab these checks drive; the token is dsh's own launch token, printed in its web log.
 *  DSH_ORIGIN points a check at another dsh, such as a scratch one on a second port, so a shoot or
 *  a check never has to touch the box's live sessions. */
export const dshUrl = (token: string | undefined): string =>
  `${process.env.DSH_ORIGIN ?? "http://127.0.0.1:3080"}/?token=${token}`;
