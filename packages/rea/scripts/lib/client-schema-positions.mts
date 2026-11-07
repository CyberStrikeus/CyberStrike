import { JsonSchemaReferences } from "../../src/contracts/jsonSchemaReferences.js";
import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
} from "../../src/contracts/jsonSchemaKeywords.js";

type SchemaObject = Readonly<Record<string, unknown>>;
export type ClientSchemaPosition =
  | {
      readonly kind: "schema";
      readonly schema: SchemaObject;
      readonly path: string;
    }
  | {
      readonly kind: "keyword";
      readonly keyword: string;
      readonly value: unknown;
      readonly path: string;
    }
  | {
      readonly kind: "pattern-property";
      readonly pattern: string;
      readonly path: string;
    };

const isSchemaObject = (value: unknown): value is SchemaObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const referenceTargetPath = (
  root: SchemaObject,
  tokens: readonly string[],
  path: string,
): string => {
  let value: unknown = root;
  for (const token of tokens) {
    path += Array.isArray(value) ? `[${token}]` : `.${token}`;
    // The reference owner already established this exact pointer's target.
    value = Reflect.get(value as object, token);
  }
  return path;
};

/** Ordered schema positions for native-client checks; instance literals remain opaque. */
export function* clientSchemaPositions(
  schema: unknown,
): IterableIterator<ClientSchemaPosition> {
  if (!isSchemaObject(schema)) return;
  const seen = new Set<object>();
  const paths = new WeakMap<object, string>();
  function* visit(
    value: unknown,
    path: string,
  ): IterableIterator<ClientSchemaPosition> {
    if (!isSchemaObject(value) || seen.has(value)) return;
    seen.add(value);
    paths.set(value, path);
    yield { kind: "schema", schema: value, path };
    for (const [keyword, child] of Object.entries(value)) {
      const childPath = `${path}.${keyword}`;
      yield { kind: "keyword", keyword, value: child, path: childPath };
      if (schemaMaps.has(keyword) && isSchemaObject(child)) {
        for (const [name, nested] of Object.entries(child)) {
          const nestedPath = `${childPath}.${name}`;
          if (keyword === "patternProperties")
            yield { kind: "pattern-property", pattern: name, path: nestedPath };
          yield* visit(nested, nestedPath);
        }
      } else if (
        (schemaArrays.has(keyword) || schemaChildren.has(keyword)) &&
        Array.isArray(child)
      ) {
        for (const [index, nested] of child.entries())
          yield* visit(nested, `${childPath}[${index}]`);
      } else if (schemaChildren.has(keyword)) yield* visit(child, childPath);
    }
  }
  yield* visit(schema, "$");
  // Resolve after ordinary positions so an existing inline diagnostic keeps
  // its encounter order. External/dynamic/ambiguous targets stay unknown.
  for (const { scope, target } of new JsonSchemaReferences(
    schema,
  ).references()) {
    if (target.kind !== "target") continue;
    const scopePath = paths.get(scope.root);
    if (scopePath !== undefined)
      yield* visit(
        target.value,
        referenceTargetPath(scope.root, target.path, scopePath),
      );
  }
}
