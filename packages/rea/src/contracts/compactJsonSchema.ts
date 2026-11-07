import {
  JsonSchemaReferences,
  type JsonSchemaScope,
} from "./jsonSchemaReferences.js";
import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
  schemaLiteralValues,
} from "./jsonSchemaKeywords.js";

// Shared compact JSON Schema projection primitives; canonical validation stays separate.

/** Annotation keys that carry guidance but no validation semantics. */
const annotationKeys = new Set(["description", "examples", "default", "title"]);

const definitionKeys = new Set(["$defs", "definitions"]);
// An empty schema accepts every JSON value. Kimi otherwise infers string.
const jsonValueTypes = [
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "string",
];
// An empty item schema accepts every JSON value, including arbitrarily nested
// arrays, while satisfying clients that require `items` for array types.
// Gemini rejects `items` beside a type list; the compact catalog test fails
// if a tool would advertise this presentation.
export const jsonValueSchema = () => ({ type: [...jsonValueTypes], items: {} });

const enumValueTypes = (values: readonly unknown[]): readonly string[] => [
  ...new Set(
    values.map((value) => {
      if (value === null) return "null";
      if (Array.isArray(value)) return "array";
      if (typeof value === "object") return "object";
      return typeof value;
    }),
  ),
];

export const isSchemaObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

export const schemaDepth = (value: unknown, depth = 0): number => {
  if (Array.isArray(value))
    return Math.max(
      depth,
      ...value.map((child) => schemaDepth(child, depth + 1)),
    );
  if (!isSchemaObject(value)) return depth;
  return Math.max(
    depth,
    ...Object.values(value).map((child) => schemaDepth(child, depth + 1)),
  );
};

/** Strict clients commonly reject advertised schemas deeper than ten nodes. */
export const COMPACT_SCHEMA_MAX_DEPTH = 10;

/** Rewrite every schema-valued position; literal data stays opaque. */
const rebuildSchemaPositions = (
  node: unknown,
  rebuild: (child: unknown) => unknown,
): unknown => {
  if (Array.isArray(node)) return node.map((child) => rebuild(child));
  if (!isSchemaObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (schemaLiteralValues.has(key)) {
      out[key] = value;
      continue;
    }
    if (schemaMaps.has(key) && isSchemaObject(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, rebuild(child)]),
      );
      continue;
    }
    if (schemaArrays.has(key) && Array.isArray(value)) {
      out[key] = value.map((child) => rebuild(child));
      continue;
    }
    if (schemaChildren.has(key)) {
      out[key] = Array.isArray(value)
        ? value.map((child) => rebuild(child))
        : rebuild(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

/**
 * Drop annotation prose from every subschema while preserving all validation
 * keywords. The root keeps its own description because the root-union
 * projection encodes accepted input groups there; the root's echoed literal
 * examples leave with the rest of the annotation prose.
 */
export const stripAnnotations = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const rebuilt = rebuildSchemaPositions(
    schema,
    stripChildAnnotations,
  ) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rebuilt)) {
    if (annotationKeys.has(key) && key !== "description") continue;
    out[key] = value;
  }
  return out;
};

const stripChildAnnotations = (child: unknown): unknown => {
  const rebuilt = rebuildSchemaPositions(child, stripChildAnnotations);
  if (!isSchemaObject(rebuilt)) return rebuilt;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rebuilt))
    if (!annotationKeys.has(key)) kept[key] = value;
  return kept;
};

/** Stop serialization at the budget before allocating an expanded schema. */
export const inlineWithinBudget = (
  root: Record<string, unknown>,
  budgetBytes: number,
): Record<string, unknown> | undefined => {
  const references = new JsonSchemaReferences(root);
  const identity = Object.fromEntries(
    ["$id", "$anchor", "$schema"].flatMap((key) =>
      Object.hasOwn(root, key) ? [[key, root[key]]] : [],
    ),
  );
  const identityBytes =
    Object.keys(identity).length === 0 ? 0 : serializedBytes(identity) - 2;
  if (identityBytes > budgetBytes) return undefined;
  let resolved = true;
  function* serialize(
    value: unknown,
    position: "schema" | "map" | "data",
    scope: JsonSchemaScope | undefined,
    active: ReadonlyMap<JsonSchemaScope, ReadonlySet<string>>,
  ): Generator<string> {
    if (Array.isArray(value)) {
      yield "[";
      for (const [index, child] of value.entries()) {
        if (index > 0) yield ",";
        yield* serialize(child, position, scope, active);
      }
      yield "]";
    } else if (isSchemaObject(value)) {
      const currentScope =
        position === "schema" ? references.enter(value, scope) : scope;
      if (
        position === "schema" &&
        (currentScope === undefined ||
          currentScope.dialect !== references.rootScope.dialect ||
          [
            "$dynamicRef",
            "$recursiveRef",
            "$dynamicAnchor",
            "$recursiveAnchor",
          ].some((key) => Object.hasOwn(value, key)))
      ) {
        resolved = false;
        return;
      }
      if (position === "schema" && Object.keys(value).length === 0) {
        yield JSON.stringify(jsonValueSchema());
        return;
      }
      if (position === "schema" && typeof value.$ref === "string") {
        const target = references.resolve(currentScope, value.$ref);
        if (
          target.kind !== "target" ||
          currentScope === undefined ||
          active.get(currentScope)?.has(value.$ref)
        ) {
          resolved = false;
          return;
        }
        const {
          $ref,
          $id: _id,
          $anchor: _anchor,
          $schema: _schema,
          ...siblings
        } = value;
        const nextActive = new Map(active);
        nextActive.set(
          currentScope,
          new Set([...(active.get(currentScope) ?? []), $ref]),
        );
        // Draft 7 ignores siblings, while clients such as Ajv also apply them.
        // Do not label either interpretation an equivalent inline advertisement.
        if (
          currentScope.dialect === "draft-07" &&
          Object.keys(siblings).length > 0
        ) {
          resolved = false;
          return;
        }
        const expanded =
          Object.keys(siblings).length === 0
            ? target.value
            : { allOf: [target.value, siblings] };
        yield* serialize(expanded, "schema", currentScope, nextActive);
        return;
      }
      yield "{";
      let first = true;
      for (const [key, child] of Object.entries(value)) {
        if (
          position === "schema" &&
          (definitionKeys.has(key) ||
            key === "$id" ||
            key === "$anchor" ||
            key === "$schema")
        )
          continue;
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(key) + ":";
        // `not: {}` forbids a value; no client infers a type for a value it
        // must omit, and the any-value list would place `items` beside a
        // non-array type, which Gemini function declarations reject.
        if (
          position === "schema" &&
          key === "not" &&
          isSchemaObject(child) &&
          Object.keys(child).length === 0
        ) {
          yield "{}";
          continue;
        }
        const childPosition =
          position === "map"
            ? "schema"
            : position === "schema" && schemaMaps.has(key)
              ? "map"
              : position === "schema" &&
                  (schemaArrays.has(key) || schemaChildren.has(key))
                ? "schema"
                : "data";
        yield* serialize(child, childPosition, currentScope, active);
      }
      yield "}";
    } else {
      yield JSON.stringify(value);
    }
  }
  const chunks: string[] = [];
  let bytes = identityBytes;
  for (const chunk of serialize(
    root,
    "schema",
    references.rootScope,
    new Map(),
  )) {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > budgetBytes || !resolved) return undefined;
    chunks.push(chunk);
  }
  if (!resolved) return undefined;
  const expanded: unknown = JSON.parse(chunks.join(""));
  if (!isSchemaObject(expanded)) return undefined;
  // Every emitted dependency is now static and reference-free. Nested resource
  // identifiers/anchors can leave without duplicating identities at call sites.
  const schema = { ...identity, ...expanded };
  return serializedBytes(schema) <= budgetBytes ? schema : undefined;
};

/** Preserve every possible type, including referenced and nullable unions. */
const detectedTypes = (
  schema: unknown,
  references: JsonSchemaReferences,
  inherited: JsonSchemaScope | undefined,
  active: ReadonlySet<object> = new Set(),
): readonly string[] | undefined => {
  if (!isSchemaObject(schema)) return undefined;
  const scope = references.enter(schema, inherited);
  if (scope === undefined) return undefined;
  if (typeof schema.$ref === "string") {
    if (active.has(schema)) return undefined;
    const target = references.resolve(scope, schema.$ref);
    return target.kind === "target"
      ? detectedTypes(
          target.value,
          references,
          scope,
          new Set([...active, schema]),
        )
      : undefined;
  }
  if (typeof schema.type === "string") return [schema.type];
  if (
    Array.isArray(schema.type) &&
    schema.type.every((type) => typeof type === "string")
  )
    return schema.type;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const enumTypes = enumValueTypes(schema.enum);
    if (enumTypes.every((type) => jsonValueTypes.includes(type)))
      return enumTypes;
  }
  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  if (alternatives.length === 0) return undefined;
  const types = alternatives.map((branch) =>
    detectedTypes(branch, references, scope, active),
  );
  if (types.some((type) => type === undefined)) return undefined;
  return [...new Set(types.flatMap((type) => type ?? []))];
};

interface ScopedSchema {
  readonly schema: Record<string, unknown>;
  readonly scope: JsonSchemaScope;
}

/**
 * Collect the item schema of every array alternative. Tuples, boolean item
 * schemas and unresolved references are unknown because one item type would
 * not describe every accepted element.
 */
const arrayItemAlternatives = (
  schema: unknown,
  references: JsonSchemaReferences,
  inherited: JsonSchemaScope | undefined,
  active: ReadonlySet<object> = new Set(),
): readonly ScopedSchema[] | undefined => {
  if (!isSchemaObject(schema)) return undefined;
  const scope = references.enter(schema, inherited);
  if (scope === undefined) return undefined;
  if (typeof schema.$ref === "string") {
    if (active.has(schema)) return undefined;
    const target = references.resolve(scope, schema.$ref);
    return target.kind === "target"
      ? arrayItemAlternatives(
          target.value,
          references,
          scope,
          new Set([...active, schema]),
        )
      : undefined;
  }
  const types =
    typeof schema.type === "string"
      ? [schema.type]
      : Array.isArray(schema.type)
        ? schema.type
        : undefined;
  if (types !== undefined) {
    if (!types.includes("array")) return [];
    return isSchemaObject(schema.items) && schema.prefixItems === undefined
      ? [{ schema: schema.items, scope }]
      : undefined;
  }
  const alternatives = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  if (alternatives.length === 0) return undefined;
  const nested = alternatives.map((branch) =>
    arrayItemAlternatives(branch, references, scope, active),
  );
  return nested.some((items) => items === undefined)
    ? undefined
    : nested.flatMap((items) => items ?? []);
};

/** Nested arrays beyond this level advertise an unconstrained item schema. */
const REDUCED_ITEM_MAX_DEPTH = 3;

/**
 * Advertise the element types the canonical item schemas accept. Gemini
 * function declarations permit `items` only beside the single `array` type,
 * so an element that may be an array alongside other types, or whose type is
 * unknown, uses the empty schema: it accepts every element and still gives
 * clients that require `items` an item schema.
 */
const reducedItemSchema = (
  alternatives: readonly ScopedSchema[] | undefined,
  references: JsonSchemaReferences,
  depth = 1,
): Record<string, unknown> => {
  if (
    alternatives === undefined ||
    alternatives.length === 0 ||
    depth > REDUCED_ITEM_MAX_DEPTH
  )
    return {};
  const types: string[] = [];
  for (const { schema, scope } of alternatives) {
    const detected = detectedTypes(schema, references, scope);
    if (detected === undefined || detected.length === 0) return {};
    types.push(...detected);
  }
  const unique = [...new Set(types)];
  if (!unique.includes("array"))
    return { type: unique.length === 1 ? unique[0] : unique };
  if (unique.length > 1) return {};
  const nested: ScopedSchema[] = [];
  for (const { schema, scope } of alternatives) {
    const items = arrayItemAlternatives(schema, references, scope);
    if (items === undefined) return { type: "array", items: {} };
    nested.push(...items);
  }
  return {
    type: "array",
    items: reducedItemSchema(nested, references, depth + 1),
  };
};

/** Give homogeneous array-item unions the type required by strict gateways. */
export const typeArrayItemUnions = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const references = new JsonSchemaReferences(schema);
  const visit = (node: unknown): unknown => {
    const rebuilt = rebuildSchemaPositions(node, visit);
    if (!isSchemaObject(rebuilt) || rebuilt.type !== "array") return rebuilt;
    const items = rebuilt.items;
    if (
      !isSchemaObject(items) ||
      items.type !== undefined ||
      (!Array.isArray(items.oneOf) && !Array.isArray(items.anyOf))
    )
      return rebuilt;
    const types = detectedTypes(items, references, references.rootScope);
    return types?.length === 1
      ? { ...rebuilt, items: { ...items, type: types[0] } }
      : rebuilt;
  };
  return visit(schema) as Record<string, unknown>;
};

/**
 * Strict gateways reject some nested combinators, primitive enums without a
 * type, and array items whose union has no explicit type. Homogeneous item
 * unions gain their shared type; remaining incompatible shapes use the shallow
 * projection while canonical runtime validation stays intact.
 */
export const hasGatewayIncompatibleShape = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(hasGatewayIncompatibleShape);
  if (!isSchemaObject(schema)) return false;
  if (Array.isArray(schema.anyOf) && schema.anyOf.length === 0) return true;
  if (
    schema.type === "array" &&
    isSchemaObject(schema.items) &&
    schema.items.type === undefined &&
    (Array.isArray(schema.items.oneOf) || Array.isArray(schema.items.anyOf))
  )
    return true;
  if (Array.isArray(schema.required) && isSchemaObject(schema.properties)) {
    for (const name of schema.required) {
      const property = schema.properties[name];
      if (isSchemaObject(property) && containsGatewayCombinator(property))
        return true;
    }
  }
  if (
    Array.isArray(schema.enum) &&
    schema.enum.length > 0 &&
    schema.type === undefined
  ) {
    const types = enumValueTypes(schema.enum);
    if (
      types.length === 1 &&
      types.every((type) =>
        ["string", "number", "boolean", "null"].includes(type),
      )
    )
      return true;
  }
  return schemaChildrenAndMaps(schema).some(hasGatewayIncompatibleShape);
};

const containsGatewayCombinator = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(containsGatewayCombinator);
  if (!isSchemaObject(schema)) return false;
  if (schema.oneOf !== undefined || schema.allOf !== undefined) return true;
  return schemaChildrenAndMaps(schema).some(containsGatewayCombinator);
};

/** Traverse only schema-valued positions; property names remain opaque data. */
const schemaChildrenAndMaps = (
  schema: Readonly<Record<string, unknown>>,
): readonly unknown[] =>
  Object.entries(schema).flatMap(([key, value]) => {
    if (schemaMaps.has(key) && isSchemaObject(value))
      return Object.values(value);
    if (schemaArrays.has(key) && Array.isArray(value)) return value;
    if (schemaChildren.has(key)) return Array.isArray(value) ? value : [value];
    return [];
  });

/**
 * Present a reduced property's reference-resolved types. Reduced inputs omit
 * nested validation, but clients still require an item schema for an array
 * declaration, and Gemini accepts `items` only beside the single `array` type,
 * so a property that may be an array or another type lists typed branches.
 */
const reducedPropertyTypes = (
  value: unknown,
  references: JsonSchemaReferences,
): Record<string, unknown> => {
  const types = detectedTypes(value, references, references.rootScope);
  if (types === undefined || types.length === 0) return {};
  if (!types.includes("array"))
    return { type: types.length === 1 ? types[0] : types };
  const array = {
    type: "array",
    items: reducedItemSchema(
      arrayItemAlternatives(value, references, references.rootScope),
      references,
    ),
  };
  return types.length === 1
    ? array
    : {
        anyOf: types.map((type) => (type === "array" ? array : { type })),
      };
};

/**
 * Present only the root property shape with per-property guidance. Used for
 * schemas whose validation structure alone exceeds the compact budget; the
 * canonical schema still rejects malformed calls server-side.
 */
export const reduceToShallowProperties = (
  schema: Record<string, unknown>,
  reducedAnnotation: string,
): Record<string, unknown> => {
  const properties = isSchemaObject(schema.properties) ? schema.properties : {};
  const description = [
    typeof schema.description === "string" ? schema.description : undefined,
    ...Object.entries(
      isSchemaObject(schema.dependentRequired)
        ? schema.dependentRequired
        : isSchemaObject(schema.dependencies)
          ? schema.dependencies
          : {},
    ).flatMap(([property, partners]) =>
      Array.isArray(partners) &&
      partners.every((partner) => typeof partner === "string")
        ? [
            `When ${property} is provided, also provide ${partners.join(" and ")}.`,
          ]
        : [],
    ),
    reducedAnnotation,
  ]
    .filter((text) => text !== undefined)
    .join(" ");
  const references = new JsonSchemaReferences(schema);
  const shallow = Object.fromEntries(
    Object.entries(properties).map(([name, value]) => {
      const description =
        isSchemaObject(value) && typeof value.description === "string"
          ? { description: value.description }
          : {};
      return [
        name,
        { ...reducedPropertyTypes(value, references), ...description },
      ];
    }),
  );
  return {
    ...(typeof schema.$schema === "string" ? { $schema: schema.$schema } : {}),
    type: "object",
    description,
    properties: shallow,
    ...(Array.isArray(schema.required)
      ? { required: [...schema.required] }
      : {}),
    ...(typeof schema.minProperties === "number"
      ? { minProperties: schema.minProperties }
      : {}),
    ...(schema.additionalProperties === false
      ? { additionalProperties: false }
      : {}),
  };
};
