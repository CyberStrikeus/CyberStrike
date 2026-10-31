import { plistUidValue } from "./plistUid.js";
import { z } from "zod";

import { jsonObjectSchema, jsonValueSchema } from "../jsonValue.js";

const objectNode = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    "view_controller",
    "view",
    "control",
    "constraint",
    "layout_guide",
    "resource",
    "placeholder",
    "external_object",
    "other",
  ]),
  class_name: z.string().nullable(),
  name: z.string().min(1),
  attributes: jsonObjectSchema,
});

const connection = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["outlet", "action", "segue", "other"]),
  source_id: z.string().min(1),
  destination_id: z.string().nullable(),
  label: z.string().nullable(),
  attributes: jsonObjectSchema,
});

type InterfaceBuilderObject = z.infer<typeof objectNode>;
type InterfaceBuilderConnection = z.infer<typeof connection>;

const APPKIT_SINGLE_OBJECT_ANNOTATION_CONNECTORS = new Set([
  "NSIBHelpConnector",
  "NSNibAXAttributeConnector",
  "NSIBUserDefinedRuntimeAttributesConnector",
]);

/** UIKit runtime connection classes store their endpoints and labels under UI-prefixed keys. */
export const isUIKitRuntimeConnectionClass = (className: string): boolean =>
  /^UIRuntime\w*Connection$/u.test(className);

/** AppKit NIB connector classes and UIKit runtime connection records. */
export const isInterfaceBuilderConnectionClass = (className: string): boolean =>
  isUIKitRuntimeConnectionClass(className) ||
  // Keep unfamiliar AppKit connector records so projection can report their
  // missing owner as unresolved instead of silently dropping their identity.
  (className.startsWith("NS") && className.endsWith("Connector"));

/** These AppKit records annotate one object and only mean a connection if a source key is encoded. */
export const isSourceLessAppKitAnnotationConnector = (
  className: string,
  values: Readonly<Record<string, unknown>>,
): boolean =>
  APPKIT_SINGLE_OBJECT_ANNOTATION_CONNECTORS.has(className) &&
  !Object.hasOwn(values, "NSSource");

/** The connection class selects the source archive field namespace. */
export const interfaceBuilderConnectionFieldNames = (className: string) =>
  isUIKitRuntimeConnectionClass(className)
    ? { source: "UISource", destination: "UIDestination", label: "UILabel" }
    : { source: "NSSource", destination: "NSDestination", label: "NSLabel" };

/** Only Interface Builder's known placeholder records establish an authored class override. */
export const interfaceBuilderRuntimeClassName = (
  archivedClass: string | null,
  authoredName: (field: string) => string | null,
): string | null => {
  switch (archivedClass) {
    case "NSClassSwapper":
    case "NSCustomObject":
    case "NSCustomResource":
      return authoredName("NSClassName") ?? archivedClass;
    case "UIClassSwapper":
      return authoredName("UIClassName") ?? archivedClass;
    default:
      return archivedClass;
  }
};

/** A decoded plist is not an Interface Builder document merely because it is named .nib. */
export const requireInterfaceBuilderArchive = (value: unknown): void => {
  const root = record(value);
  if (root.$archiver === "NSKeyedArchiver" && Array.isArray(root.$objects))
    return;
  if (
    ["objects", "connections", "hierarchy", "classes"].some((facet) =>
      Object.hasOwn(root, `com.apple.ibtool.document.${facet}`),
    )
  )
    return;
  throw new TypeError(
    "Property list is not a recognized Interface Builder archive",
  );
};

/** Parse ibtool dictionaries or compiled keyed archives into typed records. */
export const parseInterfaceBuilderRecords = (
  value: unknown,
): {
  readonly objects: readonly InterfaceBuilderObject[];
  readonly connections: readonly InterfaceBuilderConnection[];
  readonly hierarchy: readonly unknown[];
  readonly classes: Readonly<Record<string, unknown>>;
  readonly objectCount: number;
  readonly omittedObjects: number;
  readonly omittedConnections: number;
  readonly unresolvedConnections: number;
  readonly omittedHierarchyReferences: number;
} => {
  requireInterfaceBuilderArchive(value);
  const root = record(value);
  const keyed = parseKeyedArchive(root);
  if (keyed !== null) return keyed;
  const objectsRaw = record(root["com.apple.ibtool.document.objects"]);
  const connectionsRaw = record(root["com.apple.ibtool.document.connections"]);
  const hierarchyRaw = root["com.apple.ibtool.document.hierarchy"];
  const classesRaw = record(root["com.apple.ibtool.document.classes"]);
  const objects: InterfaceBuilderObject[] = [];
  const connections: InterfaceBuilderConnection[] = [];
  let omittedConnections = 0;
  const objectEntries = Object.entries(objectsRaw);
  for (const [id, raw] of objectEntries.slice(0, 20_000)) {
    const attributes = record(raw);
    const className = firstString(
      attributes["customClass"],
      attributes["class"],
      attributes["isa"],
    );
    const label = firstString(
      attributes["label"],
      attributes["title"],
      attributes["name"],
      className,
    );
    // class_name, name, and id already carry these values; repeating them in
    // attributes doubled them on every graph node.
    const carried = new Set<string>();
    if (attributes["customClass"] === className) carried.add("customClass");
    if (attributes["label"] === label) carried.add("label");
    if (attributes["objectID"] === id) carried.add("objectID");
    objects.push(
      objectNode.parse({
        id,
        kind: classifyObject(className),
        class_name: className,
        name: label ?? id,
        attributes: jsonSafeRecord(
          Object.fromEntries(
            Object.entries(attributes).filter(([key]) => !carried.has(key)),
          ),
        ),
      }),
    );
  }
  for (const [sourceId, rawConnections] of Object.entries(connectionsRaw)) {
    if (!Array.isArray(rawConnections)) continue;
    for (const [index, raw] of rawConnections.entries()) {
      if (connections.length >= 40_000) {
        omittedConnections += rawConnections.length - index;
        break;
      }
      const item = record(raw);
      const type = firstString(item.type, item.connectionType) ?? "unknown";
      const destination = firstString(
        item["destination-id"],
        item.destinationId,
      );
      const label = firstString(item.label, item.selector, item.identifier);
      connections.push(
        connection.parse({
          id: `${sourceId}:connection:${index}`,
          kind: classifyConnection(type),
          source_id: sourceId,
          destination_id: destination,
          label,
          attributes: jsonSafeRecord(item),
        }),
      );
    }
  }
  return {
    objects,
    connections,
    hierarchy: Array.isArray(hierarchyRaw) ? hierarchyRaw : [],
    classes: classesRaw,
    objectCount: objectEntries.length,
    omittedObjects: Math.max(0, objectEntries.length - 20_000),
    omittedConnections,
    unresolvedConnections: 0,
    omittedHierarchyReferences: 0,
  };
};

/** Archive references retain their binary marker identity through plist projection. */
const archiveUid = (value: unknown): number | undefined => {
  const uid = plistUidValue(value);
  return uid !== undefined && Number.isInteger(uid) ? uid : undefined;
};

const HIERARCHY_KEY =
  /(?:subviews|contentview|childviewcontrollers|children|views)$/iu;

/**
 * Read an NSKeyedArchiver object table without expanding it into a tree.
 * Archived objects reference each other freely, including cycles such as a
 * view and its superview, so inlining every reference grows exponentially.
 * A reference instead resolves to the referenced string, or to a stub that
 * names the referenced object; the hierarchy walk visits each object once.
 */
const keyedArchiveTable = (objectTable: readonly unknown[]) => {
  type ClassFacts = {
    readonly name: string | null;
    readonly rawSuperclasses: unknown[];
    readonly superclasses: readonly string[];
  };
  const classFactsByUid = new Map<number, ClassFacts>();
  const parseClassFacts = (value: unknown): ClassFacts | null => {
    const descriptor = record(value);
    const rawSuperclasses = Array.isArray(descriptor.$classes)
      ? descriptor.$classes
      : [];
    if (
      !Object.hasOwn(descriptor, "$classname") &&
      rawSuperclasses.length === 0
    )
      return null;
    return {
      name: firstString(descriptor.$classname),
      rawSuperclasses,
      superclasses: rawSuperclasses.filter(
        (name): name is string => typeof name === "string",
      ),
    };
  };
  const classFactsForUid = (uid: number): ClassFacts | null => {
    const cached = classFactsByUid.get(uid);
    if (cached !== undefined) return cached;
    if (!Number.isInteger(uid) || uid < 0 || uid >= objectTable.length)
      return null;
    const facts = parseClassFacts(objectTable[uid]);
    if (facts !== null) classFactsByUid.set(uid, facts);
    return facts;
  };
  const classFactsOfReference = (reference: unknown): ClassFacts | null => {
    const uid = archiveUid(reference);
    return uid === undefined
      ? parseClassFacts(reference)
      : classFactsForUid(uid);
  };
  const classFactsOfObject = (value: unknown) =>
    classFactsOfReference(record(value).$class);
  const classNameOf = (value: unknown): string | null =>
    classFactsOfObject(value)?.name ?? null;
  const hasClassSuperclass = (value: unknown, superclass: string): boolean =>
    classFactsOfObject(value)?.superclasses.includes(superclass) ?? false;
  /** The class and superclass names an object's descriptor declares in `$classes`. */
  const classChainOf = (value: unknown): readonly string[] =>
    classFactsOfObject(value)?.superclasses ?? [];
  /** The string an archived string object holds, if it is one. */
  const archivedString = (target: unknown): string | undefined => {
    if (typeof target === "string") return target;
    const text = record(target)["NS.string"];
    return typeof text === "string" &&
      /^NS(?:Mutable)?String$/u.test(classNameOf(target) ?? "")
      ? text
      : undefined;
  };
  /** Only an encoded UID proves which archived object a connector names. */
  const objectReference = (...values: unknown[]): string | null => {
    for (const value of values) {
      const uid = archiveUid(value);
      if (
        uid !== undefined &&
        uid !== 0 &&
        Object.hasOwn(record(objectTable[uid]), "$class")
      )
        return String(uid);
    }
    return null;
  };
  const reference = (uid: number): unknown => {
    // UID 0 is the archived nil.
    const target = uid === 0 ? null : objectTable[uid];
    if (target === undefined || target === null) return null;
    if (typeof target !== "object") return target;
    const string = archivedString(target);
    if (string !== undefined) return string;
    return {
      archiveUID: uid,
      className: classNameOf(target),
    };
  };
  /** Resolve one object's own fields, leaving references to other objects as stubs. */
  const resolve = (value: unknown): unknown => {
    const uid = archiveUid(value);
    if (uid !== undefined) return reference(uid);
    if (Array.isArray(value)) return value.map(resolve);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) => {
        // `$class` describes the archived object's type. Keep that derived fact
        // outside its serialized fields so an authored `className` key remains
        // ordinary application data.
        return key === "$class" ? [] : [[key, resolve(child)]];
      }),
    );
  };
  const hierarchy = (start: unknown) => {
    let omittedReferences = 0;
    const visited = new Set<number>();
    const root: unknown[] = [];
    const pending: { readonly value: unknown; readonly output: unknown[] }[] = [
      { value: start, output: root },
    ];
    const appendNode = (
      item: Record<string, unknown>,
      uid: number,
      output: unknown[],
    ): void => {
      const children: unknown[] = [];
      output.push({ objectID: String(uid), children });
      for (const [key, child] of Object.entries(item).reverse())
        if (HIERARCHY_KEY.test(key))
          pending.push({ value: child, output: children });
    };
    while (pending.length > 0) {
      const entry = pending.pop();
      if (entry === undefined) break;
      const { value, output } = entry;
      const uid = archiveUid(value);
      if (uid !== undefined) {
        // UID0 is archived nil, not a missing hierarchy object.
        if (uid === 0) continue;
        const target = objectTable[uid];
        if (target === undefined) {
          omittedReferences += 1;
          continue;
        }
        if (visited.has(uid)) continue;
        visited.add(uid);
        if (Array.isArray(target)) {
          for (let index = target.length - 1; index >= 0; index -= 1) {
            const child = target[index];
            if (child !== undefined) pending.push({ value: child, output });
          }
          continue;
        }
        if (typeof target !== "object" || target === null) continue;
        const item = record(target);
        if (archivedArrayClass(item.$class)) {
          const members = item["NS.objects"];
          if (Array.isArray(members))
            for (let index = members.length - 1; index >= 0; index -= 1) {
              const child = members[index];
              if (child !== undefined) pending.push({ value: child, output });
            }
          continue;
        }
        appendNode(item, uid, output);
        continue;
      }
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          const child = value[index];
          if (child !== undefined) pending.push({ value: child, output });
        }
      } else if (typeof value === "object" && value !== null) {
        // Inline dictionaries have no object-table identity. Preserve any
        // independently referenced children without inventing a parent ID.
        omittedReferences += 1;
        for (const [key, child] of Object.entries(value).reverse())
          if (HIERARCHY_KEY.test(key)) pending.push({ value: child, output });
      }
    }
    return { items: root, omittedReferences };
  };
  const archivedArrayClass = (classReference: unknown): boolean => {
    const superclasses =
      classFactsOfReference(classReference)?.superclasses ?? [];
    return (
      superclasses.includes("NSArray") ||
      superclasses.includes("NSMutableArray")
    );
  };
  const classTable = () =>
    Object.fromEntries(
      objectTable.flatMap((_, uid) => {
        const facts = classFactsForUid(uid);
        return facts === null || facts.name === null
          ? []
          : [[facts.name, { superclasses: facts.rawSuperclasses }]];
      }),
    );
  return {
    resolve,
    hierarchy,
    classNameOf,
    hasClassSuperclass,
    classChainOf,
    classTable,
    objectReference,
  };
};

/** Project class and connection objects from an NSKeyedArchiver object table. */
const parseKeyedArchive = (
  root: Record<string, unknown>,
): ReturnType<typeof parseInterfaceBuilderRecords> | null => {
  if (root.$archiver !== "NSKeyedArchiver" || !Array.isArray(root.$objects))
    return null;
  const objectTable: readonly unknown[] = root.$objects;
  const {
    resolve,
    hierarchy: toHierarchy,
    classNameOf,
    hasClassSuperclass,
    classChainOf,
    classTable,
    objectReference,
  } = keyedArchiveTable(objectTable);
  const objects: InterfaceBuilderObject[] = [];
  const connections: InterfaceBuilderConnection[] = [];
  let objectCount = 0;
  let omittedConnections = 0;
  let unresolvedConnections = 0;
  for (const [index, raw] of objectTable.entries()) {
    if (index === 0) continue;
    const resolved = record(resolve(raw));
    const archivedClassName = classNameOf(raw);
    // An archived object names its class with its own `$class` reference;
    // when that reference cannot be resolved the object is still observed,
    // with an unknown class. Scalars and class descriptors are not objects.
    if (archivedClassName === null && !Object.hasOwn(record(raw), "$class"))
      continue;
    objectCount += 1;
    const fields = { ...resolved };
    const className = interfaceBuilderRuntimeClassName(
      archivedClassName,
      (field) => firstString(fields[field]),
    );
    if (className !== archivedClassName)
      fields.interface_builder_archived_class_name = archivedClassName;
    // Keep the unresolvable class reference itself, e.g. a dangling UID.
    if (className === null) fields.$class = record(raw).$class;
    // Authored objectID, object-id, id and archiveUID fields are data. Only
    // the original table position identifies an archived object.
    const objectId = String(index);
    const kind = classifyObject(className, classChainOf(raw));
    if (objects.length < 20_000)
      objects.push(
        objectNode.parse({
          id: objectId,
          kind,
          class_name: className,
          name:
            firstString(
              fields.label,
              fields.title,
              fields.identifier,
              fields.accessibilityLabel,
              className,
            ) ?? `object ${String(index)}`,
          attributes: jsonSafeRecord(fields),
        }),
      );
    if (
      className !== null &&
      (isInterfaceBuilderConnectionClass(className) ||
        hasClassSuperclass(raw, "NSNibConnector"))
    ) {
      const controlAction = /ControlConnector/iu.test(className);
      const uiKit = isUIKitRuntimeConnectionClass(className);
      // AppKit and UIKit archive the same endpoint roles under their own
      // class-specific field namespaces; the source is the outlet owner.
      const connectionFields = interfaceBuilderConnectionFieldNames(className);
      if (isSourceLessAppKitAnnotationConnector(className, fields)) continue;
      const rawFields = record(raw);
      const source = uiKit
        ? objectReference(rawFields[connectionFields.source])
        : objectReference(
            controlAction ? rawFields.destination : rawFields.source,
            rawFields[connectionFields.source],
            controlAction ? rawFields.to : rawFields.from,
            controlAction ? rawFields.target : rawFields.owner,
          );
      if (source === null) {
        // A recognized connector that cannot name its owner is an unresolved
        // connection, not an absent one, and cannot be represented as a
        // connection because connection identity requires a source.
        unresolvedConnections += 1;
        continue;
      }
      const kind = controlAction ? "action" : classifyConnection(className);
      const parsedConnection = connection.parse({
        id: `archive:${objectId}`,
        kind,
        source_id: source,
        destination_id: uiKit
          ? objectReference(rawFields[connectionFields.destination])
          : objectReference(
              controlAction ? rawFields.source : rawFields.destination,
              rawFields[connectionFields.destination],
              controlAction ? rawFields.from : rawFields.to,
              controlAction ? rawFields.owner : rawFields.target,
            ),
        label: uiKit
          ? firstString(fields[connectionFields.label])
          : firstString(
              fields.label,
              fields[connectionFields.label],
              fields.selector,
              fields.identifier,
              fields.action,
            ),
        attributes: jsonSafeRecord(fields),
      });
      if (connections.length < 40_000) connections.push(parsedConnection);
      else omittedConnections += 1;
    }
  }
  const top = record(root.$top);
  // UIKit names its top-level collection explicitly. A present but undecoded
  // named root must not be replaced by an unrelated generic root alias.
  const hierarchy = toHierarchy(
    Object.hasOwn(top, "UINibTopLevelObjectsKey")
      ? top.UINibTopLevelObjectsKey
      : top.root,
  );
  const classes = classTable();
  return {
    objects,
    connections,
    hierarchy: hierarchy.items,
    classes,
    objectCount,
    omittedObjects: Math.max(0, objectCount - 20_000),
    omittedConnections,
    unresolvedConnections,
    omittedHierarchyReferences: hierarchy.omittedReferences,
  };
};

/** Borrow decoded dictionaries without copying away keys or UID source identity. */
export const record = (value: unknown): Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null)
    ? (value as Record<string, unknown>)
    : {};

/** First non-empty string among the candidates, otherwise null. */
export const firstString = (...values: unknown[]): string | null => {
  for (const value of values)
    if (typeof value === "string" && value.length > 0) return value;
  return null;
};

/**
 * Framework base classes whose presence in an archived `$classes` chain settles
 * an object's kind, most specific first: UIControl and NSControl are views.
 */
const archivedKindBases: readonly (readonly [
  InterfaceBuilderObject["kind"],
  readonly string[],
])[] = [
  [
    "view_controller",
    ["UIViewController", "NSViewController", "NSWindowController"],
  ],
  ["control", ["UIControl", "NSControl"]],
  ["view", ["UIView", "NSView", "UIWindow", "NSWindow"]],
];

/**
 * Classify an object by its declared superclass chain when the archive records
 * one, otherwise by its class name alone. Names are only a heuristic:
 * `UINavigationController` names no view controller and contains "control".
 */
const classifyObject = (
  className: string | null,
  classChain: readonly string[] = [],
): InterfaceBuilderObject["kind"] => {
  if (
    isInterfaceBuilderConnectionClass(className ?? "") ||
    classChain.includes("NSNibConnector")
  )
    return "other";
  for (const [kind, bases] of archivedKindBases)
    if (bases.some((base) => classChain.includes(base))) return kind;
  const value = className?.toLowerCase() ?? "";
  if (value.includes("constraint")) return "constraint";
  if (value.includes("layoutguide")) return "layout_guide";
  if (
    value.includes("placeholder") ||
    value.includes("firstresponder") ||
    value === "uiproxyobject"
  )
    return "placeholder";
  if (value.includes("external")) return "external_object";
  if (value.includes("viewcontroller") || value.includes("windowcontroller"))
    return "view_controller";
  if (
    value.includes("button") ||
    value.includes("control") ||
    value.includes("textfield") ||
    value.includes("slider") ||
    value.includes("menuitem") ||
    value.includes("colorwell")
  )
    return "control";
  if (
    value.includes("view") ||
    value.includes("window") ||
    value.includes("cell")
  )
    return "view";
  if (
    value.includes("image") ||
    value.includes("color") ||
    value.includes("font")
  )
    return "resource";
  return "other";
};

const classifyConnection = (
  type: string,
): InterfaceBuilderConnection["kind"] => {
  const value = type.toLowerCase();
  if (value.includes("outlet")) return "outlet";
  if (value.includes("action") || value.includes("eventconnection"))
    return "action";
  if (value.includes("segue")) return "segue";
  return "other";
};

const jsonSafeRecord = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      try {
        const serialized = JSON.stringify(item);
        if (serialized === undefined) return [];
        const parsed = jsonValueSchema.safeParse(JSON.parse(serialized));
        return parsed.success ? [[key, parsed.data]] : [];
      } catch (cause: unknown) {
        // Unserializable entries are omitted from the record.
        void cause;
        return [];
      }
    }),
  );
