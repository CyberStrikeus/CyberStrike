import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import {
  managedArtifactInspectionSchema,
  managedMemberInspectionSchema,
  managedNativeBoundaryInspectionSchema,
} from "../../src/domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../../src/domain/managed/managedMemberComparison.js";
import { buildManagedPeFixture } from "../../src/dotnet/ManagedPe.fixture.js";
import { managedMetadataDelta } from "../fixtures/managedMetadataDelta.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "keeps EnC baseline-dependent metadata unknown through CLI and stdio MCP, then compares retained sources after deletion",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-delta-");
    const call = await cli.sharedMcpCall!();
    const sources: ReturnType<typeof parseEvidence>[] = [];
    for (const [name, bytes] of [
      ["delta", managedMetadataDelta().bytes],
      ["complete", buildManagedPeFixture()],
    ] as const) {
      const path = join(root, `${name}.dll`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(path, bytes);
      for (const [operation, command] of [
        ["inspect_managed_artifact", "inspect-managed-artifact"],
        ["inspect_managed_members", "inspect-managed-members"],
        [
          "inspect_managed_native_boundaries",
          "inspect-managed-native-boundaries",
        ],
      ] as const) {
        const selected = operation === "inspect_managed_members";
        const output = await cli.sharedCliRun!({
          arguments: [
            command,
            path,
            ...(selected ? ["--type", "Fixture.Program"] : []),
            "--json",
          ],
        });
        expect(output.exitCode, output.stderr).toBe(0);
        const evidence = parseEvidence(output.json);
        const schema =
          operation === "inspect_managed_artifact"
            ? managedArtifactInspectionSchema
            : selected
              ? managedMemberInspectionSchema
              : managedNativeBoundaryInspectionSchema;
        const report = schema.parse(evidence.normalized_result);
        expect(report.artifact).toMatchObject({ path, sha256 });
        expect(report.metadata.status).toBe(
          name === "delta" ? "partial" : "complete",
        );
        expect(report.coverage.state).toBe(
          name === "complete"
            ? "complete"
            : selected || operation === "inspect_managed_native_boundaries"
              ? "unavailable"
              : "partial",
        );
        if (name === "delta") {
          expect(report.module).toBeNull();
          expect(report.metadata.version).toBe("v4.0.30319");
          expect(report.metadata.table_row_counts).toEqual({});
          if ("identity_scope" in report)
            expect(report.identity_scope.requires_mvid).toBeNull();
          expect(report.coverage.issues).toEqual([
            expect.objectContaining({
              code: "unsupported-metadata",
              scope: "metadata.#JTD",
              detail: expect.stringContaining("baseline"),
            }),
          ]);
          if (operation === "inspect_managed_artifact") {
            const artifact = managedArtifactInspectionSchema.parse(report);
            expect(artifact.classification).toMatchObject({
              status: "managed",
              implementation: "unknown",
            });
            expect(artifact.pe.cli).toMatchObject({
              flags: 1,
              metadata_rva: expect.any(Number),
            });
            expect(artifact.metadata.stream_names).toEqual([
              "#-",
              "#Strings",
              "#US",
              "#GUID",
              "#Blob",
              "#JTD",
            ]);
          }
        } else expect(report.coverage.issues).toEqual([]);
        if (selected) {
          const members = managedMemberInspectionSchema.parse(report);
          expect(members.selection).toEqual({
            type_names: ["Fixture.Program"],
            unmatched_type_names: [],
          });
          if (name === "delta") {
            expect(members.method_rows).toBeNull();
            expect(members.methods).toEqual([]);
            expect(members.types).toEqual([]);
            expect(members.fields).toEqual([]);
            expect(members.user_strings).toBeNull();
          } else
            expect(members.method_rows).toEqual({
              offset: 0,
              count: 1,
              total: 1,
            });
          sources.push(evidence);
        }
        const response = await call(operation, {
          path,
          ...(selected ? { type_names: ["Fixture.Program"] } : {}),
        });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        expect(
          parseEvidence(response.structuredContent).normalized_result,
        ).toEqual(evidence.normalized_result);
      }
      expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
      await rm(path);
    }
    const compared = await call("compare_managed_members", {
      left: sources[0]!,
      right: sources[1]!,
    });
    expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
    const report = managedMemberComparisonResultSchema.parse(
      parseEvidence(compared.structuredContent).normalized_result,
    );
    expect(report.coverage.status).toBe("partial");
    expect(report.summary).toMatchObject({ added: 0, removed: 0, unknown: 2 });
    expect(report.evidence_links).toEqual(
      sources.map(({ evidence_id }) => evidence_id),
    );
  },
);
