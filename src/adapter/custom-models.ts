// Models a person added in Settings: rows for the picker that neither the Models API nor the CLI's
// lineup lists, such as a name a local router sends to another model. Kept per mount in one JSON
// file under the plugin's state, so every browser and every profile sees the same list. The plugin
// config's `customModels` is the other source of such rows; `withCustomModels` in catalog.ts turns
// both into picker rows.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import type { JsonValue } from "../dsh.js";
import { serverText } from "../locale.js";
import { writeJson } from "../state.js";
import { EFFORTS_ALL } from "./catalog.js";
import type { CustomModel } from "./config.js";

/** The most models one mount keeps. A picker with more rows than this is no longer a picker. */
export const CUSTOM_MODELS_MAX = 50;

/** Where the saved lists live: one object keyed by provider id, each value that mount's entries. */
export const CUSTOM_MODELS_FILE = (dir: string): string => join(dir, "custom-models.json");

/** A list as a request body or the stored file carries it. `checkCustomModels` applies the rules
 *  this cannot say (which ids the CLI can take, the size limits). */
const CustomModelList = z.array(
  z.object({
    model: z.string().required(),
    label: z.string(),
    contextWindow: z.number(),
    efforts: z.array(z.string()),
  }),
);
const StoredLists = z.dict(CustomModelList);

/** A request body's `models` as entries. Throws on anything that is not a list of entries: a
 *  string where a number goes, an entry with no id. A body with no `models` is an empty list. */
export function parseCustomModels(value: JsonValue | undefined): CustomModel[] {
  // SAFETY: the schema checks every field at run time; its parameter type describes valid input,
  // which is exactly what is not known yet about a request body.
  return CustomModelList((value ?? []) as Parameters<typeof CustomModelList>[0]);
}

let chain = Promise.resolve();

/** An id `claude --model` can take as one argument: no whitespace, no leading dash (the CLI would
 *  read it as a flag), and not `default`, which is the picker's own row. */
const validId = (id: string): boolean =>
  id.length > 0 && id.length <= 200 && !/\s/.test(id) && !id.startsWith("-") && id !== "default";

/**
 * A parsed list as the entries to store, or the sentence that says what is wrong with it, in the
 * language the box is set to. Ids and names are trimmed; an empty name, an empty effort list and
 * effort levels the CLI does not have are dropped rather than refused, so a level the CLI gains
 * later does not make an older plugin reject the whole list.
 */
export function checkCustomModels(rows: readonly CustomModel[]): CustomModel[] | string {
  if (rows.length > CUSTOM_MODELS_MAX)
    return serverText("customModelMany", { max: String(CUSTOM_MODELS_MAX) });
  const out: CustomModel[] = [];
  for (const r of rows) {
    const model = r.model.trim();
    if (!validId(model)) return serverText("customModelId");
    if (out.some((m) => m.model === model)) return serverText("customModelTwice", { model });
    const entry: CustomModel = { model };
    const label = r.label?.trim() ?? "";
    if (label.length > 100) return serverText("customModelName");
    if (label !== "") entry.label = label;
    const n = r.contextWindow;
    if (n !== undefined) {
      if (!Number.isInteger(n) || n < 1000 || n > 10_000_000)
        return serverText("customModelWindow");
      entry.contextWindow = n;
    }
    const efforts = EFFORTS_ALL.filter((level) => r.efforts?.includes(level));
    if (efforts.length > 0) entry.efforts = efforts;
    out.push(entry);
  }
  return out;
}

/** Every mount's saved entries, by provider id. A file that is missing, unreadable or of another
 *  shape reads as no entries, and so does one mount's list that fails `checkCustomModels`: a bad
 *  file must not empty or break the picker. */
export async function loadCustomModels(dir: string): Promise<Record<string, CustomModel[]>> {
  let stored: Record<string, CustomModel[]>;
  try {
    stored = StoredLists(JSON.parse(await readFile(CUSTOM_MODELS_FILE(dir), "utf8")));
  } catch {
    return {};
  }
  const out: Record<string, CustomModel[]> = {};
  for (const [provider, list] of Object.entries(stored)) {
    const rows = checkCustomModels(list);
    if (Array.isArray(rows) && rows.length > 0) out[provider] = rows;
  }
  return out;
}

/** Replace one mount's saved entries; an empty list drops its key. Read-modify-write, one at a
 *  time, so two tabs saving for two boxes cannot lose each other's list. Rejects when the write
 *  fails, and the next save still runs. */
export function saveCustomModels(
  dir: string,
  provider: string,
  models: CustomModel[],
): Promise<void> {
  const run = chain.then(async () => {
    const all = await loadCustomModels(dir);
    if (models.length > 0) all[provider] = models;
    else delete all[provider];
    await writeJson(CUSTOM_MODELS_FILE(dir), all, { pretty: true });
  });
  chain = run.catch(() => {});
  return run;
}
