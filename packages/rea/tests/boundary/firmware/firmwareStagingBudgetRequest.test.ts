import { describe, expect, it, vi } from "vitest";

import { FirmwareAnalysisService } from "../../../src/application/firmware/FirmwareAnalysisService.js";
import { AnalysisOutputError } from "../../../src/domain/analysisErrorCore.js";
import {
  MAX_FIRMWARE_STAGING_BYTES,
  MAX_FIRMWARE_STAGING_ENTRIES,
} from "../../../src/domain/firmware/firmwareAnalysis.js";
import { err } from "../../../src/domain/result.js";

/**
 * The staging budget matters only if the value the caller wrote survives request
 * parsing and reaches the provider. A provider that silently receives the
 * default cannot enforce the ceiling the caller selected, so assert the parsed
 * request rather than the guidance text, which `firmwareStagingBudgetWiring`
 * covers separately.
 *
 * The provider rejects on arrival, so no execution record has to be fabricated:
 * the request it received is the whole assertion.
 */
const recordingProvider = () => {
  const requests: unknown[] = [];
  const provider = {
    execute: vi.fn(async (request: unknown) => {
      requests.push(request);
      return err(
        new AnalysisOutputError("extract_firmware", "recorded request"),
      );
    }),
  };
  return { provider, requests };
};

describe("firmware staging budget reaches the provider", () => {
  it.each([
    { name: "the schema ceiling", budget: MAX_FIRMWARE_STAGING_BYTES },
    { name: "a budget below the ceiling", budget: 1 },
  ] as const)("forwards %s unchanged", async ({ budget }) => {
    const { provider, requests } = recordingProvider();
    const service = new FirmwareAnalysisService(provider as never);

    await service.execute("extract_firmware", {
      path: "/tmp/input.bin",
      output_directory: "/tmp/output",
      max_output_bytes: budget,
      max_output_files: MAX_FIRMWARE_STAGING_ENTRIES,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: "extract_firmware",
      input: {
        max_output_bytes: budget,
        max_output_files: MAX_FIRMWARE_STAGING_ENTRIES,
      },
    });
  });

  it("applies the documented default when the caller omits the budget", async () => {
    const { provider, requests } = recordingProvider();
    const service = new FirmwareAnalysisService(provider as never);

    await service.execute("extract_firmware", {
      path: "/tmp/input.bin",
      output_directory: "/tmp/output",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      input: { max_output_bytes: 256 * 1024 * 1024 },
    });
  });

  it("rejects a budget above the schema maximum before the provider runs", async () => {
    const { provider, requests } = recordingProvider();
    const service = new FirmwareAnalysisService(provider as never);

    const result = await service.execute("extract_firmware", {
      path: "/tmp/input.bin",
      output_directory: "/tmp/output",
      max_output_bytes: MAX_FIRMWARE_STAGING_BYTES + 1,
    });

    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
