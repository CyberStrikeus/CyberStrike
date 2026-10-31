import { executableFormatHintSchema } from "../domain/dosCom.js";
import { absoluteLocalPathStringSchema } from "../domain/localPath.js";
import {
  binaryArchitectureSchema,
  rawBinaryEntryPointSchema,
  rawBinarySelectionError,
} from "../domain/rawBinary.js";
import { z } from "zod";
import {
  espFlashAddressSchema,
  espFlashSelectionError,
  parseEspFlashAddress,
} from "../domain/firmware/espFlashSelection.js";
import { analysisProviderSelectorSchema } from "../domain/providerSelection.js";

/** Caller-supplied analysis snapshot path; must name its destination absolutely. */
const snapshotPathSchema = absoluteLocalPathStringSchema.describe(
  "Absolute local filesystem path for the analysis snapshot; relative paths are rejected.",
);

/** Caller-supplied analysis target path; must name the target absolutely. */
const binaryTargetPathSchema = absoluteLocalPathStringSchema.describe(
  "Absolute local filesystem path for the analysis target; relative paths are rejected.",
);

/** Input contract for opening a target with an optional staged snapshot. */
export const openBinaryInputSchema = z
  .strictObject({
    path: binaryTargetPathSchema,
    format: executableFormatHintSchema
      .optional()
      .describe(
        "Explicit interpretation: dos-com or raw-binary (headerless), gamecube-dol (GameCube/Wii DOL, never auto-detected), or esp-flash-image (an ESP flash dump read with flash_offset and partition_table_offset). Omission preserves header-based detection.",
      ),
    architecture: binaryArchitectureSchema
      .optional()
      .describe(
        "Caller-supplied CPU family. Required with format=raw-binary; rejected otherwise. format=gamecube-dol takes powerpc from the header, so it must be omitted.",
      ),
    entry_point: rawBinaryEntryPointSchema
      .optional()
      .describe(
        "Caller-supplied load and entry address (0xhex). File offset 0 is mapped here. Required with format=raw-binary; rejected otherwise. Optional with format=gamecube-dol; must equal the DOL header entry.",
      ),
    flash_offset: espFlashAddressSchema
      .optional()
      .describe(
        "Flash address (0xhex) of the dump's first byte, when it does not start at flash address 0. Only with format=esp-flash-image.",
      ),
    partition_table_offset: espFlashAddressSchema
      .optional()
      .describe(
        "Flash address (0xhex, a multiple of 0x1000) of the partition table, which disables the table scan. Only with format=esp-flash-image.",
      ),
    provider_id: analysisProviderSelectorSchema.optional(),
    snapshot_path: snapshotPathSchema.optional(),
  })
  .superRefine((value, context) => {
    const flash = espFlashSelectionError({
      format: value.format,
      flashOffset:
        value.flash_offset === undefined
          ? undefined
          : parseEspFlashAddress(value.flash_offset),
      partitionTableOffset:
        value.partition_table_offset === undefined
          ? undefined
          : parseEspFlashAddress(value.partition_table_offset),
    });
    if (flash !== undefined)
      context.addIssue({
        code: "custom",
        path: [
          value.partition_table_offset === undefined
            ? "flash_offset"
            : "partition_table_offset",
        ],
        message: flash,
      });
    const pairing = rawBinarySelectionError({
      ...(value.format === undefined ? {} : { format: value.format }),
      ...(value.architecture === undefined
        ? {}
        : { architecture: value.architecture }),
      ...(value.entry_point === undefined
        ? {}
        : { entryPoint: value.entry_point }),
    });
    if (pairing === undefined) return;
    context.addIssue({
      code: "custom",
      path:
        value.format === "raw-binary"
          ? value.architecture === undefined
            ? ["architecture"]
            : ["entry_point"]
          : value.architecture === undefined
            ? ["entry_point"]
            : ["architecture"],
      message: pairing,
    });
  });

/** Open only app resources when no declared executable is available. */
export const openBundleResourcesInputSchema = z.strictObject({
  path: binaryTargetPathSchema,
});

/** Input contract for closing a target after an optional atomic snapshot. */
export const closeBinaryInputSchema = z.strictObject({
  snapshot_path: snapshotPathSchema.optional(),
  overwrite: z.boolean().default(false),
});
