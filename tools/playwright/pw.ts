// The Playwright the checks in this directory borrow, plus the slice of its API they touch.
//
// Nothing in the plugin needs a browser, so Playwright is not a dependency here and its types are
// not either: PLAYWRIGHT_ROOT names any project that has one, and the module is resolved at run
// time. Declaring the surface beats reaching for `any` for one reason above all — `boundingBox()`
// answers null for anything unrendered, and every crop in `tour.ts` reads `.x` off one. Partial on
// purpose: extend it when a check needs a method, do not mirror the API.
export type Box = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
type Find = { hasText?: string | RegExp };

export type Locator = {
  first(): Locator;
  last(): Locator;
  nth(index: number): Locator;
  all(): Promise<Locator[]>;
  filter(where: Find): Locator;
  locator(selector: string, where?: Find): Locator;
  count(): Promise<number>;
  click(how?: { force?: boolean; timeout?: number }): Promise<void>;
  hover(): Promise<void>;
  fill(value: string): Promise<void>;
  innerText(): Promise<string>;
  innerHTML(): Promise<string>;
  textContent(): Promise<string | null>;
  allTextContents(): Promise<string[]>;
  allInnerTexts(): Promise<string[]>;
  getAttribute(name: string): Promise<string | null>;
  boundingBox(): Promise<Box | null>;
  screenshot(how: { path: string }): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  setInputFiles(files: string | string[]): Promise<void>;
  selectOption(value: string): Promise<string[]>;
  inputValue(): Promise<string>;
};

export type Page = {
  goto(url: string, how?: { waitUntil?: "networkidle" | "load" }): Promise<void>;
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
  keyboard: { press(key: string): Promise<void> };
  on(event: "console", handler: (message: { text(): string }) => void): void;
  video(): { path(): Promise<string> };
  url(): string;
};

/** What a context is opened with: a phone shot needs the touch flags, a clip needs the recorder. */
export type ContextOptions = {
  viewport: Size;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  /** Emulated prefers-color-scheme; the owner runs dsh dark, so the tour shoots dark. */
  colorScheme?: "dark" | "light";
  recordVideo?: { dir: string; size: Size };
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
  const { chromium } = await import(entry).catch(() => {
    throw new Error(`no Playwright at ${entry}; point PLAYWRIGHT_ROOT at a project that has it`);
  });
  // SAFETY: `Browser` is the hand-written slice of Playwright's API these checks use. The import
  // is dynamic and untyped by design (Playwright is not a dependency here); a method that moved
  // fails the check that calls it, which is the failure a dev-only check should have.
  return chromium.launch({ headless: true }) as Promise<Browser>;
}

/** The dsh tab these checks drive; the token is dsh's own launch token, printed in its web log. */
export const dshUrl = (token: string | undefined): string =>
  `http://127.0.0.1:3080/?token=${token}`;
