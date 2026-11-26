// Offline self-check: DSH_OMC_STATE_DIR=$(mktemp -d) bun src/routes/second-opinion.test.ts. No dsh,
// no model, no network: dsh's model service is a stand-in listing one provider.
import { strict as assert } from "node:assert";
import type { JsonValue } from "../dsh.js";
import { opinions } from "../adapter/second-opinion.js";
import { secondOpinionRoutes } from "./second-opinion.js";
import { UNHANDLED } from "./context.js";

let answer: { status: number; value: unknown } = { status: 0, value: null };
let body: { [key: string]: JsonValue } = {};
const route = secondOpinionRoutes({
  ROUTE_PREFIX: "/dsh-oh-my-claude",
  json: (_res, status, value) => {
    answer = { status, value };
  },
  readBody: async () => body,
  // SAFETY: the group reads only `llm.listProviders` and `llm.listModels` off the context
  ctx: {
    llm: {
      listProviders: () => [
        { id: "claude-code" },
        { id: "local", name: "Local" },
        { id: "hung", name: "Hung" },
      ],
      // Claude's mount lists a model too, so only the provider filter keeps it out. `hung` never
      // answers, and the row must still come back without it.
      listModels: (p: string) =>
        p === "hung"
          ? new Promise(() => {})
          : Promise.resolve(
              p === "local" ? [{ id: "m1", name: "Model 1" }] : [{ id: "opus", name: "Opus" }],
            ),
    },
  } as never,
});
/** One request through the group; the answer lands in `answer`. */
const hit = async (method: string, path: string, b: { [key: string]: JsonValue } = {}) => {
  body = b;
  answer = { status: 0, value: null };
  // SAFETY: the group reads `method` off the request and the body through readBody, nothing else
  return route({ method } as never, {} as never, new URL(`http://dsh${path}`));
};

// The card read needs a session.
await hit("GET", "/dsh-oh-my-claude/second-opinion");
assert.equal(answer.status, 400);

// Off: nothing to review, and Run says so.
await hit("POST", "/dsh-oh-my-claude/second-opinion/run", { session: "s1" });
assert.equal(answer.status, 409);
await hit("POST", "/dsh-oh-my-claude/second-opinion/run", {});
assert.equal(answer.status, 400, "a body without a session");

// The model list leaves out Claude's own mounts, and a provider that never answers.
await hit("GET", "/dsh-oh-my-claude/second-opinion/setting");
assert.deepEqual(answer.value, {
  setting: null,
  choices: [{ provider: "local", name: "Local", models: [{ id: "m1", name: "Model 1" }] }],
});

// A model dsh does not list is refused; a listed one is saved; no model turns it off.
await hit("POST", "/dsh-oh-my-claude/second-opinion/setting", { provider: "local", model: "nope" });
assert.equal(answer.status, 400);
assert.equal(opinions.current(), undefined);
await hit("POST", "/dsh-oh-my-claude/second-opinion/setting", {
  provider: "local",
  model: "m1",
  auto: true,
});
assert.equal(answer.status, 200);
assert.deepEqual(opinions.current(), { provider: "local", model: "m1", auto: true });
await hit("POST", "/dsh-oh-my-claude/second-opinion/setting", {});
assert.equal(opinions.current(), undefined);

// Anything else is not this group's.
assert.equal(await hit("GET", "/dsh-oh-my-claude/other"), UNHANDLED);

console.log("second-opinion routes ok");
