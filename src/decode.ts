// Primitive decoders for values the plugin does not own: parsed JSON, HTTP bodies, dsh host
// objects handed over untyped. Code elsewhere imports these instead of testing `typeof` itself, so
// the checks live at one boundary.
import type { ImageAttachmentRef, JsonValue } from "./dsh.js";

/** A plain object whose members are still to be checked one by one; arrays and null are not. */
export const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `v` when it is a string, else undefined. */
export const stringOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** `v` when it is a number, else undefined. */
export const numberValue = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;

/** The string `id` of an object handed over untyped (a dsh session in an event handler), else
 *  undefined. */
export const idOf = (v: unknown): string | undefined => (isRec(v) ? stringOf(v.id) : undefined);

/** True when `v` is JSON all the way down, as anything `JSON.parse` hands back is. */
export const isJsonValue = (v: unknown): v is JsonValue =>
  v === null ||
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean" ||
  (Array.isArray(v)
    ? v.every(isJsonValue)
    : typeof v === "object" && Object.values(v).every(isJsonValue));

/** True for an image attachment ref with its id and media type, the two fields every reader of
 *  one needs; the optional size and name are not checked. */
export const isImageRef = (v: unknown): v is ImageAttachmentRef =>
  isRec(v) && typeof v.attachmentId === "string" && typeof v.mediaType === "string";

/** True for a file attachment ref with the id, name and size dsh's file request text names. */
export const isFileRef = (v: unknown): v is { attachmentId: string; name: string; bytes: number } =>
  isRec(v) &&
  typeof v.attachmentId === "string" &&
  typeof v.name === "string" &&
  typeof v.bytes === "number";
