import { z } from "zod";
import { bundleResourceBoundResultSchema } from "./bundleResourceRoot.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
} from "../jsonValue.js";
import { localPathStringSchema } from "../localPath.js";
import { plistUidValue } from "./plistUid.js";
import { projectPlistValue } from "./plistValue.js";

/**
 * The selected file is intact but is another kind of file, so another tool
 * applies. A malformed NSKeyedArchiver archive is not this error.
 */
export class KeyedArchiveKindError extends TypeError {
  override readonly name = "KeyedArchiveKindError";

  constructor(
    message: string,
    /** What the selected file is instead. */
    readonly kind: "nib-archive" | "property-list",
  ) {
    super(message);
  }
}

/** Select one archive within the active bundle and optionally one named root. */
export const keyedArchiveInputSchema = z.strictObject({
  path: localPathStringSchema.default("."),
  root: z.string().optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20_000).default(20_000),
});
const linkSchema = z.strictObject({
  source: z.int().nonnegative().nullable(),
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  target: z.int().nonnegative().nullable(),
  status: z.enum(["resolved", "nil", "unresolved", "malformed"]),
  raw: jsonValueSchema,
});
/** Archive object identity is its original $objects index, never a recursive copy. */
export const keyedArchiveResultSchema = bundleResourceBoundResultSchema(
  z.string(),
  {
    archive_path: z.string(),
    archive_sha256: z.string(),
    archive_format: z.enum(["binary-plist", "xml-plist"]),
    roots: jsonObjectSchema,
    objects: z.array(
      z.strictObject({
        id: z.int().nonnegative(),
        kind: z.enum([
          "nil",
          "scalar",
          "array",
          "dictionary",
          "class-descriptor",
          "archived-object",
        ]),
        class_id: z.int().nonnegative().nullable(),
        class_name: z.string().nullable(),
        status: z.enum([
          "observed",
          "unknown-class",
          "unresolved-class",
          "nil",
        ]),
        value: jsonValueSchema,
      }),
    ),
    references: z.array(linkSchema),
    total_objects: z.int().nonnegative(),
    total_references: z.int().nonnegative(),
    offset: z.int().nonnegative(),
    next_offset: z.int().nonnegative().nullable(),
    truncated: z.boolean(),
    limitations: z.array(z.string()),
  },
);

const record = (
  value: JsonValue | undefined,
  wrappedScalars: WeakSet<object>,
): Record<string, JsonValue> | undefined =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !wrappedScalars.has(value)
    ? value
    : undefined;
/** Only producer-marked binary UIDs or the XML UID convention form references. */
const uid = (
  value: JsonValue | undefined,
  wrappedScalars: WeakSet<object>,
): number | undefined => {
  const object = record(value, wrappedScalars);
  return object === undefined ? undefined : plistUidValue(object);
};

const archiverMismatch = (
  archive: Record<string, JsonValue> | undefined,
): string => {
  if (archive === undefined) return "its root is not a dictionary";
  if (!Object.hasOwn(archive, "$archiver")) return "it has no $archiver key";
  return typeof archive.$archiver === "string"
    ? `its $archiver is ${JSON.stringify(archive.$archiver)}`
    : "its $archiver is not a string";
};

/** Interpret decoded Foundation values without instantiating archive classes. */
export const projectKeyedArchive = (
  value: unknown,
  selection: { root?: string | undefined; offset: number; limit: number },
) => {
  // Classify generated scalar wrappers by their producer identity, never by
  // a caller-controlled $plist_type field in an ordinary dictionary.
  const wrappedScalars = new WeakSet<object>();
  const projected = projectPlistValue(value, (scalar) =>
    wrappedScalars.add(scalar),
  );
  const archive = record(projected.value, wrappedScalars);
  if (archive?.$archiver !== "NSKeyedArchiver")
    throw new KeyedArchiveKindError(
      `Selected property list is not an NSKeyedArchiver archive: ${archiverMismatch(archive)}`,
      "property-list",
    );
  if (!Array.isArray(archive.$objects))
    throw new TypeError("Expected NSKeyedArchiver with an $objects array");
  const table = archive.$objects;
  if (table.length > 200_000)
    throw new RangeError("Archive exceeds 200000 object-table entries");
  const top = record(archive.$top, wrappedScalars);
  if (top === undefined || Object.keys(top).length === 0)
    throw new TypeError("Keyed archive has no $top roots");
  if (selection.root !== undefined && !Object.hasOwn(top, selection.root))
    throw new AnalysisInputError("inspect_keyed_archive", undefined, [
      {
        path: ["root"],
        reason: "invalid_value",
        message: `Archive root does not exist: ${selection.root}. Select one of the archive's $top roots or omit root.`,
        expected: Object.keys(top),
      },
    ]);
  const roots =
    selection.root === undefined
      ? top
      : { [selection.root]: top[selection.root] ?? null };
  const references: z.infer<typeof linkSchema>[] = [];
  type Pending = { value: JsonValue; path: (string | number)[] };
  // `initial` is popped from the end, so callers list it in reverse order.
  const scan = (source: number | null, initial: Pending[]) => {
    const pending = initial;
    let visited = 0;
    while (pending.length > 0) {
      const item = pending.pop();
      if (item === undefined) break;
      if (++visited > 200_000 || item.path.length > 128)
        throw new RangeError(
          "Archive exceeds 200000 values per object or 128 nesting levels",
        );
      const target = uid(item.value, wrappedScalars);
      if (target !== undefined) {
        const index =
          Number.isSafeInteger(target) && target >= 0 ? target : null;
        references.push({
          source,
          path: item.path,
          target: index,
          raw: item.value,
          status:
            index === null
              ? "malformed"
              : index >= table.length
                ? "unresolved"
                : index === 0 && table[0] === "$null"
                  ? "nil"
                  : "resolved",
        });
      } else if (Array.isArray(item.value)) {
        for (let index = item.value.length - 1; index >= 0; index--) {
          const child = item.value[index];
          if (child !== undefined)
            pending.push({ value: child, path: [...item.path, index] });
        }
      } else {
        const fields = record(item.value, wrappedScalars);
        if (fields !== undefined)
          for (const key of Object.keys(fields).sort().reverse()) {
            const child = fields[key];
            if (child !== undefined)
              pending.push({ value: child, path: [...item.path, key] });
          }
      }
      if (references.length > 200_000)
        throw new RangeError("Archive exceeds 200000 reference edges");
    }
  };
  // Root names belong to the `$top` map, not to the encoded value. Scanning
  // that wrapper makes a sole scalar root named `UID` look like a UID marker.
  // Seed one scan with each value under its key to preserve paths and share
  // the existing aggregate visit budget across every root.
  scan(
    null,
    Object.keys(roots)
      .sort()
      .reverse()
      .flatMap((key) => {
        const value = roots[key];
        return value === undefined ? [] : [{ value, path: [key] }];
      }),
  );
  const objects = table.map((value, id) => {
    scan(id, [{ value, path: [] }]);
    const fields = record(value, wrappedScalars);
    const classUid = uid(fields?.$class, wrappedScalars);
    const classId =
      classUid !== undefined && Number.isSafeInteger(classUid) && classUid >= 0
        ? classUid
        : null;
    const descriptor =
      classId === null ? undefined : record(table[classId], wrappedScalars);
    const className =
      typeof descriptor?.$classname === "string" ? descriptor.$classname : null;
    const isNil = id === 0 && value === "$null";
    return {
      id,
      kind: isNil
        ? ("nil" as const)
        : Array.isArray(value)
          ? ("array" as const)
          : fields === undefined
            ? ("scalar" as const)
            : typeof fields.$classname === "string"
              ? ("class-descriptor" as const)
              : Object.hasOwn(fields, "$class")
                ? ("archived-object" as const)
                : ("dictionary" as const),
      class_id: classId,
      class_name: className,
      status: isNil
        ? ("nil" as const)
        : fields !== undefined && Object.hasOwn(fields, "$class")
          ? className === null
            ? ("unresolved-class" as const)
            : ("unknown-class" as const)
          : ("observed" as const),
      value,
    };
  });
  const end = Math.min(objects.length, selection.offset + selection.limit);
  const page = objects.slice(selection.offset, end);
  const ids = new Set(page.map(({ id }) => id));
  return {
    nonFiniteRealCount: projected.nonFiniteRealCount,
    negativeZeroRealCount: projected.negativeZeroRealCount,
    unknownDateCount: projected.unknownDateCount,
    unknownScalarCount: projected.unknownScalarCount,
    roots,
    objects: page,
    references: references.filter(
      ({ source }) => source === null || ids.has(source),
    ),
    total_objects: objects.length,
    total_references: references.length,
    offset: selection.offset,
    next_offset: end < objects.length ? end : null,
    truncated: page.length !== objects.length,
    limitations: [
      "Archive classes are never instantiated. Class names and serialized fields are observed; class-specific semantics are unknown.",
      "Conditional references serialized as UID 0 cannot be distinguished from ordinary nil references. Missing fields remain absent in the raw serialized value.",
      "Root selection selects the named $top entry; object pagination retains original indices and does not recursively expand references.",
    ],
  };
};
