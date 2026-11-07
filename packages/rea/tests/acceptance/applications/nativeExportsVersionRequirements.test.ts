import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { nativeExportsSchema } from "../../../src/domain/native/nativeExports.js";
import { elfExportImage } from "../../fixtures/binaryDiagnostics/nativeExports.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const contract = toolContract("inspect_native_exports");

cliTest(
  "retains export rows when their ELF version metadata is unavailable",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-version-coverage-");
    const path = join(root, "versioned.so");
    await writeFile(
      path,
      elfExportImage({
        symbols: [{ name: "a" }, { name: "b", version: 2 }],
        versionDefinitions: ["lib.so", "V1"],
        versionsOutsideFile: true,
      }),
    );
    const result = await cli.run({
      arguments: ["inspect-native-exports", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const report = nativeExportsSchema.parse(
      contract.outputSchema.parse(result.json).normalized_result,
    );
    expect(report.exports.map(({ name }) => name)).toEqual(["a", "b"]);
    expect(report.coverage).toMatchObject({
      status: "partial",
      exports: 2,
      reason:
        "1 export table issue(s) affect reported rows or metadata; see issues",
    });
    expect(report.issues).toMatchObject([{ code: "version_unresolved" }]);
  },
);

cliTest(
  "reports defined ELF symbols named by the version-requirement table",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-version-requirements-");
    const path = join(root, "copy-relocated-exports");
    const bytes = elfExportImage({
      symbols: [{ name: "stdout", type: 1, value: 0x28268n, version: 3 }],
      versionRequirements: [{ index: 3, name: "GLIBC_2.2.5" }],
    });
    await writeFile(path, bytes);

    const result = await cli.run({
      arguments: ["inspect-native-exports", path, "--json"],
    });
    expect(result.exitCode).toBe(0);
    const evidence = contract.outputSchema.parse(result.json);
    expect(nativeExportsSchema.parse(evidence.normalized_result)).toMatchObject(
      {
        format: "elf",
        coverage: { status: "complete", exports: 1 },
        issues: [],
        exports: [
          {
            name: "stdout",
            value: "0x28268",
            version: { index: 3, name: "GLIBC_2.2.5", hidden: false },
          },
        ],
      },
    );
  },
  30_000,
);

cliTest(
  "preserves UTF-8 GNU version names and their exact bytes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-elf-version-utf8-");
    const path = join(root, "versioned.so");
    await writeFile(
      path,
      elfExportImage({
        symbols: [{ name: "plain", version: 2 }],
        versionDefinitions: ["libfixture.so", "libcafÃ©.so"],
      }),
    );

    const result = await cli.run({
      arguments: ["inspect-native-exports", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = contract.outputSchema.parse(result.json);
    expect(nativeExportsSchema.parse(evidence.normalized_result)).toMatchObject(
      {
        format: "elf",
        coverage: { status: "complete", exports: 1 },
        issues: [],
        exports: [
          {
            name: "plain",
            version: {
              index: 2,
              name: "libcafé.so",
              name_bytes_base64: "bGliY2Fmw6kuc28=",
              name_utf8_decodable: true,
              hidden: false,
            },
          },
        ],
      },
    );
  },
  30_000,
);
