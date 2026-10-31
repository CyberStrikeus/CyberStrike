import type {
  JavaScriptSemanticProperty,
  JavaScriptSemanticValue,
} from "./javascriptSemanticValueTypes.js";

/** Static container inventory; partial siblings do not weaken retained slots. */
export interface JavaScriptSemanticContainer {
  readonly slots: readonly JavaScriptSemanticProperty[];
  readonly coverage:
    | { readonly status: "complete"; readonly omitted: 0 }
    | { readonly status: "partial"; readonly omitted: number | null };
}

/** Read the same slot inventory for object, array, and return projections. */
export function semanticContainer(
  value: Extract<
    JavaScriptSemanticValue,
    { readonly status: "object" | "array" }
  >,
): JavaScriptSemanticContainer;
export function semanticContainer(
  value: JavaScriptSemanticValue,
): JavaScriptSemanticContainer | null;
export function semanticContainer(
  value: JavaScriptSemanticValue,
): JavaScriptSemanticContainer | null {
  if (value.status === "object")
    return {
      slots: value.properties,
      coverage: value.unknownProperties
        ? { status: "partial", omitted: value.omittedProperties }
        : { status: "complete", omitted: 0 },
    };
  if (value.status === "array")
    return {
      slots: value.items,
      coverage: value.unknownItems
        ? { status: "partial", omitted: value.omittedItems }
        : { status: "complete", omitted: 0 },
    };
  return null;
}

/** Resolve a full static own-property path without conflating missing siblings. */
export const semanticSlotAtPath = (
  value: JavaScriptSemanticValue,
  path: readonly string[],
): JavaScriptSemanticProperty => {
  const leafName = path.at(-1) ?? "";
  let current: JavaScriptSemanticProperty = {
    name: "",
    presence: "present",
    value,
  };
  for (const [index, name] of path.entries()) {
    const container = semanticContainer(current.value);
    if (current.presence !== "present" || container === null)
      return {
        name: leafName,
        presence: "unknown-coverage",
        value:
          "reason" in current.value
            ? {
                ...current.value,
                reason: `${current.value.reason} Cannot continue ${semanticPropertyPointer(path)} through receiver ${semanticPropertyPointer(path.slice(0, index))}.`,
              }
            : {
                status: "unknown",
                reason: `Cannot resolve ${semanticPropertyPointer(path)} through ${current.value.status} receiver ${semanticPropertyPointer(path.slice(0, index))}.`,
              },
      };
    // Array position inventories omit the intrinsic non-enumerable length slot.
    // Its own presence is guaranteed even when no exact length is retained.
    if (current.value.status === "array" && name === "length") {
      current = {
        name,
        presence: "present",
        value: {
          status: "unknown",
          reason: "Array length is present but its value is not retained.",
        },
      };
      continue;
    }
    const observed = container.slots.find((slot) => slot.name === name);
    current = observed ?? {
      name,
      presence:
        container.coverage.status === "complete"
          ? "absent"
          : "unknown-coverage",
      value: {
        status: "unknown",
        reason: `Own property ${name} was not observed.`,
      },
    };
  }
  return current;
};

/** Encode path segments as an unambiguous JSON Pointer, preserving empty keys. */
export const semanticPropertyPointer = (path: readonly string[]): string =>
  path
    .map((key) => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
