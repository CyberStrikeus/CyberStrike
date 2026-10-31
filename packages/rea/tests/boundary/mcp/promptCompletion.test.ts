import { ok as resultOk } from "../../../src/domain/result.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import {
  createAnalysisExecution,
  type AnalysisClient,
} from "../../../src/application/AnalysisProvider.js";
import type { AnalysisProfileCommitment } from "../../../src/domain/analysisProfile.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { PROCESS_CAPTURE_REFERENCE } from "../../../src/contracts/investigationExamples.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import {
  artifactInspectionResultSchema,
  createArtifactInspection,
} from "../../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { createPromptCompletionSource } from "../../../src/server/promptCompletion.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { fragmentInventoryEvidence } from "../../fixtures/artifactEvidence.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";

let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("guided prompt completion from live analysis", () => {
  it("reads live documents and complete procedures without ambiguous names", async () => {
    const requests: Array<Readonly<Record<string, unknown>>> = [];
    const session = createTestBinarySession(
      (_target, profile) => client(requests, profile),
      {
        resolveAnalysisProfile: () =>
          Promise.resolve(
            resultOk({
              profile: createAnalysisProfile(
                {
                  id: "fixture",
                  name: "Fixture analysis provider",
                  version: "1",
                },
                { fixture: true },
              ),
            }),
          ),
      },
    );
    directory = await createTestTempDirectory("rea-prompt-completion-");
    const target = join(directory, "fixture.hop");
    await writeFile(target, "fixture");
    expect((await session.open(target)).ok).toBe(true);
    const completion = createPromptCompletionSource(session, session);
    expect(await completion.complete("document", "app")).toEqual([]);
    expect(await completion.complete("procedure", "")).toEqual([]);
    const warmed = await session.execute("list_documents", {});
    if (!warmed.ok) throw warmed.error;

    expect(await completion.complete("document", "app")).toEqual([
      "App",
      "AppTests",
    ]);
    expect(
      await completion.complete("procedure", "", {
        arguments: { document: "App" },
      }),
    ).toEqual(["0x1000", "0x2000", "0x3000", "0x4000", "tail", "unique"]);
    expect(requests).toEqual([{ document: "App" }]);
    expect(await completion.complete("provider", "fix")).toEqual(["fixture"]);
    expect(await completion.complete("document", "x".repeat(4_097))).toEqual(
      [],
    );

    await session.close();
    expect(await completion.complete("document", "")).toEqual([]);
    expect(await completion.complete("procedure", "")).toEqual([]);
  });
});

it("offers only captures admitted by the process comparison identity", async () => {
  const session = createTestBinarySession(() => client([]));
  const captureResult = jsonValueSchema.parse(EMPTY_PROCESS_CAPTURE_EXAMPLE);
  const unsupportedProvider = createEvidence(undefined, fixtureProvider, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: {},
    result: captureResult,
    confidence: "observed",
    authority: "controlled-replay",
    environment: fixtureEnvironment,
  });
  const wrongPredicate = createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.other-process-data",
    operation: "capture_process_scenario",
    parameters: {},
    result: captureResult,
    confidence: "observed",
    authority: "controlled-replay",
    environment: fixtureEnvironment,
  });
  for (const evidence of [
    PROCESS_CAPTURE_REFERENCE,
    unsupportedProvider,
    wrongPredicate,
  ])
    expect(session.recordEvidence(evidence).ok).toBe(true);
  const completion = createPromptCompletionSource(session, session);

  expect(await completion.complete("capture", "ev_")).toEqual([
    PROCESS_CAPTURE_REFERENCE.evidence_id,
  ]);

  await session.close();
});

describe("guided prompt completion from investigation records", () => {
  it("excludes process captures missing canonical executable identity", async () => {
    const session = createTestBinarySession(() => client([]));
    const {
      selected_executable_sha256: _selectedDigest,
      executable_identity: _identity,
      executable_sha256,
      ...legacyManifest
    } = EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest;
    const legacyCapture = {
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
      manifest: { ...legacyManifest, executable_sha256 },
    };
    const evidence = createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: legacyCapture,
      confidence: "observed",
      authority: "controlled-replay",
      environment: fixtureEnvironment,
    });
    expect(session.recordEvidence(evidence).ok).toBe(true);
    const completion = createPromptCompletionSource(session, session);

    expect(
      await completion.complete("capture", evidence.evidence_id.slice(0, 8)),
    ).toEqual([]);

    await session.close();
  });

  it("projects only validated typed identifiers from the evidence ledger", async () => {
    const session = createTestBinarySession(() => client([]));
    const invalidCapture = createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: {},
      confidence: "observed",
      authority: "controlled-replay",
      environment: fixtureEnvironment,
    });
    const invalidInventory = createEvidence(undefined, fixtureProvider, {
      operation: "fixture_inventory",
      parameters: {},
      result: ARTIFACT_COMPARISON_EXAMPLE.right.normalized_result,
      confidence: "observed",
      authority: "shipped-artifact",
    });
    const inventoryInspection = createArtifactInspection(
      ARTIFACT_COMPARISON_EXAMPLE.left,
    );
    const inventory = artifactInventoryResultSchema.parse(
      ARTIFACT_COMPARISON_EXAMPLE.left.normalized_result,
    );
    const inspectionEvidence = createEvidence(undefined, fixtureProvider, {
      operation: "inspect_artifact",
      parameters: {},
      result: inventoryInspection,
      confidence: "observed",
      authority: "shipped-artifact",
      evidenceLinks: inventoryInspection.evidence_links,
    });
    for (const evidence of [
      ARTIFACT_COMPARISON_EXAMPLE.left,
      inspectionEvidence,
      PROCESS_CAPTURE_REFERENCE,
      invalidCapture,
      invalidInventory,
    ])
      expect(session.recordEvidence(evidence).ok).toBe(true);
    const unknown = session.recordUnknown({
      question: "Which branch handles the fallback?",
      severity: "medium",
      domain: "control-flow",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      required_authority: "analyst-inference",
      required_confidence: "derived",
      required_environment: null,
      recommended_probes: [],
      relationships: [],
    });
    if (!unknown.ok) throw unknown.error;
    const completion = createPromptCompletionSource(session, session);

    expect(await completion.complete("capture", "ev_")).toEqual([
      PROCESS_CAPTURE_REFERENCE.evidence_id,
    ]);
    expect(await completion.complete("manifest", "agm_")).toEqual([
      inventory.manifest.manifest_id,
    ]);
    expect(await completion.complete("occurrence", "occ_")).toEqual(
      inventory.occurrences.map(({ occurrence_id }) => occurrence_id),
    );
    expect(await completion.complete("unknown", "unk_")).toEqual([
      unknown.value.unknown_id,
    ]);

    const resolved = session.updateUnknown({
      unknown_id: unknown.value.unknown_id,
      expected_revision: unknown.value.revision,
      status: "resolved",
      severity: unknown.value.severity,
      supporting_evidence_ids: unknown.value.supporting_evidence_ids,
      contradicting_evidence_ids: unknown.value.contradicting_evidence_ids,
      required_authority: unknown.value.required_authority,
      required_confidence: unknown.value.required_confidence,
      required_environment: unknown.value.required_environment,
      recommended_probes: unknown.value.recommended_probes,
      relationships: unknown.value.relationships,
      resolution: {
        disposition: "withdrawn",
        rationale: "The requested fallback is outside the current scope.",
        evidence_ids: [],
      },
    });
    expect(resolved.ok).toBe(true);
    expect(await completion.complete("unknown", "")).toEqual([]);

    await session.close();
    expect(await completion.complete("evidence", "ev_")).toEqual([]);
  });
});

describe("guided prompt completion from retained records", () => {
  it("offers identifiers from every authenticated page in one inspection inventory", async () => {
    const session = createTestBinarySession(() => client([]));
    const { evidence: inspectionEvidence, inventory: completeInventory } =
      await createPagedInspectionEvidence();
    expect(session.recordEvidence(inspectionEvidence).ok).toBe(true);
    const completion = createPromptCompletionSource(session, session);
    const pages = artifactInspectionResultSchema.parse(
      inspectionEvidence.normalized_result,
    ).substeps;
    const firstPage = pages[0]?.evidence.normalized_result;
    const laterPage = pages[1]?.evidence.normalized_result;
    if (firstPage === undefined || laterPage === undefined)
      throw new Error("paged inspection fixture must contain two pages");
    expect(
      artifactInventoryResultSchema.parse(firstPage).occurrences.length,
    ).toBeLessThan(completeInventory.occurrences.length);
    expect(
      artifactInventoryResultSchema.parse(laterPage).occurrences.length,
    ).toBeGreaterThan(0);

    expect(await completion.complete("manifest", "agm_")).toEqual([
      completeInventory.manifest.manifest_id,
    ]);
    expect(await completion.complete("occurrence", "occ_")).toEqual(
      completeInventory.occurrences
        .map(({ occurrence_id }) => occurrence_id)
        .sort(),
    );

    await session.close();
  });

  it.each([
    "child",
    "coverage",
    "substep-link",
    "declared-subject",
    "carrier-subject",
  ] as const)(
    "rejects inspection completions when %s is invalid",
    async (corruption) => {
      const session = createTestBinarySession(() => client([]));
      const { evidence: inspectionEvidence } =
        await createPagedInspectionEvidence(corruption);
      expect(session.recordEvidence(inspectionEvidence).ok).toBe(true);
      const completion = createPromptCompletionSource(session, session);

      expect(await completion.complete("manifest", "agm_")).toEqual([]);
      expect(await completion.complete("occurrence", "occ_")).toEqual([]);

      await session.close();
    },
  );

  it("still completes a valid standalone inventory Evidence", async () => {
    const session = createTestBinarySession(() => client([]));
    const inventoryEvidence = ARTIFACT_COMPARISON_EXAMPLE.left;
    expect(session.recordEvidence(inventoryEvidence).ok).toBe(true);
    const completion = createPromptCompletionSource(session, session);
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );

    expect(await completion.complete("manifest", "agm_")).toEqual([
      inventory.manifest.manifest_id,
    ]);
    expect(await completion.complete("occurrence", "occ_")).toEqual(
      inventory.occurrences.map(({ occurrence_id }) => occurrence_id).sort(),
    );

    await session.close();
  });

  it("deduplicates, case-folds, and returns deterministic live evidence IDs", async () => {
    const session = createTestBinarySession(() => client([]));
    for (let index = 149; index >= 0; index -= 1) {
      const evidence = createEvidence(undefined, fixtureProvider, {
        operation: `fixture-${String(index)}`,
        parameters: { index },
        result: index,
        confidence: "derived",
        authority: "analyst-inference",
      });
      expect(session.recordEvidence(evidence).ok).toBe(true);
      expect(session.recordEvidence(evidence).ok).toBe(true);
    }
    const completion = createPromptCompletionSource(session, session);
    const values = await completion.complete("evidence", "EV_");
    expect(values).toHaveLength(150);
    expect(values).toEqual([...values].sort());
  });
});

describe("guided prompt completion from complete inventories", () => {
  it("reads every procedure in one provider call", async () => {
    let calls = 0;
    const procedures = Array.from({ length: 6_000 }, (_, address) => ({
      address: `0x${address.toString(16).padStart(8, "0")}`,
      value: `procedure_${String(address)}`,
    }));
    const bounded = createPromptCompletionSource({
      execute(_operation, parameters) {
        calls += 1;
        expect(parameters).toEqual({});
        return Promise.resolve(observed(procedures));
      },
    });
    const values = await bounded.complete("procedure", "");
    expect(calls).toBe(1);
    expect(values).toHaveLength(12_000);
    expect(values).toContain("0x00000000");
  });

  it("normalizes Unicode prefixes while preserving distinct exact identifiers", async () => {
    const completion = createPromptCompletionSource({
      execute(operation) {
        return Promise.resolve(
          observed(
            operation === "list_documents"
              ? ["Ａpp", "App", "app", "Zulu"]
              : null,
          ),
        );
      },
    });
    expect(await completion.complete("document", "ＡＰ")).toEqual([
      "App",
      "app",
      "Ａpp",
    ]);

    const malformed = createPromptCompletionSource({
      execute: () => Promise.resolve(observed(["valid", 1])),
    });
    expect(await malformed.complete("document", "")).toEqual([]);
  });
});

const fixtureProvider = { id: "fixture", name: "Fixture", version: "1" };
const fixtureEnvironment = {
  id: "fixture-linux",
  platform: "linux",
  architecture: "x86_64",
  isolation: "process" as const,
};

type InspectionCorruption =
  | "child"
  | "coverage"
  | "substep-link"
  | "declared-subject"
  | "carrier-subject";

const createPagedInspectionEvidence = async (
  corruption?: InspectionCorruption,
) => {
  directory = await createTestTempDirectory("rea-prompt-inspection-pages-");
  const path = join(directory, "fixture.app");
  await mkdir(path);
  await Promise.all([
    writeFile(join(path, "first.js"), "first();"),
    writeFile(join(path, "second.js"), "second();"),
  ]);
  const inventoryResult = await inventoryArtifact(path);
  const source = createEvidence(
    {
      path,
      sha256: inventoryResult.manifest.root_sha256,
      format: inventoryResult.manifest.root_format,
    },
    fixtureProvider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventoryResult,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
  const pages = fragmentInventoryEvidence(source, 2);
  const firstPage = pages[0];
  if (firstPage === undefined) throw new Error("missing first inventory page");
  const base = createArtifactInspection(firstPage);
  const { inspection_id: _inspectionId, ...baseSemantic } = base;
  const substeps = pages.map((evidence) => ({
    substep_id: `ais_${digestCanonicalValue(
      { operation: "inventory_artifact", evidence_id: evidence.evidence_id },
      "Artifact inspection",
    )}`,
    operation: "inventory_artifact" as const,
    status: "completed" as const,
    evidence_id: evidence.evidence_id,
    evidence,
  }));
  const linkedEvidenceIds = [
    ...base.evidence_links,
    ...pages.map(({ evidence_id }) => evidence_id),
  ].sort();
  let inspection = {
    ...baseSemantic,
    substeps,
    evidence_links: [...new Set(linkedEvidenceIds)],
    coverage: {
      ...base.coverage,
      substeps_completed: pages.length,
    },
  };

  if (corruption === "child") {
    const first = inspection.substeps[0];
    if (first === undefined) throw new Error("missing first inspection step");
    const inventory = artifactInventoryResultSchema.parse(
      first.evidence.normalized_result,
    );
    inspection = {
      ...inspection,
      substeps: [
        {
          ...first,
          evidence: {
            ...first.evidence,
            normalized_result: {
              ...inventory,
              limitations: [...inventory.limitations, "Changed after sealing"],
            },
          },
        },
        ...inspection.substeps.slice(1),
      ],
    };
  } else if (corruption === "coverage") {
    inspection = {
      ...inspection,
      coverage: {
        ...inspection.coverage,
        substeps_completed: inspection.substeps.length + 1,
      },
    };
  } else if (corruption === "substep-link") {
    const first = inspection.substeps[0];
    if (first === undefined) throw new Error("missing first inspection step");
    inspection = {
      ...inspection,
      substeps: [
        { ...first, evidence_id: `ev_${"f".repeat(64)}` },
        ...inspection.substeps.slice(1),
      ],
    };
  } else if (corruption === "declared-subject") {
    inspection = {
      ...inspection,
      subject: {
        ...inspection.subject,
        root_artifact_id: `art_${"f".repeat(64)}`,
      },
    };
  }

  const semantic = inspection;
  const result = {
    ...semantic,
    inspection_id: `ai_${digestCanonicalValue(semantic, "Artifact inspection")}`,
  };
  const target = source.subject;
  if (target === null) throw new Error("fixture inventory has no subject");
  const evidence = createEvidence(
    {
      path: target.local_path,
      sha256:
        corruption === "carrier-subject"
          ? "a".repeat(64)
          : target.digest.sha256,
      format: target.format,
    },
    fixtureProvider,
    {
      operation: "inspect_artifact",
      parameters: {},
      result: result,
      confidence: "observed",
      authority: "shipped-artifact",
      evidenceLinks: result.evidence_links,
    },
  );
  return { evidence, inventory: inventoryResult };
};

const client = (
  requests: Array<Readonly<Record<string, unknown>>>,
  analysisProfile?: AnalysisProfileCommitment,
): AnalysisClient => {
  const observe = (value: unknown) =>
    resultOk(
      createAnalysisExecution(
        value,
        analysisProfile?.provider ?? fixtureProvider,
        analysisProfile === undefined ? {} : { analysisProfile },
      ),
    );
  const execute: AnalysisClient["execute"] = (operation, parameters) => {
    if (operation === "list_documents")
      return Promise.resolve(observe(["AppTests", "App", "App"]));
    if (operation === "list_procedures") {
      requests.push(parameters);
      return Promise.resolve(
        observe([
          { address: "0x1000", value: "duplicate" },
          { address: "0x2000", value: "unique" },
          { address: "0x3000", value: "duplicate" },
          { address: "0x4000", value: "tail" },
        ]),
      );
    }
    return Promise.resolve(observe(null));
  };
  return {
    execute,
    executeIfReady: execute,
    close: () => Promise.resolve(resultOk(null)),
  };
};
