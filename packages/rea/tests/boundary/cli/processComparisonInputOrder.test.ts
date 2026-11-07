import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { PROCESS_CAPTURE_REFERENCE } from "../../../src/contracts/investigationExamples.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["left", "right"] as const)(
  "authenticates the %s capture before reading later selected files",
  async (side, { cli }) => {
    const root = await createTestTempDirectory("rea-process-input-order-");
    await writeFile(
      join(root, "valid.json"),
      JSON.stringify(PROCESS_CAPTURE_REFERENCE),
    );
    await writeFile(
      join(root, "invalid.json"),
      JSON.stringify({
        ...PROCESS_CAPTURE_REFERENCE,
        evidence_id: `ev_${"0".repeat(64)}`,
      }),
    );
    const result = await cli.run({
      arguments: [
        "compare-process-captures",
        side === "left" ? "invalid.json" : "valid.json",
        side === "left" ? "missing-right.json" : "invalid.json",
        "missing-trace.json",
        "--json",
      ],
      cwd: root,
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ["evidence_id"] }),
        ]),
      },
    });
  },
);
