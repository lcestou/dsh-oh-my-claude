import type { JsonValue } from "../dsh.js";
import type { CustomModel } from "./config.js";
/** The most models one mount keeps. A picker with more rows than this is no longer a picker. */
export declare const CUSTOM_MODELS_MAX = 50;
/** Where the saved lists live: one object keyed by provider id, each value that mount's entries. */
export declare const CUSTOM_MODELS_FILE: (dir: string) => string;
/** A request body's `models` as entries. Throws on anything that is not a list of entries: a
 *  string where a number goes, an entry with no id. A body with no `models` is an empty list. */
export declare function parseCustomModels(value: JsonValue | undefined): CustomModel[];
/**
 * A parsed list as the entries to store, or the sentence that says what is wrong with it, in the
 * language the box is set to. Ids and names are trimmed; an empty name, an empty effort list and
 * effort levels the CLI does not have are dropped rather than refused, so a level the CLI gains
 * later does not make an older plugin reject the whole list.
 */
export declare function checkCustomModels(rows: readonly CustomModel[]): CustomModel[] | string;
/** Every mount's saved entries, by provider id. A file that is missing, unreadable or of another
 *  shape reads as no entries, and so does one mount's list that fails `checkCustomModels`: a bad
 *  file must not empty or break the picker. */
export declare function loadCustomModels(dir: string): Promise<Record<string, CustomModel[]>>;
/** Replace one mount's saved entries; an empty list drops its key. Read-modify-write, one at a
 *  time, so two tabs saving for two boxes cannot lose each other's list. Rejects when the write
 *  fails, and the next save still runs. */
export declare function saveCustomModels(dir: string, provider: string, models: CustomModel[]): Promise<void>;
