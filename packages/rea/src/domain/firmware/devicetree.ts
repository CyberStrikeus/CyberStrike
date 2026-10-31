import { z } from "zod";
import { digestSchema } from "../digests.js";
import { localPathStringSchema } from "../localPath.js";
const uint = z.number().int().min(0).max(0xffffffff);
export const MAX_DEVICETREE_FILE_BYTES = 16777216;
export const inspectDevicetreeInputSchema = z.strictObject({
  path: localPathStringSchema,
  max_file_bytes: z
    .number()
    .int()
    .min(40)
    .max(MAX_DEVICETREE_FILE_BYTES)
    .default(4194304),
  max_nodes: z.number().int().min(1).max(65536).default(8192),
  max_properties: z.number().int().min(1).max(262144).default(32768),
  max_depth: z.number().int().min(1).max(256).default(64),
});
export const devicetreePropertySchema = z.strictObject({
  name: z.string(),
  offset: uint,
  bytes: uint,
  hex: z
    .string()
    .regex(/^[0-9a-f]*$/)
    .max(512),
  truncated: z.boolean(),
  derived: z.strictObject({
    confidence: z.literal("derived"),
    strings: z.array(z.string()).nullable(),
    cells: z.array(uint).nullable(),
    reg: z
      .array(
        z.strictObject({
          address: z.string().nullable(),
          size: z.string().nullable(),
        }),
      )
      .nullable(),
  }),
});
export const devicetreeNodeSchema = z.strictObject({
  path: z.string(),
  parent: z.string().nullable(),
  offset: uint,
  properties: z.array(devicetreePropertySchema),
});
export const devicetreeSchema = z.strictObject({
  artifact: z.strictObject({
    path: z.string(),
    sha256: digestSchema,
    bytes: uint,
  }),
  header: z.strictObject({
    magic: uint,
    totalsize: uint,
    off_dt_struct: uint,
    off_dt_strings: uint,
    off_mem_rsvmap: uint,
    version: uint,
    last_comp_version: uint,
    boot_cpuid_phys: uint,
    size_dt_strings: uint,
    size_dt_struct: uint.nullable(),
  }),
  reservations: z.array(
    z.strictObject({ offset: uint, address: z.string(), size: z.string() }),
  ),
  nodes: z.array(devicetreeNodeSchema),
  references: z.array(
    z.strictObject({
      source: z.string(),
      property: z.string(),
      phandle: uint,
      target: z.string().nullable(),
      confidence: z.literal("derived"),
    }),
  ),
  summary: z.strictObject({
    confidence: z.literal("derived"),
    compatible: z.array(z.string()).nullable(),
    model: z.string().nullable(),
    bootargs: z.string().nullable(),
    stdout_path: z.string().nullable(),
    aliases: z.array(
      z.strictObject({ name: z.string(), path: z.string().nullable() }),
    ),
  }),
  coverage: z.strictObject({
    status: z.literal("complete"),
    examined_nodes: uint,
    examined_properties: uint,
  }),
  limitations: z.array(z.string()),
});
export type Devicetree = z.infer<typeof devicetreeSchema>;
export type InspectDevicetreeInput = z.infer<
  typeof inspectDevicetreeInputSchema
>;
