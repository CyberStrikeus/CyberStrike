import { z } from "zod";

import {
  BINARY_ARCHITECTURES,
  ELF_METADATA_ARCHITECTURES,
  RAW_ONLY_ARCHITECTURES,
} from "./binaryTargetTypes.js";
import { digestSchema } from "./digests.js";
import {
  binaryArchitectureSchema,
  rawBinaryEntryPointSchema,
} from "./rawBinary.js";
import { ZIP_PACKAGE_FORMATS } from "./zipPackageFormat.js";

const architectureSchema = z.enum(BINARY_ARCHITECTURES);
const headerArchitectureSchema = architectureSchema.exclude([
  ...ELF_METADATA_ARCHITECTURES,
  ...RAW_ONLY_ARCHITECTURES,
  "hexagon",
  "arm64_32",
]);
const identity = { path: z.string(), sha256: digestSchema };
const executable = { ...identity, kind: z.literal("executable") };

/** Live target classifications; historical Evidence and snapshots retain their own admission. */
export const liveBinaryTargetSummaryVariants = [
  z.object({
    ...executable,
    format: z.literal("elf"),
    architecture: architectureSchema.exclude([
      ...RAW_ONLY_ARCHITECTURES,
      "arm64_32",
    ]),
  }),
  z.object({
    ...executable,
    format: z.literal("mach-o"),
    architecture: z.enum([...headerArchitectureSchema.options, "arm64_32"]),
  }),
  z.object({
    ...executable,
    format: z.enum(["mach-o-universal", "pe", "dos-mz", "dos-com"]),
    architecture: headerArchitectureSchema,
  }),
  z.object({
    ...executable,
    format: z.literal("raw-binary"),
    architecture: binaryArchitectureSchema,
    entry_point: rawBinaryEntryPointSchema.describe(
      "Canonical caller-selected address where raw file offset 0 is mapped and execution is seeded.",
    ),
  }),
  z.object({
    ...executable,
    format: z.literal("gamecube-dol"),
    architecture: z.literal("powerpc"),
    entry_point: rawBinaryEntryPointSchema.describe(
      "Canonical entry address taken from the caller-selected DOL header.",
    ),
  }),
  z.object({
    ...identity,
    kind: z.literal("database"),
    format: z.literal("analysis-database"),
    architecture: z.null(),
  }),
  z.object({
    ...identity,
    kind: z.literal("archive"),
    format: z.enum([
      ...ZIP_PACKAGE_FORMATS,
      "asar",
      "ines",
      "godot-pck",
      "unityfs",
      "uimage",
      "dmg",
      "pkg",
      "intel-hex",
      "srec",
      "esp-image",
      "uf2",
      "dfuse",
      "fit",
    ]),
    architecture: z.null(),
  }),
  z.object({
    ...identity,
    kind: z.literal("archive"),
    format: z.literal("esp-flash-image"),
    architecture: z.null(),
    flash_offset: z
      .number()
      .int()
      .min(0)
      .max(0xffff_ffff)
      .nullable()
      .describe(
        "Caller-selected flash address of the dump's first byte; null reads it as flash address 0.",
      ),
    partition_table_offset: z
      .number()
      .int()
      .min(0)
      .max(0xffff_ffff)
      .nullable()
      .describe(
        "Caller-selected partition table address; null tries 0x8000, then a scan.",
      ),
  }),
  z.object({
    ...identity,
    kind: z.literal("artifact"),
    format: z.enum(["plist", "javascript", "source-map"]),
    architecture: z.null(),
  }),
] as const;

/** Exact wire projection of the currently admitted canonical target variants. */
export const liveBinaryTargetSummarySchema = z.discriminatedUnion(
  "format",
  liveBinaryTargetSummaryVariants,
);
