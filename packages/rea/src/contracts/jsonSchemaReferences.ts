import {
  schemaArrays,
  schemaChildren,
  schemaMaps,
} from "./jsonSchemaKeywords.js";

type SchemaObject = Readonly<Record<string, unknown>>;
type Dialect = "draft-07" | "draft-2020-12";

/** A fragment's resource and URI base are distinct facts. */
export interface JsonSchemaScope {
  readonly root: SchemaObject;
  readonly baseUri: string | undefined;
  readonly dialect: Dialect | undefined;
  readonly parent?: JsonSchemaScope;
}

type LocalReference =
  | {
      readonly kind: "target";
      readonly value: unknown;
      readonly path: readonly string[];
    }
  | { readonly kind: "anchor" }
  | {
      readonly kind: "unresolved";
      readonly reason:
        | "scope"
        | "external"
        | "fragment"
        | "pointer"
        | "resource-boundary"
        | "dynamic";
    };

const isObject = (value: unknown): value is SchemaObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const dialectOf = (
  schema: SchemaObject,
  inherited: Dialect | undefined,
): Dialect | undefined =>
  schema.$schema === undefined
    ? inherited
    : schema.$schema === "http://json-schema.org/draft-07/schema#" ||
        schema.$schema === "http://json-schema.org/draft-07/schema"
      ? "draft-07"
      : schema.$schema === "https://json-schema.org/draft/2020-12/schema"
        ? "draft-2020-12"
        : undefined;

/** Per-projection scope ownership; no external resource loading or dynamic-reference evaluation. */
export class JsonSchemaReferences {
  readonly rootScope: JsonSchemaScope;
  readonly #scopes = new WeakMap<
    object,
    WeakMap<JsonSchemaScope, JsonSchemaScope | undefined>
  >();
  readonly #referenceSites: {
    scope: JsonSchemaScope;
    reference: string;
    keyword: string;
  }[] = [];
  readonly #identities = new Map<string, JsonSchemaScope>();
  readonly #relativeIdentities = new WeakMap<
    JsonSchemaScope,
    Map<string, JsonSchemaScope>
  >();
  readonly #ambiguous = new WeakSet<JsonSchemaScope>();

  constructor(root: SchemaObject) {
    let baseUri: string | undefined;
    if (typeof root.$id === "string" && URL.canParse(root.$id)) {
      const url = new URL(root.$id);
      url.hash = "";
      baseUri = url.href;
    }
    this.rootScope = {
      root,
      baseUri,
      dialect: dialectOf(root, "draft-2020-12"),
    };
    if (baseUri !== undefined) this.#identities.set(baseUri, this.rootScope);
    // Index resources before consumers resolve anything, so later duplicate IDs
    // cannot invalidate facts that have already escaped from the owner.
    const pending = [{ value: root as unknown, scope: this.rootScope }];
    const visited = new WeakMap<JsonSchemaScope, WeakSet<object>>();
    while (pending.length > 0) {
      const { value, scope: parent } = pending.pop()!;
      if (!isObject(value)) continue;
      const scope = this.#scope(value, parent);
      if (scope === undefined) continue;
      let seen = visited.get(scope);
      if (seen === undefined) {
        seen = new WeakSet();
        visited.set(scope, seen);
      }
      if (seen.has(value)) continue;
      seen.add(value);
      for (const keyword of ["$ref", "$dynamicRef", "$recursiveRef"]) {
        const reference = value[keyword];
        if (typeof reference !== "string") continue;
        this.#referenceSites.push({ scope, reference, keyword });
        if (keyword !== "$ref") continue;
        const target = this.resolve(scope, reference);
        if (target.kind === "target")
          pending.push({ value: target.value, scope });
      }
      for (const [key, child] of Object.entries(value)) {
        if (schemaMaps.has(key) && isObject(child)) {
          for (const item of Object.values(child))
            pending.push({ value: item, scope });
        } else if (
          (schemaArrays.has(key) || schemaChildren.has(key)) &&
          Array.isArray(child)
        ) {
          for (const item of child) pending.push({ value: item, scope });
        } else if (schemaChildren.has(key))
          pending.push({ value: child, scope });
      }
    }
  }

  enter(
    schema: SchemaObject,
    parent: JsonSchemaScope | undefined,
  ): JsonSchemaScope | undefined {
    if (parent === undefined) return undefined;
    const scope = this.#scope(schema, parent);
    for (let current = scope; current !== undefined; current = current.parent)
      if (this.#ambiguous.has(current)) return undefined;
    return scope?.dialect === undefined ? undefined : scope;
  }

  #scope(
    schema: SchemaObject,
    parent: JsonSchemaScope,
  ): JsonSchemaScope | undefined {
    if (schema === parent.root) return parent;
    if (schema.$id === undefined) return parent;
    let cached = this.#scopes.get(schema);
    if (cached?.has(parent)) return cached.get(parent);
    if (cached === undefined) {
      cached = new WeakMap();
      this.#scopes.set(schema, cached);
    }
    let scope: JsonSchemaScope | undefined;
    if (
      typeof schema.$id === "string" &&
      schema.$id !== "" &&
      (!schema.$id.includes("#") ||
        (schema.$id !== "#" &&
          schema.$id.indexOf("#") === schema.$id.length - 1))
    ) {
      let baseUri: string | undefined;
      try {
        if (parent.baseUri !== undefined || URL.canParse(schema.$id)) {
          const url = new URL(schema.$id, parent.baseUri);
          url.hash = "";
          baseUri = url.href;
        }
        scope = {
          root: schema,
          baseUri,
          dialect: dialectOf(schema, parent.dialect),
          parent,
        };
        if (baseUri !== undefined) {
          const existing = this.#identities.get(baseUri);
          if (existing !== undefined && existing.root !== schema) {
            this.#ambiguous.add(existing);
            this.#ambiguous.add(scope);
          } else if (existing !== undefined) scope = existing;
          else this.#identities.set(baseUri, scope);
        } else {
          let identities = this.#relativeIdentities.get(parent);
          if (identities === undefined) {
            identities = new Map();
            this.#relativeIdentities.set(parent, identities);
          }
          const identity = schema.$id.replace(/#$/u, "");
          const existing = identities.get(identity);
          if (existing !== undefined && existing.root !== schema) {
            this.#ambiguous.add(existing);
            this.#ambiguous.add(scope);
          } else if (existing !== undefined) scope = existing;
          else identities.set(identity, scope);
        }
      } catch {
        // An opaque or unknown URI base must not be replaced with a guessed scope.
      }
    }
    // Empty/fragment IDs can alias a resource or be legacy anchors. Keep them
    // unresolved rather than resetting the pointer root to that subschema.
    cached.set(parent, scope);
    return scope;
  }

  *references(): IterableIterator<{
    readonly scope: JsonSchemaScope;
    readonly target: LocalReference;
  }> {
    for (const { scope, reference, keyword } of this.#referenceSites)
      yield {
        scope,
        target:
          keyword === "$ref"
            ? this.resolve(scope, reference)
            : { kind: "unresolved", reason: "dynamic" },
      };
  }

  resolve(
    scope: JsonSchemaScope | undefined,
    reference: string,
  ): LocalReference {
    if (scope === undefined || this.enter(scope.root, scope) === undefined)
      return { kind: "unresolved", reason: "scope" };
    if (!reference.startsWith("#"))
      return { kind: "unresolved", reason: "external" };
    let fragment: string;
    try {
      fragment = decodeURIComponent(reference.slice(1));
    } catch {
      return { kind: "unresolved", reason: "fragment" };
    }
    if (fragment === "") return { kind: "target", value: scope.root, path: [] };
    if (!fragment.startsWith("/")) return { kind: "anchor" };
    let value: unknown = scope.root;
    const path: string[] = [];
    for (const token of fragment.slice(1).split("/")) {
      if (/~(?:[^01]|$)/u.test(token))
        return { kind: "unresolved", reason: "pointer" };
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
      if (
        value === null ||
        typeof value !== "object" ||
        !Object.hasOwn(value, key) ||
        (Array.isArray(value) && !/^(?:0|[1-9][0-9]*)$/u.test(key))
      )
        return { kind: "unresolved", reason: "pointer" };
      if (value !== scope.root && isObject(value) && "$id" in value)
        return { kind: "unresolved", reason: "resource-boundary" };
      path.push(key);
      value = Reflect.get(value, key);
    }
    return { kind: "target", value, path };
  }
}
