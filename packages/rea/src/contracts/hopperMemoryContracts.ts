import { z } from "zod";
import { address, document } from "./toolContractHelpers.js";
import {
  MAX_BYTE_SEARCH_MATCHES,
  bytePatternFields,
  validateBytePattern,
} from "../domain/native/bytePattern.js";

/** Hopper memory and file-mapping contracts. */
export const HOPPER_MEMORY_TOOL_DEFINITIONS = [
  {
    name: "search_bytes",
    description:
      "Find masked byte signatures in initialized analyzed memory. Hex byte pairs and ?? wildcards are supported; an optional equal-length hex mask selects bits. Bounds are inclusive. Matches are ordered by provider address and never span blocks. Coverage describes this page; reuse the same query with next_cursor to continue. Uninitialized blocks are listed separately. Ghidra only; Hopper is unavailable.",
    inputSchema: z
      .strictObject({
        ...bytePatternFields,
        document,
        start: address.optional(),
        end: address.optional(),
        limit: z.int().min(1).max(MAX_BYTE_SEARCH_MATCHES).default(100),
        cursor: z.string().min(1).optional(),
      })
      .superRefine(validateBytePattern),
  },
  {
    name: "read_bytes",
    description:
      "Read analyzed bytes from one provider-normalized virtual address. The hexadecimal payload reports the exact returned length; incomplete reads remain explicit and unsupported provider APIs return typed capability unavailability.",
    inputSchema: z.object({
      address,
      length: z.int().min(1).default(256),
      document,
    }),
  },
  {
    name: "address_to_file_offset",
    description:
      "Map one provider-normalized virtual address to its original nonnegative file offset. Hopper verifies the original bytes against the selected executable digest and translates FAT image-relative offsets using the loaded header. Results preserve the provider coordinate, image base, and source path. Unmapped addresses fail explicitly; changed or unavailable sources return typed errors retaining native mapping facts as partial evidence.",
    inputSchema: z.object({ address, document }),
  },
] as const;
