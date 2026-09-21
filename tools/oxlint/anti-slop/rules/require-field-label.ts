import { defineRule } from "@oxlint/plugins";

/** The attributes that give a form field an accessible name without a wrapping `<label>`. */
const NAMING = new Set(["aria-label", "aria-labelledby", "id"]);

/** Field types a person never reads a name for: nothing on screen, or opened by another control. */
const UNNAMED_TYPES = new Set(["hidden", "file", "submit", "button", "reset", "image"]);

/**
 * Require every form field to carry an accessible name.
 *
 * The upstream `jsx-a11y/control-has-associated-label` deliberately skips `<input>`, on the
 * assumption that a `<label>` names it. That leaves exactly the case this repository keeps getting
 * wrong: a field whose only name is its `placeholder`, which vanishes the moment someone types and
 * is not announced as a label by a screen reader. An audit on 2026-09-21 found 28 of them.
 *
 * A field passes when it has an `aria-label`, an `aria-labelledby`, or an `id` a `<label htmlFor>`
 * can point at, or when it sits inside a `<label>` element. A field whose `type` means nobody reads
 * its name (hidden, a file picker opened by a visible button, a submit) is not a field this is
 * about. The `id` exemption trusts that a matching label exists; checking that across the file is
 * more than a lint rule should do, and an `id` with no label is caught by a person, not a parser.
 */
export const requireFieldLabelRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require input, select and textarea elements to have an accessible name, not just a placeholder.",
    },
    messages: {
      unnamed:
        "This field has no accessible name. Add `aria-label`, or wrap it in a `<label>`. A placeholder is not a name: it disappears as someone types and screen readers do not announce it.",
    },
  },
  createOnce(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const tag = node.name.name;
        if (tag !== "input" && tag !== "select" && tag !== "textarea") return;
        let typeValue: string | undefined;
        for (const attr of node.attributes) {
          if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
          // A spread could carry a name this rule cannot see, so it is given the benefit.
          if (NAMING.has(attr.name.name)) return;
          if (attr.name.name === "type" && attr.value?.type === "Literal")
            typeValue = String(attr.value.value);
        }
        if (node.attributes.some((a) => a.type === "JSXSpreadAttribute")) return;
        if (typeValue !== undefined && UNNAMED_TYPES.has(typeValue)) return;
        // Inside a `<label>` element, that label names it.
        for (let up = node.parent?.parent; up; up = up.parent) {
          if (
            up.type === "JSXElement" &&
            up.openingElement.name.type === "JSXIdentifier" &&
            up.openingElement.name.name === "label"
          )
            return;
        }
        context.report({ node, messageId: "unnamed" });
      },
    };
  },
});
