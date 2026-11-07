import {
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createPackageWithOptions, extractFile } from "@electron/asar";
import { expect, onTestFinished } from "vitest";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.skipIf(process.platform === "win32")(
  "public ASAR inspection and extraction use the selected alias companion",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asar-selected-cli-");
    const source = join(root, "source");
    const selected = join(root, "app.asar");
    const canonical = join(root, "content-addressed-archive");
    const bytes = Buffer.from("selected native companion");
    await mkdir(source);
    await writeFile(join(source, "native.node"), bytes);
    await createPackageWithOptions(source, selected, { unpack: "*.node" });
    await rename(selected, canonical);
    await symlink(canonical, selected);
    await mkdir(`${canonical}.unpacked`);
    await writeFile(
      join(`${canonical}.unpacked`, "native.node"),
      "different canonical bytes",
    );
    expect(extractFile(selected, "native.node").equals(bytes)).toBe(true);

    const inspected = await cli.run({
      arguments: ["inspect-artifact", selected, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    expect(parseEvidence(inspected.json).subject?.local_path).toBe(selected);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventoryEvidence = inspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("Missing inventory Evidence");
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    expect(
      inventory.occurrences.find(
        ({ logical_path }) => logical_path === "native.node",
      )?.hash_status,
    ).toBe("verified");

    const extracted = await cli.run({
      arguments: ["extract-artifact", selected, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    expect(parseEvidence(extracted.json).subject?.local_path).toBe(selected);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    onTestFinished(() =>
      rm(result.output_root, { recursive: true, force: true }),
    );
    expect(
      (await readFile(join(result.output_root, "native.node"))).equals(bytes),
    ).toBe(true);
  },
);
