import z from "@deepseek-ai/schemastery";
/**
 * True when `raw` passes `schema`'s checks. Schemastery throws on a mismatch, which reads as
 * false; the value is then safe to hand to `schema(raw)`, which runs the same resolver again to
 * build the typed result.
 */
export function fits(schema, raw) {
    try {
        z.resolve(raw, schema, {});
        return true;
    }
    catch {
        return false;
    }
}
/** `text` parsed as JSON and built by `schema`, or undefined when the text is not JSON or the
 *  value does not fit the schema. */
export function parsedWith(schema, text) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    return fits(schema, raw) ? schema(raw) : undefined;
}
//# sourceMappingURL=schema-fits.js.map