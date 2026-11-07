import { projectCliAnalysisResult } from "../../../../src/cli/projectCliAnalysisResult.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { createDirectAnalysis } from "../../../../src/composition/directAnalysis.js";
import { createArtifactBinarySession } from "../../../../src/composition/binary.js";
import { thinMach } from "../../../../src/domain/binaryTarget.fixture.js";
import { interfaceBuilderAnalysisSchema } from "../../../../src/domain/apple/interfaceBuilderGraph.js";
import { artifactInspectionResultSchema } from "../../../../src/domain/artifactInspection.js";
import { createAnalysisExecutionEvidence } from "../../../../src/domain/analysisObservation.js";
import { immutableJsonSnapshotMember } from "../../../../src/domain/immutableJson.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";

const { runProviderAnalysis } = createDirectAnalysis({});

it("runs static .app decoding without registering native analysis engines", async () => {
  const root = await createTestTempDirectory("rea-artifact-only-direct-");
  const app = join(root, "Fixture.app");
  const contents = join(app, "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await mkdir(join(contents, "Resources"), { recursive: true });
  await writeFile(
    join(contents, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  await writeFile(
    join(contents, "MacOS", "Fixture"),
    thinMach(0xfeedfacf, 0x0100000c),
  );

  const staticSession = await createArtifactBinarySession({
    REA_ANALYSIS_PROVIDER: "auto",
  });
  expect(await staticSession.status()).toMatchObject({
    analysis_provider_candidates: [],
  });
  await staticSession.close();

  const evidence = parseEvidence(
    await createDirectAnalysis({
      REA_ANALYSIS_PROVIDER: "auto",
    })
      .runProviderAnalysis(app, "decode_interface_builder", {})
      .then(projectCliAnalysisResult),
  );
  expect(evidence.operation).toBe("decode_interface_builder");
  expect(evidence.provider.id).toBe("rea-artifact-graph");
  const result = interfaceBuilderAnalysisSchema.parse(
    evidence.normalized_result,
  );
  expect(result.documents).toEqual([]);
  expect(result.graph.target_sha256).toBe(
    evidence.subject?.digest.sha256 ?? null,
  );
});

it("inspects an artifact through the direct CLI workflow without an REA grant", async () => {
  const root = await createTestTempDirectory("rea-artifact-direct-");
  const source = join(root, "source");
  const archive = join(root, "fixture.asar");
  await mkdir(source);
  await writeFile(join(source, "main.js"), "console.log('ok');\n");
  await createPackageWithOptions(source, archive, {});

  const evidence = parseEvidence(
    await runProviderAnalysis(archive, "inspect_artifact", {}).then(
      projectCliAnalysisResult,
    ),
  );
  expect(evidence.operation).toBe("inspect_artifact");
  expect(evidence.provider.id).toBe("rea-artifact-graph");
  const inspection = artifactInspectionResultSchema.parse(
    evidence.normalized_result,
  );
  expect(inspection.subject.root_format).toBe("asar");
  expect(inspection.substeps[0]?.evidence.normalized_result).toMatchObject({
    occurrences: expect.arrayContaining([
      expect.objectContaining({ logical_path: "main.js" }),
    ]),
  });

  const staticSession = await createArtifactBinarySession({});
  try {
    const opened = await staticSession.open(archive);
    if (!opened.ok) throw opened.error;
    const executed = await staticSession.execute("inspect_artifact", {});
    if (!executed.ok) throw executed.error;
    const sessionInspection = artifactInspectionResultSchema.parse(
      executed.value.result,
    );
    expect(sessionInspection.evidence_links).toEqual(
      sessionInspection.substeps.map(
        ({ evidence: sourceEvidence }) => sourceEvidence.evidence_id,
      ),
    );
    const substeps = immutableJsonSnapshotMember(
      executed.value.result,
      "substeps",
    );
    const sources = executed.value.sourceEvidence;
    expect(sources).toHaveLength(sessionInspection.substeps.length);
    if (sources === undefined)
      throw new Error("Missing committed inspection sources");
    for (const [index, sourceEvidence] of sources.entries()) {
      const step = immutableJsonSnapshotMember(substeps, String(index));
      expect(sourceEvidence).toBe(
        immutableJsonSnapshotMember(step, "evidence"),
      );
    }
    const parent = createAnalysisExecutionEvidence(
      "inspect_artifact",
      {},
      executed.value,
      "observed",
    );
    expect(parent.evidence_links).toEqual(sessionInspection.evidence_links);
  } finally {
    const closed = await staticSession.close();
    if (!closed.ok) throw closed.error;
  }
});
