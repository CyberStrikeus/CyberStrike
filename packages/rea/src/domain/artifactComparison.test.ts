import { expect, it } from "vitest";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../contracts/artifactComparisonExample.js";
import { compareArtifacts } from "./artifactComparison.js";
import {
  artifactInventoryResultSchema,
  type ArtifactNode,
  type ArtifactOccurrence,
} from "./artifactGraph.js";
import { artifactGraphDigest, artifactManifestId } from "./artifactIdentity.js";
import { createEvidence } from "./evidence.js";

/** Recommit observation variants so comparisons exercise valid Evidence carriers. */
const packingObservation = (
  unpacked: boolean | undefined,
  hashStatus: ArtifactOccurrence["hash_status"] = "verified",
  changedContent = false,
  occurrenceChanges: Partial<ArtifactOccurrence> = {},
  nodeChanges: Partial<ArtifactNode> = {},
) => {
  const source = changedContent
    ? ARTIFACT_COMPARISON_EXAMPLE.right
    : ARTIFACT_COMPARISON_EXAMPLE.left;
  const inventory = artifactInventoryResultSchema.parse(
    source.normalized_result,
  );
  inventory.occurrences = inventory.occurrences.map((occurrence) => ({
    ...occurrence,
    ...(unpacked === undefined ? {} : { unpacked }),
    hash_status: hashStatus,
    ...occurrenceChanges,
  }));
  if (occurrenceChanges.artifact_format !== undefined)
    inventory.manifest.root_format = occurrenceChanges.artifact_format;
  inventory.nodes = inventory.nodes.map((node) => ({
    ...node,
    ...nodeChanges,
  }));
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences: inventory.occurrences,
    edges: inventory.edges,
    contradictions: inventory.integrity_contradictions,
  });
  inventory.manifest.graph_sha256 = graphSha256;
  inventory.manifest.manifest_id = artifactManifestId(
    inventory.manifest.root_artifact_id,
    graphSha256,
  );
  return createEvidence(
    {
      path: "packing-observation",
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    source.provider,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

it.each([
  [{ artifact_kind: "unknown" }, { artifact_kind: "javascript" }, "verified"],
  [{ artifact_kind: "javascript" }, { artifact_kind: "unknown" }, "verified"],
  [
    { artifact_format: "unknown" },
    { artifact_format: "javascript-bundle" },
    "verified",
  ],
  [
    { artifact_format: "javascript-bundle" },
    { artifact_format: "unknown" },
    "verified",
  ],
  [
    { artifact_kind: "unknown" },
    { artifact_kind: "javascript" },
    "unavailable",
  ],
  [
    { artifact_format: "unknown" },
    { artifact_format: "javascript-bundle" },
    "unavailable",
  ],
] as const)(
  "keeps an unknown occurrence classification uncertain",
  (left, right, hashStatus) => {
    const result = compareArtifacts(
      packingObservation(undefined, hashStatus, false, left),
      packingObservation(undefined, "verified", false, right),
    );
    expect(result).toMatchObject({
      status: "unknown",
      changes: [{ classification: "unknown", dimensions: ["availability"] }],
    });
  },
);

it("retains definite kind and format changes between known occurrence values", () => {
  const result = compareArtifacts(
    packingObservation(undefined, "verified", false, {
      artifact_kind: "javascript",
      artifact_format: "javascript-bundle",
    }),
    packingObservation(undefined, "verified", false, {
      artifact_kind: "resource",
      artifact_format: "file",
    }),
  );
  expect(result).toMatchObject({
    status: "changed",
    changes: [{ classification: "changed", dimensions: ["kind", "format"] }],
  });
});

it.each(["media_type", "architecture"] as const)(
  "keeps missing node %s uncertain without claiming metadata change",
  (field) => {
    const result = compareArtifacts(
      packingObservation(undefined, "verified", false, {}, { [field]: null }),
      packingObservation(
        undefined,
        "verified",
        false,
        {},
        { [field]: "known" },
      ),
    );
    expect(result).toMatchObject({
      status: "unknown",
      changes: [{ classification: "unknown", dimensions: ["availability"] }],
    });
  },
);

it.each([true, false, undefined])(
  "retains equality for matching packing observations %s",
  (unpacked) => {
    const evidence = packingObservation(unpacked);
    expect(compareArtifacts(evidence, evidence)).toMatchObject({
      status: "unchanged",
      changes: [],
    });
  },
);

it.each([
  [false, true],
  [true, false],
] as const)("compares known packing declarations %s to %s", (left, right) => {
  expect(
    compareArtifacts(packingObservation(left), packingObservation(right)),
  ).toMatchObject({
    status: "changed",
    changes: [{ classification: "changed", dimensions: ["metadata"] }],
  });
});

it.each([
  [true, undefined],
  [undefined, true],
  [false, undefined],
  [undefined, false],
] as const)(
  "keeps missing packing metadata unknown: %s to %s",
  (left, right) => {
    const result = compareArtifacts(
      packingObservation(left),
      packingObservation(right),
    );
    expect(result).toMatchObject({
      status: "unknown",
      changes: [{ classification: "unknown", dimensions: ["availability"] }],
    });
    expect(result.limitations).toEqual([
      expect.stringContaining("omitted metadata may be a legacy observation"),
    ]);
  },
);

it("retains proven content changes alongside unknown packing metadata", () => {
  expect(
    compareArtifacts(
      packingObservation(undefined),
      packingObservation(true, "verified", true),
    ),
  ).toMatchObject({
    status: "changed",
    changes: [
      { classification: "changed", dimensions: ["content", "availability"] },
    ],
  });
});

it("retains known packing changes when content is unavailable", () => {
  expect(
    compareArtifacts(
      packingObservation(false),
      packingObservation(true, "unavailable"),
    ),
  ).toMatchObject({
    status: "changed",
    changes: [
      { classification: "changed", dimensions: ["metadata", "availability"] },
    ],
  });
});

it("keeps unavailable content unknown when packing declarations agree", () => {
  expect(
    compareArtifacts(
      packingObservation(true),
      packingObservation(true, "unavailable"),
    ),
  ).toMatchObject({
    status: "unknown",
    changes: [{ classification: "unknown", dimensions: ["availability"] }],
  });
});

it("keeps integrity contradictions ahead of packing differences", () => {
  expect(
    compareArtifacts(
      packingObservation(false),
      packingObservation(true, "mismatched"),
    ),
  ).toMatchObject({
    status: "contradiction",
    changes: [{ classification: "contradiction", dimensions: ["integrity"] }],
  });
});
