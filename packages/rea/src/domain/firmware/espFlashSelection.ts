import { z } from "zod";

import type { ExecutableFormatHint } from "../dosCom.js";
import { ESP_PARTITION_TABLE_SECTOR_BYTES } from "./espPartitionTable.js";

/** A 32-bit flash address written as `0x`-prefixed hexadecimal. */
export const espFlashAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{1,8}$/u, {
  message: "must be a hexadecimal flash address of the form 0x…",
});

export const parseEspFlashAddress = (text: string): number =>
  Number.parseInt(text.slice(2), 16);

/** Describe the format and flash-input pairing without performing I/O. */
export const espFlashSelectionError = (input: {
  readonly format?: ExecutableFormatHint | undefined;
  readonly flashOffset?: number | undefined;
  readonly partitionTableOffset?: number | undefined;
}): string | undefined => {
  if (
    (input.flashOffset !== undefined ||
      input.partitionTableOffset !== undefined) &&
    input.format !== "esp-flash-image"
  )
    return "flash_offset and partition_table_offset apply only with format=esp-flash-image";
  if (
    input.partitionTableOffset !== undefined &&
    input.partitionTableOffset % ESP_PARTITION_TABLE_SECTOR_BYTES !== 0
  )
    return "partition_table_offset must be a multiple of 0x1000, as ESP-IDF requires";
  return undefined;
};
