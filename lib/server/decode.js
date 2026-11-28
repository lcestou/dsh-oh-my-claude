/** A plain object whose members are still to be checked one by one; arrays and null are not. */
export const isRec = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** `v` when it is a string, else undefined. */
export const stringOf = (v) => (typeof v === "string" ? v : undefined);
/** `v` when it is a number, else undefined. */
export const numberValue = (v) => typeof v === "number" ? v : undefined;
/** The string `id` of an object handed over untyped (a dsh session in an event handler), else
 *  undefined. */
export const idOf = (v) => (isRec(v) ? stringOf(v.id) : undefined);
/** True when `v` is JSON all the way down, as anything `JSON.parse` hands back is. */
export const isJsonValue = (v) => v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean" ||
    (Array.isArray(v)
        ? v.every(isJsonValue)
        : typeof v === "object" && Object.values(v).every(isJsonValue));
/** True for an image attachment ref with its id and media type, the two fields every reader of
 *  one needs; the optional size and name are not checked. */
export const isImageRef = (v) => isRec(v) && typeof v.attachmentId === "string" && typeof v.mediaType === "string";
/** True for a file attachment ref with the id, name and size dsh's file request text names. */
export const isFileRef = (v) => isRec(v) &&
    typeof v.attachmentId === "string" &&
    typeof v.name === "string" &&
    typeof v.bytes === "number";
//# sourceMappingURL=decode.js.map