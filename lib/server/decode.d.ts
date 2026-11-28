import type { ImageAttachmentRef, JsonValue } from "./dsh.js";
/** A plain object whose members are still to be checked one by one; arrays and null are not. */
export declare const isRec: (v: unknown) => v is Record<string, unknown>;
/** `v` when it is a string, else undefined. */
export declare const stringOf: (v: unknown) => string | undefined;
/** `v` when it is a number, else undefined. */
export declare const numberValue: (v: unknown) => number | undefined;
/** The string `id` of an object handed over untyped (a dsh session in an event handler), else
 *  undefined. */
export declare const idOf: (v: unknown) => string | undefined;
/** True when `v` is JSON all the way down, as anything `JSON.parse` hands back is. */
export declare const isJsonValue: (v: unknown) => v is JsonValue;
/** True for an image attachment ref with its id and media type, the two fields every reader of
 *  one needs; the optional size and name are not checked. */
export declare const isImageRef: (v: unknown) => v is ImageAttachmentRef;
/** True for a file attachment ref with the id, name and size dsh's file request text names. */
export declare const isFileRef: (v: unknown) => v is {
    attachmentId: string;
    name: string;
    bytes: number;
};
