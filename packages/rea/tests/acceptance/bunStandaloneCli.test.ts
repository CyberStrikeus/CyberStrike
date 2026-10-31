import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  bunModuleGraphPayload,
  elfAppendedBunPayload,
} from "../../src/artifacts/bun/BunStandalone.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactInventoryResultSchema,
  artifactExtractionResultSchema,
} from "../../src/domain/artifactGraph.js";

cliTest(
  "inventories and extracts Bun source without executing its carrier",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-bun-cli-");
    const source = join(root, "app");
    const contents = "console.log('Bun fixture');\n";
    await writeFile(
      source,
      elfAppendedBunPayload(
        bunModuleGraphPayload({
          modules: [
            {
              name: "/$bunfs/root/main.js",
              contents: Buffer.from(contents),
              sourcemap: Buffer.from("map"),
              bytecode: Buffer.from([1, 2]),
            },
          ],
        }),
      ),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps.find(
        (step) => step.operation === "inventory_artifact",
      )?.evidence.normalized_result,
    );
    expect(graph.manifest.root_format).toBe("bun-standalone");
    expect(inspection.next_probes).toEqual([
      {
        operation: "extract_artifact",
        authority: "artifact-bytes",
        rationale: expect.any(String),
      },
    ]);
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      kind: "bun-standalone",
      entry_point_id: 0,
      entry_point_logical_path: "$bunfs/root/main.js",
    });
    const module = graph.occurrences.find(
      (row) => row.logical_path === "$bunfs/root/main.js",
    );
    expect(
      graph.nodes.find((node) => node.artifact_id === module?.artifact_id)
        ?.sha256,
    ).toBe(createHash("sha256").update(contents).digest("hex"));
    expect(module).toMatchObject({
      format_metadata: {
        entry_point: true,
        source_name: "/$bunfs/root/main.js",
        sourcemap_bytes: 3,
        bytecode_bytes: 2,
      },
    });
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(result.containment_verified).toBe(true);
    expect(
      await readFile(join(result.output_root, "$bunfs/root/main.js"), "utf8"),
    ).toBe(contents);
  },
);
