import { nibCollectionMembers, type NibArchiveDocument } from "./NibArchive.js";
import type { JsonValue } from "../../domain/jsonValue.js";

export type NibHierarchyNode = {
  objectID: string;
  children: NibHierarchyNode[];
};

const childCollections = new Set([
  "subviews",
  "NSSubviews",
  "UISubviews",
  "childViewControllers",
  "NSChildViewControllers",
  "UIChildViewControllers",
]);
const childReferences = new Set([
  "view",
  "NSView",
  "UIView",
  "contentView",
  "NSContentView",
  "UIContentView",
]);

// These exact AppKit classes derive from NSCell, not NSView. Do not infer
// custom class semantics from a suffix: their inheritance is not in the NIB.
const nonViewCellClasses = new Set([
  "NSCell",
  "NSActionCell",
  "NSButtonCell",
  "NSComboBoxCell",
  "NSDatePickerCell",
  "NSFormCell",
  "NSLevelIndicatorCell",
  "NSMenuItemCell",
  "NSPathCell",
  "NSPathComponentCell",
  "NSPopUpButtonCell",
  "NSSearchFieldCell",
  "NSSecureTextFieldCell",
  "NSSegmentedCell",
  "NSSliderCell",
  "NSStepperCell",
  "NSTableHeaderCell",
  "NSTextFieldCell",
  "NSTokenFieldCell",
]);
const isNonViewCell = (
  object: NibArchiveDocument["objects"][number] | undefined,
) =>
  object !== undefined &&
  nonViewCellClasses.has(object.class_name.replace(/\0+$/u, ""));

/** Interpret serialized relationships once, before bounded forest materialization. */
export const projectNibViewHierarchy = (
  objects: NibArchiveDocument["objects"],
  retainedIds: ReadonlySet<number>,
  reserveNode: () => boolean = () => true,
  maxNodes = 20_000,
  reportUnknownRegistry: (description: string) => void = () => {},
) => {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const parents = new Map<number, number | null>();
  const involved = new Set<number>();
  const registryUnknown = new Set<number>();
  let invalid = 0;
  let ownerWithoutRegistry = false;
  const addParent = (child: number, parent: number) => {
    if (retainedIds.has(parent)) involved.add(parent);
    if (!retainedIds.has(child)) {
      invalid += 1;
      return;
    }
    involved.add(child);
    const previous = parents.get(child);
    // A disagreement invalidates placement; archive order is not authority.
    parents.set(
      child,
      previous === undefined || previous === parent ? parent : null,
    );
  };
  const fieldValues = (
    object: NibArchiveDocument["objects"][number],
    key: string,
  ) =>
    object.repeated_values?.[key] ??
    (Object.hasOwn(object.values, key) ? [object.values[key]!] : []);
  const addReference = (value: JsonValue, parent: number) => {
    if (value === null) return;
    const child = reference(value);
    if (child === null) invalid += 1;
    else addParent(child, parent);
  };
  for (const object of objects) {
    if (!retainedIds.has(object.id)) continue;
    for (const value of fieldValues(object, "NSSuperview")) {
      if (value === null) continue;
      const parent = reference(value);
      if (parent === null) invalid += 1;
      else addParent(object.id, parent);
    }
    const keys = new Set([
      ...Object.keys(object.values),
      ...Object.keys(object.repeated_values ?? {}),
    ]);
    for (const key of keys) {
      if (childCollections.has(key)) {
        for (const value of fieldValues(object, key)) {
          if (value === null) continue;
          const collection = reference(value);
          const members = nibCollectionMembers(
            collection === null ? undefined : byId.get(collection),
          );
          if (members === undefined) invalid += 1;
          else {
            involved.add(object.id);
            for (const member of members) addReference(member, object.id);
          }
        }
      } else if (
        childReferences.has(key) ||
        (key === "NSWindowView" &&
          object.class_name.replace(/\0+$/u, "") === "NSWindowTemplate")
      ) {
        for (const value of fieldValues(object, key))
          addReference(value, object.id);
      } else if (
        !["NSSuperview", "NSNextKeyView", "NSPreviousKeyView"].includes(key) &&
        !(key === "NSControlView" && isNonViewCell(object)) &&
        /(?:subviews|contentview|childviewcontrollers|view)$/iu.test(key)
      ) {
        // Preserve formerly admitted fields as raw facts without inventing semantics.
        invalid += 1;
      }
    }
  }
  for (const object of objects) {
    if (object.class_name.replace(/\0+$/u, "") !== "NSIBObjectData") continue;
    const registryFields = ["NSRoot", "NSObjectsKeys", "NSObjectsValues"];
    const ambiguous = registryFields.filter(
      (key) => fieldValues(object, key).length > 1,
    );
    if (ambiguous.length > 0) {
      invalid += 1;
      reportUnknownRegistry(
        `NSIBObjectData object ${object.id} has repeated ${ambiguous.join(", ")} declarations; registry hierarchy interpretation remains unknown.`,
      );
      continue;
    }
    const rootValue = fieldValues(object, "NSRoot")[0];
    const keysValue = fieldValues(object, "NSObjectsKeys")[0];
    const valuesValue = fieldValues(object, "NSObjectsValues")[0];
    const ownerReference = reference(rootValue);
    const owner =
      ownerReference !== null && byId.has(ownerReference)
        ? ownerReference
        : null;
    if (rootValue !== undefined && rootValue !== null && owner === null)
      invalid += 1;
    const keysRef = reference(keysValue);
    const valuesRef = reference(valuesValue);
    if (keysValue === undefined && valuesValue === undefined) {
      if (rootValue !== undefined) ownerWithoutRegistry = true;
      continue;
    }
    const keys = nibCollectionMembers(
      keysRef === null ? undefined : byId.get(keysRef),
    );
    const values = nibCollectionMembers(
      valuesRef === null ? undefined : byId.get(valuesRef),
    );
    if (
      keys === undefined ||
      values === undefined ||
      keys.length !== values.length
    ) {
      invalid += 1;
      continue;
    }
    for (let index = 0; index < keys.length; index += 1) {
      const child = reference(keys[index]);
      const parent = reference(values[index]);
      if (child === null || parent === null) {
        invalid += 1;
        continue;
      }
      if (!retainedIds.has(child) || isNonViewCell(byId.get(child))) continue;
      involved.add(child);
      // The registry identifies top-level membership through the owner.
      // Other registry associations alone do not establish view parentage.
      if (owner !== null && parent === owner) {
        if (parents.has(child)) parents.set(child, null);
      } else {
        registryUnknown.add(child);
        if (!parents.has(child))
          reportUnknownRegistry(
            `NSIBObjectData object ${object.id}: NSObjectsKeys/NSObjectsValues pair child ${child} with registry value ${parent}; NSRoot is ${ownerReference === null ? "unresolved" : owner === null ? `${ownerReference} (unresolved)` : owner}. This decoded registry association does not establish visual parentage.`,
          );
      }
    }
  }
  if (ownerWithoutRegistry) invalid += 1;
  for (const child of registryUnknown)
    if (!parents.has(child)) parents.set(child, null);
  const children = new Map<number, number[]>();
  for (const [child, parent] of parents) {
    if (parent === null || !retainedIds.has(parent)) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(child);
    children.set(parent, siblings);
  }
  if (involved.size === 0)
    return {
      hierarchy: null,
      omitted: invalid,
    };
  const roots: NibHierarchyNode[] = [];
  const pending: { id: number; depth: number; output: NibHierarchyNode[] }[] =
    [];
  for (const id of involved)
    if (!parents.has(id)) pending.push({ id, depth: 0, output: roots });
  const visited = new Set<number>();
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) break;
    if (
      visited.has(item.id) ||
      item.depth > 128 ||
      visited.size >= maxNodes ||
      !reserveNode()
    )
      continue;
    visited.add(item.id);
    const node: NibHierarchyNode = { objectID: String(item.id), children: [] };
    item.output.push(node);
    for (const child of [...(children.get(item.id) ?? [])].reverse())
      pending.push({ id: child, depth: item.depth + 1, output: node.children });
  }
  return { hierarchy: roots, omitted: involved.size - visited.size + invalid };
};

const reference = (value: JsonValue | undefined): number | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return typeof value.$nib_object_ref === "number"
    ? value.$nib_object_ref
    : null;
};
