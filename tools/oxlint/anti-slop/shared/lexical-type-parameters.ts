import type { ESTree } from "@oxlint/plugins";

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

/** Type-guard an AST value onto ESTree.Node by checking it carries a string `type` field, since the
 *  walker hands this raw `any` straight from oxlint's visitor map.
 */
function isNode(value: unknown): value is ESTree.Node {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

/** Recurse the AST child map collecting the names of `infer T` type parameters, because a mapped or
 *  conditional type can shadow a module alias with one.
 */
function collectInferTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  names: Set<string>,
): void {
  if (node.type === "TSInferType") names.add(node.typeParameter.name.name);
  // SAFETY: this is the generic AST walk. `visitorKeys` is oxlint's own map of which properties of
  // a node hold children, so every key read below is one oxlint says exists; each value is checked
  // with `isNode` or `Array.isArray` before it is used.
  const record = node as unknown as Readonly<Record<string, any>>;
  for (const key of visitorKeys[node.type] ?? []) {
    const value = record[key];
    if (isNode(value)) {
      collectInferTypeParameterNames(value, visitorKeys, names);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
    }
  }
}

/** Collect type binders that are in scope at a node and can shadow module aliases. */
export function lexicalTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant: ESTree.Node = node;
  let current: ESTree.Node | null = node;
  while (current !== null && current.type !== "Program") {
    if ("typeParameters" in current) {
      for (const parameter of current.typeParameters?.params ?? []) {
        names.add(parameter.name.name);
      }
    }
    if (
      current.type === "TSMappedType" &&
      (descendant === current.nameType || descendant === current.typeAnnotation)
    ) {
      names.add(current.key.name);
    }
    if (current.type === "TSConditionalType" && descendant === current.trueType) {
      collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
    }
    descendant = current;
    current = current.parent;
  }
  return names;
}
