import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createSingleEntryZip } from "../../fixtures/zipNames.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

cliTest.skipIf(process.platform === "win32")(
  "retains the selected archive alias without changing inventory identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-artifact-selected-alias-");
    const target = join(root, "program.zip");
    const alias = "selected-alias.zip";
    await writeFile(target, await createSingleEntryZip("payload.txt"));
    await symlink(target, join(root, alias));
    const selected = await cli.run({
      arguments: ["inspect-artifact", alias, "--json"],
      cwd: root,
    });
    const control = await cli.run({
      arguments: ["inspect-artifact", target, "--json"],
      cwd: root,
    });
    expect(selected.exitCode).toBe(0);
    expect(control.exitCode).toBe(0);
    const observed = parseEvidence(selected.json);
    const direct = parseEvidence(control.json);
    expect(observed.parameters).toMatchObject({ input_path: alias });
    expect(observed.subject?.local_path).toBe(join(root, alias));
    expect(direct.subject?.local_path).toBe(target);
    expect(observed.subject?.digest.sha256).toBe(direct.subject?.digest.sha256);
    const selectedInspection = artifactInspectionResultSchema.parse(
      observed.normalized_result,
    );
    const directInspection = artifactInspectionResultSchema.parse(
      direct.normalized_result,
    );
    expect(selectedInspection.subject).toEqual(directInspection.subject);
    const selectedInventory = selectedInspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    const directInventory = directInspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    if (selectedInventory === undefined || directInventory === undefined)
      throw new Error("Missing nested inventory Evidence");
    expect(selectedInventory.subject?.local_path).toBe(join(root, alias));
    expect(selectedInventory.normalized_result).toEqual(
      directInventory.normalized_result,
    );
  },
);

cliTest(
  "offers a fresh destination after protected inspection publication collides, preserving the existing bundle",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-artifact-collision-guidance-",
    );
    const archive = join(root, "program.zip");
    const output = join(root, "evidence.json");
    await writeFile(archive, await createSingleEntryZip("payload.txt"));
    const args = [
      "inspect-artifact",
      archive,
      "--detail",
      "summary",
      "--evidence_output",
      output,
      "--json",
    ];
    const initial = await cli.run({ arguments: args });
    expect(initial.exitCode).toBe(0);
    const before = await readFile(output);
    const collision = await cli.run({ arguments: args });
    expect(collision.exitCode).not.toBe(0);
    expect(collision.json).toMatchObject({
      code: "invalid_request",
      message: "Evidence file already exists. Choose another output path.",
      remediation: {
        action: "Evidence file already exists. Choose another output path.",
      },
    });
    expect(Buffer.compare(await readFile(output), before)).toBe(0);
    const next = await cli.run({
      arguments: [
        "inspect-artifact",
        archive,
        "--detail",
        "summary",
        "--evidence_output",
        join(root, "next.json"),
        "--json",
      ],
    });
    expect(next.exitCode).toBe(0);
  },
);
