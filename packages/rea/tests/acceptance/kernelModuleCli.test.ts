import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../src/contracts/toolContracts.js";
import {
  compressedKernelModuleContainer,
  kernelModuleFixture,
} from "../../src/native/elf/KernelModule.fixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "reports license, duplicate aliases, and version CRCs through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-kernel-module-cli-");
    const path = join(root, "demo.ko");
    await writeFile(path, kernelModuleFixture());
    const result = await cli.run({
      arguments: ["inspect-kernel-module", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_kernel_module").outputSchema.parse(
      result.json,
    );
    expect(
      evidence.normalized_result.modinfo?.entries.map((entry) => [
        entry.key,
        entry.value,
      ]),
    ).toEqual([
      ["license", "GPL"],
      ["vermagic", "5.15.0 SMP mod_unload"],
      ["alias", "pci:v1"],
      ["alias", "pci:v2"],
      ["name", "demo"],
      ["depends", ""],
    ]);
    expect(evidence.normalized_result.versions?.entries[0]?.crc_hex).toBe(
      "0000000012345678",
    );
    expect(evidence.normalized_result.signature?.status).toBe("present");
  },
);

cliTest(
  "resolves a relative kernel module path against the working directory",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-kernel-module-cli-rel-");
    await writeFile(join(root, "demo.ko"), kernelModuleFixture({ type: 3 }));
    const result = await cli.run({
      arguments: ["inspect-kernel-module", "demo.ko", "--json"],
      cwd: root,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_kernel_module").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result.applicability).toBe("not_applicable");
    expect(evidence.normalized_result.type_name).toBe("shared");
    expect(evidence.subject?.local_path).toBe(join(root, "demo.ko"));
  },
);

cliTest("reports a non-ELF file as invalid input", async ({ cli }) => {
  const root = await createTestTempDirectory("rea-kernel-module-cli-bad-");
  const path = join(root, "broken.ko");
  await writeFile(path, Buffer.from("not an elf"));
  const result = await cli.run({
    arguments: ["inspect-kernel-module", path, "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.json).toMatchObject({
    code: "invalid_request",
    details: { operation: "inspect_kernel_module" },
  });
});

cliTest(
  "reports a compressed container without claiming the payload is a module",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-kernel-module-cli-xz-");
    const path = join(root, "demo.ko.xz");
    await writeFile(path, compressedKernelModuleContainer("xz"));
    const result = await cli.run({
      arguments: ["inspect-kernel-module", path, "--json"],
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const evidence = toolContract("inspect_kernel_module").outputSchema.parse(
      result.json,
    );
    expect(evidence.normalized_result).toMatchObject({
      applicability: "unsupported",
      format: null,
      compression: { codec: "xz", status: "unsupported" },
      next_probe: { operation: "external_decompression" },
      modinfo: null,
    });
    expect(evidence.subject?.format).toBe("file");
  },
);
