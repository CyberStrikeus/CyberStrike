import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, onTestFinished } from "vitest";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest
  .skipIf(process.platform === "win32")
  .for(["content-addressed-archive", "stored.ipa"])(
  "public APK aliases retain package selection through inspection, projection and extraction from %s",
  async (storedName, { cli }) => {
    const root = await createTestTempDirectory("rea-selected-apk-cli-");
    const stored = join(root, storedName);
    const selected = join(root, "selected.apk");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      "AndroidManifest.xml",
      new TextReader(
        '<manifest package="example.fixture"><application /></manifest>',
      ),
    );
    await writer.add("payload.txt", new TextReader("same packed bytes"));
    await writeFile(stored, await writer.close());
    await symlink(stored, selected);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", selected, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspectedEvidence = parseEvidence(inspected.json);
    expect(inspectedEvidence.subject?.local_path).toBe(selected);
    const inspection = artifactInspectionResultSchema.parse(
      inspectedEvidence.normalized_result,
    );
    const inventoryEvidence = inspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("Missing inventory Evidence");
    expect(
      artifactInventoryResultSchema.parse(inventoryEvidence.normalized_result)
        .manifest.root_format,
    ).toBe("apk");
    const projection = await cli.run({
      arguments: [
        "project-android-application-graph",
        JSON.stringify({ inventory_evidence: [inventoryEvidence] }),
        "--json",
      ],
    });
    expect(projection.exitCode, projection.stdout + projection.stderr).toBe(0);
    expect(parseEvidence(projection.json).subject?.format).toBe("apk");
    const extracted = await cli.run({
      arguments: ["extract-artifact", selected, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const extractedEvidence = parseEvidence(extracted.json);
    expect(extractedEvidence.subject?.local_path).toBe(selected);
    const result = artifactExtractionResultSchema.parse(
      extractedEvidence.normalized_result,
    );
    onTestFinished(() =>
      rm(result.output_root, { recursive: true, force: true }),
    );
    expect(result.manifest.root_format).toBe("apk");
    expect(
      await readFile(join(result.output_root, "payload.txt"), "utf8"),
    ).toBe("same packed bytes");
  },
);
