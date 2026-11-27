// Imports name the .ts files: oxlint loads this plugin in real Node, which does not map .js to .ts.
import { eslintCompatPlugin } from "@oxlint/plugins";

import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { requireDocCommentRule } from "./rules/require-doc-comment.ts";
import { requireFieldLabelRule } from "./rules/require-field-label.ts";
import { requireReadableSpacingRule } from "./rules/require-readable-spacing.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";

/**
 * The anti-slop rules @cloudflare/oxlint-config does not ship (its nkzw base carries the other
 * twelve as `quality/*`), plus this repo's own doc-comment and field-label rules.
 */
const antiSlopPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-module-mocking": noModuleMockingRule,
    "no-runtime-typeof": noRuntimeTypeofRule,
    "no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
    "no-unknown-parameters": noUnknownParametersRule,
    "require-doc-comment": requireDocCommentRule,
    "require-field-label": requireFieldLabelRule,
    "require-readable-spacing": requireReadableSpacingRule,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
  },
});

export default antiSlopPlugin;
