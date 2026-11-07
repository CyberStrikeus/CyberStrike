import * as t from "@babel/types";
import { semanticKnownSymbolKey } from "./javascriptSemanticPropertyKeys.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  isRuntimeJavaScriptClassProperty,
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  semanticArrayIndex,
  semanticPropertyPathKeyMatches,
  type JavaScriptSemanticPropertyPath as PropertyPath,
} from "./javascriptSemanticPropertyPaths.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  SemanticGetterQuery,
  type GetterQueryJob,
} from "./javascriptSemanticGetterQueries.js";
import { expandSemanticGetterResult } from "./javascriptSemanticGetterResultWalker.js";

import type { JavaScriptSemanticObjectReference } from "./javascriptSemanticObjectReference.js";

export type { JavaScriptSemanticObjectReference } from "./javascriptSemanticObjectReference.js";

export const semanticClassCandidates = (
  root: t.Node,
  state: JavaScriptSemanticAnalysisState,
): readonly (t.ClassDeclaration | t.ClassExpression)[] => {
  const pending: t.Node[] = [root];
  const seenNodes = new Set<t.Node>();
  const seenBindings = new Set<string>();
  const classes: (t.ClassDeclaration | t.ClassExpression)[] = [];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const node = pending[cursor];
    if (node === undefined) continue;
    const expression = unwrapJavaScriptExpression(node).node;
    if (seenNodes.has(expression)) continue;
    seenNodes.add(expression);
    if (t.isClass(expression)) {
      classes.push(expression);
    } else if (t.isIdentifier(expression)) {
      const binding = resolveSemanticBindingState(
        state,
        expression,
        expression.name,
      );
      if (binding === undefined || seenBindings.has(binding.bindingId))
        continue;
      seenBindings.add(binding.bindingId);
      for (const initializer of binding.initializers)
        pending.push(initializer.node);
    } else if (
      t.isConditionalExpression(expression) ||
      t.isLogicalExpression(expression)
    ) {
      pending.push(
        t.isConditionalExpression(expression)
          ? expression.consequent
          : expression.left,
        t.isConditionalExpression(expression)
          ? expression.alternate
          : expression.right,
      );
    } else if (t.isSequenceExpression(expression)) {
      const last = expression.expressions.at(-1);
      if (last !== undefined) pending.push(last);
    }
  }
  return classes;
};

const instanceFieldReferences = (
  root: t.ClassDeclaration | t.ClassExpression,
  propertyName: string | null,
  path: PropertyPath,
  state: JavaScriptSemanticAnalysisState,
  initializedBefore?: t.ClassProperty,
): {
  readonly references: readonly JavaScriptSemanticObjectReference[];
  readonly definiteNames: ReadonlySet<string>;
} => {
  const references: JavaScriptSemanticObjectReference[] = [];
  const pending = [{ klass: root, excluded: new Set<string>() }];
  const selections = new Map<t.Node, ReadonlySet<string>>();
  let definiteNames: ReadonlySet<string> | undefined;
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor];
    if (current === undefined) continue;
    const previous = selections.get(current.klass);
    // A shared base can be reached through different derived classes. Only
    // exclusions common to those paths can suppress a field in that base.
    const excluded =
      previous === undefined
        ? current.excluded
        : new Set([...previous].filter((name) => current.excluded.has(name)));
    if (previous !== undefined && previous.size === excluded.size) continue;
    selections.set(current.klass, excluded);
    const shadowed = new Set(excluded);
    const before =
      initializedBefore === undefined
        ? -1
        : current.klass.body.body.indexOf(initializedBefore);
    const members =
      before < 0
        ? current.klass.body.body
        : current.klass.body.body.slice(0, before);
    for (const member of [...members].reverse()) {
      if (!isRuntimeJavaScriptClassProperty(member) || member.static) continue;
      if (
        propertyName !== null &&
        member.computed &&
        semanticKnownSymbolKey(member.key, state)
      )
        continue;
      const key = semanticStaticPropertyKey(member.key, member.computed);
      if (key !== null && shadowed.has(key)) continue;
      if (key !== null) shadowed.add(key);
      if (
        (propertyName === null || key === null || key === propertyName) &&
        member.value != null
      )
        references.push({ node: member.value, path });
    }
    const bases =
      current.klass.superClass == null
        ? []
        : semanticClassCandidates(current.klass.superClass, state);
    if (bases.length === 0)
      definiteNames =
        definiteNames === undefined
          ? shadowed
          : new Set([...definiteNames].filter((name) => shadowed.has(name)));
    for (const klass of bases) pending.push({ klass, excluded: shadowed });
  }
  return { references, definiteNames: definiteNames ?? new Set() };
};

interface ClassPropertyLookup {
  readonly owner: t.ClassDeclaration | t.ClassExpression;
  readonly receiver?: t.ClassDeclaration | t.ClassExpression;
  readonly kind: "instance" | "static" | "prototype";
  readonly fieldsOnly?: true;
  readonly initializedBefore?: t.ClassProperty;
}

const classPropertyDescriptors = (
  klass: t.ClassDeclaration | t.ClassExpression,
  propertyName: string | null,
  kind: ClassPropertyLookup["kind"],
  state: JavaScriptSemanticAnalysisState,
  initializedBefore?: t.ClassProperty,
  accessor: "get" | "set" = "get",
) => {
  const isStatic = kind === "static";
  const selectedAccessors: t.ClassMethod[] = [];
  const fields: t.ClassProperty[] = [];
  const indexedMembers: {
    readonly member: t.ClassMethod | t.ClassProperty;
    readonly index: number;
    readonly key: string | null;
  }[] = [];
  const before =
    initializedBefore === undefined
      ? -1
      : klass.body.body.indexOf(initializedBefore);
  klass.body.body.forEach((member, index) => {
    if (
      (t.isClassMethod(member) || t.isClassProperty(member)) &&
      propertyName !== null &&
      member.computed &&
      semanticKnownSymbolKey(member.key, state)
    )
      return;
    if (
      before >= 0 &&
      index >= before &&
      isRuntimeJavaScriptClassProperty(member)
    )
      return;
    if (
      (t.isClassMethod(member) ||
        (kind === "static" && isRuntimeJavaScriptClassProperty(member))) &&
      member.static === isStatic
    )
      indexedMembers.push({
        member,
        index,
        key: semanticStaticPropertyKey(member.key, member.computed),
      });
  });
  const matchingMembers =
    propertyName === null
      ? []
      : indexedMembers.filter(({ key }) => key === propertyName);
  const uncertainAccessors = indexedMembers.filter(
    (entry): entry is typeof entry & { member: t.ClassMethod } => {
      const { member, key } = entry;
      return (
        t.isClassMethod(member) &&
        member.kind === accessor &&
        (propertyName === null || (member.computed && key === null))
      );
    },
  );
  const getters = matchingMembers.filter(
    (entry): entry is typeof entry & { member: t.ClassMethod } =>
      t.isClassMethod(entry.member) && entry.member.kind === accessor,
  );
  const getter = getters.at(-1);
  const getterIndex = getter?.index ?? -1;
  const laterDataMember = matchingMembers.some(
    ({ member, index }) =>
      t.isClassProperty(member) ||
      (t.isClassMethod(member) &&
        member.kind === "method" &&
        index > getterIndex),
  );
  const seenFields = new Set<string>();
  for (const { member, key } of [...indexedMembers].reverse()) {
    if (!t.isClassProperty(member)) continue;
    if (key !== null && seenFields.has(key)) continue;
    if (key !== null) seenFields.add(key);
    if (propertyName === null || key === null || key === propertyName)
      fields.push(member);
  }
  if (getters.length > 0 && !laterDataMember && getter !== undefined)
    selectedAccessors.push(getter.member);
  for (const { member, index } of uncertainAccessors)
    if (
      !matchingMembers.some(
        ({ member: matching, index: matchingIndex }) =>
          (t.isClassProperty(matching) ||
            (t.isClassMethod(matching) &&
              (matching.kind === "method" || matching.kind === accessor))) &&
          matchingIndex > index,
      )
    )
      selectedAccessors.push(member);
  return {
    accessors: selectedAccessors,
    fields,
    inherits: matchingMembers.length === 0,
  };
};

export const semanticClassPropertyReferences = (
  lookup: ClassPropertyLookup,
  selection: PropertyPath,
  state: JavaScriptSemanticAnalysisState,
): readonly JavaScriptSemanticObjectReference[] => {
  const query = new SemanticGetterQuery(state);
  return query.run(
    () => classPropertyReferences(lookup, selection, state, { query }),
    (job) => expandGetterResult(job, query),
  );
};

/** Class descriptor selection shares field shadowing and inheritance with reference lookup. */
export const semanticClassAccessorReferences = (
  lookup: ClassPropertyLookup,
  key: PropertyPath[number],
  state: JavaScriptSemanticAnalysisState,
  accessor: "get" | "set",
): readonly JavaScriptSemanticObjectReference[] =>
  new ClassReferenceWalk(lookup, [key], state, {
    query: new SemanticGetterQuery(state),
    accessor,
  }).run();

class ClassReferenceWalk {
  readonly #references: JavaScriptSemanticObjectReference[] = [];
  readonly #pending: (t.ClassDeclaration | t.ClassExpression)[];
  readonly #seen = new Set<t.Node>();
  readonly #name: string | null;
  readonly #path: PropertyPath;
  #fields: ReadonlySet<string> = new Set();

  constructor(
    readonly lookup: ClassPropertyLookup,
    selection: PropertyPath,
    readonly state: JavaScriptSemanticAnalysisState,
    readonly context: {
      readonly query: SemanticGetterQuery;
      readonly escapes?: boolean;
      readonly accessor?: "get" | "set";
    },
  ) {
    const [key, ...path] = selection;
    this.#name = key == null || typeof key === "object" ? null : String(key);
    this.#path = path;
    this.#pending = [lookup.owner];
  }

  #instanceFields(): boolean {
    if (this.lookup.kind !== "instance") return false;
    // Own fields, including inherited constructor fields, suppress prototype descriptors.
    const fields = instanceFieldReferences(
      this.lookup.owner,
      this.#name,
      this.#path,
      this.state,
      this.lookup.initializedBefore,
    );
    if (this.context.accessor === undefined)
      for (const reference of fields.references)
        this.#references.push(reference);
    this.#fields = fields.definiteNames;
    return this.#name !== null && this.#fields.has(this.#name);
  }

  #getter(
    klass: t.ClassDeclaration | t.ClassExpression,
    getter: t.ClassMethod,
  ): void {
    const key = semanticStaticPropertyKey(getter.key, getter.computed);
    if (key !== null && this.#fields.has(key)) return;
    if (this.context.accessor !== undefined) {
      this.#references.push({ node: getter, path: [] });
      return;
    }
    this.context.query.schedule(
      {
        getter,
        owner: klass,
        receiver: this.lookup.receiver ?? this.lookup.owner,
      },
      this.#path,
      this.context.escapes,
    );
  }

  #visit(klass: t.ClassDeclaration | t.ClassExpression): void {
    const descriptors = classPropertyDescriptors(
      klass,
      this.#name,
      this.lookup.kind,
      this.state,
      this.lookup.initializedBefore,
      this.context.accessor,
    );
    for (const field of this.context.accessor === undefined
      ? descriptors.fields
      : [])
      if (field.value != null)
        this.#references.push({ node: field.value, path: this.#path });
    for (const getter of this.lookup.fieldsOnly ? [] : descriptors.accessors)
      this.#getter(klass, getter);
    // Only a definite own descriptor can suppress possible superclass results.
    if (descriptors.inherits && klass.superClass != null)
      for (const base of semanticClassCandidates(klass.superClass, this.state))
        this.#pending.push(base);
  }

  run(): readonly JavaScriptSemanticObjectReference[] {
    if (this.#instanceFields()) return this.#references;
    for (let cursor = 0; cursor < this.#pending.length; cursor++) {
      const klass = this.#pending[cursor];
      if (klass === undefined || this.#seen.has(klass)) continue;
      this.#seen.add(klass);
      this.#visit(klass);
    }
    return this.#references;
  }
}

const classPropertyReferences = (
  lookup: ClassPropertyLookup,
  selection: PropertyPath,
  state: JavaScriptSemanticAnalysisState,
  context: { readonly query: SemanticGetterQuery; readonly escapes?: boolean },
): readonly JavaScriptSemanticObjectReference[] =>
  new ClassReferenceWalk(lookup, selection, state, context).run();

const objectReceiverReference = (
  object: t.ObjectExpression,
  path: PropertyPath,
  state: JavaScriptSemanticAnalysisState,
): readonly JavaScriptSemanticObjectReference[] => {
  // A literal's enclosing binding owns its slots. Returning the literal
  // itself would bypass invalidation of that binding's observed properties.
  let current: t.Node = object;
  const projection: PropertyPath[number][] = [];
  while (true) {
    const parent = state.parentsByNode.get(current);
    if (
      t.isVariableDeclarator(parent) &&
      parent.init === current &&
      t.isIdentifier(parent.id)
    )
      return [
        {
          node: parent.id,
          path: [...projection, ...path],
          ownerInitializer: current,
        },
      ];
    if (
      t.isAssignmentExpression(parent, { operator: "=" }) &&
      parent.right === current &&
      t.isIdentifier(parent.left)
    )
      return [
        {
          node: parent.left,
          path: [...projection, ...path],
          ownerInitializer: current,
        },
      ];
    if (t.isArrayExpression(parent)) {
      let minimumIndex = 0;
      let uncertainIndex = false;
      for (const element of parent.elements) {
        if (element === current) break;
        if (t.isSpreadElement(element)) uncertainIndex = true;
        else minimumIndex++;
      }
      // A spread contributes an unknown number of slots. Retain the known
      // prefix without treating the element's syntax position as its index.
      projection.unshift(
        uncertainIndex
          ? { excludedKeys: [], startIndex: minimumIndex }
          : minimumIndex,
      );
      current = parent;
      continue;
    }
    if (t.isObjectProperty(parent) && parent.value === current) {
      projection.unshift(
        semanticStaticPropertyKey(parent.key, parent.computed),
      );
      const container = state.parentsByNode.get(parent);
      if (t.isObjectExpression(container)) {
        current = container;
        continue;
      }
    }
    break;
  }
  return [{ node: object, path }];
};

// Getter return expressions use the receiver of the property read. Keep that
// identity when translating `this`, private fields, and superclass reads into
// the same reference paths used by ordinary member mutations.
/** Follow only data fields whose initializers retain a class receiver. */
const privateReceiverProjection = (
  receiver: t.ClassDeclaration | t.ClassExpression,
  owner: t.ClassDeclaration | t.ClassExpression,
  path: PropertyPath,
  isStatic: boolean,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  if (path.some((key) => key === null || typeof key === "object")) return false;
  type Selection = { readonly key: string; readonly before?: t.ClassProperty };
  const pending: {
    receiver: typeof receiver;
    path: readonly Selection[];
    visits: ReadonlyMap<string, number>;
  }[] = [
    {
      receiver,
      path: path.map((key) => ({ key: String(key) })),
      visits: new Map(),
    },
  ];
  const seen = new Set<string>();
  const declaringClass = (field: t.ClassProperty) => {
    const body = state.parentsByNode.get(field);
    return body === undefined ? undefined : state.parentsByNode.get(body);
  };
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const current = pending[cursor];
    if (current === undefined) break;
    const [selection, ...remaining] = current.path;
    if (selection === undefined) {
      if (!isStatic || current.receiver === owner) return true;
      continue;
    }
    const origin = JSON.stringify([
      current.receiver.start,
      selection.key,
      selection.before?.start,
    ]);
    const previous = current.visits.get(origin);
    // Repeated fields may consume a finite getter path. An initializer cycle
    // that preserves or grows it cannot establish another receiver identity.
    if (previous !== undefined && previous <= current.path.length) continue;
    const visits = new Map(current.visits).set(origin, current.path.length);
    const identity = JSON.stringify([
      current.receiver.start,
      current.path.map(({ key, before }) => [key, before?.start]),
    ]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const lookupOwner =
      selection.before === undefined
        ? current.receiver
        : declaringClass(selection.before);
    if (!t.isClass(lookupOwner)) continue;
    for (const reference of semanticClassPropertyReferences(
      {
        owner: lookupOwner,
        receiver: current.receiver,
        kind: isStatic ? "static" : "instance",
        fieldsOnly: true,
        ...(selection.before === undefined
          ? {}
          : { initializedBefore: selection.before }),
      },
      [selection.key],
      state,
    )) {
      const field = state.parentsByNode.get(reference.node);
      if (!t.isClassProperty(field)) continue;
      const fieldOwner = declaringClass(field);
      if (!t.isClass(fieldOwner)) continue;
      const projection: Selection[] = [];
      let value = unwrapJavaScriptExpression(reference.node).node;
      while (
        t.isMemberExpression(value) ||
        t.isOptionalMemberExpression(value)
      ) {
        const key = semanticStaticPropertyKey(value.property, value.computed);
        if (key === null || t.isPrivateName(value.property)) break;
        projection.unshift({ key, before: field });
        value = unwrapJavaScriptExpression(value.object).node;
      }
      if (!t.isThisExpression(value)) continue;
      // Instance fields retain the actual instance. Static field `this` belongs
      // to its declaring class, even when a subclass inherits the field.
      pending.push({
        receiver: isStatic ? fieldOwner : current.receiver,
        path: [...projection, ...remaining],
        visits,
      });
    }
  }
  return false;
};

const expandGetterResult = (
  job: GetterQueryJob,
  query: SemanticGetterQuery,
): void => {
  const state = query.state;
  expandSemanticGetterResult(job, query, {
    classReferences: (lookup, path, escapes) =>
      classPropertyReferences(lookup, path, state, { query, escapes }),
    objectReferences: (receiver, path) =>
      objectReceiverReference(receiver, path, state),
    privateReceiver: (receiver, owner, path, isStatic) =>
      privateReceiverProjection(receiver, owner, path, isStatic, state),
    bases: (node) => semanticClassCandidates(node, state),
  });
};

type ObjectLiteralMember = t.ObjectExpression["properties"][number];

/** Property positions grouped by whether an exact key can reach them. */
interface ObjectPropertyIndex {
  /** Spreads, computed keys and `__proto__` data entries reach every key. */
  readonly keyIndependent: readonly number[];
  readonly byName: ReadonlyMap<string, readonly number[]>;
}

// Mutation tracking resolves one key of the same literal per write, so the
// index removes the per-write scan of every property.
const propertyIndexes = new WeakMap<t.ObjectExpression, ObjectPropertyIndex>();

const objectPropertyIndex = (node: t.ObjectExpression): ObjectPropertyIndex => {
  const cached = propertyIndexes.get(node);
  if (cached !== undefined) return cached;
  const keyIndependent: number[] = [];
  const byName = new Map<string, number[]>();
  node.properties.forEach((property, index) => {
    const name = t.isSpreadElement(property)
      ? null
      : semanticStaticPropertyKey(property.key, property.computed);
    if (
      name === null ||
      (t.isObjectProperty(property) &&
        !property.computed &&
        !property.shorthand &&
        name === "__proto__")
    ) {
      keyIndependent.push(index);
      return;
    }
    const positions = byName.get(name);
    if (positions === undefined) byName.set(name, [index]);
    else positions.push(index);
  });
  const index = { keyIndependent, byName };
  propertyIndexes.set(node, index);
  return index;
};

/**
 * Properties in reverse source order that can affect `key`. For an exact key,
 * another static name only updates bookkeeping for that other name, which
 * this key never reads, so only same-name and key-independent entries remain.
 */
const relevantPropertiesInReverse = (
  node: t.ObjectExpression,
  key: PropertyPath[number] | undefined,
): readonly ObjectLiteralMember[] => {
  if (typeof key !== "string" && typeof key !== "number")
    return [...node.properties].reverse();
  const { keyIndependent, byName } = objectPropertyIndex(node);
  const named = byName.get(String(key)) ?? [];
  const relevant: ObjectLiteralMember[] = [];
  let left = keyIndependent.length - 1;
  let right = named.length - 1;
  while (left >= 0 || right >= 0) {
    const fromLeft =
      right < 0 ||
      (left >= 0 && (keyIndependent[left] ?? -1) > (named[right] ?? -1));
    const position = fromLeft ? keyIndependent[left--] : named[right--];
    const property =
      position === undefined ? undefined : node.properties[position];
    if (property !== undefined) relevant.push(property);
  }
  return relevant;
};

export const semanticObjectPropertyReferences = (
  node: t.ObjectExpression,
  path: PropertyPath,
  state: JavaScriptSemanticAnalysisState,
): readonly JavaScriptSemanticObjectReference[] => {
  const query = new SemanticGetterQuery(state);
  return query.run(
    () => objectPropertyReferences(node, path, query),
    (job) => expandGetterResult(job, query),
  );
};

/** Select accessor descriptors without invoking them or following their return values. */
export const semanticObjectAccessorReferences = (
  node: t.ObjectExpression,
  key: PropertyPath[number],
  state: JavaScriptSemanticAnalysisState,
  accessor: "get" | "set",
  lookup: "prototype" | "own" = "prototype",
): readonly JavaScriptSemanticObjectReference[] =>
  new ObjectReferenceWalk(
    node,
    [key],
    new SemanticGetterQuery(state),
    accessor,
    lookup,
  ).run();

class ObjectReferenceWalk {
  readonly #references: JavaScriptSemanticObjectReference[] = [];
  readonly #overwritten = new Set<string>();
  readonly #data = new Set<string>();
  readonly #accessors = new Set<string>();
  readonly #getters = new Set<string>();
  readonly #setters = new Set<string>();
  readonly #key: PropertyPath[number] | undefined;
  readonly #remaining: PropertyPath;

  constructor(
    readonly node: t.ObjectExpression,
    path: PropertyPath,
    readonly query: SemanticGetterQuery,
    readonly accessor?: "get" | "set",
    readonly accessorLookup: "prototype" | "own" = "prototype",
  ) {
    [this.#key, ...this.#remaining] = path;
  }

  #spreadKey(): PropertyPath[number] {
    const selected = this.#key ?? null;
    return typeof selected !== "object"
      ? selected
      : {
          ...selected,
          excludedKeys: [
            ...new Set([
              ...(selected?.excludedKeys ?? []),
              ...this.#overwritten,
            ]),
          ].sort(compareUnicodeCodePoints),
        };
  }

  #spread(property: t.SpreadElement): void {
    const selected = this.#key ?? null;
    if (typeof selected !== "object" && this.#overwritten.has(String(selected)))
      return;
    // Spread creates data properties; the source descriptor is not installed.
    if (this.accessor === undefined)
      this.#references.push({
        node: property.argument,
        path: [this.#spreadKey(), ...this.#remaining],
        capturedSelectionAt: property.argument,
        ownEnumerable: true,
      });
    if (
      selected !== null &&
      typeof selected !== "object" &&
      t.isObjectExpression(property.argument) &&
      objectExpressionDefinesKey(property.argument, String(selected))
    ) {
      this.#overwritten.add(String(selected));
      this.#data.add(String(selected));
    }
  }

  #prototype(
    property: t.ObjectMethod | t.ObjectProperty,
    name: string | null,
  ): boolean {
    if (
      !t.isObjectProperty(property) ||
      property.computed ||
      property.shorthand ||
      name !== "__proto__"
    )
      return false;
    const selected = this.#key ?? null;
    if (this.accessor !== undefined && this.accessorLookup === "own")
      return true;
    if (
      t.isExpression(property.value) &&
      (selected === null ||
        typeof selected === "object" ||
        (typeof selected === "string" &&
          !objectExpressionDefinesKey(this.node, selected)))
    )
      this.#references.push({
        node: property.value,
        path: [selected, ...this.#remaining],
        inherited: true,
      });
    return true;
  }

  #read(
    property: t.ObjectMethod | t.ObjectProperty,
    name: string | null,
  ): void {
    // An earlier unknown computed key cannot replace a later definite slot.
    // Spreads obey the same overwrite proof; paired named accessors below
    // retain their separate getter/setter semantics.
    if (
      name === null &&
      this.#key != null &&
      typeof this.#key !== "object" &&
      (t.isObjectMethod(property) && property.kind === (this.accessor ?? "get")
        ? this.#data.has(String(this.#key)) ||
          (this.accessor === "set" ? this.#setters : this.#getters).has(
            String(this.#key),
          )
        : this.#overwritten.has(String(this.#key)))
    )
      return;
    if (
      name !== null &&
      !semanticPropertyPathKeyMatches(this.#key ?? null, name)
    )
      return;
    if (this.accessor !== undefined) {
      if (t.isObjectMethod(property) && property.kind === this.accessor)
        this.#references.push({ node: property, path: [] });
      return;
    }
    if (t.isObjectMethod(property)) {
      if (property.kind === "get")
        this.query.schedule(
          { getter: property, owner: this.node },
          this.#remaining,
        );
      // A paired getter remains readable even when its setter appears later.
      if (property.kind === "get" || property.kind === "set") return;
    }
    this.#references.push({
      node: t.isObjectProperty(property) ? property.value : property,
      path: this.#remaining,
    });
  }

  #record(name: string, kind: "get" | "set" | "data"): void {
    this.#overwritten.add(name);
    if (kind === "data") this.#data.add(name);
    else {
      this.#accessors.add(name);
      (kind === "get" ? this.#getters : this.#setters).add(name);
    }
  }

  #visit(property: ObjectLiteralMember): void {
    if (t.isSpreadElement(property)) {
      this.#spread(property);
      return;
    }
    if (
      property.computed &&
      this.#key !== undefined &&
      this.#key !== null &&
      typeof this.#key !== "object" &&
      semanticKnownSymbolKey(property.key, this.query.state)
    )
      return;
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (this.#prototype(property, name)) return;
    const kind =
      t.isObjectMethod(property) && property.kind !== "method"
        ? property.kind
        : "data";
    if (
      name !== null &&
      (kind === "data"
        ? this.#data.has(name) || this.#accessors.has(name)
        : this.#data.has(name) ||
          (kind === "get" ? this.#getters : this.#setters).has(name))
    )
      return;
    this.#read(property, name);
    if (name !== null) this.#record(name, kind);
  }

  run(): readonly JavaScriptSemanticObjectReference[] {
    for (const property of relevantPropertiesInReverse(this.node, this.#key))
      this.#visit(property);
    return this.#references;
  }
}

const objectPropertyReferences = (
  node: t.ObjectExpression,
  path: PropertyPath,
  query: SemanticGetterQuery,
): readonly JavaScriptSemanticObjectReference[] =>
  new ObjectReferenceWalk(node, path, query).run();

const objectExpressionDefinesKey = (
  root: t.ObjectExpression,
  key: string,
): boolean => {
  const pending: t.ObjectExpression[] = [root];
  const seen = new Set<t.ObjectExpression>();
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const object = pending[cursor];
    if (object === undefined || seen.has(object)) continue;
    seen.add(object);
    for (const property of object.properties) {
      if (t.isSpreadElement(property)) {
        if (t.isObjectExpression(property.argument))
          pending.push(property.argument);
        continue;
      }
      const name = semanticStaticPropertyKey(property.key, property.computed);
      if (
        name === key &&
        !(
          t.isObjectProperty(property) &&
          !property.computed &&
          !property.shorthand &&
          name === "__proto__"
        )
      )
        return true;
    }
  }
  return false;
};

export const semanticArrayPropertyReferences = (
  node: t.ArrayExpression,
  path: PropertyPath,
): readonly JavaScriptSemanticObjectReference[] => {
  const [key, ...remaining] = path;
  const selected = key ?? null;
  const selectedIndex =
    typeof selected === "object" ? null : semanticArrayIndex(selected);
  if (typeof selected !== "object" && selectedIndex === null) return [];
  const references: JavaScriptSemanticObjectReference[] = [];
  let minimumIndex = 0;
  let uncertainIndex = false;
  for (const element of node.elements) {
    if (t.isSpreadElement(element)) {
      if (selectedIndex === null || selectedIndex >= minimumIndex) {
        let sourceKey: PropertyPath[number] = null;
        if (!uncertainIndex) {
          if (selectedIndex !== null) sourceKey = selectedIndex - minimumIndex;
          else if (selected !== null && typeof selected === "object")
            sourceKey = {
              excludedKeys: selected.excludedKeys.flatMap((name) => {
                const index = semanticArrayIndex(name);
                return index === null || index < minimumIndex
                  ? []
                  : [String(index - minimumIndex)];
              }),
              startIndex: Math.max(
                0,
                (selected.startIndex ?? 0) - minimumIndex,
              ),
            };
        }
        references.push({
          node: element.argument,
          path: [sourceKey, ...remaining],
          capturedSelectionAt: element.argument,
          iterableFallbackPath: [],
        });
      }
      uncertainIndex = true;
      continue;
    }
    if (
      element !== null &&
      (uncertainIndex
        ? selectedIndex === null || selectedIndex >= minimumIndex
        : semanticPropertyPathKeyMatches(selected, String(minimumIndex)))
    )
      references.push({ node: element, path: remaining });
    minimumIndex++;
  }
  return references;
};
