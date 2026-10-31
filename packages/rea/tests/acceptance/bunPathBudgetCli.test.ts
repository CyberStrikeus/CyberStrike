import { writeFile } from "node:fs/promises";
import { expect } from "vitest";
import { workspaceCliTest as test } from "../support/cli/workspaceCliFixture.js";
import { artifactFixedLimitFailure } from "../../src/artifacts/ArtifactReader.js";
import {
  bunModuleGraphPayload,
  elfAppendedBunPayload,
} from "../../src/artifacts/bun/BunStandalone.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";

for (const shared of [false, true])
  test(`bounds combined Bun path growth with shared prefixes: ${String(shared)}`, async ({
    cli,
    workspace,
  }) => {
    const modules = Array.from({ length: 1000 }, (_, index) => ({
      name: shared
        ? `/${"a/".repeat(254)}${String(index)}`
        : `/${String(index)}/${"a/".repeat(254)}end`,
      contents: Buffer.alloc(0),
    }));
    const path = workspace.path("paths");
    await writeFile(
      path,
      elfAppendedBunPayload(bunModuleGraphPayload({ modules })),
    );
    const result = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    if (!shared) {
      expect(result.exitCode).toBe(1);
      const limit = artifactFixedLimitFailure(
        "Artifact path tree",
        250_000,
        "path nodes",
      );
      expect(result.json).toMatchObject({
        code: "truncated",
        details: {
          reason: "limit",
          boundary: "capacity",
          detail: limit.message,
        },
      });
    } else {
      expect(result.exitCode, result.stderr).toBe(0);
      const inspected = artifactInspectionResultSchema.parse(
        parseEvidence(result.json).normalized_result,
      );
      expect(inspected.subject.root_format).toBe("bun-standalone");
      const graph = inspected.substeps.find(
        (step) => step.operation === "inventory_artifact",
      )?.evidence.normalized_result;
      expect(graph).toMatchObject({ manifest: { occurrence_count: 1001 } });
    }
  }, 120_000);
