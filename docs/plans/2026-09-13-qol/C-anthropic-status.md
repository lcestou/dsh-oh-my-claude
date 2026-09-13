TASK C: say when Anthropic reports a degraded API on a 5xx or 529 retry line.

Read first and quote one sentence in your report: docs/design/2026-09-13-qol.md, section "5. Anthropic status on API errors". Also read src/update.ts in full: the new module copies its cache and timeout shape.

SCOPE: src/anthropic-status.ts (new file), src/anthropic-status.test.ts (new file), src/translator.ts, src/translator.test.ts, src/adapter.ts (one option in one constructor call).

Part 1, new file src/anthropic-status.ts:

```ts
// Anthropic's public status page, read only after the CLI reports a server-side API failure
// (5xx or 529) and cached so a burst of retries costs one read. Statuspage's summary document:
// `{ status: { indicator: "none" | "minor" | "major" | "critical", description: string } }`.
const STATUS_URL = "https://status.anthropic.com/api/v2/status.json";

export interface AnthropicStatus {
  indicator: string;
  description: string;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

const TTL_OK = 60_000;
const TTL_FAIL = 5 * 60_000;
let cache: { at: number; ttl: number; value: AnthropicStatus | undefined } | undefined;
let inflight: Promise<AnthropicStatus | undefined> | undefined;

/** What the last read said, without reading: undefined when nothing is cached or it expired. */
export function peekStatus(now = Date.now()): AnthropicStatus | undefined;

/** Read the page (or answer the cached value); never throws; one read in flight at a time. */
export async function anthropicStatus(fetchFn: FetchFn = fetch, now = Date.now(), timeoutMs = 2500): Promise<AnthropicStatus | undefined>;

/** The suffix for an error line: empty for `none` or unknown, else ` · Anthropic reports <description>`. */
export function degradedNote(status: AnthropicStatus | undefined): string;

/** Test seam. */
export function forgetStatus(): void;
```

Parse the JSON body with `JSON.parse` and narrow by hand: the value must be an object with a `status` object whose `indicator` and `description` are strings; anything else reads as undefined (a failed read, cached with `TTL_FAIL`). No `as` assertions: write a small guard `function isStatusDoc(v: unknown): v is { status: AnthropicStatus }` using `typeof` checks (this module is a new I/O module; add it to the `no-runtime-typeof` exemption list in `.oxlintrc.json` only if lint fails on it, and say so in the report).

Part 2, src/anthropic-status.test.ts. Fake fetch, no network. Assert: a `minor` document gives `{ indicator: "minor", description: "Degraded performance" }` and `degradedNote` of it is ` · Anthropic reports Degraded performance`; `none` gives an empty note; a second call within 60 s does not call fetch again (count calls); a non-OK response caches undefined and the next call within 5 minutes does not fetch; `peekStatus` answers the cached value and undefined after `forgetStatus()`; a fetch that rejects answers undefined without throwing.

Part 3, src/translator.ts.
- Add a constructor option `statusNote?: (httpStatus: number) => string` (the option list starts around line 489, the class fields around line 409; store it as `statusNote: ((httpStatus: number) => string) | undefined`).
- In the `api_retry`/`api_error` branch (grep `event.subtype === "api_retry" || event.subtype === "api_error"`, around line 806), compute `const code = err.status ?? 0;` and `const status = code >= 500 ? (this.statusNote?.(code) ?? "") : "";` then append `status` to the returned text after `tail` (the returned line becomes `⚠ ${head}${down}${tail}${status}`). 529 is above 500 so it is covered.

Part 4, src/translator.test.ts. Add one block: a `Translator` built with `statusNote: (code) => { seen.push(code); return " · Anthropic reports Degraded performance"; }`; an `api_retry` frame with `error: { status: 529, message: "overloaded" }, attempt: 1, max_retries: 3, retry_delay_ms: 2000` yields a reasoning line ending in ` · attempt 1/3 · Anthropic reports Degraded performance` and `seen` equals `[529]`; a 429 frame leaves `seen` unchanged and has no suffix. Look at the existing `api_retry` test in src/adapter.test.ts around line 1693 for the exact frame shape and the expected prefix wording.

Part 5, src/adapter.ts. In the main `new Translator({ ... })` call that passes `hostLabel: this.hostLabelFor(options.sessionId)` (around line 4249), add:

```ts
      // A 5xx or 529 asks the status page once a minute; the note lands on the next retry line.
      statusNote: () => {
        const known = peekStatus();
        if (known === undefined) void anthropicStatus();
        return degradedNote(known);
      },
```

Import `anthropicStatus, degradedNote, peekStatus` from `./anthropic-status.js`.

Gate: `bun run validate`, last line `✔ all green`. Also `bun src/anthropic-status.test.ts` and `bun src/translator.test.ts`; paste each last line.
