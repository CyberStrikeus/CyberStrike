import { z } from "zod";
import { jsonObjectSchema, type JsonValue } from "./jsonValue.js";

/** Own every JSON map key, then validate and retain each value's normalized facts. */
export const jsonRecordSchema = <Value extends JsonValue>(
  valueSchema: z.ZodType<Value>,
  keySchema: z.ZodString = z.string(),
) => {
  const projection = z.record(keySchema, valueSchema);
  const schema = jsonObjectSchema.transform(
    (value, context): Record<string, Value> => {
      const entries: [string, Value][] = [];
      let invalid = false;
      for (const [key, entry] of Object.entries(value)) {
        const parsedKey = keySchema.safeParse(key);
        if (!parsedKey.success) {
          invalid = true;
          context.addIssue({
            code: "invalid_key",
            origin: "record",
            issues: parsedKey.error.issues,
            path: [key],
          });
          continue;
        }
        const parsed = valueSchema.safeParse(entry);
        if (parsed.success) entries.push([parsedKey.data, parsed.data]);
        else {
          invalid = true;
          for (const issue of parsed.error.issues)
            context.addIssue({ ...issue, path: [key, ...issue.path] });
        }
      }
      return invalid ? z.NEVER : Object.fromEntries(entries);
    },
  );
  // Zod clones reconstruct from the definition. Install projection in the
  // constructor so descriptions, metadata and checks retain the same owner.
  const JsonRecord = z.core.$constructor<typeof schema>(
    "JsonRecord",
    (instance, definition) => {
      z.ZodPipe.init(instance, definition);
      instance._zod.processJSONSchema = (context, json, params) =>
        projection._zod.processJSONSchema!(context, json, params);
    },
  );
  return new JsonRecord(schema._zod.def);
};
