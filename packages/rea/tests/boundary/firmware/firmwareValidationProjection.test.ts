import { describe, expect, it, vi } from "vitest";

import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import { analysisErrorProjectionSchema } from "../../../src/contracts/errorSchemas.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

describe("firmware request validation projection", () => {
  it.each([
    {
      input: {
        path: "/tmp/firmware.bin",
        output_directory: "/tmp/out",
        range: { offset: 5 },
      },
      missing: "length",
    },
    {
      input: {
        path: "/tmp/firmware.bin",
        output_directory: "/tmp/out",
        range: { length: 5 },
      },
      missing: "offset",
    },
  ] as const)(
    "identifies missing range.$missing before provider admission",
    async ({ input, missing }) => {
      const execute = vi.fn(async () => {
        throw new Error("Provider must not execute for invalid input");
      });
      const service = new FirmwareAnalysisService({ execute });
      const result = await service.execute("extract_firmware", input);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected request validation to fail");
      const projected = projectAnalysisError(result.error);
      expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
        true,
      );
      expect(projected).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        retryable: false,
        details: {
          operation: "extract_firmware",
          issues: [
            {
              path: ["range", missing],
              reason: "missing_argument",
            },
          ],
        },
        remediation: {
          action: expect.stringContaining("Correct the listed fields"),
        },
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
