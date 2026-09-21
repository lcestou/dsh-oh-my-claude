import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

/** The node a declaration's leading comments attach to: the export wrapping it when there is one. */
function commentOwner(node: ESTree.Node): ESTree.Node {
  const parent = node.parent;
  return parent?.type === "ExportNamedDeclaration" || parent?.type === "ExportDefaultDeclaration"
    ? parent
    : node;
}

/** Whether a declaration sits at the top of its file, directly or under an export. */
function isTopLevel(node: ESTree.Node): boolean {
  return commentOwner(node).parent?.type === "Program";
}

/** Whether a `/** … *\/` block sits in the run of comments directly above the node. A line comment
 *  between the two (a `// SAFETY:` for a cast in the signature, an `oxlint-disable` directive) is
 *  allowed, so the doc comment does not have to be the very last one. */
function hasDocComment(sourceCode: SourceCode, node: ESTree.Node): boolean {
  return sourceCode
    .getCommentsBefore(commentOwner(node))
    .some((comment) => comment.type === "Block" && comment.value.startsWith("*"));
}

/** A top-level `const` whose value is a function, which is a function by another spelling. */
function isFunctionConst(node: ESTree.VariableDeclaration): boolean {
  if (!isTopLevel(node)) return false;
  return node.declarations.some(
    (d) => d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression",
  );
}

/**
 * Require a doc comment on every named function, class, class method and top-level function const.
 *
 * The repository rule is that each one says what its name does not. A lint rule cannot judge
 * whether a comment does that, so this only makes sure there is one to judge: a function nobody
 * has written a sentence about is the case a reviewer never sees. Callbacks, React hook bodies and
 * functions nested inside another function are left out, since their enclosing function's comment
 * is where they are explained.
 */
export const requireDocCommentRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require a /** */ comment above every named function, class, method and top-level function const.",
    },
    messages: {
      missing:
        "This function has no doc comment. Add a `/** … */` above it that says what its name does not: what it returns or throws on failure, a side effect, an assumption, or why it exists.",
    },
  },
  createOnce(context) {
    const check = (node: ESTree.Node) => {
      if (!hasDocComment(context.sourceCode, node)) context.report({ node, messageId: "missing" });
    };
    return {
      FunctionDeclaration(node) {
        if (node.id && isTopLevel(node)) check(node);
      },
      ClassDeclaration(node) {
        if (node.id) check(node);
      },
      MethodDefinition(node) {
        // An optional method declared without a body is a type, not a function to document.
        if (node.value.body !== null) check(node);
      },
      VariableDeclaration(node) {
        if (isFunctionConst(node)) check(node);
      },
    };
  },
});
