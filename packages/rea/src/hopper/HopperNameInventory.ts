import type { JsonValue } from "../domain/jsonValue.js";
import { z } from "zod";

const LEGACY_OBJC_CLASS_LABEL_PREFIX = "__objc_class_";
const LEGACY_OBJC_CLASS_LABEL_SUFFIX = "_class";
const addressedNameRowsSchema = z.array(
  z.object({ address: z.string(), value: z.string() }),
);

const isLegacyObjcClassObjectLabel = (value: string): boolean =>
  value.startsWith(LEGACY_OBJC_CLASS_LABEL_PREFIX) &&
  value.endsWith(LEGACY_OBJC_CLASS_LABEL_SUFFIX) &&
  value.length >
    LEGACY_OBJC_CLASS_LABEL_PREFIX.length +
      LEGACY_OBJC_CLASS_LABEL_SUFFIX.length;

/** Tag Hopper's stripped class-object labels while retaining their exact text. */
export const projectHopperNameInventory = (
  value: JsonValue,
): { readonly result: JsonValue; readonly changed: boolean } => {
  const parsed = addressedNameRowsSchema.safeParse(value);
  if (!parsed.success) return { result: value, changed: false };

  let changed = false;
  if (!Array.isArray(value)) return { result: value, changed: false };
  const result = value.map((entry, index) => {
    if (entry === null || Array.isArray(entry) || typeof entry !== "object")
      return entry;
    const parsedEntry = parsed.data[index];
    if (parsedEntry === undefined) return entry;
    const { objc_class_label: _untrustedLabel, ...sourceFields } = entry;
    const ownsLegacyLabel = isLegacyObjcClassObjectLabel(parsedEntry.value);
    if (ownsLegacyLabel) {
      changed = true;
      return {
        ...sourceFields,
        objc_class_label: "hopper_legacy_class_object" as const,
      };
    }
    if (_untrustedLabel !== undefined) {
      changed = true;
      return sourceFields;
    }
    return entry;
  });
  return changed ? { result, changed } : { result: value, changed: false };
};
