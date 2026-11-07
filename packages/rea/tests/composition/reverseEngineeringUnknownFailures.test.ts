import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { ReverseEngineeringService } from "../../src/application/reverse/ReverseEngineeringService.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

it.each([
  { stage: "stat", cause: null },
  { stage: "stat", cause: undefined },
  { stage: "command", cause: null },
  { stage: "command", cause: undefined },
] as const)(
  "preserves a $cause rejection from $stage without throwing while classifying it",
  async ({ stage, cause }) => {
    const root = await createTestTempDirectory("rea-reverse-unknown-failure-");
    const path = join(root, "input.bin");
    await writeFile(path, new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
    const run = vi.fn(async () => {
      throw cause;
    });
    const service = new ReverseEngineeringService({
      stat:
        stage === "stat"
          ? async () => {
              throw cause;
            }
          : stat,
      run,
      commands: {
        objdump: () => ({
          executable: "unused-objdump",
          arguments: [path],
          identity: { id: "test.objdump", name: "Test objdump", version: null },
        }),
        rizin: () => ({
          executable: "unused-rizin",
          arguments: [path],
          identity: { id: "test.rizin", name: "Test Rizin", version: null },
        }),
      },
    });

    const result = await service.inspectWithObjdump({
      path,
      operation: "symbols",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected injected boundary rejection");
    expect(result.error.cause).toBe(cause);
    const projected = projectAnalysisError(result.error);
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
    expect(projected.code).toBe(
      stage === "stat" ? "execution_failure" : "capability_unavailable",
    );
    if (stage === "stat") expect(run).not.toHaveBeenCalled();
    else expect(run).toHaveBeenCalledOnce();
    await service.close();
  },
);
