import { createHash } from "node:crypto";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  buildAliasedGodotPck,
  buildGodotPck,
  buildGodotPck1,
  pckU64,
} from "../fixtures/godotPck.js";
import { elf } from "../../src/domain/binaryTarget.fixture.js";
import { readEvidenceBundle } from "../../src/application/EvidenceBundleFiles.js";
import { analysisViewResultSchema } from "../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

const members = [
  { path: "res://scripts/main.gd", data: "extends Node\n" },
  { path: "res://data/玩家.txt", data: "玩家数据\n" },
];
const graphFrom = (reply: unknown) => {
  const evidence = parseEvidence(reply);
  const inspection = artifactInspectionResultSchema.parse(
    evidence.normalized_result,
  );
  return artifactInventoryResultSchema.parse(
    inspection.substeps[0]?.evidence.normalized_result,
  );
};

cliTest.for([1, 2, 3, 4] as const)(
  "inspects and safely extracts format %s PCK through the compiled CLI",
  async (version, { cli }) => {
    const root = await createTestTempDirectory("rea-pck-cli-");
    const source = join(root, "game.pck");
    await writeFile(
      source,
      version === 1 ? buildGodotPck1(members) : buildGodotPck(version, members),
    );
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const graph = graphFrom(inspected.json);
    expect(graph.coverage).toEqual({
      scope: "container-entries",
      status: "complete",
    });
    const rootRow = graph.occurrences.find((row) => row.logical_path === ".");
    expect(rootRow?.format_metadata).toMatchObject({
      kind: "godot-pck",
      format_version: version,
      declared_file_count: 2,
    });
    for (const [index, member] of members.entries()) {
      const row = graph.occurrences.find(
        (row) => row.logical_path === member.path.slice(6),
      );
      expect(row?.declared_integrity).toEqual({
        algorithm: "md5",
        digest: createHash("md5").update(member.data).digest("hex"),
      });
      expect(row?.format_metadata).toMatchObject({
        index,
        source_path: member.path,
        flags: 0,
      });
      expect(row?.source_path).toBe(member.path);
      expect(row?.hash_status).toBe("verified");
    }
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(result.containment_verified).toBe(true);
    for (const member of members)
      expect(
        await readFile(join(result.output_root, member.path.slice(6)), "utf8"),
      ).toBe(member.data);
  },
);

cliTest.for([1, 4] as const)(
  "reads an embedded format %s pack while preserving the native carrier's content classification",
  async (version, { cli }) => {
    const root = await createTestTempDirectory("rea-pck-embedded-cli-");
    const source = join(root, "game.x86_64");
    const carrier = elf(2, 1, 62);
    const pack =
      version === 1
        ? buildGodotPck1(members, { carrierBytes: carrier.length })
        : buildGodotPck(4, members);
    const bytes = Buffer.concat([
      carrier,
      pack,
      pckU64(pack.length),
      Buffer.from("GDPC"),
    ]);
    await writeFile(source, bytes);
    const reply = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(reply.exitCode, reply.stdout + reply.stderr).toBe(0);
    const graph = graphFrom(reply.json);
    expect(graph.manifest.root_sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(
      graph.nodes.find(
        (row) => row.artifact_id === graph.manifest.root_artifact_id,
      )?.format,
    ).toBe("elf");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      embedded: true,
      pack_start: carrier.length,
      pack_end: carrier.length + pack.length,
    });
  },
);

cliTest(
  "keeps native inventory when an incidental GDPC trailer does not point at a pack header",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-marker-candidate-");
    const carrier = elf(2, 1, 62);
    const candidates = [
      Buffer.concat([carrier, Buffer.from("12345678ABCD", "ascii")]),
      Buffer.concat([carrier, Buffer.from("12345678GDPC", "ascii")]),
      Buffer.concat([
        carrier,
        Buffer.from("notpack!", "ascii"),
        pckU64(8),
        Buffer.from("GDPC", "ascii"),
      ]),
    ];

    for (const [index, bytes] of candidates.entries()) {
      const source = join(root, `candidate-${String(index)}.x86_64`);
      await writeFile(source, bytes);
      const reply = await cli.run({
        arguments: ["inspect-artifact", source, "--json"],
      });
      expect(reply.exitCode, reply.stdout + reply.stderr).toBe(0);
      const graph = graphFrom(reply.json);
      expect(graph.manifest.root_format).toBe("elf");
      expect(
        graph.nodes.find(
          (row) => row.artifact_id === graph.manifest.root_artifact_id,
        )?.format,
      ).toBe("elf");
      expect(graph.occurrences).toHaveLength(1);
    }
  },
);

cliTest(
  "refuses an unsupported version after an embedded trailer points at a PCK header",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-confirmed-malformed-");
    const source = join(root, "unsupported.x86_64");
    const pack = buildGodotPck(4, members);
    pack.writeUInt32LE(5, 4);
    await writeFile(
      source,
      Buffer.concat([
        elf(2, 1, 62),
        pack,
        pckU64(pack.length),
        Buffer.from("GDPC", "ascii"),
      ]),
    );

    const reply = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(reply.exitCode).toBe(1);
    expect(reply.json).toMatchObject({
      code: "artifact_operation_failed",
      details: {
        reason: "unavailable",
        detail: expect.stringContaining("Godot PCK format 5 is unsupported"),
      },
    });
  },
);

cliTest(
  "applies strict and record-and-continue MD5 integrity to inspection and extraction",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-integrity-cli-");
    const source = join(root, "contradiction.pck");
    await writeFile(
      source,
      buildGodotPck(4, [
        { path: "res://main.gd", data: "real", md5: Buffer.alloc(16, 1) },
      ]),
    );
    const rejected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(rejected.exitCode).toBe(1);
    expect(rejected.json).toMatchObject({
      code: "artifact_integrity_mismatch",
      details: {
        algorithm: "md5",
        logical_path: "main.gd",
        declared_md5: "01".repeat(16),
        calculated_md5: createHash("md5").update("real").digest("hex"),
      },
    });
    const inspected = await cli.run({
      arguments: [
        "inspect-artifact",
        source,
        "--integrity-policy",
        "record-and-continue",
        "--json",
      ],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const graph = graphFrom(inspected.json);
    expect(graph.integrity_contradictions).toEqual([
      expect.objectContaining({
        algorithm: "md5",
        logical_path: "main.gd",
        declared_md5: "01".repeat(16),
        observed_md5: createHash("md5").update("real").digest("hex"),
        trust: "observed-untrusted",
      }),
    ]);
    expect(
      graph.occurrences.find((row) => row.logical_path === "main.gd")
        ?.hash_status,
    ).toBe("mismatched");
    const extracted = await cli.run({
      arguments: [
        "extract-artifact",
        source,
        "--integrity-policy",
        "record-and-continue",
        "--json",
      ],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(result.integrity_contradictions).toHaveLength(1);
    expect(await readFile(join(result.output_root, "main.gd"), "utf8")).toBe(
      "real",
    );
  },
);

cliTest(
  "retains encrypted-directory declarations without claiming an empty package",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-encrypted-cli-");
    const source = join(root, "encrypted.pck");
    const bytes = buildGodotPck(4, members, { packFlags: 3 });
    const directory = Number(bytes.readBigUInt64LE(32));
    bytes.fill(0xff, directory + 4);
    await writeFile(source, bytes);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const graph = graphFrom(inspected.json);
    expect(graph.coverage).toEqual({
      scope: "container-entries",
      status: "unknown",
    });
    expect(graph.occurrences).toHaveLength(1);
    expect(graph.occurrences[0]).toMatchObject({
      encrypted: true,
      format_metadata: {
        directory_status: "encrypted",
        declared_file_count: 2,
      },
    });
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode).toBe(1);
  },
);

cliTest(
  "exports compact CLI delivery and queries its retained complete Evidence after unlink",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-export-");
    const source = join(root, "game.pck");
    const bundle = join(root, "evidence.json");
    const refused = await cli.run({
      arguments: ["inspect-artifact", source, "--detail", "summary", "--json"],
    });
    expect(refused.exitCode).toBe(1);
    expect(refused.json).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["evidence_output"] }] },
    });
    await writeFile(source, buildGodotPck(4, members));
    const args = [
      "inspect-artifact",
      source,
      "--detail",
      "summary",
      "--evidence_output",
      bundle,
      "--json",
    ];
    const reply = await cli.run({ arguments: args });
    expect(reply.exitCode, reply.stdout + reply.stderr).toBe(0);
    expect(reply.json).toMatchObject({
      evidence_bundle: { path: bundle, bytes: expect.any(Number) },
      summary: {
        normalized_result: {
          kind: "summary",
          summary: { root_format_metadata: { format_version: 4 } },
        },
      },
    });
    const saved = await readEvidenceBundle(bundle);
    if (!saved.ok) throw saved.error;
    const evidence = saved.value.records.find(
      (record) => record.operation === "inspect_artifact",
    );
    if (evidence === undefined) throw new Error("Missing complete inspection");
    expect(graphFrom(evidence).occurrences).toHaveLength(3);
    const inspection = artifactInspectionResultSchema.parse(
      evidence.normalized_result,
    );
    expect(saved.value.records).toContainEqual(
      inspection.substeps[0]?.evidence,
    );
    const before = await readFile(bundle);
    expect((await cli.run({ arguments: args })).exitCode).toBe(1);
    expect(Buffer.compare(await readFile(bundle), before)).toBe(0);
    await unlink(source);
    const query = join(root, "query.json");
    await writeFile(
      query,
      JSON.stringify({
        source: { kind: "inline", evidence },
        view: {
          kind: "inventory",
          collection: "occurrences",
          logical_paths: ["scripts/main.gd"],
          fields: ["logical_path"],
        },
      }),
    );
    const selected = await cli.run({
      arguments: ["inspect-analysis-view", query, "--json"],
    });
    expect(selected.exitCode, selected.stdout + selected.stderr).toBe(0);
    const view = analysisViewResultSchema.parse(
      parseEvidence(selected.json).normalized_result,
    );
    if (view.kind !== "inventory") throw new Error("Expected inventory view");
    expect(view.parent_evidence_id).toBe(evidence.evidence_id);
    expect(view.items).toEqual([
      expect.objectContaining({
        logical_path: "scripts/main.gd",
        occurrence_id: expect.any(String),
        artifact_id: expect.any(String),
        parent_occurrence_id: expect.any(String),
      }),
    ]);
  },
  30000,
);

cliTest(
  "rejects repeated-range expansion before hashing members or creating extraction output",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-pck-expansion-");
    const source = join(root, "aliased.pck");
    await writeFile(source, buildAliasedGodotPck(4, 1100));
    for (const operation of ["inspect-artifact", "extract-artifact"]) {
      for (const policy of ["fail", "record-and-continue"]) {
        const reply = await cli.run({
          arguments: [
            operation,
            source,
            "--integrity-policy",
            policy,
            "--json",
          ],
          environment: { TMPDIR: root, TMP: root, TEMP: root },
        });
        expect(reply.exitCode, reply.stdout + reply.stderr).toBe(1);
        expect(reply.json).toMatchObject({
          code: "truncated",
          details: {
            reason: "limit",
            truncated: true,
            detail: expect.stringContaining("expansion budget"),
          },
        });
        expect(await readdir(root)).toEqual(["aliased.pck"]);
      }
    }
  },
  30000,
);
