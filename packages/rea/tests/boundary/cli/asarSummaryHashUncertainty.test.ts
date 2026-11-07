import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createPackageWithOptions } from "@electron/asar";
import { expect } from "vitest";
import { z } from "zod";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const summarySchema = z.object({
  unknowns: z.array(z.string()),
  summary: z.object({ source_complete: z.boolean() }),
});

cliTest(
  "discloses unavailable ASAR content hashes in both summary routes and retains the parent",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asar-summary-");
    const source = join(root, "source");
    await mkdir(join(source, "native"), { recursive: true });
    await writeFile(join(source, "main.js"), "console.log(1);\n");
    const bytes = "inert addon bytes\n";
    await writeFile(join(source, "native", "addon.node"), bytes);
    const archive = join(root, "app.asar");
    await createPackageWithOptions(source, archive, { unpack: "*.node" });
    const companion = join(`${archive}.unpacked`, "native", "addon.node");
    const caveat =
      "Content hashes are unknown for some recorded files; missing node IDs do not prove content absence.";
    for (const phase of ["present", "missing", "restored"]) {
      if (phase === "missing") await rm(companion);
      if (phase === "restored") await writeFile(companion, bytes);
      const bundle = join(root, `${phase}-evidence.json`);
      const direct = await cli.run({
        arguments: [
          "inspect-artifact",
          archive,
          "--detail",
          "summary",
          "--evidence_output",
          bundle,
          "--json",
        ],
      });
      expect(direct.exitCode).toBe(0);
      const compact = z
        .object({ summary: z.object({ normalized_result: summarySchema }) })
        .parse(direct.json);
      const retained = z
        .object({ records: z.array(z.unknown()) })
        .parse(JSON.parse(await readFile(bundle, "utf8")));
      const parent = retained.records
        .map(parseEvidence)
        .find((record) => record.operation === "inspect_artifact");
      expect(parent).toBeDefined();
      const request = join(root, "request.json");
      await writeFile(
        request,
        JSON.stringify({
          source: { kind: "inline", evidence: parent },
          view: { kind: "summary" },
        }),
      );
      const inline = await cli.run({
        arguments: ["inspect-analysis-view", request, "--json"],
      });
      expect(inline.exitCode).toBe(0);
      const summary = summarySchema.parse(
        parseEvidence(inline.json).normalized_result,
      );
      const inspection = artifactInspectionResultSchema.parse(
        parent!.normalized_result,
      );
      const occurrence = inspection.substeps
        .flatMap((step) => step.evidence.normalized_result.occurrences)
        .find((row) => row.logical_path === "native/addon.node");
      expect(occurrence).toMatchObject({
        hash_status: phase === "missing" ? "unavailable" : "verified",
        ...(phase === "missing" ? { artifact_id: null } : {}),
      });
      for (const result of [compact.summary.normalized_result, summary]) {
        expect(result.summary.source_complete).toBe(true);
        expect(result.unknowns.includes(caveat), phase).toBe(
          phase === "missing",
        );
      }
    }
  },
);
