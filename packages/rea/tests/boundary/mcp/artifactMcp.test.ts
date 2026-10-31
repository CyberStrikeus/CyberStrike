import {
  PROCESS_CAPTURE_REFERENCE,
  PROCESS_CAPTURE_RECONSTRUCTION,
  PROCESS_COMPARISON_EVIDENCE,
} from "../../../src/contracts/investigationExamples.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  createEvidence,
  parseEvidence,
  type Evidence,
} from "../../../src/domain/evidence.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

import { artifactInventoryResultSchema } from "../../../src/domain/artifactGraph.js";
import {
  artifactEdgeId,
  artifactGraphDigest,
  artifactManifestId,
  occurrenceIdForLocation,
} from "../../../src/domain/artifactIdentity.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseArtifactInventoryEvidence } from "../../../src/domain/artifactInventoryEvidence.js";
import {
  ok as resultOk,
  err as resultErr,
} from "../../../src/domain/result.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Client } from "@modelcontextprotocol/client";
import { createPackageWithOptions } from "@electron/asar";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, vi, type MockInstance } from "vitest";
import { z } from "zod";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createSingleEntryZip,
  rewriteSingleEntryZipName,
} from "../../fixtures/zipNames.js";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { mcpTest as it } from "../../support/mcp/mcpFixture.js";
import { ownArtifactSession } from "../../support/mcp/artifactSession.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../../../src/contracts/artifactComparisonExample.js";
import { createServer } from "../../../src/server/createServer.js";
import { createArtifactBinarySession } from "../../../src/composition/binary.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { cArchiveExecutable } from "../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { compareUnicodeCodePoints } from "../../../src/domain/unicodeCodePointOrder.js";

const integrityMessage = (unpacked: boolean): string =>
  `${
    unpacked
      ? "Declared ASAR integrity for unpacked entry main.js contradicts its companion file; packaging tools commonly sign or strip unpacked native binaries after writing the archive."
      : "Artifact bytes contradict declared integrity."
  } If expected, rerun inspect_artifact with integrity_policy=record-and-continue (CLI: --integrity-policy record-and-continue) to retain observed bytes as untrusted; otherwise get a fresh copy.`;

it("refuses an artifact parent and summary when its actual inventory source cannot be recorded", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory(
    "rea-artifact-source-refusal-mcp-",
  );
  const archive = join(root, "fixture.zip");
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add("main.js", new TextReader("console.log('source');\n"));
  await writeFile(archive, await zip.close());
  const session = await createArtifactBinarySession({});
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-source-refusal",
    version: "1",
  });
  const attempted: Evidence[] = [];
  const failure = new EvidenceIntegrityError(
    "controlled inventory source recording refusal",
  );
  const nativeRecord = session.recordEvidence.bind(session);
  let recording: MockInstance<typeof session.recordEvidence> | undefined;
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    expect(opened.isError).not.toBe(true);
    const before = session.exportEvidenceBundle().records;
    recording = vi
      .spyOn(session, "recordEvidence")
      .mockImplementation((evidence) => {
        attempted.push(evidence);
        return evidence.operation === "inventory_artifact"
          ? resultErr(failure)
          : nativeRecord(evidence);
      });
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: { detail: "summary" },
    });
    expect(inspected.isError).toBe(true);
    expect(parseMcpToolError(inspected)).toMatchObject({
      error: projectAnalysisError(failure),
    });
    expect(attempted.map(({ operation }) => operation)).toEqual([
      "inventory_artifact",
    ]);
    expect(attempted[0]?.normalized_result).toMatchObject({
      occurrences: expect.arrayContaining([
        expect.objectContaining({ logical_path: "main.js" }),
      ]),
    });
    expect(session.exportEvidenceBundle().records).toEqual(before);
  } finally {
    recording?.mockRestore();
    await mcp.close();
  }
});

it.for([
  { unpacked: false, label: "embedded" },
  { unpacked: true, label: "unpacked" },
])(
  "returns actionable local details for an $label ASAR integrity error",
  { timeout: 20_000 },
  async ({ unpacked }, { mcp, onTestFinished }) => {
    const root = await createTestTempDirectory("rea-asar-integrity-mcp-");
    const source = join(root, "source");
    const original = "console.log('ok');\n";
    const changed = "console.log('no');\n";
    await mkdir(source);
    await writeFile(join(source, "main.js"), original);
    const archive = join(root, "fixture.asar");
    await createPackageWithOptions(
      source,
      archive,
      unpacked ? { unpack: "*.js" } : {},
    );
    if (unpacked) {
      await writeFile(join(`${archive}.unpacked`, "main.js"), changed);
    } else {
      const bytes = await readFile(archive);
      const contentOffset = bytes.indexOf(original);
      expect(contentOffset).toBeGreaterThanOrEqual(0);
      bytes.write(changed, contentOffset, "utf8");
      await writeFile(archive, bytes);
    }

    const session = createTestBinarySession(new ArtifactProvider(process.env));
    ownArtifactSession(session, onTestFinished);
    const server = createServer({ kind: "session", session });
    const client = await mcp.connect(server, {
      name: "asar-integrity-test",
      version: "1",
    });
    try {
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path: archive },
      });
      expect(opened.isError).not.toBe(true);

      const result = await client.callTool({
        name: "inspect_artifact",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(parseMcpToolError(result)).toEqual({
        error: {
          code: "artifact_integrity_mismatch",
          category: "integrity_mismatch",
          message: integrityMessage(unpacked),
          details: {
            logical_path: "main.js",
            declared_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            calculated_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            unpacked,
          },
          retryable: false,
          remediation: { action: integrityMessage(unpacked) },
        },
      });
    } finally {
      await mcp.close();
    }
  },
);

it("extracts an active archive through MCP when requested", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-artifact-extract-mcp-");
  const archive = join(root, "fixture.zip");
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add("main.js", new TextReader("console.log('extract');\n"));
  await writeFile(archive, await zip.close());

  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-extract-test",
    version: "1",
  });
  let outputRoot: string | undefined;
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    expect(opened.isError).not.toBe(true);

    const result = await client.callTool({
      name: "extract_artifact",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const normalized = z
      .object({ output_root: z.string(), artifacts: z.array(z.unknown()) })
      .parse(toolEvidence(result.structuredContent).normalized_result);
    outputRoot = normalized.output_root;
    expect(await readFile(join(outputRoot, "main.js"), "utf8")).toBe(
      "console.log('extract');\n",
    );
    expect(normalized.artifacts).toHaveLength(1);
  } finally {
    try {
      await mcp.close();
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  }
});

it("preserves raw legacy ZIP name bytes and CP437 path interpretation through MCP", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-legacy-zip-name-mcp-");
  const archive = join(root, "legacy-name.zip");
  const rawName = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]);
  await writeFile(
    archive,
    rewriteSingleEntryZipName(
      await createSingleEntryZip("name.txt"),
      "name.txt",
      rawName,
      false,
    ),
  );

  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "legacy-zip-name-test",
    version: "1",
  });
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const result = toolEvidence(inspected.structuredContent);
    const inspection = z
      .object({ substeps: z.array(z.object({ evidence: z.unknown() })) })
      .parse(result.normalized_result);
    const inventory = z
      .object({ normalized_result: artifactInventoryResultSchema })
      .parse(inspection.substeps[0]?.evidence).normalized_result;
    expect(inventory.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "╟╤▒█.txt",
        limitations: [
          "ZIP name uses CP437 fallback; source encoding unverified; raw hex: c7d1b1db2e747874.",
        ],
      }),
    );
  } finally {
    await mcp.close();
  }
});

it("extracts a macOS app bundle through MCP", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-artifact-extract-app-mcp-");
  const contents = join(root, "Fixture.app", "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  const plist =
    '<?xml version="1.0"?><plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>';
  await writeFile(join(contents, "Info.plist"), plist);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x01000007, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(2, 12);
  await writeFile(join(contents, "MacOS", "Fixture"), header);

  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-extract-app-test",
    version: "1",
  });
  let outputRoot: string | undefined;
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: join(root, "Fixture.app") },
    });
    expect(opened.isError).not.toBe(true);

    const result = await client.callTool({
      name: "extract_artifact",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const normalized = z
      .object({ output_root: z.string() })
      .parse(toolEvidence(result.structuredContent).normalized_result);
    outputRoot = normalized.output_root;
    expect(
      await readFile(join(outputRoot, "Contents", "Info.plist"), "utf8"),
    ).toBe(plist);
  } finally {
    try {
      await mcp.close();
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  }
});

it("records an explicitly continued mismatch, preserves verified siblings, and never reports equivalence", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-asar-continue-mcp-");
  const source = join(root, "source");
  await mkdir(source);
  const original = "console.log('ok');\n",
    changed = "console.log('no');\n",
    secondOriginal = "console.log('up');\n",
    secondChanged = "console.log('dn');\n";
  await writeFile(join(source, "main.js"), original);
  await writeFile(join(source, "second.js"), secondOriginal);
  await writeFile(join(source, "sibling.js"), "console.log('sibling');\n");
  const archive = join(root, "fixture.asar");
  await createPackageWithOptions(source, archive, {});
  const bytes = await readFile(archive);
  const contentOffset = bytes.indexOf(original);
  const secondOffset = bytes.indexOf(secondOriginal);
  expect(contentOffset).toBeGreaterThanOrEqual(0);
  expect(secondOffset).toBeGreaterThanOrEqual(0);
  bytes.write(changed, contentOffset, "utf8");
  bytes.write(secondChanged, secondOffset, "utf8");
  await writeFile(archive, bytes);

  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "asar-continue-test",
    version: "1",
  });
  try {
    await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    const result = await client.callTool({
      name: "inspect_artifact",
      arguments: {
        integrity_policy: "record-and-continue",
      },
    });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
      true,
    );
    const compact = toolEvidence(result.structuredContent);
    const evidence = session.evidenceById(compact.evidence_id);
    if (evidence === undefined) throw new Error("missing inventory Evidence");
    const inspection = z
      .object({
        contradictions: z.array(z.unknown()),
        substeps: z.array(
          z.object({
            evidence: z.object({ normalized_result: z.unknown() }),
          }),
        ),
      })
      .parse(compact.normalized_result);
    const inventory = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(inspection.contradictions).toHaveLength(2);
    expect(inventory.integrity_contradictions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_path: "main.js",
          trust: "observed-untrusted",
          declared_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          observed_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
        expect.objectContaining({ logical_path: "second.js" }),
      ]),
    );
    expect(inventory.integrity_contradictions).toHaveLength(2);
    expect(inventory.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_path: "main.js",
          hash_status: "mismatched",
        }),
        expect.objectContaining({
          logical_path: "sibling.js",
          hash_status: "verified",
        }),
        expect.objectContaining({
          logical_path: "second.js",
          hash_status: "mismatched",
        }),
      ]),
    );
    const compared = await client.callTool({
      name: "compare_artifacts",
      arguments: {
        left: evidence,
        right: evidence,
      },
    });
    expect(compared.isError).not.toBe(true);
    expect(
      toolEvidence(compared.structuredContent).normalized_result,
    ).toMatchObject({
      status: "contradiction",
      summary: { contradiction: 2 },
      changes: expect.arrayContaining([
        expect.objectContaining({
          logical_path: "main.js",
          classification: "contradiction",
          dimensions: ["integrity"],
        }),
        expect.objectContaining({
          logical_path: "second.js",
          classification: "contradiction",
        }),
      ]),
    });
    const { coverage: _coverage, ...inventoryWithoutCoverage } = inventory;
    const missingCoverage = createEvidence(
      {
        path: archive,
        sha256: inventory.manifest.root_sha256,
        format: "asar",
      },
      compact.provider,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: inventoryWithoutCoverage,
      },
    );
    const retainedComparison = await client.callTool({
      name: "compare_artifacts",
      arguments: { left: evidence, right: missingCoverage },
    });
    expect(retainedComparison.isError, JSON.stringify(retainedComparison)).toBe(
      true,
    );
  } finally {
    await mcp.close();
  }
});

it("rejects inline artifact Evidence whose content does not match its ID", async ({
  mcp,
  onTestFinished,
}) => {
  const session = createTestBinarySession(() => ({
    health: () => Promise.resolve(),
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-authority-test",
    version: "1",
  });
  try {
    const result = await client.callTool({
      name: "compare_artifacts",
      arguments: {
        ...ARTIFACT_COMPARISON_EXAMPLE,
        left: {
          ...ARTIFACT_COMPARISON_EXAMPLE.left,
          limitations: ["caller altered this record"],
        },
      },
    });
    expect(result.isError).toBe(true);
    expect(
      session.evidenceById(ARTIFACT_COMPARISON_EXAMPLE.left.evidence_id),
    ).toBeUndefined();
    expect(
      session.evidenceById(ARTIFACT_COMPARISON_EXAMPLE.right.evidence_id),
    ).toBeUndefined();
  } finally {
    await mcp.close();
  }
});

it("compares inline inventory Evidence without prior session calls", async ({
  mcp,
  onTestFinished,
}) => {
  const session = createTestBinarySession(() => ({
    health: () => Promise.resolve(),
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(resultOk(null)),
  }));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-ownership-test",
    version: "1",
  });
  try {
    const result = await client.callTool({
      name: "compare_artifacts",
      arguments: ARTIFACT_COMPARISON_EXAMPLE,
    });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
      true,
    );
    expect(
      toolEvidence(result.structuredContent).normalized_result,
    ).toMatchObject({
      status: "changed",
    });
    expect(
      session.evidenceById(ARTIFACT_COMPARISON_EXAMPLE.left.evidence_id),
    ).toBeDefined();
    expect(
      session.evidenceById(ARTIFACT_COMPARISON_EXAMPLE.right.evidence_id),
    ).toBeDefined();
  } finally {
    await mcp.close();
  }
});

it("returns full artifact graphs inline and compares changed inventories", async ({
  mcp,
  onTestFinished,
}) => {
  const directory = await createTestTempDirectory("rea-artifact-mcp-");
  const archive = join(directory, "fixture.ipa");
  const changedArchive = join(directory, "changed.ipa");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("Payload/Fixture.app/main.js", new TextReader("main();"));
  await writeFile(archive, await writer.close());
  const changedWriter = new ZipWriter(new Uint8ArrayWriter());
  await changedWriter.add(
    "Payload/Fixture.app/main.js",
    new TextReader("changed();"),
  );
  await writeFile(changedArchive, await changedWriter.close());
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-mcp-test",
    version: "1",
  });
  try {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: archive },
    });
    expect(opened.isError).not.toBe(true);
    const inspected = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inspected.isError).not.toBe(true);
    const inspectionResult = toolEvidence(inspected.structuredContent);
    const inspectionEvidence = session.evidenceById(
      inspectionResult.evidence_id,
    );
    if (inspectionEvidence === undefined)
      throw new Error("missing inspection Evidence");
    const inspection = z
      .object({
        substeps: z.array(
          z.object({
            evidence_id: z.string(),
            status: z.literal("completed"),
          }),
        ),
        coverage: z.object({
          status: z.literal("complete-within-substeps"),
          substeps_completed: z.literal(1),
        }),
      })
      .parse(inspectionResult.normalized_result);
    expect(inspection.substeps).toHaveLength(1);
    expect(
      session.evidenceById(inspection.substeps[0]?.evidence_id ?? ""),
    ).toMatchObject({ operation: "inventory_artifact" });
    expect(inspectionEvidence.evidence_links).toEqual([
      inspection.substeps[0]?.evidence_id,
    ]);
    const inventory = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    expect(inventory.isError).not.toBe(true);
    const inventoryResult = toolEvidence(inventory.structuredContent);
    const evidence = session.evidenceById(inventoryResult.evidence_id);
    if (evidence === undefined) throw new Error("missing inventory Evidence");
    expect(evidence).toMatchObject({
      provider: { id: "rea-artifact-graph" },
      subject: { format: "ipa" },
    });
    const inventoryInspection = z
      .object({
        substeps: z.array(z.object({ evidence: z.unknown() })),
      })
      .parse(inventoryResult.normalized_result);
    const inventoryEvidence = z
      .object({
        normalized_result: z.object({
          manifest: z.object({ root_format: z.literal("ipa") }),
          occurrences: z.array(z.object({ logical_path: z.string() })),
        }),
      })
      .parse(inventoryInspection.substeps[0]?.evidence);
    expect(inventoryEvidence.normalized_result.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_path: "Payload/Fixture.app/main.js",
        }),
      ]),
    );
    const openedChanged = await client.callTool({
      name: "open_binary",
      arguments: { path: changedArchive },
    });
    expect(openedChanged.isError).not.toBe(true);
    const changedInventory = await client.callTool({
      name: "inspect_artifact",
      arguments: {},
    });
    const changedResult = toolEvidence(changedInventory.structuredContent);
    const changedInspection = z
      .object({
        substeps: z.array(z.object({ evidence: z.unknown() })),
      })
      .parse(changedResult.normalized_result);
    const compared = await client.callTool({
      name: "compare_artifacts",
      arguments: {
        left: inventoryInspection.substeps[0]?.evidence,
        right: changedInspection.substeps[0]?.evidence,
      },
    });
    expect(compared.isError).not.toBe(true);
    expect(toolEvidence(compared.structuredContent)).toMatchObject({
      normalized_result: { status: "changed" },
      evidence_id: expect.stringMatching(/^ev_/u),
    });
    const unknowns = await client.callTool({
      name: "list_unknowns",
      arguments: { domain: "artifact-comparison" },
    });
    expect(unknowns.structuredContent).toMatchObject({
      result: {
        items: [
          expect.objectContaining({
            domain: "artifact-comparison",
          }),
        ],
      },
    });
  } finally {
    await mcp.close();
  }
});

it("compares summary Evidence through retained complete inspection parents", async ({
  mcp,
  onTestFinished,
}) => {
  const directory = await createTestTempDirectory("rea-artifact-summary-mcp-");
  const archive = join(directory, "one.zip");
  const changedArchive = join(directory, "two.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("a.txt", new TextReader("same"));
  await writeFile(archive, await writer.close());
  const changedWriter = new ZipWriter(new Uint8ArrayWriter());
  await changedWriter.add("a.txt", new TextReader("same"));
  await changedWriter.add("b.txt", new TextReader("new"));
  await writeFile(changedArchive, await changedWriter.close());

  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-summary-mcp-test",
    version: "1",
  });
  try {
    const summaries = [];
    for (const path of [archive, changedArchive]) {
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError).not.toBe(true);
      const inspected = await client.callTool({
        name: "inspect_artifact",
        arguments: { detail: "summary" },
      });
      expect(inspected.isError).not.toBe(true);
      summaries.push(toolEvidence(inspected.structuredContent));
    }
    const [left, right] = summaries;
    if (left === undefined || right === undefined)
      throw new Error("missing artifact summary Evidence");
    expect(left.operation).toBe("inspect_analysis_view");
    expect(right.operation).toBe("inspect_analysis_view");
    const compared = await client.callTool({
      name: "compare_artifacts",
      arguments: { left, right },
    });
    expect(compared.isError).not.toBe(true);
    const result = toolEvidence(compared.structuredContent);
    expect(result.normalized_result).toMatchObject({ status: "changed" });
    const leftParentId = z
      .object({ parent_evidence_id: z.string() })
      .parse(left.normalized_result).parent_evidence_id;
    const rightParentId = z
      .object({ parent_evidence_id: z.string() })
      .parse(right.normalized_result).parent_evidence_id;
    expect(result.evidence_links).toEqual([leftParentId, rightParentId]);
  } finally {
    await mcp.close();
  }
});

const toolEvidence = (value: unknown) => parseEvidence(value);

const pyInstallerComparisonArchive = (
  typeCode: "m" | "s",
  includeSymlink: boolean,
  includePrefix = false,
) =>
  cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: [
      ...(includePrefix
        ? [
            {
              name: "prefix.bin",
              typeCode: "x" as const,
              payload: Buffer.from("prefix bytes"),
              compress: false,
            },
          ]
        : []),
      {
        name: "helper",
        typeCode,
        payload: Buffer.from("same helper bytes"),
        compress: false,
      },
      {
        name: "pyi-contents-directory _internal",
        typeCode: "o",
        payload: Buffer.alloc(0),
        compress: false,
      },
      {
        name: "shared-app:assets/data.bin",
        typeCode: "d",
        payload: Buffer.alloc(0),
        compress: false,
      },
      ...(includeSymlink
        ? [
            {
              name: "unavailable-link",
              typeCode: "n" as const,
              payload: Buffer.from("target"),
              compress: false,
            },
          ]
        : []),
    ],
  });

const inspectArtifactInventoryThroughMcp = async (
  client: Client,
  path: string,
) => {
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path },
  });
  expect(opened.isError).not.toBe(true);
  const reply = await client.callTool({
    name: "inspect_artifact",
    arguments: {},
  });
  expect(reply.isError).not.toBe(true);
  const inspection = artifactInspectionResultSchema.parse(
    toolEvidence(reply.structuredContent).normalized_result,
  );
  const inventory = inspection.substeps.find(
    ({ operation }) => operation === "inventory_artifact",
  )?.evidence;
  if (inventory === undefined) throw new Error("missing inventory Evidence");
  return parseEvidence(inventory);
};

const compareArtifactEvidenceThroughMcp = (
  client: Client,
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) => client.callTool({ name: "compare_artifacts", arguments: { left, right } });

const withForeignMetadataAndNestedZipMember = (
  evidence: ReturnType<typeof parseEvidence>,
) => {
  const inventory = artifactInventoryResultSchema.parse(
    evidence.normalized_result,
  );
  const helper = inventory.occurrences.find(
    ({ logical_path }) => logical_path === "helper",
  );
  if (helper === undefined) throw new Error("missing helper occurrence");
  const { format_metadata: _formatMetadata, ...helperWithoutMetadata } = helper;
  const foreignMetadataId = occurrenceIdForLocation({
    rootArtifactId: inventory.manifest.root_artifact_id,
    logicalPath: "foreign-meta",
    entryKind: "metadata",
  });
  const foreignMetadata = {
    ...helperWithoutMetadata,
    occurrence_id: foreignMetadataId,
    logical_path: "foreign-meta",
    entry_kind: "metadata" as const,
    artifact_format: "zip" as const,
  };
  const nestedZipMember = {
    ...helperWithoutMetadata,
    occurrence_id: occurrenceIdForLocation({
      rootArtifactId: inventory.manifest.root_artifact_id,
      logicalPath: "helper/member.txt",
      entryKind: "file",
    }),
    parent_occurrence_id: helper.occurrence_id,
    logical_path: "helper/member.txt",
    artifact_format: "zip" as const,
  };
  const occurrences = inventory.occurrences
    .concat(foreignMetadata, nestedZipMember)
    .sort((left, right) =>
      compareUnicodeCodePoints(left.logical_path, right.logical_path),
    );
  const edges = inventory.edges
    .map((edge) => {
      const occurrence = occurrences.find(
        ({ occurrence_id }) => occurrence_id === edge.occurrence_id,
      );
      return occurrence === undefined
        ? edge
        : { ...edge, edge_id: artifactEdgeId(edge, occurrence) };
    })
    .sort((left, right) =>
      compareUnicodeCodePoints(left.edge_id, right.edge_id),
    );
  const graphSha256 = artifactGraphDigest({
    nodes: inventory.nodes,
    occurrences,
    edges,
    contradictions: inventory.integrity_contradictions,
  });
  const manifestId = artifactManifestId(
    inventory.manifest.root_artifact_id,
    graphSha256,
  );
  const subject = evidence.subject;
  if (subject === null) throw new Error("missing inventory subject");
  return createEvidence(
    {
      path: subject.local_path,
      sha256: subject.digest.sha256,
      format: subject.format,
    },
    evidence.provider,
    {
      operation: "inventory_artifact",
      parameters: evidence.parameters,
      confidence: evidence.confidence,
      authority: evidence.authority,
      result: {
        ...inventory,
        occurrences,
        edges,
        manifest: {
          ...inventory.manifest,
          occurrence_count: occurrences.length,
          edge_count: edges.length,
          graph_sha256: graphSha256,
          manifest_id: manifestId,
        },
      },
    },
  );
};

it("does not apply PyInstaller declaration unknowns to foreign metadata or nested ZIP members", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-pyinstaller-scope-mcp-");
  const archive = join(root, "sample");
  await writeFile(archive, pyInstallerComparisonArchive("m", false));
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "pyinstaller-scope-test",
    version: "1",
  });
  try {
    const observed = await inspectArtifactInventoryThroughMcp(client, archive);
    const foreign = withForeignMetadataAndNestedZipMember(observed);
    const response = await compareArtifactEvidenceThroughMcp(
      client,
      foreign,
      foreign,
    );
    expect(response.isError).not.toBe(true);
    expect(
      toolEvidence(response.structuredContent).normalized_result,
    ).toMatchObject({
      status: "unchanged",
      summary: { unknown: 0 },
      changes: [],
    });
  } finally {
    await mcp.close();
  }
});

it("compares PyInstaller declaration facts without inventing payload identity", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-pyinstaller-compare-mcp-");
  const leftPath = join(root, "module");
  const rightPath = join(root, "script");
  const declarationsPath = join(root, "declarations");
  const modulePath = join(root, "module-clean");
  const shiftedPath = join(root, "module-shifted");
  await Promise.all([
    writeFile(leftPath, pyInstallerComparisonArchive("m", true)),
    writeFile(rightPath, pyInstallerComparisonArchive("s", true)),
    writeFile(declarationsPath, pyInstallerComparisonArchive("s", false)),
    writeFile(modulePath, pyInstallerComparisonArchive("m", false)),
    writeFile(shiftedPath, pyInstallerComparisonArchive("m", false, true)),
  ]);
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "pyinstaller-compare-test",
    version: "1",
  });
  try {
    const left = await inspectArtifactInventoryThroughMcp(client, leftPath);
    const right = await inspectArtifactInventoryThroughMcp(client, rightPath);
    const clean = await inspectArtifactInventoryThroughMcp(
      client,
      declarationsPath,
    );
    const module = await inspectArtifactInventoryThroughMcp(client, modulePath);
    const shifted = await inspectArtifactInventoryThroughMcp(
      client,
      shiftedPath,
    );
    const leftInventory = artifactInventoryResultSchema.parse(
      left.normalized_result,
    );
    const rightInventory = artifactInventoryResultSchema.parse(
      right.normalized_result,
    );
    const leftHelper = leftInventory.occurrences.find(
      ({ logical_path }) => logical_path === "helper",
    );
    const rightHelper = rightInventory.occurrences.find(
      ({ logical_path }) => logical_path === "helper",
    );
    expect(leftHelper?.artifact_id).toBe(rightHelper?.artifact_id);
    expect(leftHelper?.format_metadata).toMatchObject({ type_code: "m" });
    expect(rightHelper?.format_metadata).toMatchObject({ type_code: "s" });
    expect(
      leftInventory.occurrences.filter(
        ({ entry_kind }) => entry_kind === "metadata",
      ),
    ).toHaveLength(2);

    const changed = await compareArtifactEvidenceThroughMcp(
      client,
      left,
      right,
    );
    expect(changed.isError).not.toBe(true);
    const changedResult = toolEvidence(
      changed.structuredContent,
    ).normalized_result;
    expect(changedResult).toMatchObject({
      status: "unknown",
      summary: { changed: 2, unchanged: 2, unknown: 1 },
      changes: expect.arrayContaining([
        expect.objectContaining({
          logical_path: ".",
          classification: "changed",
          dimensions: expect.arrayContaining(["content"]),
        }),
        expect.objectContaining({
          logical_path: "helper",
          classification: "changed",
          dimensions: ["metadata"],
          left_occurrence_id: leftHelper?.occurrence_id,
          right_occurrence_id: rightHelper?.occurrence_id,
        }),
        expect.objectContaining({
          logical_path: "unavailable-link",
          classification: "unknown",
          dimensions: ["availability"],
        }),
      ]),
    });
    expect(
      z
        .object({ changes: z.array(z.object({ logical_path: z.string() })) })
        .parse(changedResult)
        .changes.map(({ logical_path }) => logical_path),
    ).not.toContain("__pyinstaller__/runtime-options/1");
    expect(
      z
        .object({ changes: z.array(z.object({ logical_path: z.string() })) })
        .parse(changedResult)
        .changes.map(({ logical_path }) => logical_path),
    ).not.toContain("__pyinstaller__/dependencies/2");

    const declarationsOnly = await client.callTool({
      name: "compare_artifacts",
      arguments: { left: clean, right: clean },
    });
    expect(declarationsOnly.isError).not.toBe(true);
    expect(
      toolEvidence(declarationsOnly.structuredContent).normalized_result,
    ).toMatchObject({
      status: "unchanged",
      summary: { unchanged: 4, unknown: 0 },
      changes: [],
    });

    const layoutOnly = await client.callTool({
      name: "compare_artifacts",
      arguments: { left: module, right: shifted },
    });
    expect(layoutOnly.isError).not.toBe(true);
    const layoutChanges = z
      .object({ changes: z.array(z.object({ logical_path: z.string() })) })
      .parse(toolEvidence(layoutOnly.structuredContent).normalized_result)
      .changes.map(({ logical_path }) => logical_path);
    expect(layoutChanges).toContain("prefix.bin");
    expect(layoutChanges).not.toContain("helper");

    const unavailableControl = await client.callTool({
      name: "compare_artifacts",
      arguments: { left, right: left },
    });
    expect(unavailableControl.isError).not.toBe(true);
    expect(
      toolEvidence(unavailableControl.structuredContent).normalized_result,
    ).toMatchObject({
      status: "unknown",
      changes: [
        expect.objectContaining({
          logical_path: "unavailable-link",
          classification: "unknown",
        }),
      ],
    });
  } finally {
    await mcp.close();
  }
});

it("discovers artifact target prerequisites and preserves typed MCP refusals", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-artifact-availability-mcp-");
  const zip = new ZipWriter(new Uint8ArrayWriter());
  await zip.add("a.txt", new TextReader("hello"));
  await writeFile(join(root, "sample.zip"), await zip.close());
  await writeFile(
    join(root, "plain.plist"),
    "<plist><dict><key>hello</key><string>world</string></dict></plist>",
  );
  await writeFile(
    join(root, "keyed.plist"),
    "<plist><dict><key>$archiver</key><string>NSKeyedArchiver</string><key>$objects</key><array><string>$null</string><string>hello</string></array><key>$top</key><dict><key>root</key><dict><key>CF$UID</key><integer>1</integer></dict></dict></dict></plist>",
  );
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x01000007, 4);
  header.writeUInt32LE(3, 8);
  header.writeUInt32LE(2, 12);
  await writeFile(join(root, "standalone"), header);
  await writeFile(join(root, "Tool.app"), header);
  const contents = join(root, "Fixture.app", "Contents");
  await mkdir(join(contents, "MacOS"), { recursive: true });
  await writeFile(join(contents, "MacOS", "Fixture"), header);
  await writeFile(
    join(contents, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  const session = createTestBinarySession(
    new ArtifactProvider(process.env, "darwin"),
  );
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-availability-test",
    version: "1",
  });
  const operations = [
    "decode_interface_builder",
    "inspect_asset_catalog",
    "inspect_keyed_archive",
    "trace_dylib_resolution",
  ];
  const availability = async () => {
    const response = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const result = toolContract("binary_session").outputSchema.parse(
      response.structuredContent,
    );
    return result.result.tool_availability.groups;
  };
  try {
    const before = await availability();
    for (const name of operations)
      expect(before.find((group) => group.names.includes(name))).toMatchObject({
        available: false,
        reason: "target_required",
      });
    for (const filename of [
      "sample.zip",
      "plain.plist",
      "keyed.plist",
      "standalone",
      "Tool.app",
      "Fixture.app",
    ]) {
      expect(
        (
          await client.callTool({
            name: "open_binary",
            arguments: { path: join(root, filename) },
          })
        ).isError,
      ).not.toBe(true);
      const groups = await availability();
      for (const name of operations) {
        const supported =
          filename === "Fixture.app" ||
          (filename.endsWith(".plist") && name === "inspect_keyed_archive") ||
          (["standalone", "Tool.app"].includes(filename) &&
            name === "trace_dylib_resolution");
        const group = groups.find((entry) => entry.names.includes(name));
        expect(group, `${filename} ${name}`).toMatchObject({
          available: supported,
          reason: supported ? "available" : "target_unsupported",
        });
        if (!supported) {
          expect(group?.remediation).toMatch(/requires an active/);
          const refused = await client.callTool({ name, arguments: {} });
          expect(parseMcpToolError(refused)).toMatchObject({
            error: { code: "unsupported_target" },
          });
        }
      }
      if (filename.endsWith(".plist")) {
        const inspected = await client.callTool({
          name: "inspect_keyed_archive",
          arguments: {},
        });
        if (filename === "keyed.plist")
          expect(inspected.isError).not.toBe(true);
        else
          expect(parseMcpToolError(inspected)).toMatchObject({
            error: { code: "unsupported_target" },
          });
      }
      await client.callTool({ name: "close_binary", arguments: {} });
    }
    await writeFile(
      join(contents, "state.plist"),
      await readFile(join(root, "keyed.plist")),
    );
    for (const format of ["raw-binary", "dos-com"] as const) {
      const opened = await client.callTool({
        name: "open_binary",
        arguments: {
          path: join(root, "Fixture.app"),
          format,
          ...(format === "raw-binary"
            ? { architecture: "x86_64", entry_point: "0x0" }
            : {}),
        },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      const groups = await availability();
      for (const name of operations.filter(
        (name) => name !== "trace_dylib_resolution",
      ))
        expect(
          groups.find((group) => group.names.includes(name)),
          `${format} ${name}`,
        ).toMatchObject({ available: true });
      const inspected = await client.callTool({
        name: "inspect_keyed_archive",
        arguments: { path: "Contents/state.plist" },
      });
      expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
      await client.callTool({ name: "close_binary", arguments: {} });
    }
  } finally {
    await mcp.close();
  }
});

it("attributes ASAR integrity contradictions to their actual inputs and withholds correlation support", async ({
  mcp,
  onTestFinished,
}) => {
  const root = await createTestTempDirectory("rea-asar-attribution-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "keep.txt"), "unchanged sibling\n");
  const absentArchive = join(root, "absent.asar");
  await createPackageWithOptions(source, absentArchive, {});
  const original = "console.log('ok');\n";
  const changed = "console.log('no');\n";
  await writeFile(join(source, "main.js"), original);
  const originalArchive = join(root, "original.asar");
  await createPackageWithOptions(source, originalArchive, {});
  const staleBytes = await readFile(originalArchive);
  const offset = staleBytes.indexOf(original);
  expect(offset).toBeGreaterThanOrEqual(0);
  staleBytes.write(changed, offset, "utf8");
  const staleArchive = join(root, "stale.asar");
  await writeFile(staleArchive, staleBytes);
  await writeFile(join(source, "main.js"), changed);
  const currentArchive = join(root, "current.asar");
  await createPackageWithOptions(source, currentArchive, {});
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  ownArtifactSession(session, onTestFinished);
  const server = createServer({ kind: "session", session });
  const client = await mcp.connect(server, {
    name: "artifact-attribution",
    version: "1",
  });
  try {
    const observations = [];
    for (const path of [
      originalArchive,
      staleArchive,
      currentArchive,
      absentArchive,
    ]) {
      expect(
        (await client.callTool({ name: "open_binary", arguments: { path } }))
          .isError,
      ).not.toBe(true);
      const inspected = await client.callTool({
        name: "inspect_artifact",
        arguments: { integrity_policy: "record-and-continue" },
      });
      expect(inspected.isError).not.toBe(true);
      observations.push(toolEvidence(inspected.structuredContent));
    }
    for (const record of [
      PROCESS_CAPTURE_REFERENCE,
      PROCESS_CAPTURE_RECONSTRUCTION,
      PROCESS_COMPARISON_EVIDENCE,
    ])
      expect(session.recordEvidence(record).ok).toBe(true);
    const [originalEvidence, stale, current, absent] = observations;
    if (
      originalEvidence === undefined ||
      stale === undefined ||
      current === undefined ||
      absent === undefined
    )
      throw new Error("Expected four artifact observations");
    for (const [left, right, mismatches, presence] of [
      [stale, current, [stale.evidence_id], "changed"],
      [current, stale, [stale.evidence_id], "changed"],
      [stale, stale, [stale.evidence_id], "changed"],
      [originalEvidence, current, [], "changed"],
      [absent, stale, [stale.evidence_id], "added"],
      [stale, absent, [stale.evidence_id], "removed"],
      [absent, current, [], "added"],
      [current, absent, [], "removed"],
    ] as const)
      await assertIntegrityComparison(
        client,
        session,
        left,
        right,
        mismatches,
        presence,
      );
  } finally {
    await mcp.close();
  }
});

const assertIntegrityComparison = async (
  client: Client,
  session: ReturnType<typeof createTestBinarySession>,
  left: ReturnType<typeof toolEvidence>,
  right: ReturnType<typeof toolEvidence>,
  mismatches: readonly string[],
  presence: "added" | "removed" | "changed",
) => {
  const compared = await client.callTool({
    name: "compare_artifacts",
    arguments: { left, right },
  });
  expect(compared.isError).not.toBe(true);
  const comparison = toolEvidence(compared.structuredContent);
  expect(comparison.normalized_result).toMatchObject({
    status: mismatches.length === 0 ? "changed" : "contradiction",
    summary: { contradiction: mismatches.length === 0 ? 0 : 1 },
    integrity_mismatch_evidence_ids: mismatches,
  });
  const unknown = session
    .listUnknowns({ domain: "artifact-comparison" })
    .find((item) => item.question.includes(comparison.evidence_id));
  expect(unknown).toBeDefined();
  const [leftMember, rightMember] = [left, right].map((record) =>
    parseArtifactInventoryEvidence(record).inventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js",
    ),
  );
  expect(comparison.normalized_result).toMatchObject({
    changes: expect.arrayContaining([
      expect.objectContaining({
        logical_path: "main.js",
        classification: mismatches.length > 0 ? "contradiction" : presence,
        ...(mismatches.length > 0 ? { dimensions: ["integrity"] } : {}),
        left_occurrence_id: leftMember?.occurrence_id ?? null,
        left_artifact_id: leftMember?.artifact_id ?? null,
        right_occurrence_id: rightMember?.occurrence_id ?? null,
        right_artifact_id: rightMember?.artifact_id ?? null,
      }),
    ]),
  });
  if (mismatches.length > 0) {
    expect(unknown?.contradicting_evidence_ids).toEqual(mismatches);
    expect(unknown?.supporting_evidence_ids).toEqual(
      [...new Set([left.evidence_id, right.evidence_id])].filter(
        (id) => !mismatches.includes(id),
      ),
    );
  }
  const correlated = await client.callTool({
    name: "correlate_static_and_runtime",
    arguments: {
      static_comparisons: [comparison],
      runtime_comparisons: [PROCESS_COMPARISON_EVIDENCE],
      mappings: [
        {
          static: {
            comparison_evidence_id: comparison.evidence_id,
            selector: { kind: "artifact", logical_path: "main.js" },
          },
          runtime: {
            comparison_evidence_id: PROCESS_COMPARISON_EVIDENCE.evidence_id,
            dimension: "terminal",
          },
          side_alignment: "left_to_left",
          hypothesis: {
            statement: "Member bytes changed while terminal output did not.",
            expected_pattern: "static_only",
          },
        },
      ],
    },
  });
  expect(correlated.isError).not.toBe(true);
  expect(
    toolEvidence(correlated.structuredContent).normalized_result,
  ).toMatchObject(
    mismatches.length > 0
      ? {
          status: "unknown",
          summary: { hypotheses: 0, unresolved: 1 },
          correlations: {
            items: [
              {
                observed_pattern: "unknown",
                classification: "unresolved_branch",
                static: { status: "contradiction" },
              },
            ],
          },
        }
      : { status: "correlated", summary: { hypotheses: 1, unresolved: 0 } },
  );
};
