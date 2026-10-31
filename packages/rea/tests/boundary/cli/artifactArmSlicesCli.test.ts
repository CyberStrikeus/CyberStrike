import { rm } from "node:fs/promises";
import { describe, expect } from "vitest";
import { z } from "zod";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import {
  createArmSliceFixture,
  expectArmSliceExtraction,
  expectArmSliceInventory,
} from "../../fixtures/machoArmSlices.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const envelope = z.object({ ok: z.literal(true), data: z.unknown() });

describe.skipIf(process.platform !== "darwin")(
  "ARM slice CLI with system lipo",
  () => {
    cliTest(
      "inspects and extracts exact ARM subtype slices",
      async ({ cli, onTestFinished }) => {
        const fixture = await createArmSliceFixture();
        const inspected = await cli.run({
          arguments: [
            "inspect-artifact",
            fixture.path,
            "--json",
            "--full-output",
          ],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
        const manifest = expectArmSliceInventory(
          parseEvidence(envelope.parse(inspected.json).data).normalized_result,
          fixture,
        );
        const result = await cli.run({
          arguments: [
            "extract-artifact",
            fixture.path,
            "--json",
            "--full-output",
          ],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        const extracted = artifactExtractionResultSchema.parse(
          parseEvidence(envelope.parse(result.json).data).normalized_result,
        );
        onTestFinished(() =>
          rm(extracted.output_root, { recursive: true, force: true }),
        );
        expect(await expectArmSliceExtraction(extracted, fixture)).toEqual(
          manifest,
        );
      },
    );
  },
);
