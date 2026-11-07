import { artifactInventoryResultSchema } from "./artifactGraph.js";
import {
  artifactIdForContent,
  artifactManifestId,
} from "./artifactIdentity.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { freezeJsonSnapshot } from "./immutableJson.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { ARTIFACT_COMPARISON_EXAMPLE } from "../contracts/artifactComparisonExample.js";
import { createArtifactInspection } from "./artifactInspection.js";
import {
  ArtifactInventoryValidationError,
  ArtifactInventoryCarrierError,
  parseArtifactInventoryEvidence,
  parseArtifactInspectionInventoryResult,
} from "./artifactInventoryEvidence.js";
import { createEvidence } from "./evidence.js";

const inventoryEvidence = ARTIFACT_COMPARISON_EXAMPLE.left;
const target = inventoryEvidence.subject;
if (target === null) throw new Error("Artifact fixture has no target");

const inspectionEvidence = (result: unknown, subject = target) =>
  createEvidence(
    {
      path: subject.local_path,
      sha256: subject.digest.sha256,
      format: subject.format,
    },
    inventoryEvidence.provider,
    {
      operation: "inspect_artifact",
      parameters: {},
      result,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );

const inspection = createArtifactInspection(inventoryEvidence);

it.each([
  { occurrence_id: `occ_${"f".repeat(64)}` },
  { artifact_id: null },
  { artifact_format: "unknown" },
  { entry_kind: "directory" },
  { parent_occurrence_id: `occ_${"f".repeat(64)}` },
])("rejects an invalid root on an incomplete inventory page: %j", (patch) => {
  const inventory = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  const carrier = createEvidence(
    {
      path: target.local_path,
      sha256: target.digest.sha256,
      format: target.format,
    },
    inventoryEvidence.provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: {
        ...inventory,
        nodes: [],
        occurrences: [{ ...inventory.occurrences[0]!, ...patch }],
      },
      confidence: "derived",
      authority: "shipped-artifact",
    },
  );
  expect(() => parseArtifactInventoryEvidence(carrier)).toThrow(
    EvidenceIntegrityError,
  );
});

it("accepts an inspection whose carrier, declaration, and substep identities agree", () => {
  expect(
    parseArtifactInventoryEvidence(inspectionEvidence(inspection)).inventory,
  ).toMatchObject({ complete: true, coverage: { status: "complete" } });
});

it("rejects an inspection carrier whose Evidence subject disagrees with its nested inventory", () => {
  const carrier = inspectionEvidence(inspection, {
    ...target,
    digest: { sha256: "a".repeat(64) },
  });
  try {
    parseArtifactInventoryEvidence(carrier);
    throw new Error("Expected the mismatched subject to be rejected");
  } catch (cause: unknown) {
    expect(cause).toBeInstanceOf(EvidenceIntegrityError);
    expect(cause).toMatchObject({
      message:
        "Artifact inspection Evidence subject does not match its root manifest",
      cause: expect.any(ArtifactInventoryValidationError),
    });
  }
});

it("rejects an inspection declaration whose root manifest disagrees with its nested inventory", () => {
  const mismatched = {
    ...inspection,
    subject: {
      ...inspection.subject,
      root_artifact_id: `art_${"f".repeat(64)}`,
    },
  };
  expect(() =>
    parseArtifactInventoryEvidence(inspectionEvidence(mismatched)),
  ).toThrow(
    "Artifact inspection subject does not match its inventory manifest",
  );
});

it("rejects a substep evidence ID that disagrees with its authenticated nested Evidence", () => {
  const [first, ...remaining] = inspection.substeps;
  if (first === undefined) throw new Error("Expected inventory substep");
  const mismatched = {
    ...inspection,
    substeps: [{ ...first, evidence_id: `ev_${"f".repeat(64)}` }, ...remaining],
  };
  expect(() =>
    parseArtifactInventoryEvidence(inspectionEvidence(mismatched)),
  ).toThrow(
    "Artifact inspection substep evidence ID does not match nested Evidence",
  );
});

it("retains the authenticated parent's nested facts without a second inventory copy", () => {
  const owned = freezeJsonSnapshot(createArtifactInspection(inventoryEvidence));
  const parsed = parseArtifactInspectionInventoryResult(owned, target);
  expect(parsed.inspection).toBe(owned);
  expect(parsed.inventory.nodes[0]).toBe(
    owned.substeps[0]!.evidence.normalized_result.nodes[0],
  );
});

it.each([0, 1])(
  "locates a stale nested Evidence ID at substep %i and retains its cause",
  (index) => {
    const input = structuredClone(inspection);
    input.substeps.push(structuredClone(input.substeps[0]!));
    input.coverage.substeps_completed = input.substeps.length;
    expect(
      parseArtifactInspectionInventoryResult(input, target).inventory.complete,
    ).toBe(true);
    input.substeps[index]!.evidence.evidence_id = `ev_${"f".repeat(64)}`;
    expect(() =>
      parseArtifactInspectionInventoryResult(input, target),
    ).toThrowError(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            path: ["substeps", index, "evidence", "evidence_id"],
          }),
        ],
        cause: expect.any(z.ZodError),
      }),
    );
  },
);

it("keeps a commitment failure discovered across individually incomplete pages as Evidence integrity", () => {
  const complete = artifactInventoryResultSchema.parse(
    inventoryEvidence.normalized_result,
  );
  const graphDigest = "f".repeat(64);
  const manifest = {
    ...complete.manifest,
    graph_sha256: graphDigest,
    manifest_id: artifactManifestId(
      complete.manifest.root_artifact_id,
      graphDigest,
    ),
  };
  const page = (includeNodes: boolean) =>
    createEvidence(
      {
        path: target.local_path,
        sha256: target.digest.sha256,
        format: target.format,
      },
      inventoryEvidence.provider,
      {
        operation: "inventory_artifact",
        parameters: {},
        confidence: "observed",
        authority: "shipped-artifact",
        result: {
          ...complete,
          manifest,
          nodes: includeNodes ? complete.nodes : [],
          occurrences: includeNodes ? [] : complete.occurrences,
        },
      },
    );
  const nodes = page(true);
  const occurrences = page(false);
  expect(parseArtifactInventoryEvidence(nodes).inventory.complete).toBe(false);
  expect(parseArtifactInventoryEvidence(occurrences).inventory.complete).toBe(
    false,
  );
  expect(() => parseArtifactInventoryEvidence([nodes, occurrences])).toThrow(
    EvidenceIntegrityError,
  );
});

it("reports incompatible independently valid manifests as caller composition", () => {
  expect(() =>
    parseArtifactInventoryEvidence([
      ARTIFACT_COMPARISON_EXAMPLE.left,
      ARTIFACT_COMPARISON_EXAMPLE.right,
    ]),
  ).toThrow(ArtifactInventoryCarrierError);
});

it.each(
  (["nodes", "occurrences", "edges"] as const).flatMap((member) =>
    (["single", "assembled"] as const).map((mode) => ({ member, mode })),
  ),
)(
  "rejects $member exceeding the manifest in $mode pages",
  ({ member, mode }) => {
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    const root = inventory.occurrences[0]!;
    const sha256 = "f".repeat(64);
    const members = {
      nodes: [
        inventory.nodes[0]!,
        {
          ...inventory.nodes[0]!,
          sha256,
          artifact_id: artifactIdForContent(sha256),
        },
      ],
      occurrences: [
        root,
        {
          ...root,
          occurrence_id: `occ_${"f".repeat(64)}`,
          logical_path: "child",
        },
      ],
      edges: ["a", "b"].map((digit) => ({
        edge_id: `edge_${digit.repeat(64)}`,
        ordinal: 0,
        parent_artifact_id: inventory.manifest.root_artifact_id,
        relation: "contains" as const,
        occurrence_id: root.occurrence_id,
        producer: null,
      })),
    };
    const manifest = { ...inventory.manifest, edge_count: 1 };
    const page = (indices: readonly number[]) =>
      createEvidence(
        {
          path: target.local_path,
          sha256: target.digest.sha256,
          format: target.format,
        },
        inventoryEvidence.provider,
        {
          operation: "inventory_artifact",
          parameters: {},
          confidence: "observed",
          authority: "shipped-artifact",
          result: {
            ...inventory,
            manifest,
            nodes: [],
            occurrences: [],
            edges: [],
            [member]: indices.map((index) => members[member][index]!),
          },
        },
      );
    const first = page([0]);
    const second = page([1]);
    expect(parseArtifactInventoryEvidence(first).inventory.complete).toBe(
      false,
    );
    expect(parseArtifactInventoryEvidence(second).inventory.complete).toBe(
      false,
    );
    expect(() =>
      parseArtifactInventoryEvidence(
        mode === "single" ? page([0, 1]) : [first, second],
      ),
    ).toThrow(EvidenceIntegrityError);
  },
);
