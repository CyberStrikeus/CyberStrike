import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { buildUnityFs } from "../../fixtures/unityfs.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "inspects and extracts UnityFS with virtual coordinates and retained unavailable members",
  async ({ cli, onTestFinished }) => {
    const root = await createTestTempDirectory("rea-unity-cli-");
    const path = join(root, "bundle");
    const payload = Buffer.from("serialized bytes");
    await writeFile(
      path,
      buildUnityFs([{ path: "data..bin", data: payload, flags: 4 }]),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventory = inspection.substeps[0]!.evidence.normalized_result;
    expect(inventory.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "data..bin",
        source_location: null,
        hash_status: "verified",
        format_metadata: {
          kind: "unityfs-entry",
          index: 0,
          source_path: "data..bin",
          declared_offset: 0,
          flags: 4,
        },
      }),
    );
    expect(inventory.nodes).toContainEqual(
      expect.objectContaining({
        sha256: createHash("sha256").update(payload).digest("hex"),
      }),
    );
    const extracted = await cli.run({
      arguments: ["extract-artifact", path, "--json"],
    });
    expect(extracted.exitCode, extracted.stderr).toBe(0);
    const output = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    onTestFinished(() =>
      rm(output.output_root, { recursive: true, force: true }),
    );
    expect(
      (await readFile(join(output.output_root, "data..bin"))).equals(payload),
    ).toBe(true);

    await writeFile(
      path,
      buildUnityFs([{ path: "CAB-lzma", data: payload }], {
        blockCompression: 1,
      }),
    );
    const unavailable = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(unavailable.exitCode, unavailable.stderr).toBe(0);
    const partial = artifactInspectionResultSchema.parse(
      parseEvidence(unavailable.json).normalized_result,
    ).substeps[0]!.evidence.normalized_result;
    expect(partial.coverage).toMatchObject({ status: "unknown" });
    expect(partial.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "CAB-lzma",
        hash_status: "unavailable",
        artifact_id: null,
      }),
    );
    expect(partial.limitations.join(" ")).toContain(
      "compression 1 is unsupported",
    );
  },
);

cliTest(
  "keeps an unsafe declared uint64 size unknown in desktop header facts",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-unity-desktop-");
    await mkdir(join(root, "assets"));
    const bytes = buildUnityFs([{ path: "CAB", data: "bytes" }]);
    bytes.writeBigUInt64BE(2n ** 53n + 1n, 32);
    await writeFile(join(root, "assets", "content.bundle"), bytes);
    const result = await cli.run({
      arguments: ["inspect-desktop-application", root, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseEvidence(result.json).normalized_result).toMatchObject({
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "assets/content.bundle",
          facts: expect.arrayContaining([
            expect.objectContaining({
              kind: "unityfs-header",
              value: expect.objectContaining({ declared_size: null }),
            }),
          ]),
        }),
      ]),
    });
  },
);
