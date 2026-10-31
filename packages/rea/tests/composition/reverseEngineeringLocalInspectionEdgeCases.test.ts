import { rm } from "node:fs/promises";
import { createArtifact } from "../support/reverseEngineeringCompositionFixtures.js";

import { expect, it, vi } from "vitest";

import { TestReverseEngineeringService as ReverseEngineeringService } from "../support/reverseEngineeringService.js";

it("rejects NUL in a Rizin command before touching the provider", async () => {
  const { directory, path } = await createArtifact();
  let invoked = false;
  const service = new ReverseEngineeringService({
    run: async () => {
      invoked = true;
      return { stdout: "", stderr: "" };
    },
  });

  try {
    const result = await service.executeRizinCommand({
      path,
      command: "wx\u0000 00",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "execute_rizin_command" },
    });
    expect(invoked).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
