import type { BinaryTarget } from "../../domain/binaryTargetTypes.js";

import { liveBinaryTargetSummarySchema } from "../../domain/liveBinaryTargetSummary.js";

/** Preserve the admitted target interpretation in public lifecycle results. */
export const binaryTargetSummary = (target: BinaryTarget) =>
  liveBinaryTargetSummarySchema.parse({
    path: target.path,
    format: target.format,
    kind: target.kind,
    sha256: target.sha256,
    architecture: target.architecture ?? null,
    ...(target.format === "raw-binary" || target.format === "gamecube-dol"
      ? { entry_point: target.entryPoint }
      : {}),
    ...(target.format === "esp-flash-image"
      ? {
          flash_offset: target.espFlash.flashOffset,
          partition_table_offset: target.espFlash.partitionTableOffset,
        }
      : {}),
  });
