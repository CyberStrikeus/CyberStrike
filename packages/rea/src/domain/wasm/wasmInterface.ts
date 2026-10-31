import { z } from "zod";

const kind = z.enum(["func", "table", "memory", "global", "tag", "unknown"]);
const valueType = z.enum([
  "i32",
  "i64",
  "f32",
  "f64",
  "v128",
  "funcref",
  "externref",
]);
const limit = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const signature = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("func"),
    params: z.array(valueType),
    results: z.array(valueType),
  }),
  z.object({
    kind: z.literal("tag"),
    params: z.array(valueType),
    results: z.array(valueType),
  }),
  z.object({
    kind: z.literal("table"),
    element: z.enum(["funcref", "externref"]),
    address_type: z.enum(["i32", "i64"]),
    minimum: limit,
    maximum: limit.nullable(),
    shared: z.boolean(),
  }),
  z.object({
    kind: z.literal("memory"),
    page_size: limit,
    address_type: z.enum(["i32", "i64"]),
    minimum: limit,
    maximum: limit.nullable(),
    shared: z.boolean(),
  }),
  z.object({
    kind: z.literal("global"),
    value_type: valueType,
    mutable: z.boolean(),
  }),
]);

/** Typed observations decoded once at the WABT producer boundary. */
export const wasmInterfaceSchema = z.object({
  state: z.enum(["complete", "partial"]),
  entries: z.array(
    z
      .object({
        direction: z.enum(["import", "export"]),
        module: z.string().nullable(),
        name: z.string(),
        kind,
        index: z.int().nonnegative().max(0xffff_ffff).nullable(),
        signature: signature.nullable(),
        wat_form: z.string(),
        issue: z.string().nullable(),
      })
      .superRefine((entry, context) => {
        if (
          (entry.direction === "export" && entry.module !== null) ||
          (entry.direction === "import" && entry.module === null)
        )
          context.addIssue({
            code: "custom",
            message: "Interface direction does not match module-name presence",
          });
        if (entry.signature !== null && entry.signature.kind !== entry.kind)
          context.addIssue({
            code: "custom",
            message: "Interface kind does not match its typed signature",
          });
      }),
  ),
  issues: z.array(z.string()),
});
export type WasmInterface = z.infer<typeof wasmInterfaceSchema>;
export type WasmInterfaceEntry = WasmInterface["entries"][number];
export type WasmInterfaceSignature = NonNullable<
  WasmInterfaceEntry["signature"]
>;

export type WasmInterfaceValueType = z.infer<typeof valueType>;

/** Bound eager typed output and repeated signature expansion independently of WAT bytes. */
export const WASM_INTERFACE_REPRESENTATION_BYTES = 32 * 1024 * 1024;

/** Conservative JSON/retention charge; shared arrays still expand at every occurrence. */
export const wasmInterfaceEntryRepresentationBytes = (
  entry: WasmInterfaceEntry,
): number => {
  let bytes =
    1024 +
    [entry.module, entry.name, entry.wat_form, entry.issue].reduce<number>(
      (sum, value) => sum + (value?.length ?? 0) * 6,
      0,
    );
  const signature = entry.signature;
  if (signature?.kind === "func" || signature?.kind === "tag")
    bytes += (signature.params.length + signature.results.length) * 16;
  else if (signature !== null)
    for (const value of Object.values(signature))
      if (typeof value === "string") bytes += value.length * 6;
  return bytes;
};
