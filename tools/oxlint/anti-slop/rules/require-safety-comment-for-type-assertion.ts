import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const DEFAULT_SAFETY_MARKERS = ["SAFETY"] as const;

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

/**
 * Return true when an assertion casts to the `const` modifier, which preserves precision and needs
 * no safety comment.
 */
function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

/**
 * The comment markers that justify an assertion, from the rule option `{ markers: [...] }`; blank
 * or missing entries fall back to the defaults.
 */
function configuredSafetyMarkers(option: unknown): ReadonlyArray<string> {
  if (typeof option !== "object" || option === null || !("markers" in option)) {
    return DEFAULT_SAFETY_MARKERS;
  }

  const configured = option.markers;

  if (!Array.isArray(configured)) {
    return DEFAULT_SAFETY_MARKERS;
  }

  const markers = configured.flatMap((marker) =>
    typeof marker === "string" && marker.trim().length > 0 ? [marker.trim()] : [],
  );

  return markers.length > 0 ? markers : DEFAULT_SAFETY_MARKERS;
}

/** One pattern that matches any marker followed by a colon and some text, as `SAFETY: why`. */
function markerPattern(markers: ReadonlyArray<string>): RegExp {
  const alternation = markers
    .map((marker) => marker.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join("|");

  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}_])(?:${alternation})\s*:\s*\S`, "u");
}

/**
 * Return true when a comment above `owner` that ends before the assertion carries a marker with a
 * reason after it.
 */
function hasSafetyJustificationBefore(
  sourceCode: SourceCode,
  owner: ESTree.Node,
  assertion: TypeAssertion,
  pattern: RegExp,
): boolean {
  return sourceCode
    .getCommentsBefore(owner)
    .some((comment) => comment.end <= assertion.start && pattern.test(comment.value));
}

/**
 * Walk up from an assertion to its statement, returning true when a marker comment sits within it,
 * and hop past an export so an exported assertion can be justified above the export line.
 */
function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion, pattern: RegExp): boolean {
  let current: ESTree.Node = node;

  while (true) {
    if (hasSafetyJustificationBefore(sourceCode, current, node, pattern)) {
      return true;
    }

    if (commentOwnerKinds.has(current.type)) {
      const exportDeclaration = current.parent;

      return (
        exportDeclaration.type === "ExportNamedDeclaration" &&
        exportDeclaration.declaration === current &&
        hasSafetyJustificationBefore(sourceCode, exportDeclaration, node, pattern)
      );
    }

    if (current.parent.type === "Program") {
      return false;
    }

    current = current.parent;
  }
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `{{marker}}:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
    schema: [
      {
        type: "object",
        properties: {
          markers: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ markers: ["SAFETY"] }],
  },
  createOnce(context) {
    const patterns = new Map<string, RegExp>();

    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node)) {
        return;
      }

      const markers = configuredSafetyMarkers(context.options?.[0]);
      const patternKey = markers.join("\u0000");
      const pattern = patterns.get(patternKey) ?? markerPattern(markers);
      patterns.set(patternKey, pattern);

      if (hasSafetyComment(context.sourceCode, node, pattern)) {
        return;
      }

      context.report({
        node,
        messageId: "missingSafetyComment",
        data: { marker: markers[0] ?? DEFAULT_SAFETY_MARKERS[0] },
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
