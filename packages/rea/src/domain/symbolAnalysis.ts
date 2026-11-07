import { objcClassSymbol } from "./objcClassSymbol.js";
import type { JsonValue } from "./jsonValue.js";
import type { AddressedName } from "./native/nativeInventory.js";
import type {
  MachoImportBinding,
  ObjcClassDiscoveryCoverage,
} from "./native/objcSwiftMetadata.js";
import {
  classifySwiftSymbol,
  isSwiftSymbolName,
  type SwiftTypeCategory,
} from "./swiftSymbolClassification.js";

/** Local class records emitted by Apple's fragile Objective-C ABI. */
const LEGACY_OBJC_CLASS_PREFIX = "l_OBJC_CLASS_" as const;

/**
 * Objective-C protocol declaration marker. `PROTOCOL_REFERENCE` slots
 * share the substring but are uses, not definitions.
 */
const OBJC_PROTOCOL_MARKER = "OBJC_PROTOCOL_$_" as const;

export interface ObjcClassImportBindingScan {
  readonly bindings: readonly MachoImportBinding[];
  readonly coverage: ObjcClassDiscoveryCoverage;
}

/** Select class labels and apply the caller's literal filter before identity joins. */
export const selectObjcClassCandidates = (
  names: readonly AddressedName[],
  pattern: string,
): AddressedName[] =>
  uniqueByAddressAndName(
    names
      .filter(
        ({ name, objc_class_label }) =>
          objcClassSymbol(name)?.metaclass === false ||
          objc_class_label === "hopper_legacy_class_object" ||
          (name.startsWith(LEGACY_OBJC_CLASS_PREFIX) &&
            name.length > LEGACY_OBJC_CLASS_PREFIX.length &&
            !/^l_OBJC_CLASS_NAME_(?:\.\d+)?$/u.test(name)),
      )
      .filter(({ name }) => pattern.length === 0 || name.includes(pattern)),
  );

/** Project selected class labels, coalescing only exact proven import identities. */
export const projectObjcClassCandidates = (
  candidates: readonly AddressedName[],
  bindingScan: ObjcClassImportBindingScan,
): JsonValue => {
  const classes = coalesceBoundClassAliases(candidates, bindingScan.bindings);
  return {
    count: classes.length,
    classes: classes.map(toObjcClassEntry),
    identity_coverage: {
      status: bindingScan.coverage.status,
      reason: bindingScan.coverage.reason,
    },
  };
};

/** Select and deduplicate Objective-C and Swift protocol labels. */
export const discoverObjcProtocols = (
  names: readonly AddressedName[],
): JsonValue => {
  const protocols = uniqueByName(
    names.filter(
      ({ name }) =>
        name.includes(OBJC_PROTOCOL_MARKER) ||
        classifySwiftSymbol(name)?.protocolIdentity === true,
    ),
  );
  return {
    count: protocols.length,
    protocols: protocols.map(toJsonEntry),
  };
};

/** Categorize procedure names using Swift manglings at their exact addresses. */
export const categorizeSwiftTypes = (
  procedures: readonly AddressedName[],
  filter: {
    readonly category?: SwiftTypeCategory | undefined;
    readonly pattern?: string | undefined;
  } = {},
  symbols: readonly AddressedName[] = [],
) => {
  const groups: Record<
    string,
    Array<{
      address: string;
      name: string;
      mangled_names: string[];
    }>
  > = Object.fromEntries(
    ["classes", "structs", "enums", "protocols", "extensions", "other"].map(
      (category) => [category, []],
    ),
  );
  const aliases = swiftAliasesByAddress(symbols);
  const pattern = filter.pattern;
  const seen = new Set<string>();
  const unclassifiedNames = new Set<string>();
  const unclassified: Array<{
    address: string;
    name: string;
    mangled_names: string[];
    reason: "category_not_decoded" | "conflicting_categories";
  }> = [];

  for (const entry of procedures) {
    if (seen.has(entry.name)) continue;
    const mangledNames = [
      ...new Set([
        ...(isSwiftSymbolName(entry.name) ? [entry.name] : []),
        ...(aliases.get(entry.address) ?? []),
      ]),
    ];
    if (mangledNames.length === 0) continue;
    if (
      pattern !== undefined &&
      ![entry.name, ...mangledNames].some((name) => name.includes(pattern))
    )
      continue;
    // Only decoded categories vote. A Swift-looking alias whose category is
    // not decoded remains evidence without erasing a decoded category.
    const kinds = new Set<SwiftTypeCategory>();
    for (const name of mangledNames) {
      const decoded = classifySwiftSymbol(name)?.category;
      if (decoded !== undefined && decoded !== null) kinds.add(decoded);
    }
    const category = kinds.size === 1 ? ([...kinds][0] ?? null) : null;
    const item = {
      address: entry.address,
      name: entry.name,
      mangled_names: mangledNames,
    };
    if (category === null && !unclassifiedNames.has(entry.name)) {
      unclassifiedNames.add(entry.name);
      unclassified.push({
        ...item,
        reason:
          kinds.size > 1 ? "conflicting_categories" : "category_not_decoded",
      });
    }
    const bucket = category ?? "other";
    if (filter.category === undefined || filter.category === bucket) {
      seen.add(entry.name);
      groups[bucket]?.push(item);
    }
  }

  const categories = Object.fromEntries(
    Object.entries(groups).map(([category, items]) => [
      category,
      { count: items.length, items },
    ]),
  );
  return {
    total: Object.values(groups).reduce((sum, items) => sum + items.length, 0),
    categories,
    unclassified,
    limitations: [
      "Identification uses Swift mangled procedure names or same-address symbol aliases. Demangled names without retained Swift manglings cannot be identified. Counts deduplicate procedure names, not source declarations.",
      ...(unclassified.length === 0
        ? []
        : [
            "Some Swift categories could not be established from the retained manglings. Unclassified observations remain inline regardless of the category filter.",
          ]),
    ],
  };
};

const swiftAliasesByAddress = (symbols: readonly AddressedName[]) => {
  const aliases = new Map<string, string[]>();
  for (const { address, name } of symbols) {
    if (!isSwiftSymbolName(name)) continue;
    const existing = aliases.get(address);
    if (existing === undefined) aliases.set(address, [name]);
    else existing.push(name);
  }
  return aliases;
};

const uniqueByName = (entries: readonly AddressedName[]): AddressedName[] => {
  const seen = new Set<string>();
  return entries.filter(({ name }) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
};

/** Keep same-named rows at distinct locations until slot identity is examined. */
const uniqueByAddressAndName = (
  entries: readonly AddressedName[],
): AddressedName[] => {
  const seen = new Set<string>();
  return entries.filter(({ address, name }) => {
    const key = JSON.stringify([address, name]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

interface ObjcClassOutputEntry extends AddressedName {
  readonly binding_identity?: Omit<MachoImportBinding, "requested_address"> & {
    readonly slot_addresses: readonly string[];
  };
}

const coalesceBoundClassAliases = (
  candidates: readonly AddressedName[],
  bindings: readonly MachoImportBinding[],
): ObjcClassOutputEntry[] => {
  const bindingsByAddress = new Map(
    bindings.map((binding) => [binding.requested_address, binding]),
  );
  const bindingKey = (binding: MachoImportBinding) =>
    JSON.stringify([
      binding.symbol,
      binding.binding_source,
      binding.library_ordinal,
      binding.library,
      binding.weak,
      binding.addend,
    ]);
  const groupedBindings = new Map<string, MachoImportBinding[]>();
  for (const binding of bindings) {
    const key = bindingKey(binding);
    const existing = groupedBindings.get(key);
    if (existing === undefined) groupedBindings.set(key, [binding]);
    else existing.push(binding);
  }

  const groupedCandidates = new Map<string, AddressedName[]>();
  const ordered: Array<AddressedName | { readonly group: string }> = [];
  for (const candidate of candidates) {
    const binding = bindingsByAddress.get(candidate.address);
    if (binding === undefined) {
      ordered.push(candidate);
      continue;
    }
    const key = bindingKey(binding);
    let group = groupedCandidates.get(key);
    if (group === undefined) {
      group = [];
      groupedCandidates.set(key, group);
      ordered.push({ group: key });
    }
    group.push(candidate);
  }

  const output: ObjcClassOutputEntry[] = [];
  for (const entry of ordered) {
    if ("group" in entry) {
      const key = entry.group;
      const facts = groupedBindings.get(key) ?? [];
      const group = groupedCandidates.get(key) ?? [];
      const identity = facts[0];
      const canonicalName =
        identity === undefined
          ? undefined
          : classNameFromImport(identity.symbol);
      const representative =
        (canonicalName === undefined
          ? undefined
          : group.find(
              ({ name }) => classNameFromDisplayName(name) === canonicalName,
            )) ?? group[0];
      if (representative === undefined || identity === undefined) continue;
      output.push({
        ...representative,
        binding_identity: {
          symbol: identity.symbol,
          binding_source: identity.binding_source,
          library_ordinal: identity.library_ordinal,
          library: identity.library,
          weak: identity.weak,
          addend: identity.addend,
          slot_addresses: [
            ...new Set(facts.map(({ requested_address }) => requested_address)),
          ],
        },
      });
    } else {
      const candidate = entry;
      output.push(candidate);
    }
  }
  return output;
};

const classNameFromImport = (symbol: string): string | undefined => {
  const facts = objcClassSymbol(symbol);
  return facts?.metaclass === false ? facts.symbol : undefined;
};

const classNameFromDisplayName = classNameFromImport;

const toObjcClassEntry = (entry: ObjcClassOutputEntry): JsonValue => ({
  address: entry.address,
  name: entry.name,
  ...(entry.binding_identity === undefined
    ? {}
    : {
        binding_identity: {
          symbol: entry.binding_identity.symbol,
          binding_source: entry.binding_identity.binding_source,
          library_ordinal: entry.binding_identity.library_ordinal,
          library: entry.binding_identity.library,
          weak: entry.binding_identity.weak,
          addend: entry.binding_identity.addend,
          slot_addresses: [...entry.binding_identity.slot_addresses],
        },
      }),
});

const toJsonEntry = ({ address, name }: AddressedName): JsonValue => ({
  address,
  name,
});
