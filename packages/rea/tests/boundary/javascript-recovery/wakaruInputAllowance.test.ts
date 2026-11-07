import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Input admission precedes engine launch, so the configured engine is only
// fingerprinted here and never started.
vi.mock(
  "../../../src/javascript/recovery/WakaruCommand.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/javascript/recovery/WakaruCommand.js")
      >();
    return {
      ...actual,
      resolveWakaruCommand: async () => ({
        command: {
          invocationPath: "/unused/wakaru",
          resolvedPath: "/unused/wakaru",
        },
        limiter: {
          invocationPath: "/unused/prlimit",
          resolvedPath: "/unused/prlimit",
        },
        sha256: "a".repeat(64),
        bytes: 1,
      }),
    };
  },
);

import { JavaScriptRecoveryService } from "../../../src/application/javascript/JavaScriptRecoveryService.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { snapshotRecoveryInputs } from "../../../src/javascript/recovery/RecoveryFiles.js";
import { WakaruProvider } from "../../../src/javascript/recovery/WakaruProvider.js";

const MAXIMUM = 64 * 1024 * 1024;

const recover = async (
  root: string,
  path: string,
  additional?: readonly string[],
) => {
  const launches: unknown[] = [];
  const service = new JavaScriptRecoveryService(
    new WakaruProvider({}, async (options) => {
      launches.push(options);
      throw new Error("input admission must refuse before engine launch");
    }),
  );
  const output = join(root, "output");
  try {
    const result = await service.recover({
      path,
      output_directory: output,
      ...(additional === undefined ? {} : { additional_paths: additional }),
    });
    if (result.ok) throw new Error("Expected recovery input refusal");
    expect(launches).toEqual([]);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    return projectAnalysisError(result.error);
  } finally {
    await service.close();
  }
};

it.skipIf(process.platform === "win32")(
  "reports exhausted total input bytes as a deterministic file-size limit",
  async () => {
    const root = await createTestTempDirectory("rea-recovery-allowance-");
    const exact = join(root, "exact.js");
    await writeFile(exact, Buffer.alloc(MAXIMUM, 32));
    const [admitted] = await snapshotRecoveryInputs(
      [exact],
      join(root, "snapshot"),
    );
    expect(admitted.bytes).toBe(MAXIMUM);

    const over = join(root, "over.js");
    await writeFile(over, Buffer.alloc(MAXIMUM + 1, 32));
    const single = await recover(root, over);
    expect(single).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      details: {
        operation: "recover_javascript_sources",
        resource: "file-size",
        reported_limits: {
          maximum_input_bytes: MAXIMUM,
          remaining_input_bytes: MAXIMUM,
        },
      },
    });
    expect(single.message).not.toMatch(/Invalid analysis output/u);
    expect(single.remediation.action).toMatch(/retrying the unchanged/u);

    // A selection whose total exceeds the allowance reports what remained.
    const primary = join(root, "primary.js");
    await writeFile(primary, "module.exports = 1;\n");
    const multiple = await recover(root, primary, [exact]);
    expect(multiple).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      details: {
        resource: "file-size",
        reported_limits: {
          maximum_input_bytes: MAXIMUM,
          remaining_input_bytes: MAXIMUM - 20,
        },
      },
    });
  },
);

it("keeps malformed UTF-8 an input-format refusal distinct from size", async () => {
  const root = await createTestTempDirectory("rea-recovery-encoding-");
  const invalid = join(root, "invalid.js");
  await writeFile(invalid, Buffer.from([0xff]));
  const projection = await recover(root, invalid);
  expect(projection).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["path"], reason: "invalid_format" }],
    },
  });
  expect(projection.details).not.toHaveProperty("resource");
});
