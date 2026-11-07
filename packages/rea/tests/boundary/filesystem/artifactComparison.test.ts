import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import { fragmentInventoryEvidence } from "../../fixtures/artifactEvidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import {
  artifactComparisonResultSchema,
  compareArtifacts,
} from "../../../src/domain/artifactComparison.js";
import { parseArtifactInventoryEvidence } from "../../../src/domain/artifactInventoryEvidence.js";
import { createEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { jsonValueSchema } from "../../../src/domain/jsonValue.js";

const PROVIDER = {
  id: "rea-artifact-graph",
  name: "REA artifact graph",
  version: "1",
} as const;

const observe = async (path: string) => {
  const inventory = await inventoryArtifact(path);
  return createEvidence(
    {
      path,
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    PROVIDER,
    {
      operation: "inventory_artifact",
      parameters: {},
      result: inventory,
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

const inspectPages = (
  pages: readonly Evidence[],
  substepsCompleted = pages.length,
) => {
  const first = pages[0];
  if (first === undefined) throw new Error("Missing inspection page");
  const inventory = artifactInventoryResultSchema.parse(
    first.normalized_result,
  );
  return createEvidence(
    {
      path: "artifact-inspection-example",
      sha256: inventory.manifest.root_sha256,
      format: inventory.manifest.root_format,
    },
    PROVIDER,
    {
      operation: "inspect_artifact",
      parameters: {},
      result: {
        inspection_id: `ai_${"f".repeat(64)}`,
        subject: {
          manifest_id: inventory.manifest.manifest_id,
          root_artifact_id: inventory.manifest.root_artifact_id,
          root_sha256: inventory.manifest.root_sha256,
          root_format: inventory.manifest.root_format,
        },
        substeps: pages.map((evidence, index) => ({
          substep_id: `ais_${(index + 1).toString(16).padStart(64, "0")}`,
          operation: "inventory_artifact",
          status: "completed",
          evidence_id: evidence.evidence_id,
          evidence,
        })),
        observations: [],
        hypotheses: [],
        contradictions: [],
        unexplored_branches: [],
        next_probes: [],
        coverage: {
          status: "complete-within-substeps",
          substeps_completed: substepsCompleted,
          observations_retained: 0,
          observations_omitted: 0,
          hypotheses_retained: 0,
          hypotheses_omitted: 0,
          unexplored_branches_retained: 0,
          unexplored_branches_omitted: 0,
          next_probes_retained: 0,
          next_probes_omitted: 0,
        },
        evidence_links: pages.map(({ evidence_id }) => evidence_id),
        limitations: [],
      },
      confidence: "observed",
      authority: "shipped-artifact",
    },
  );
};

const changedArtifactComparison = async () => {
  const parent = await createTestTempDirectory("rea-artifact-compare-");
  const leftPath = join(parent, "left.app");
  const rightPath = join(parent, "right.app");
  await Promise.all([mkdir(leftPath), mkdir(rightPath)]);
  await Promise.all([
    writeFile(join(leftPath, "main.js"), "old();"),
    writeFile(join(leftPath, "same.txt"), "same"),
    writeFile(join(rightPath, "main.js"), "newer();"),
    writeFile(join(rightPath, "same.txt"), "same"),
    writeFile(join(rightPath, "added.txt"), "added"),
  ]);
  const left = await observe(leftPath);
  const right = await observe(rightPath);
  return {
    left,
    right,
    result: compareArtifacts(left, right),
  };
};

describe("leaf artifact comparison", () => {
  it("rejects inventory Evidence without required producer coverage", async () => {
    const root = await createTestTempDirectory("rea-artifact-plist-compare-");
    const leftPath = join(root, "left.plist");
    const xml =
      '<?xml version="1.0"?><plist version="1.0"><dict><key>label</key><string>hello</string></dict></plist>';
    await writeFile(leftPath, xml);
    const left = await observe(leftPath);
    const parsed = artifactInventoryResultSchema.parse(left.normalized_result);
    const { coverage: _coverage, ...withoutCoverage } = parsed;
    const malformed = createEvidence(
      {
        path: left.subject!.local_path,
        sha256: left.subject!.digest.sha256,
        format: left.subject!.format,
      },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: withoutCoverage,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    );
    expect(() => parseArtifactInventoryEvidence(malformed)).toThrow();
  });

  it("keeps content and executable changes visible for complete plist roots", async () => {
    const root = await createTestTempDirectory("rea-artifact-plist-deltas-");
    const leftPath = join(root, "left.plist");
    const rightPath = join(root, "right.plist");
    const plist = (label: string) =>
      `<?xml version="1.0"?><plist version="1.0"><dict><key>label</key><string>${label}</string></dict></plist>`;
    await Promise.all([
      writeFile(leftPath, plist("hello"), { mode: 0o644 }),
      writeFile(rightPath, plist("world"), { mode: 0o644 }),
    ]);
    const [left, changed] = await Promise.all([
      observe(leftPath),
      observe(rightPath),
    ]);
    expect(compareArtifacts(left, changed)).toMatchObject({
      status: "changed",
      summary: { changed: 1, unknown: 0 },
      changes: [
        expect.objectContaining({
          logical_path: ".",
          classification: "changed",
          dimensions: expect.arrayContaining(["content"]),
        }),
      ],
    });

    if (process.platform !== "win32") {
      await writeFile(rightPath, plist("hello"), { mode: 0o644 });
      await chmod(rightPath, 0o755);
      const executable = await observe(rightPath);
      expect(compareArtifacts(left, executable)).toMatchObject({
        status: "changed",
        summary: { changed: 1, unknown: 0 },
        changes: [
          expect.objectContaining({
            logical_path: ".",
            classification: "changed",
            dimensions: expect.arrayContaining(["executable"]),
          }),
        ],
      });
    }
  });
});

describe("artifact inspection inventory substeps", () => {
  it("assembles every paged inventory substep and retains its outer Evidence once", async () => {
    const root = await createTestTempDirectory("rea-inspect-pages-");
    const path = join(root, "fixture.app");
    await mkdir(path);
    await Promise.all([
      writeFile(join(path, "first.js"), "first();"),
      writeFile(join(path, "second.js"), "second();"),
    ]);
    const source = await observe(path);
    const pages = fragmentInventoryEvidence(source, 2);
    const inspection = inspectPages(pages);
    const parsed = parseArtifactInventoryEvidence(inspection);

    expect(parsed.evidence).toEqual([inspection]);
    expect(parsed.inventory.complete).toBe(true);
    expect(parsed.inventory.nodes).toHaveLength(
      artifactInventoryResultSchema.parse(source.normalized_result).nodes
        .length,
    );
  });

  it("rejects inspection substeps with different inventory manifests", async () => {
    const root = await createTestTempDirectory("rea-inspect-mixed-pages-");
    const firstPath = join(root, "first.plist");
    const secondPath = join(root, "second.plist");
    await Promise.all([
      writeFile(
        firstPath,
        '<?xml version="1.0"?><plist version="1.0"><dict><key>a</key><string>1</string></dict></plist>',
      ),
      writeFile(
        secondPath,
        '<?xml version="1.0"?><plist version="1.0"><dict><key>b</key><string>2</string></dict></plist>',
      ),
    ]);

    const inspection = inspectPages([
      await observe(firstPath),
      await observe(secondPath),
    ]);
    expect(() => parseArtifactInventoryEvidence(inspection)).toThrow(
      "Artifact inventory pages do not share one manifest",
    );
  });

  it("rejects inspection coverage counts that disagree with retained substeps", async () => {
    const root = await createTestTempDirectory("rea-inspect-count-mismatch-");
    const path = join(root, "fixture.app");
    await mkdir(path);
    await Promise.all([
      writeFile(join(path, "first.js"), "first();"),
      writeFile(join(path, "second.js"), "second();"),
    ]);
    const pages = fragmentInventoryEvidence(await observe(path), 2);
    const inspection = inspectPages(pages, 1);

    expect(() => parseArtifactInventoryEvidence(inspection)).toThrow(
      "Artifact inspection substep count does not match its coverage declaration",
    );
  });

  it("authenticates later inventory substeps instead of silently ignoring them", async () => {
    const root = await createTestTempDirectory("rea-inspect-invalid-page-");
    const path = join(root, "fixture.app");
    await mkdir(path);
    await writeFile(join(path, "main.js"), "main();");
    const source = await observe(path);
    const [first, later] = fragmentInventoryEvidence(source, 2);
    if (first === undefined || later === undefined)
      throw new Error("Missing inventory page");
    const graph = artifactInventoryResultSchema.parse(later.normalized_result);
    const tamperedLater: Evidence = {
      ...later,
      normalized_result: jsonValueSchema.parse({
        ...graph,
        limitations: ["Changed after this Evidence identifier was computed."],
      }),
    };
    const inspection = inspectPages([first, tamperedLater]);

    expect(() => parseArtifactInventoryEvidence(inspection)).toThrow(
      "Evidence semantic identifier does not match its record",
    );
  });
});

describe("artifact inventory coverage", () => {
  it("uses current unknown coverage without deriving it from limitation prose", async () => {
    const root = await createTestTempDirectory("rea-artifact-coverage-");
    const path = join(root, "complete.plist");
    await writeFile(
      path,
      '<?xml version="1.0"?><plist version="1.0"><dict/></plist>',
    );
    const complete = await observe(path);
    const graph = artifactInventoryResultSchema.parse(
      complete.normalized_result,
    );
    const unknownCoverage = createEvidence(
      {
        path: complete.subject!.local_path,
        sha256: complete.subject!.digest.sha256,
        format: complete.subject!.format,
      },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: {
          ...graph,
          coverage: { scope: "root", status: "unknown" },
          limitations: ["No extra child entries were observed."],
        },
        confidence: "derived",
        authority: "shipped-artifact",
      },
    );
    expect(
      parseArtifactInventoryEvidence(unknownCoverage).inventory.complete,
    ).toBe(true);
    expect(compareArtifacts(unknownCoverage, unknownCoverage)).toMatchObject({
      status: "unknown",
      summary: { unchanged: 0, unknown: 1 },
    });
  });

  it("rejects inventory fragments that disagree on producer coverage", async () => {
    const parent = await createTestTempDirectory("rea-artifact-page-coverage-");
    const path = join(parent, "fixture.app");
    await mkdir(path);
    await writeFile(join(path, "main.js"), "main();");
    const source = await observe(path);
    const fragments = fragmentInventoryEvidence(source, 2);
    const firstFragment = fragments[0];
    const fragment = fragments[1];
    if (firstFragment === undefined || fragment === undefined)
      throw new Error("Missing test fragment");
    const fragmentGraph = artifactInventoryResultSchema.parse(
      fragment.normalized_result,
    );
    const mixed = createEvidence(
      {
        path: fragment.subject!.local_path,
        sha256: fragment.subject!.digest.sha256,
        format: fragment.subject!.format,
      },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: fragment.parameters,
        result: {
          ...fragmentGraph,
          coverage: { ...fragmentGraph.coverage, status: "unknown" },
        },
        confidence: "derived",
        authority: "shipped-artifact",
      },
    );
    expect(() =>
      parseArtifactInventoryEvidence([firstFragment, mixed]),
    ).toThrow("Artifact inventory pages do not share one coverage declaration");
  });
});

describe("artifact comparison", () => {
  it("keeps the canonical public example valid and fully comparable", () => {
    const left = parseArtifactInventoryEvidence(
      ARTIFACT_COMPARISON_EXAMPLE.left,
    );
    const right = parseArtifactInventoryEvidence(
      ARTIFACT_COMPARISON_EXAMPLE.right,
    );

    expect(left.inventory).toMatchObject({
      complete: true,
      coverage: { scope: "root", status: "complete" },
    });
    expect(right.inventory).toMatchObject({
      complete: true,
      coverage: { scope: "root", status: "complete" },
    });
    expect(
      artifactComparisonResultSchema.parse(
        compareArtifacts(
          ARTIFACT_COMPARISON_EXAMPLE.left,
          ARTIFACT_COMPARISON_EXAMPLE.right,
        ),
      ),
    ).toMatchObject({
      status: "changed",
      summary: { changed: 1, unknown: 0 },
      changes: [
        expect.objectContaining({
          logical_path: ".",
          classification: "changed",
          dimensions: expect.arrayContaining(["content"]),
        }),
      ],
    });
  });

  it("classifies deterministic path changes and cites both inventories", async () => {
    const firstObservation = await changedArtifactComparison();
    const secondObservation = await changedArtifactComparison();
    const first = firstObservation.result;
    const second = secondObservation.result;
    expect(first).toEqual(second);
    expect(artifactComparisonResultSchema.parse(first)).toMatchObject({
      status: "changed",
      summary: { added: 1, changed: 2, unknown: 0 },
      changes: expect.arrayContaining([
        expect.objectContaining({ logical_path: "added.txt" }),
      ]),
    });
    expect(first.changes[0]?.evidence_links).toEqual([
      firstObservation.left.evidence_id,
      firstObservation.right.evidence_id,
    ]);
    expect(first.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_path: "added.txt",
          classification: "added",
        }),
        expect.objectContaining({
          logical_path: "main.js",
          classification: "changed",
          dimensions: expect.arrayContaining(["content", "size"]),
        }),
      ]),
    );
  });

  it("reports incomplete inventory as truncated, never unchanged", async () => {
    const root = await createTestTempDirectory("rea-artifact-truncated-");
    await writeFile(join(root, "one.txt"), "one");
    const complete = await observe(root);
    const completeInventory = artifactInventoryResultSchema.parse(
      complete.normalized_result,
    );
    const incomplete = createEvidence(
      {
        path: root,
        sha256: complete.subject?.digest.sha256 ?? "0".repeat(64),
        format: "directory",
      },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: {
          ...completeInventory,
          nodes: [],
        },
        confidence: "observed",
        authority: "shipped-artifact",
        limitations: ["Inventory node observations are unavailable."],
      },
    );
    const comparison = compareArtifacts(incomplete, incomplete);
    expect(comparison).toMatchObject({
      status: "truncated",
      summary: { unchanged: 0, unknown: 2 },
    });
    expect(comparison.limitations).toContain(
      "Left artifact inventory is incomplete.",
    );
  });
});

describe("artifact comparison completeness", () => {
  it("does not infer child changes from root-only coverage", async () => {
    const root = await createTestTempDirectory("rea-artifact-root-coverage-");
    const leftPath = join(root, "left.app");
    const rightPath = join(root, "right.app");
    await Promise.all([mkdir(leftPath), mkdir(rightPath)]);
    await Promise.all([
      writeFile(join(leftPath, "left-only.txt"), "left"),
      writeFile(join(rightPath, "right-only.txt"), "right"),
    ]);
    const [left, right] = await Promise.all([
      observe(leftPath),
      observe(rightPath),
    ]);
    const rootOnly = (evidence: Awaited<ReturnType<typeof observe>>) => {
      const inventory = artifactInventoryResultSchema.parse(
        evidence.normalized_result,
      );
      return createEvidence(
        {
          path: evidence.subject?.local_path ?? "",
          sha256: inventory.manifest.root_sha256,
          format: inventory.manifest.root_format,
        },
        PROVIDER,
        {
          operation: "inventory_artifact",
          parameters: {},
          result: {
            ...inventory,
            coverage: { scope: "root", status: "complete" },
          },
          confidence: "derived",
          authority: "shipped-artifact",
        },
      );
    };
    const compared = compareArtifacts(rootOnly(left), rootOnly(right));
    expect(compared.status).toBe("unknown");
    expect(compared.summary).toMatchObject({ added: 0, removed: 0 });
    expect(
      compared.changes
        .filter(({ logical_path }) => logical_path !== ".")
        .map(({ logical_path, classification }) => ({
          logical_path,
          classification,
        })),
    ).toEqual([
      { logical_path: "left-only.txt", classification: "unknown" },
      { logical_path: "right-only.txt", classification: "unknown" },
    ]);
    expect(compared.limitations).toContain(
      "Container entry coverage is unavailable for child paths.",
    );
  });

  it("compares every graph member for inventories larger than 500 entries", async () => {
    const root = await createTestTempDirectory("rea-artifact-pages-");
    const entryCount = 501;
    await Promise.all(
      Array.from({ length: entryCount }, async (_, index) =>
        writeFile(
          join(root, `file-${String(index).padStart(3, "0")}.txt`),
          String(index),
        ),
      ),
    );
    const complete = await observe(root);
    const graph = artifactInventoryResultSchema.parse(
      complete.normalized_result,
    );
    // The real risk above 500 entries is silent truncation, so assert the
    // manifest counts reconcile with the arrays actually returned and that
    // every written file is present. Deriving from `entryCount` keeps this
    // valid at any size instead of freezing a page boundary.
    expect(graph.manifest.node_count).toBe(graph.nodes.length);
    expect(graph.manifest.occurrence_count).toBe(graph.occurrences.length);
    expect(graph.manifest.edge_count).toBe(graph.edges.length);
    const written = new Set(
      Array.from(
        { length: entryCount },
        (_, index) => `file-${String(index).padStart(3, "0")}.txt`,
      ),
    );
    // Occurrences carry the inventory paths, so completeness is checked there.
    const paths = new Set(
      graph.occurrences.map((occurrence) => occurrence.logical_path),
    );
    expect([...written].filter((path) => !paths.has(path))).toEqual([]);
    expect(
      graph.occurrences.filter(
        (occurrence) => occurrence.entry_kind === "file",
      ),
    ).toHaveLength(entryCount);
    expect(compareArtifacts(complete, complete)).toMatchObject({
      status: "unchanged",
      summary: { unchanged: 502, unknown: 0 },
      changes: [],
    });
  }, 15_000);
});

describe("artifact source-map relationship coverage", () => {
  it("reports when an unchanged map points to changed source content", async () => {
    const root = await createTestTempDirectory("rea-map-target-change-");
    const leftPath = join(root, "left");
    const rightPath = join(root, "right");
    await Promise.all([mkdir(leftPath), mkdir(rightPath)]);
    await Promise.all([
      writeFile(join(leftPath, "main.js"), "/* first source */\n"),
      writeFile(join(rightPath, "main.js"), "/* second source */\n"),
      writeFile(
        join(leftPath, "main.js.map"),
        '{"version":3,"sources":[],"names":[],"mappings":""}',
      ),
      writeFile(
        join(rightPath, "main.js.map"),
        '{"version":3,"sources":[],"names":[],"mappings":""}',
      ),
    ]);
    const [left, right] = await Promise.all([
      observe(leftPath),
      observe(rightPath),
    ]);

    const comparison = compareArtifacts(left, right);
    const leftInventory = parseArtifactInventoryEvidence(left).inventory;
    const rightInventory = parseArtifactInventoryEvidence(right).inventory;
    const leftMap = leftInventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js.map",
    );
    const rightMap = rightInventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js.map",
    );
    expect(leftMap?.artifact_id).toBe(rightMap?.artifact_id);
    expect(comparison.changes).toContainEqual(
      expect.objectContaining({
        logical_path: "main.js.map",
        classification: "changed",
        dimensions: ["relations"],
        left_artifact_id: leftMap?.artifact_id,
        right_artifact_id: rightMap?.artifact_id,
      }),
    );
  });

  it("preserves unknown source-map relationships for duplicate ZIP paths", async () => {
    const root = await createTestTempDirectory("rea-duplicate-source-map-");
    const path = join(root, "duplicate-source-map.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("main.js", new TextReader("first();"), { level: 0 });
    await writer.add("your.js", new TextReader("second();"), { level: 0 });
    await writer.add("main.js.map", new TextReader("{}"), { level: 0 });
    const bytes = Buffer.from(await writer.close());
    for (const [signature, headerSize] of [
      [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 30],
      [Buffer.from([0x50, 0x4b, 0x01, 0x02]), 46],
    ] as const) {
      const first = bytes.indexOf(signature);
      const second = bytes.indexOf(signature, first + 4);
      if (first < 0 || second <= first)
        throw new Error("Expected both source ZIP member headers");
      expect(
        bytes.subarray(second + headerSize, second + headerSize + 7).toString(),
      ).toBe("your.js");
      bytes.write("main.js", second + headerSize);
    }
    await writeFile(path, bytes);

    const evidence = await observe(path);
    const parsed = parseArtifactInventoryEvidence(evidence);
    const { inventory } = parsed;
    const map = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js.map",
    );
    if (map === undefined) throw new Error("Expected source-map occurrence");
    const mapEdge = inventory.edges.find(
      ({ occurrence_id }) => occurrence_id === map.occurrence_id,
    );

    expect(inventory.coverage.status).toBe("unknown");
    expect(map.limitations).toContain(
      'Source-map target is unknown because multiple occurrences share "main.js".',
    );
    expect(mapEdge).toMatchObject({ relation: "contains" });
    expect(mapEdge?.relation).not.toBe("maps-source");
    expect(inventory.integrityContradictions).toEqual([]);
    expect(
      inventory.limitations.some((limitation) =>
        limitation.toLowerCase().includes("integrity"),
      ),
    ).toBe(false);
  });
});

describe("duplicate archive occurrence ownership", () => {
  it("keeps directory ancestry unknown when ZIP directory paths repeat", async () => {
    const root = await createTestTempDirectory(
      "rea-artifact-duplicate-directory-",
    );
    const path = join(root, "duplicate-directories.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("x/", new TextReader(""));
    await writer.add("y/", new TextReader(""));
    await writer.add("x/file.txt", new TextReader("member"));
    const bytes = Buffer.from(await writer.close());
    for (const [signature, headerSize] of [
      [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 30],
      [Buffer.from([0x50, 0x4b, 0x01, 0x02]), 46],
    ] as const) {
      const first = bytes.indexOf(signature);
      const second = bytes.indexOf(signature, first + 4);
      if (first < 0 || second <= first)
        throw new Error("Expected both ZIP directory headers");
      expect(
        bytes.subarray(second + headerSize, second + headerSize + 2).toString(),
      ).toBe("y/");
      bytes.write("x/", second + headerSize);
    }
    await writeFile(path, bytes);

    const evidence = await observe(path);
    const inventory = parseArtifactInventoryEvidence(evidence).inventory;
    const directory = inventory.occurrences.filter(
      ({ logical_path }) => logical_path === "x",
    );
    const child = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "x/file.txt",
    );
    expect(directory).toHaveLength(2);
    expect(directory.every(({ artifact_id }) => artifact_id === null)).toBe(
      true,
    );
    expect(child?.parent_occurrence_id).toBeNull();
    expect(child?.limitations).toContain(
      'The parent occurrence for "x/file.txt" is unknown because multiple observed directory or container occurrences share "x".',
    );
    expect(inventory.coverage.status).toBe("unknown");
  });

  it("retains duplicate path occurrences across pages and leaves pairing unknown", async () => {
    const root = await createTestTempDirectory("rea-artifact-duplicate-pages-");
    const archives = [join(root, "left.zip"), join(root, "right.zip")] as const;
    for (const [index, path] of archives.entries()) {
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("x.txt", new TextReader("first"));
      await writer.add(
        "y.txt",
        new TextReader(index === 0 ? "second-left" : "second-right"),
      );
      await writer.add("neighbor.txt", new TextReader("neighbor"));
      const bytes = Buffer.from(await writer.close());
      // Produce a duplicate path the same way as real malformed/ambiguous ZIP
      // inputs: retain each member record and rewrite only the equal-length name.
      for (const [signature, headerSize] of [
        [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 30],
        [Buffer.from([0x50, 0x4b, 0x01, 0x02]), 46],
      ] as const) {
        const first = bytes.indexOf(signature);
        const second = bytes.indexOf(signature, first + 4);
        if (first < 0 || second <= first)
          throw new Error("Expected both ZIP member headers");
        expect(
          bytes
            .subarray(second + headerSize, second + headerSize + 5)
            .toString(),
        ).toBe("y.txt");
        bytes.write("x.txt", second + headerSize);
      }
      await writeFile(path, bytes);
    }

    const [left, right] = await Promise.all([
      observe(archives[0]),
      observe(archives[1]),
    ]);
    const parsed = parseArtifactInventoryEvidence(left);
    const repeated = parsed.inventory.occurrences.filter(
      ({ logical_path }) => logical_path === "x.txt",
    );
    expect(repeated).toHaveLength(2);
    expect(
      new Set(repeated.map(({ occurrence_id }) => occurrence_id)).size,
    ).toBe(2);

    const leftPages = fragmentInventoryEvidence(left, 2);
    const parsedPages = parseArtifactInventoryEvidence(leftPages);
    expect(
      parsedPages.inventory.occurrences.filter(
        ({ logical_path }) => logical_path === "x.txt",
      ),
    ).toHaveLength(2);

    const comparison = compareArtifacts(
      leftPages,
      fragmentInventoryEvidence(right, 2),
    );
    expect(comparison).toMatchObject({
      status: "unknown",
      summary: { unknown: expect.any(Number) },
      changes: expect.arrayContaining([
        expect.objectContaining({
          logical_path: "x.txt",
          classification: "unknown",
          dimensions: ["availability"],
          left_occurrence_id: null,
          right_occurrence_id: null,
          left_artifact_id: null,
          right_artifact_id: null,
        }),
      ]),
    });
    expect(comparison.limitations).toContain(
      "Duplicate logical paths cannot be paired across inventories; comparisons for those paths are unknown.",
    );
    // Occurrences on the unknown duplicate path are never counted unchanged.
    // The archives differ, so the root changes and only neighbor.txt remains.
    expect(comparison.summary).toMatchObject({ unchanged: 1, unknown: 1 });
    expect(compareArtifacts(left, left).summary).toMatchObject({
      unchanged: 2,
      unknown: 1,
    });
  });
});

describe("artifact comparison fragment integrity", () => {
  it("assembles real inventory fragments and retains every citation", async () => {
    const parent = await createTestTempDirectory("rea-artifact-fragments-");
    const leftPath = join(parent, "left.app");
    const rightPath = join(parent, "right.app");
    await Promise.all([mkdir(leftPath), mkdir(rightPath)]);
    // Cross the former 100-citation limit with distinct, real graph members.
    const fragmentCount = 101;
    await Promise.all(
      Array.from({ length: fragmentCount }, async (_, index) => {
        await Promise.all([
          writeFile(join(leftPath, `file-${index}.js`), `left(${index});`),
          writeFile(join(rightPath, `file-${index}.js`), `right(${index});`),
        ]);
      }),
    );
    const left = await observe(leftPath);
    const right = await observe(rightPath);
    const leftFragments = fragmentInventoryEvidence(left, fragmentCount);
    const rightFragments = fragmentInventoryEvidence(right, fragmentCount);
    const citations = [...leftFragments, ...rightFragments]
      .map(({ evidence_id }) => evidence_id)
      .sort();
    expect(new Set(citations).size).toBe(fragmentCount * 2);
    const comparison = compareArtifacts(leftFragments, rightFragments);
    const complete = compareArtifacts(left, right);
    expect(
      comparison.changes
        .filter(({ logical_path }) => logical_path !== ".")
        .map(({ logical_path, classification }) => ({
          logical_path,
          classification,
        }))
        .sort((left, right) =>
          left.logical_path.localeCompare(right.logical_path),
        ),
    ).toEqual(
      Array.from({ length: fragmentCount }, (_, index) => ({
        logical_path: `file-${index}.js`,
        classification: "changed",
      })).sort((left, right) =>
        left.logical_path.localeCompare(right.logical_path),
      ),
    );
    expect({
      ...comparison,
      changes: comparison.changes.map((change) => ({
        ...change,
        evidence_links: [...change.evidence_links].sort(),
      })),
    }).toEqual({
      ...complete,
      changes: complete.changes.map((change) => ({
        ...change,
        evidence_links: citations,
      })),
    });
    const fragment = leftFragments[0];
    if (fragment === undefined) throw new Error("Expected inventory fragments");
    const conflictingScope = createEvidence(
      {
        path: leftPath,
        sha256: left.subject?.digest.sha256 ?? "",
        format: "directory",
      },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: {
          ...artifactInventoryResultSchema.parse(fragment.normalized_result),
          coverage: { scope: "root", status: "complete" },
        },
      },
    );
    expect(() =>
      compareArtifacts(
        [conflictingScope, ...leftFragments.slice(1)],
        rightFragments,
      ),
    ).toThrowError(
      expect.objectContaining({
        _tag: "AnalysisInputError",
        userMessage: expect.stringContaining("coverage declaration"),
        issues: [expect.objectContaining({ path: ["left"] })],
      }),
    );
  }, 15_000);

  it("rejects non-inventory and tampered Evidence", async () => {
    const root = await createTestTempDirectory("rea-artifact-invalid-");
    const evidence = await observe(root);
    expect(() =>
      compareArtifacts({ ...evidence, operation: "binary_overview" }, evidence),
    ).toThrow(/identifier/u);
    const wrongOperation = createEvidence(undefined, PROVIDER, {
      operation: "binary_overview",
      parameters: {},
      result: evidence.normalized_result,
    });
    expect(() => compareArtifacts(wrongOperation, evidence)).toThrowError(
      expect.objectContaining({
        _tag: "AnalysisInputError",
        userMessage: expect.stringContaining("inspect_artifact"),
        issues: [expect.objectContaining({ path: ["left"] })],
      }),
    );
    const mismatchedSubject = createEvidence(
      { path: root, sha256: "f".repeat(64), format: "directory" },
      PROVIDER,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: evidence.normalized_result,
      },
    );
    expect(() => compareArtifacts(mismatchedSubject, evidence)).toThrow(
      /root digest/u,
    );
  });
});

describe("ZIP non-entry coverage", () => {
  it("retains pre-directory APK block changes under current ZIP coverage", async () => {
    const root = await createTestTempDirectory("rea-apk-block-compare-");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("classes.dex", new TextReader("unchanged entry"));
    const zip = Buffer.from(await writer.close());
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    const directory = zip.readUInt32LE(eocd + 16);
    // APK Signing Block framing with one opaque padding pair, not a verified signature.
    // https://source.android.com/docs/security/features/apksigning/v2#apk-signing-block
    const block = Buffer.alloc(48);
    block.writeBigUInt64LE(40n, 0);
    block.writeBigUInt64LE(8n, 8);
    block.writeUInt32LE(0x42726577, 16);
    block.writeBigUInt64LE(40n, 24);
    block.write("APK Sig Block 42", 32, "ascii");
    const paths = [join(root, "before.apk"), join(root, "after.apk")];
    for (const [index, path] of paths.entries()) {
      block.writeUInt32LE(index, 20);
      const apk = Buffer.concat([
        zip.subarray(0, directory),
        block,
        zip.subarray(directory),
      ]);
      apk.writeUInt32LE(directory + block.length, eocd + block.length + 16);
      await writeFile(path, apk);
    }
    const left = await observe(paths[0]!);
    const right = await observe(paths[1]!);
    const inventory = artifactInventoryResultSchema.parse(
      left.normalized_result,
    );
    expect(inventory.limitations).toContain(
      "ZIP inventory lists central-directory entries only. Non-entry bytes, including leading bytes before the first entry such as a self-extractor stub, an APK Signing Block before the central directory or a ZIP comment after it, are not occurrences.",
    );
    expect(
      inventory.occurrences.map(({ logical_path }) => logical_path).sort(),
    ).toEqual([".", "classes.dex"]);
    expect(compareArtifacts(left, right)).toMatchObject({
      status: "changed",
      summary: { changed: 1, unchanged: 1, unknown: 0 },
      changes: [
        expect.objectContaining({ logical_path: ".", dimensions: ["content"] }),
      ],
    });
  });
});
