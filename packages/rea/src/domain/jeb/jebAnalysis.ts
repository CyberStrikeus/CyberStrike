import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";

/**
 * Caller intent for JEB-backed inspection, independent of the engine build.
 *
 * JEB resolves paths on the host running the JEB client that serves MCP; REA
 * never launches the engine or opens the target itself.
 */
export const jebInputSchemas = {
  inspect_jeb_client: z.strictObject({}),
  open_jeb_project: z.strictObject({
    path: localPathStringSchema.describe(
      "Artifact file or existing .jdb2 project database, resolved by the running JEB client",
    ),
  }),
  list_jeb_units: z.strictObject({
    filter: z
      .string()
      .optional()
      .describe("Wildcard filter matched against unit paths; '*' allowed"),
    parent_unit_path: z
      .string()
      .min(1)
      .optional()
      .describe("Restrict results to descendants of this unit path"),
    index: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe("Zero-based index of the first result to return"),
    count: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .describe(
        "Maximum results to return; the engine protocol caps pages at 100",
      ),
  }),
  decompile_jeb_item: z.strictObject({
    unit_path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Target code unit; the engine's first code unit in the project when omitted",
      ),
    item_address: z
      .string()
      .min(1)
      .describe(
        "Type or method address within the unit, as listed by the engine",
      ),
    item_kind: z.enum(["type", "method"]).describe("Kind of item to decompile"),
  }),
} as const;

/** Supported JEB-backed operations. */
export type JebOperation = keyof typeof jebInputSchemas;
/** Validated JEB requests carry their selected operation. */
export type JebRequest = {
  [Name in JebOperation]: {
    operation: Name;
    input: z.infer<(typeof jebInputSchemas)[Name]>;
  };
}[JebOperation];

/** Validate operation and input together so their types remain correlated. */
export const jebRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_jeb_client"),
    input: jebInputSchemas.inspect_jeb_client,
  }),
  z.strictObject({
    operation: z.literal("open_jeb_project"),
    input: jebInputSchemas.open_jeb_project,
  }),
  z.strictObject({
    operation: z.literal("list_jeb_units"),
    input: jebInputSchemas.list_jeb_units,
  }),
  z.strictObject({
    operation: z.literal("decompile_jeb_item"),
    input: jebInputSchemas.decompile_jeb_item,
  }),
]);

const engine = z.strictObject({
  name: z.string().min(1),
  version: z.string().nullable(),
  endpoint: z.string().min(1),
  gui_client: z.boolean().nullable(),
});

const unit = z.strictObject({
  unit_path: z.string(),
  unit_type: z.string(),
});

/** Portable JEB observations with explicit identity and coverage limitations. */
export const jebResultSchemas = {
  inspect_jeb_client: z.strictObject({
    engine,
    startup_ts: z.number().int().nonnegative().nullable(),
    message: z.string().nullable(),
  }),
  open_jeb_project: z.strictObject({
    engine,
    project_name: z.string().nullable(),
    creation_datetime: z.string().nullable(),
    input_files: z.array(
      z.strictObject({
        file_name: z.string(),
        file_size: z.number().int().nonnegative(),
        contents_sha256_hash: z.string(),
      }),
    ),
    units: z.array(unit),
  }),
  list_jeb_units: z.strictObject({
    engine,
    filter: z.string().nullable(),
    parent_unit_path: z.string().nullable(),
    index: z.number().int().nonnegative(),
    count: z.number().int().positive(),
    units: z.array(unit),
    coverage: z.enum(["complete", "partial"]),
  }),
  decompile_jeb_item: z.strictObject({
    engine,
    unit_path: z.string().nullable(),
    item_address: z.string(),
    item_kind: z.enum(["type", "method"]),
    text: z.string(),
  }),
} as const;
